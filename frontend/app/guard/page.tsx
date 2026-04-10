"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { AlertTriangle, Car, Camera, Package, QrCode, ShieldAlert, UserRoundCheck, Users, X } from "lucide-react";
import {
  HEALTH_SMOKE_PATH,
  resolveBackendBase,
  resolveWsBase,
  buildWsPath,
} from "../../lib/runtimeConfig";

const DEFAULT_FLAT_OPTIONS = ["T4-401", "T4-402", "T4-503"];
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

type VisitorRow = {
  id?: string;
  visitor_name?: string;
  visitor_type?: string;
  flat_number?: string;
  status?: string;
  timestamp?: string;
  [k: string]: unknown;
};

type GuestQrPayload = {
  visitor_id?: string;
  provisioned_uri?: string;
  current_otp?: string;
  valid_for_seconds?: number;
  [k: string]: unknown;
};

type GuardNotification = {
  received_at: number;
  payload: Record<string, unknown>;
};

export default function GuardPage() {
  const backendBase = useMemo(() => resolveBackendBase(), []);
  const wsBase = useMemo(() => resolveWsBase(backendBase), [backendBase]);
  const [visitorName, setVisitorName] = useState("");
  const [flatOptions, setFlatOptions] = useState<string[]>(DEFAULT_FLAT_OPTIONS);
  const [flatNumber, setFlatNumber] = useState(flatOptions[0]);
  const [visitorType, setVisitorType] = useState(VISITOR_TYPES[0]);
  const [totp, setTotp] = useState<TotpResponse | null>(null);
  const [loadingTotp, setLoadingTotp] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const [notifications, setNotifications] = useState<GuardNotification[]>([]);
  const [flash, setFlash] = useState<{ visible: boolean; message: string } | null>(null);
  const [flashDuration, setFlashDuration] = useState<number>(8);
  const [guestQr, setGuestQr] = useState<GuestQrPayload | null>(null);
  const [mode, setMode] = useState<"single" | "multi" | "qr" | "frequent" | "logs">("single");
  const [multiFlats, setMultiFlats] = useState<string>("");
  const [logs, setLogs] = useState<VisitorRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [favorites, setFavorites] = useState<Array<{ name: string; flat: string; type: string }>>([]);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [verifyVisitorId, setVerifyVisitorId] = useState("");
  const [verifyCode, setVerifyCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [activeModal, setActiveModal] = useState<null | "single" | "multi" | "frequent" | "logs">(null);

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
  }, [backendBase, favorites.length, flatNumber]);

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
      setStatusText("Guard channel connected.");
      pingIntervalId = window.setInterval(() => {
        if (socket && socket.readyState === WebSocket.OPEN) socket.send("ping");
      }, 15000);
    };

    socket.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data) as unknown;
        const payload = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
        // record notification for guard UI
        setNotifications((prev) => [{ received_at: Date.now(), payload }, ...prev].slice(0, 50));

        const eventName = typeof payload.event === "string" ? payload.event : undefined;

        if (eventName === "visitor_approved" && typeof payload.visitor === "object" && payload.visitor !== null) {
          const visitor = payload.visitor as Record<string, unknown>;
          const name = typeof visitor.visitor_name === "string" ? visitor.visitor_name : "Visitor";
          setStatusText(`Approved: ${name}`);
          // flash green overlay
          setFlash({ visible: true, message: `Approved: ${name}` });
          window.setTimeout(() => setFlash(null), (flashDuration || 8) * 1000);
        }

        if (eventName === "sos_alert") {
          setStatusText("SOS alert received — check notifications.");
        }
      } catch {
        setStatusText("Received malformed guard channel message.");
      }
    };

    socket.onclose = () => {
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

  // Fetch recent visitor history, seed flats and favorites
  const fetchVisitorHistory = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const api = backendBase ? `${backendBase}/api/visitors/history?limit=200` : `/api/visitors/history?limit=200`;
      const res = await fetch(api, { cache: "no-store" });
      if (!res.ok) throw new Error("Unable to fetch visitor history");
      const payload = await res.json();
      const rows = (payload.visitors ?? []) as VisitorRow[];
      setLogs(rows);

      // derive flats from history
      const flats = Array.from(
        new Set(
          rows
            .map((r) => r.flat_number)
            .filter((x): x is string => typeof x === "string")
        )
      );
      if (flats.length > 0) {
        setFlatOptions((prev) => Array.from(new Set([...prev, ...flats])));
        if (!flatNumber && flats.length > 0) setFlatNumber(flats[0]);
      }

      // seed favorites from most frequent visitor names (top 5)
      const counts: Record<string, number> = {};
      rows.forEach((r) => {
        const key = `${r.visitor_name ?? ""}||${r.flat_number ?? ""}||${r.visitor_type ?? ""}`;
        counts[key] = (counts[key] || 0) + 1;
      });
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
      const seeded = sorted.map(([k]) => {
        const [name, flat, type] = k.split("||");
        return { name, flat, type };
      });
      if (seeded.length && favorites.length === 0) {
        setFavorites(seeded);
        try {
          localStorage.setItem("guard_favorites", JSON.stringify(seeded));
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore silently — guard UI still functional
    } finally {
      setLoadingLogs(false);
    }
  }, [backendBase, favorites.length, flatNumber]);

  useEffect(() => {
    void fetchVisitorHistory();
    // sync flatNumber with options when options change
  }, [fetchVisitorHistory]);

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
      void fetchVisitorHistory();
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
      if (typeof payload?.visitor_id === "string") {
        setVerifyVisitorId(payload.visitor_id);
      }
      setStatusText("Guest QR generated. Show the QR to the visitor.");
      // refresh history so guard sees the created visitor row
      void fetchVisitorHistory();
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
      void fetchVisitorHistory();
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

  // TOTP verify for expected guest
  const verifyTotp = async () => {
    if (!verifyVisitorId || !verifyCode) return setStatusText("visitor id and code required");
    setVerifying(true);
    setStatusText("");
    try {
      const api = backendBase ? `${backendBase}/api/visitors/verify-totp` : `/api/visitors/verify-totp`;
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visitor_id: verifyVisitorId, scanned_code: verifyCode }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Verification failed");
      }
      await res.json();
      setStatusText("Verification success — approved.");
      setFlash({ visible: true, message: `Approved: ${verifyVisitorId}` });
      window.setTimeout(() => setFlash(null), (flashDuration || 8) * 1000);
      setVerifyModalOpen(false);
      setVerifyVisitorId("");
      setVerifyCode("");
      void fetchVisitorHistory();
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  // Random visitor generator using unplanned endpoint
  const generateRandomVisitor = async () => {
    const names = ["Ramesh Kumar", "Sunita Sharma", "Vikram Patel", "Neha Rao", "Aarav Mehta"];
    const categories: Array<"Delivery" | "Maid" | "Staff" | "Unknown"> = ["Delivery", "Maid", "Staff", "Unknown"];
    const name = names[Math.floor(Math.random() * names.length)];
    const category = categories[Math.floor(Math.random() * categories.length)];
    const targetFlat = flatOptions.length ? flatOptions[Math.floor(Math.random() * flatOptions.length)] : flatNumber;
    setStatusText("Creating random visitor...");
    try {
      const api = backendBase ? `${backendBase}/api/visitors/unplanned` : `/api/visitors/unplanned`;
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, flat_number: targetFlat, visitor_name: name }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to create random visitor");
      }
      const payload = await res.json();
      setStatusText(payload.message || "Random visitor created.");
      void fetchVisitorHistory();
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "Random visitor failed.");
    }
  };

  const submitUnknownVisitor = async () => {
    setSubmitting(true);
    setStatusText("Running unknown visitor identity check...");
    try {
      const api = backendBase ? `${backendBase}/api/visitors/unplanned` : "/api/visitors/unplanned";
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "Unknown",
          flat_number: flatNumber,
          visitor_name: visitorName || "Unknown",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err?.detail === "string" ? err.detail : "Identity check failed");
      }
      const payload = await res.json();
      setStatusText(payload.message || "Unknown visitor logged and resident alerted.");
      void fetchVisitorHistory();
    } catch (err) {
      setStatusText(err instanceof Error ? err.message : "Unknown visitor flow failed");
    } finally {
      setSubmitting(false);
    }
  };

  const selectedMultiFlats = useMemo(
    () => new Set(multiFlats.split(",").map((v) => v.trim()).filter(Boolean)),
    [multiFlats]
  );

  const toggleMultiFlat = (targetFlat: string) => {
    const next = new Set(selectedMultiFlats);
    if (next.has(targetFlat)) {
      next.delete(targetFlat);
    } else {
      next.add(targetFlat);
    }
    setMultiFlats(Array.from(next).join(", "));
  };

  // Logs download helpers
  const downloadJson = (rows: VisitorRow[]) => {
    const blob = new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auragate-visitor-logs-${new Date().toISOString()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toCsv = (rows: VisitorRow[]) => {
    const headers = ["id", "visitor_name", "visitor_type", "flat_number", "status", "timestamp"];
    const lines = [headers.join(",")];
    rows.forEach((r) => {
      const vals = headers.map((h) => {
        const v = (r as Record<string, unknown>)[h] ?? "";
        return `"${String(v).replace(/"/g, '""')}"`;
      });
      lines.push(vals.join(","));
    });
    return lines.join("\n");
  };

  const downloadCsv = (rows: VisitorRow[]) => {
    const csv = toCsv(rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auragate-visitor-logs-${new Date().toISOString()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const modalShellClass = "relative w-full max-w-2xl border-4 border-navy bg-vintage p-5 sm:p-7 shadow-[8px_8px_0px_#F25C05]";
  const modalInputClass = "w-full border-4 border-navy bg-white px-4 py-4 text-xl font-semibold text-navy outline-none focus:border-safety";
  const modalLabelClass = "block border border-slate-300/80 bg-white/30 px-2 py-1 text-xs font-bold uppercase tracking-[0.24em] text-navy/70";

  return (
    <>
      <main className="h-screen overflow-hidden bg-vintage px-3 py-3 text-navy sm:p-5 lg:p-7">
        <div className="mx-auto flex h-full w-full max-w-[1700px] flex-col gap-4 pb-20">
          <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
            <div className="flex flex-wrap items-center gap-2">
              <span className="border-2 border-navy bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.24em] shadow-[2px_2px_0px_#1B2A47]">
                Terminal: Guard-01
              </span>
              <span className="hidden border-2 border-navy bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.2em] shadow-[2px_2px_0px_#1B2A47] md:inline-flex">
                Mode: {mode}
              </span>
              <span className="hidden border-2 border-navy bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.2em] shadow-[2px_2px_0px_#1B2A47] lg:inline-flex">
                Alerts: {notifications.length}
              </span>
            </div>

            <button
              onClick={() => void triggerEmergency()}
              className="flex w-full items-center justify-center gap-2 border-4 border-navy bg-danger px-6 py-3 text-lg font-black uppercase tracking-[0.14em] text-white shadow-[4px_4px_0px_#1B2A47] transition-all active:translate-y-1 active:shadow-none sm:w-auto"
            >
              <AlertTriangle className="h-6 w-6" />
              Emergency SOS
            </button>
          </header>

          <div className="border border-slate-300 bg-white/30 p-3 text-center">
            <h1 className="text-3xl font-black uppercase tracking-[0.24em] text-navy sm:text-5xl">Gate Operations</h1>
          </div>

          <section className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => {
                setMode("qr");
                setVerifyModalOpen(true);
              }}
              className="group flex min-h-[210px] flex-row items-center justify-center gap-4 border-4 border-navy bg-white p-8 text-left shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-[#1B2A47] hover:text-white lg:min-h-0 lg:flex-col lg:text-center"
            >
              <QrCode className="h-16 w-16 text-navy transition-colors duration-200 group-hover:text-white" />
              <span className="text-3xl font-black uppercase tracking-[0.2em] text-navy transition-colors duration-200 group-hover:text-white">
                Scan Guest QR
              </span>
            </button>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setMode("single");
                  setVisitorType("Delivery");
                  setActiveModal("single");
                }}
                className="group flex min-h-[210px] flex-col items-center justify-center gap-3 border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
              >
                <Package className="h-16 w-16 text-navy transition-colors duration-200 group-hover:text-white" />
                <span className="text-4xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Delivery</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("multi");
                  setVisitorType("Delivery");
                  setActiveModal("multi");
                }}
                className="group flex min-h-[210px] flex-col items-center justify-center gap-3 border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
              >
                <Car className="h-16 w-16 text-navy transition-colors duration-200 group-hover:text-white" />
                <span className="text-4xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Multi-Flat</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("frequent");
                  setVisitorType("Maid");
                  setActiveModal("frequent");
                }}
                className="group flex min-h-[210px] flex-col items-center justify-center gap-3 border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
              >
                <Users className="h-16 w-16 text-navy transition-colors duration-200 group-hover:text-white" />
                <span className="text-4xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Daily Staff</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode("logs");
                  setActiveModal("logs");
                }}
                className="group flex min-h-[210px] flex-col items-center justify-center gap-3 border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
              >
                <ShieldAlert className="h-16 w-16 text-navy transition-colors duration-200 group-hover:text-white" />
                <span className="text-4xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Unknown</span>
              </button>
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-2 border-2 border-navy bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.16em] shadow-[3px_3px_0px_#1B2A47]">
            <button
              type="button"
              onClick={() => startCountdown(15)}
              className="border-2 border-navy bg-vintage px-3 py-2 transition hover:bg-safety hover:text-white"
            >
              15s Countdown
            </button>
            <button
              type="button"
              onClick={() => {
                setVisitorType("Delivery");
                void performCheckIn();
              }}
              className="border-2 border-navy bg-vintage px-3 py-2 transition hover:bg-safety hover:text-white"
            >
              Simulate Now
            </button>
            {countdown !== null ? (
              <button
                type="button"
                onClick={cancelCountdown}
                className="border-2 border-navy bg-danger px-3 py-2 text-white"
              >
                Cancel ({countdown}s)
              </button>
            ) : null}
            <label className="ml-1">Flash</label>
            <input
              value={String(flashDuration)}
              onChange={(e) => setFlashDuration(Number(e.target.value || 8))}
              className="w-16 border-2 border-navy bg-vintage px-2 py-1 text-center"
            />
            <button type="button" onClick={() => setNotifications([])} className="border-2 border-navy bg-vintage px-3 py-2 transition hover:bg-safety hover:text-white">
              Clear Alerts
            </button>
          </section>
        </div>
      </main>

      <div className="fixed bottom-0 left-0 z-40 w-full border-t-4 border-navy bg-safety px-4 py-4 text-center text-sm font-bold uppercase tracking-[0.2em] text-white sm:text-base">
        {(statusText || (countdown !== null ? `Auto check-in in ${countdown}s` : "Kiosk active. Tap a box to begin.")).toUpperCase()}
      </div>

      {verifyModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className={modalShellClass}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-3xl font-black uppercase tracking-[0.2em] text-navy">Expected Guest Verification</h3>
              <button
                type="button"
                onClick={() => setVerifyModalOpen(false)}
                className="border-2 border-navy bg-white p-2 text-navy shadow-[2px_2px_0px_#1B2A47]"
                aria-label="Close expected guest modal"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="grid gap-4">
              <div className="border-4 border-navy bg-white p-5 text-center">
                <div className="flex justify-center">
                  {loadingTotp ? (
                    <p className="text-lg font-bold uppercase tracking-[0.2em] text-navy/70">Loading QR...</p>
                  ) : (
                    <QRCodeSVG value={qrValue} size={160} bgColor="#FFFFFF" fgColor="#1B2A47" />
                  )}
                </div>
                <p className="mt-3 text-lg font-black uppercase tracking-[0.16em] text-navy">Camera Simulated For Demo</p>
                {totp ? (
                  <p className="mt-2 text-sm font-semibold uppercase tracking-[0.12em] text-navy/70">
                    Live OTP: {totp.current_otp} • Valid {totp.valid_for_seconds}s
                  </p>
                ) : null}
              </div>

              <div>
                <span className={modalLabelClass}>Guest Name</span>
                <input
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  className={modalInputClass}
                  placeholder="Guest Name"
                />
              </div>

              <div>
                <span className={modalLabelClass}>Enter 6-Digit Code</span>
                <input
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  className={`${modalInputClass} font-mono tracking-[0.5em]`}
                  placeholder="123456"
                  maxLength={6}
                />
              </div>

              <div>
                <span className={modalLabelClass}>Visitor ID</span>
                <input
                  value={verifyVisitorId}
                  onChange={(e) => setVerifyVisitorId(e.target.value)}
                  className={modalInputClass}
                  placeholder="UUID from invite"
                />
              </div>

              <div>
                <span className={modalLabelClass}>Flat Number</span>
                <select value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} className={modalInputClass}>
                  {flatOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void generateGuestQr()}
                  className="w-full border-4 border-navy bg-white px-4 py-5 text-xl font-black uppercase tracking-[0.16em] text-navy shadow-[4px_4px_0px_#1B2A47] transition hover:bg-safety hover:text-white"
                >
                  Scan QR
                </button>
                <button
                  type="button"
                  onClick={() => void verifyTotp()}
                  disabled={verifying}
                  className="w-full border-4 border-navy bg-navy px-4 py-5 text-xl font-black uppercase tracking-[0.16em] text-white shadow-[4px_4px_0px_#F25C05] transition hover:bg-safety disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {verifying ? "Verifying..." : "Verify and Open Gate"}
                </button>
              </div>

              {guestQr ? (
                <p className="text-sm font-semibold uppercase tracking-[0.14em] text-navy/80">
                  Visitor ID: {guestQr.visitor_id} • OTP: {guestQr.current_otp}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "single" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form onSubmit={handleSubmit} className={modalShellClass}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-3xl font-black uppercase tracking-[0.2em] text-navy">Quick Commerce Delivery</h3>
              <button type="button" onClick={() => setActiveModal(null)} className="border-2 border-navy bg-white p-2 text-navy shadow-[2px_2px_0px_#1B2A47]" aria-label="Close delivery modal">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="grid gap-4">
              <div>
                <span className={modalLabelClass}>Select Flat</span>
                <select value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} className={modalInputClass}>
                  {flatOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className={modalLabelClass}>Visitor Name</span>
                <input
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  className={modalInputClass}
                  placeholder="Delivery Agent"
                  required
                />
              </div>

              <div className="flex items-center justify-center gap-3 border-4 border-navy bg-white px-4 py-8 text-navy">
                <Camera className="h-9 w-9" />
                <span className="text-3xl font-black uppercase tracking-[0.16em]">Capture Package</span>
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full border-4 border-navy bg-navy px-4 py-5 text-3xl font-black uppercase tracking-[0.16em] text-white shadow-[4px_4px_0px_#F25C05] transition hover:bg-safety disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? "Submitting..." : "Notify Resident"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {activeModal === "multi" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form onSubmit={handleMultiSubmit} className={modalShellClass}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-3xl font-black uppercase tracking-[0.2em] text-navy">Multi-Flat Delivery</h3>
              <button type="button" onClick={() => setActiveModal(null)} className="border-2 border-navy bg-white p-2 text-navy shadow-[2px_2px_0px_#1B2A47]" aria-label="Close multi-flat modal">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="grid gap-4">
              <div>
                <span className={modalLabelClass}>Tap all flats for this delivery agent</span>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {flatOptions.map((option) => {
                    const isSelected = selectedMultiFlats.has(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => toggleMultiFlat(option)}
                        className={`border-2 px-4 py-4 text-xl font-black uppercase tracking-[0.12em] shadow-[2px_2px_0px_#1B2A47] transition ${
                          isSelected ? "border-safety bg-safety text-white" : "border-navy bg-white text-navy hover:bg-vintage"
                        }`}
                      >
                        {option}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <span className={modalLabelClass}>Delivery Name</span>
                <input
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  className={modalInputClass}
                  placeholder="Delivery Agent"
                />
              </div>

              <div className="flex items-center justify-center gap-3 border-4 border-navy bg-white px-4 py-8 text-navy">
                <Camera className="h-9 w-9" />
                <span className="text-3xl font-black uppercase tracking-[0.16em]">Capture Package Group</span>
              </div>

              <button
                type="submit"
                disabled={submitting || selectedMultiFlats.size === 0}
                className="w-full border-4 border-navy bg-navy px-4 py-5 text-3xl font-black uppercase tracking-[0.16em] text-white shadow-[4px_4px_0px_#F25C05] transition hover:bg-safety disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? "Submitting..." : `Ping ${selectedMultiFlats.size} Residents`}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {activeModal === "frequent" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className={modalShellClass}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-3xl font-black uppercase tracking-[0.2em] text-navy">Daily Staff Voice Flow</h3>
              <button type="button" onClick={() => setActiveModal(null)} className="border-2 border-navy bg-white p-2 text-navy shadow-[2px_2px_0px_#1B2A47]" aria-label="Close staff modal">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="grid gap-4">
              <button
                type="button"
                onClick={() => setStatusText("Listening for staff voice input...")}
                className="flex w-full items-center justify-center gap-3 border-4 border-navy bg-white px-4 py-8 text-navy"
              >
                <UserRoundCheck className="h-10 w-10" />
                <span className="text-3xl font-black uppercase tracking-[0.16em]">Hold to Speak</span>
              </button>

              <div>
                <span className={modalLabelClass}>Staff Name</span>
                <input
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  className={modalInputClass}
                  placeholder="Waiting for voice input"
                />
              </div>

              <div>
                <span className={modalLabelClass}>Flat</span>
                <select value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} className={modalInputClass}>
                  {flatOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={addFavorite} className="border-2 border-navy bg-white px-4 py-3 text-sm font-black uppercase tracking-[0.14em] shadow-[2px_2px_0px_#1B2A47]">
                  Save Frequent Staff
                </button>
                {favorites.slice(0, 3).map((fav, idx) => (
                  <button
                    key={`${fav.name}-${idx}`}
                    type="button"
                    onClick={() => {
                      setVisitorName(fav.name);
                      setFlatNumber(fav.flat);
                      setVisitorType(fav.type);
                    }}
                    className="border-2 border-navy bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.12em]"
                    title="Tap to prefill"
                  >
                    {fav.name}
                  </button>
                ))}
                {favorites.length > 0 ? (
                  <button type="button" onClick={() => removeFavorite(0)} className="border-2 border-navy bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.12em]">
                    Remove First
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => {
                  setVisitorType("Maid");
                  void performCheckIn();
                }}
                disabled={submitting}
                className="w-full border-4 border-navy bg-navy px-4 py-5 text-3xl font-black uppercase tracking-[0.16em] text-white shadow-[4px_4px_0px_#F25C05] transition hover:bg-safety disabled:cursor-not-allowed disabled:opacity-70"
              >
                Log Staff Entry
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeModal === "logs" ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className={modalShellClass}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-3xl font-black uppercase tracking-[0.2em] text-navy">Unknown Visitor Check</h3>
              <button type="button" onClick={() => setActiveModal(null)} className="border-2 border-navy bg-white p-2 text-navy shadow-[2px_2px_0px_#1B2A47]" aria-label="Close unknown visitor modal">
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="grid gap-4">
              <div>
                <span className={modalLabelClass}>Flat Number</span>
                <select value={flatNumber} onChange={(e) => setFlatNumber(e.target.value)} className={modalInputClass}>
                  {flatOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <span className={modalLabelClass}>Visitor Name (Optional)</span>
                <input
                  value={visitorName}
                  onChange={(e) => setVisitorName(e.target.value)}
                  className={modalInputClass}
                  placeholder="Unknown"
                />
              </div>

              <div className="flex items-center justify-center gap-3 border-4 border-navy bg-white px-4 py-8 text-navy">
                <Camera className="h-9 w-9" />
                <span className="text-3xl font-black uppercase tracking-[0.16em]">Take Liveness Selfie</span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void submitUnknownVisitor()}
                  disabled={submitting}
                  className="w-full border-4 border-navy bg-navy px-4 py-5 text-xl font-black uppercase tracking-[0.16em] text-white shadow-[4px_4px_0px_#F25C05] transition hover:bg-safety disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {submitting ? "Running..." : "Run Identity Check and Alert"}
                </button>
                <button
                  type="button"
                  onClick={() => void generateRandomVisitor()}
                  className="w-full border-4 border-navy bg-white px-4 py-5 text-xl font-black uppercase tracking-[0.16em] text-navy shadow-[4px_4px_0px_#1B2A47] transition hover:bg-vintage"
                >
                  Simulate Random Visitor
                </button>
              </div>

              <div className="grid gap-2 border-2 border-navy bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={() => downloadJson(logs)} className="border-2 border-navy bg-vintage px-3 py-2 text-xs font-bold uppercase tracking-[0.14em]">Download JSON</button>
                  <button onClick={() => downloadCsv(logs)} className="border-2 border-navy bg-vintage px-3 py-2 text-xs font-bold uppercase tracking-[0.14em]">Download CSV</button>
                  <button onClick={() => void fetchVisitorHistory()} className="border-2 border-navy bg-vintage px-3 py-2 text-xs font-bold uppercase tracking-[0.14em]">Refresh Logs</button>
                </div>

                <div className="max-h-40 space-y-2 overflow-y-auto">
                  {loadingLogs ? (
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-navy/70">Loading logs...</p>
                  ) : logs.length === 0 ? (
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-navy/70">No logs available.</p>
                  ) : (
                    logs.slice(0, 8).map((row, idx) => (
                      <div key={row.id ?? idx} className="flex items-center justify-between gap-2 border-2 border-navy bg-vintage px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-navy">
                        <div className="truncate">
                          {(row.visitor_name || "Unknown")} • {(row.flat_number || "N/A")} • {row.timestamp ? new Date(row.timestamp).toLocaleTimeString() : "--"}
                        </div>
                        {row.id ? (
                          <button
                            onClick={async () => {
                              try {
                                const api = backendBase ? `${backendBase}/api/visitors/${row.id}/approve` : `/api/visitors/${row.id}/approve`;
                                const res = await fetch(api, { method: "PUT" });
                                if (!res.ok) throw new Error("Approve failed");
                                setStatusText("Approved from logs");
                                void fetchVisitorHistory();
                              } catch (err) {
                                setStatusText(err instanceof Error ? err.message : "Approve failed");
                              }
                            }}
                            className="border-2 border-navy bg-navy px-2 py-1 text-white"
                          >
                            Approve
                          </button>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
