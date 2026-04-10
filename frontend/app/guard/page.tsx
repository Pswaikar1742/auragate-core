"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  HEALTH_SMOKE_PATH,
  resolveBackendBase,
  resolveWsBase,
  buildWsPath,
} from "../../lib/runtimeConfig";

const FLAT_OPTIONS = ["T4-401", "T4-402"];
const VISITOR_TYPES = ["Delivery", "Maid", "Guest"];

type TotpResponse = {
  secret: string;
  otp_auth_uri: string;
  current_otp: string;
  valid_for_seconds: number;
  interval_seconds: number;
};

type VisitorResponse = {
  message: string;
  visitor: {
    id: string;
    visitor_name: string;
    visitor_type: string;
    flat_number: string;
    status: string;
    timestamp: string;
  };
};

export default function GuardPage() {
  const backendBase = useMemo(() => resolveBackendBase(), []);
  const wsBase = useMemo(() => resolveWsBase(backendBase), [backendBase]);
  const [visitorName, setVisitorName] = useState("");
  const [flatNumber, setFlatNumber] = useState(FLAT_OPTIONS[0]);
  const [visitorType, setVisitorType] = useState(VISITOR_TYPES[0]);
  const [totp, setTotp] = useState<TotpResponse | null>(null);
  const [loadingTotp, setLoadingTotp] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [notifications, setNotifications] = useState<Array<any>>([]);
  const [flash, setFlash] = useState<{ visible: boolean; message: string } | null>(null);
  const [flashDuration, setFlashDuration] = useState<number>(8);
  const [guestQr, setGuestQr] = useState<any | null>(null);
  const [mode, setMode] = useState<"single" | "multi" | "qr" | "frequent">("single");
  const [multiFlats, setMultiFlats] = useState<string>("");
  const [favorites, setFavorites] = useState<Array<{ name: string; flat: string; type: string }>>([]);

  // Polling keeps OTP metadata fresh so the guard sees live validity windows.
  useEffect(() => {
    let isMounted = true;

    const loadTotp = async () => {
      try {
        const apiPath = backendBase ? `${backendBase}/api/guard/totp` : "/api/guard/totp";
        const response = await fetch(apiPath, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`Unable to load guard QR payload (HTTP ${response.status}).`);
        }
        const payload = (await response.json()) as TotpResponse;
        if (isMounted) {
          setTotp(payload);
          setLoadingTotp(false);
        }
      } catch (error) {
        if (isMounted) {
          const baseHint = backendBase || "http://127.0.0.1:8001";
          const fallback = `Cannot reach backend for QR data. Expected: ${baseHint}`;
          setStatusText(error instanceof Error ? `${error.message} ${fallback}` : fallback);
          setLoadingTotp(false);
        }
      }
    };

    void loadTotp();
    const intervalId = window.setInterval(() => void loadTotp(), 5000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
      if (countdownRef.current) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [backendBase]);

  useEffect(() => {
    if (!wsBase) return;

    const wsPath = buildWsPath("/ws/guard", wsBase);
    let socket: WebSocket | null = null;
    try {
      socket = new WebSocket(wsPath);
    } catch (err) {
      setStatusText(`Guard WebSocket failed: ${String(err)}`);
      return;
    }

    let pingIntervalId: number | undefined;

    socket.onopen = () => {
      setWsConnected(true);
      setStatusText("Guard channel connected.");
      pingIntervalId = window.setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 15000);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as any;
        // record notification for guard UI
        setNotifications((prev) => [{ received_at: Date.now(), payload }, ...prev].slice(0, 50));

        if (payload.event === "visitor_approved" && payload.visitor) {
          const name = payload.visitor.visitor_name || "Visitor";
          setStatusText(`Approved: ${name}`);
          // flash green overlay
          setFlash({ visible: true, message: `Approved: ${name}` });
          window.setTimeout(() => setFlash(null), (flashDuration || 8) * 1000);
        }

        if (payload.event === "sos_alert") {
          setStatusText("SOS alert received — check notifications.");
        }
      } catch {
        setStatusText("Received malformed guard channel message.");
      }
    };

    socket.onclose = () => {
      setWsConnected(false);
      setStatusText("Guard channel disconnected.");
      if (pingIntervalId) window.clearInterval(pingIntervalId);
    };

    socket.onerror = () => {
      setStatusText("Guard WebSocket error — verify backend connectivity.");
    };

    return () => {
      if (pingIntervalId) window.clearInterval(pingIntervalId);
      if (socket) socket.close();
    };
  }, [wsBase, flashDuration]);

  // Lightweight client-side smoke ping to help detect runtime integration during demos.
  // Uses a relative path so CI/build smoke-check can assert presence of `/api/health`.
  useEffect(() => {
    const smokePath = backendBase ? `${backendBase}/health` : HEALTH_SMOKE_PATH;
    void fetch(smokePath, { cache: "no-store" }).catch(() => {
      /* ignore network errors in browser demos */
    });
  }, [backendBase]);

  const qrValue = useMemo(() => {
    if (!totp) {
      return "auragate://loading";
    }

    // Encode URI + current token snapshot to make the QR visibly dynamic for demos.
    return JSON.stringify({
      otpAuthUri: totp.otp_auth_uri,
      currentOtp: totp.current_otp,
      generatedAt: new Date().toISOString(),
    });
  }, [totp]);

  const performCheckIn = async () => {
    setSubmitting(true);
    setStatusText("");

    if (!visitorName || visitorName.trim().length === 0) {
      setStatusText("Visitor name is required for check-in.");
      setSubmitting(false);
      return;
    }

    try {
      const apiPath = backendBase ? `${backendBase}/api/visitors/check-in` : "/api/visitors/check-in";
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          visitor_name: visitorName,
          visitor_type: visitorType,
          flat_number: flatNumber,
        }),
      });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        const detail =
          typeof errorPayload?.detail === "string"
            ? errorPayload.detail
            : "Check-in failed. Please verify resident data.";
        throw new Error(detail);
      }

      const payload = (await response.json()) as VisitorResponse;
      setStatusText(`${payload.message} Visitor ID: ${payload.visitor.id}`);
      setVisitorName("");

      // clear any running countdown
      if (countdownRef.current) {
        window.clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      setCountdown(null);
    } catch (error) {
      if (error instanceof TypeError) {
        const baseHint = backendBase || "http://127.0.0.1:8001";
        setStatusText(`Backend is unreachable for check-in. Expected: ${baseHint}`);
      } else {
        setStatusText(error instanceof Error ? error.message : "Unexpected check-in error.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await performCheckIn();
  };

  const startCountdown = (seconds = 15) => {
    if (!visitorName || visitorName.trim().length === 0) {
      setStatusText("Enter a visitor name before starting the countdown.");
      return;
    }

    if (countdownRef.current) {
      // already running
      return;
    }

    setCountdown(seconds);
    const id = window.setInterval(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          if (countdownRef.current) {
            window.clearInterval(countdownRef.current);
            countdownRef.current = null;
          }
          // auto-checkin when countdown ends
          void performCheckIn();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    countdownRef.current = id as unknown as number;
  };

  const cancelCountdown = () => {
    if (countdownRef.current) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
      setCountdown(null);
      setStatusText("Countdown cancelled.");
    }
  };

  // Multi-flat check-in
  const performMultiFlatCheckIn = async () => {
    setSubmitting(true);
    setStatusText("");

    const flats = multiFlats
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    if (flats.length === 0) {
      setStatusText("Enter at least one flat for multi-flat delivery.");
      setSubmitting(false);
      return;
    }

    try {
      const apiPath = backendBase ? `${backendBase}/api/visitors/multi-flat` : "/api/visitors/multi-flat";
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitor_name: visitorName || "Delivery", visitor_type: visitorType, flat_numbers: flats }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(typeof err?.detail === "string" ? err.detail : "Multi-flat check-in failed.");
      }

      const payload = await response.json();
      setStatusText(`${payload.message} Group ID: ${payload.group_id}`);
      setVisitorName("");
      setMultiFlats("");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Unexpected multi-flat error.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMultiSubmit = async (e: FormEvent) => {
    e.preventDefault();
    await performMultiFlatCheckIn();
  };

  // Guest QR generation (visitor scans and verifies themselves)
  const generateGuestQr = async () => {
    setStatusText("");
    try {
      const api = backendBase
        ? `${backendBase}/api/totp/generate?guest_name=${encodeURIComponent(visitorName || "Guest Pass")}&flat_number=${encodeURIComponent(flatNumber)}`
        : `/api/totp/generate?guest_name=${encodeURIComponent(visitorName || "Guest Pass")}&flat_number=${encodeURIComponent(flatNumber)}`;
      const response = await fetch(api, { cache: "no-store" });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(typeof err?.detail === "string" ? err.detail : "Guest QR generation failed.");
      }

      const payload = await response.json();
      setGuestQr(payload);
      setStatusText("Guest QR generated. Show the QR to the visitor.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Unexpected QR error.");
    }
  };

  // Emergency SOS trigger
  const triggerEmergency = async () => {
    setStatusText("");
    try {
      const apiPath = backendBase ? `${backendBase}/api/emergency/sos` : "/api/emergency/sos";
      const response = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flat_number: flatNumber, source: "guard_kiosk" }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(typeof err?.detail === "string" ? err.detail : "Emergency failed.");
      }
      const payload = await response.json();
      setStatusText(payload.message || "Emergency sent.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Unexpected emergency error.");
    }
  };

  // Favorites persistence
  useEffect(() => {
    try {
      const raw = localStorage.getItem("guard_favorites");
      if (raw) setFavorites(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  const addFavorite = () => {
    const entry = { name: visitorName || "Guest", flat: flatNumber, type: visitorType };
    const next = [entry, ...favorites].slice(0, 30);
    setFavorites(next);
    try {
      localStorage.setItem("guard_favorites", JSON.stringify(next));
      setStatusText("Added to favorites.");
    } catch {
      setStatusText("Unable to save favorite.");
    }
  };

  const removeFavorite = (index: number) => {
    const next = favorites.filter((_, i) => i !== index);
    setFavorites(next);
    try {
      localStorage.setItem("guard_favorites", JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  return (
    <>
      <main className="grid-overlay mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-8 px-4 py-10 text-navy md:flex-row md:items-start">
      <section className="w-full rounded-2xl border border-navy/80 bg-white p-6 shadow-offset-safety md:w-2/5">
        <h1 className="headline text-2xl font-bold text-navy">Guard Access QR</h1>
        <p className="mt-2 text-navy/70">Tower 4 secure check-in token (TOTP-based)</p>

        <div className="mt-6 flex justify-center rounded-xl border border-navy bg-vintage p-4">
          {loadingTotp ? (
            <p className="text-navy/70">Loading QR...</p>
          ) : (
            <QRCodeSVG value={qrValue} size={240} bgColor="#F4F1EA" fgColor="#1B2A47" />
          )}
        </div>

        {totp && (
          <div className="mt-4 rounded-lg border border-navy bg-vintage p-4 text-sm">
            <p>
              OTP: <span className="font-bold text-navy">{totp.current_otp}</span>
            </p>
            <p className="mt-1 text-navy/70">Valid for: {totp.valid_for_seconds}s</p>
          </div>
        )}
      </section>

      <section className="w-full rounded-2xl border border-navy/80 bg-white p-6 shadow-offset-safety md:w-3/5">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="headline text-2xl font-bold text-navy">Visitor Check-In</h2>
            <p className="mt-2 text-navy/70">Submit a check-in that notifies residents and guard.</p>
            <p className="mt-1 text-xs text-navy/60">Backend target: {backendBase || "relative /api"}</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="text-sm text-navy/70 mr-1">Mode:</div>
            <button
              onClick={() => setMode("single")}
              className={`rounded-md px-3 py-1 text-sm font-semibold ${mode === "single" ? "bg-navy text-white" : "bg-vintage text-navy"}`}
            >
              Single
            </button>
            <button
              onClick={() => setMode("multi")}
              className={`rounded-md px-3 py-1 text-sm font-semibold ${mode === "multi" ? "bg-navy text-white" : "bg-vintage text-navy"}`}
            >
              Multi-flat
            </button>
            <button
              onClick={() => setMode("qr")}
              className={`rounded-md px-3 py-1 text-sm font-semibold ${mode === "qr" ? "bg-navy text-white" : "bg-vintage text-navy"}`}
            >
              QR
            </button>
            <button
              onClick={() => setMode("frequent")}
              className={`rounded-md px-3 py-1 text-sm font-semibold ${mode === "frequent" ? "bg-navy text-white" : "bg-vintage text-navy"}`}
            >
              Frequent
            </button>
            <button
              onClick={() => void triggerEmergency()}
              className="ml-3 rounded-md border border-rose-500 bg-rose-500/10 px-3 py-1 text-sm font-black text-rose-600"
            >
              EMERGENCY
            </button>
          </div>
        </div>

        <div className="mt-4">
          {mode === "single" && (
            <form onSubmit={handleSubmit} className="mt-3 grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-navy">Visitor Name</span>
                <input
                  value={visitorName}
                  onChange={(event) => setVisitorName(event.target.value)}
                  required
                  placeholder="e.g., Ramesh Kumar"
                  className="rounded-lg border border-navy bg-vintage px-4 py-3 text-navy outline-none focus:border-safety"
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-navy">Flat Number</span>
                  <select
                    value={flatNumber}
                    onChange={(event) => setFlatNumber(event.target.value)}
                    className="rounded-lg border border-navy bg-vintage px-4 py-3 text-navy outline-none focus:border-safety"
                  >
                    {FLAT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-navy">Visitor Type</span>
                  <select
                    value={visitorType}
                    onChange={(event) => setVisitorType(event.target.value)}
                    className="rounded-lg border border-navy bg-vintage px-4 py-3 text-navy outline-none focus:border-safety"
                  >
                    {VISITOR_TYPES.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="headline mt-2 rounded-lg border border-navy px-4 py-3 font-semibold text-navy transition hover:bg-safety hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Submitting..." : "Check In Visitor"}
                </button>

                <button
                  type="button"
                  onClick={() => addFavorite()}
                  className="mt-2 rounded-lg border border-navy px-4 py-3 font-semibold text-navy bg-transparent hover:bg-navy hover:text-white"
                >
                  Add Favorite
                </button>
              </div>
            </form>
          )}

          {mode === "multi" && (
            <form onSubmit={handleMultiSubmit} className="mt-3 grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-navy">Delivery Name</span>
                <input
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  placeholder="e.g., Quick Delivery"
                  className="rounded-lg border border-navy bg-vintage px-4 py-3 text-navy outline-none focus:border-safety"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-navy">Target Flats (comma-separated)</span>
                <input
                  value={multiFlats}
                  onChange={(e) => setMultiFlats(e.target.value)}
                  placeholder="T4-401, T4-402"
                  className="rounded-lg border border-navy bg-vintage px-4 py-3 text-navy outline-none focus:border-safety"
                />
              </label>

              <div className="flex gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="headline mt-2 rounded-lg border border-navy px-4 py-3 font-semibold text-navy transition hover:bg-safety hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Submitting..." : "Check In Multi-flat"}
                </button>
              </div>
            </form>
          )}

          {mode === "qr" && (
            <div className="mt-3 grid gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-navy">Guest Name</span>
                <input
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  placeholder="e.g., Guest Pass"
                  className="rounded-lg border border-navy bg-vintage px-4 py-3 text-navy outline-none focus:border-safety"
                />
              </label>

              <div className="flex gap-3 items-center">
                <select
                  value={flatNumber}
                  onChange={(e) => setFlatNumber(e.target.value)}
                  className="rounded-lg border border-navy bg-vintage px-4 py-3 text-navy outline-none focus:border-safety"
                >
                  {FLAT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>

                <button
                  onClick={() => void generateGuestQr()}
                  className="headline rounded-lg border border-navy px-4 py-3 font-semibold text-navy transition hover:bg-safety hover:text-white"
                >
                  Generate Guest QR
                </button>
              </div>

              {guestQr && (
                <div className="mt-3 flex items-center gap-4">
                  <div className="rounded-lg border border-navy bg-white p-3">
                    <QRCodeSVG value={guestQr.provisioned_uri ?? JSON.stringify(guestQr)} size={160} bgColor="#F4F1EA" fgColor="#1B2A47" />
                  </div>
                  <div>
                    <p className="text-sm text-navy/70">Visitor ID: {guestQr.visitor_id}</p>
                    <p className="mt-1 text-navy">Code: <span className="font-bold">{guestQr.current_otp}</span></p>
                    <p className="mt-1 text-sm text-navy/70">Valid for: {guestQr.valid_for_seconds}s</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {mode === "frequent" && (
            <div className="mt-3 grid gap-3">
              <div className="flex gap-2">
                <button onClick={() => addFavorite()} className="rounded-md border border-navy px-3 py-2 text-sm">Add Current</button>
                <div className="ml-2 text-sm text-navy/70">Favorites saved locally</div>
              </div>
              <div className="grid gap-2">
                {favorites.length === 0 ? (
                  <p className="text-sm text-navy/70">No favorites yet.</p>
                ) : (
                  favorites.map((f, i) => (
                    <div key={`${f.flat}-${i}`} className="flex items-center justify-between gap-2 rounded-lg border border-navy bg-vintage p-2">
                      <div>
                        <div className="font-semibold text-navy">{f.name}</div>
                        <div className="text-sm text-navy/70">{f.flat} • {f.type}</div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setVisitorName(f.name); setFlatNumber(f.flat); setVisitorType(f.type); void performCheckIn(); }}
                          className="rounded-md border border-navy px-3 py-2 text-sm bg-navy text-white"
                        >
                          Check-in
                        </button>
                        <button onClick={() => removeFavorite(i)} className="rounded-md border border-navy px-3 py-2 text-sm">Remove</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => startCountdown(15)}
              className="rounded-md border border-navy bg-vintage px-3 py-2 text-sm text-navy hover:border-safety"
            >
              Start 15s Countdown
            </button>

            <button
              type="button"
              onClick={() => {
                void performCheckIn();
              }}
              className="rounded-md border border-navy bg-transparent px-3 py-2 text-sm font-semibold text-navy hover:bg-safety hover:text-white"
            >
              Simulate Now
            </button>

            {countdown !== null && (
              <>
                <button
                  type="button"
                  onClick={cancelCountdown}
                  className="rounded-md border border-rose-500 bg-transparent px-3 py-2 text-sm text-rose-400 hover:bg-rose-500/10"
                >
                  Cancel
                </button>
                <span className="ml-2 font-mono text-sm font-semibold text-navy">{countdown}s</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-navy/70">Flash (s)</label>
            <input value={String(flashDuration)} onChange={(e) => setFlashDuration(Number(e.target.value || 8))} className="w-16 rounded-md border border-navy bg-vintage px-2 py-1 text-sm text-navy" />
            <button onClick={() => setNotifications([])} className="ml-3 rounded-md border border-navy px-3 py-2 text-sm">Clear</button>
          </div>
        </div>

        {statusText && (
          <p className="mt-4 rounded-lg border border-navy bg-vintage p-3 text-sm text-navy">{statusText}</p>
        )}

        <div className="mt-4">
          <h3 className="text-sm font-semibold text-navy">Notifications</h3>
          <div className="mt-2 max-h-40 overflow-y-auto space-y-2">
            {notifications.length === 0 ? (
              <p className="text-sm text-navy/70">No recent notifications</p>
            ) : (
              notifications.map((item, idx) => (
                <div key={idx} className="rounded-md border border-navy bg-vintage p-2 text-sm">
                  <div className="font-bold text-navy">{item.payload.event}</div>
                  <div className="text-navy/70">{item.payload.visitor ? `${item.payload.visitor.visitor_name} • ${item.payload.flat_number ?? item.payload.visitor.flat_number}` : JSON.stringify(item.payload)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
      </main>

      {flash && flash.visible ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-safety/95 text-white">
          <div className="max-w-lg rounded-lg border-2 border-white/20 bg-safety/100 p-8 text-center shadow-xl">
            <h3 className="text-3xl font-black">{flash.message}</h3>
            <p className="mt-2 text-lg">Approved — show to guard for recognition.</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
