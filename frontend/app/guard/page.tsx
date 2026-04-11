"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertTriangle, Car, Package, QrCode, ScanLine, ShieldAlert, UserRoundCheck, Users, X } from "lucide-react";
import jsQR from "jsqr";
import { QRCodeSVG } from "qrcode.react";
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

type CaptureMode = "single" | "multi" | "unknown" | "expected";

type ScannedGuestPass = {
  visitorId: string;
  totpCode: string;
  raw: string;
};

type GateFlash = {
  visible: boolean;
  tone: "success" | "danger";
  title: string;
  subtitle: string;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOTP_REGEX = /^\d{6}$/;

function parseScannedGuestPass(rawValue: string): ScannedGuestPass | null {
  const raw = rawValue.trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as { visitor_id?: unknown; totp?: unknown; scanned_code?: unknown };
    const visitorId = typeof parsed.visitor_id === "string" ? parsed.visitor_id.trim() : "";
    const totpCode =
      typeof parsed.totp === "string"
        ? parsed.totp.trim()
        : typeof parsed.scanned_code === "string"
          ? parsed.scanned_code.trim()
          : "";
    if (UUID_REGEX.test(visitorId) && TOTP_REGEX.test(totpCode)) {
      return { visitorId, totpCode, raw };
    }
  } catch {
    // Not JSON, continue with alternative parsers.
  }

  try {
    const parsedUrl = new URL(raw);
    const visitorId = parsedUrl.searchParams.get("visitor_id")?.trim() ?? "";
    const totpCode =
      parsedUrl.searchParams.get("totp")?.trim() ??
      parsedUrl.searchParams.get("scanned_code")?.trim() ??
      "";
    if (UUID_REGEX.test(visitorId) && TOTP_REGEX.test(totpCode)) {
      return { visitorId, totpCode, raw };
    }
  } catch {
    // Not a URL, continue.
  }

  const compact = raw.replace(/\s+/g, "");
  const fallbackMatch = compact.match(/([0-9a-fA-F-]{36})[^0-9]*([0-9]{6})/);
  if (fallbackMatch) {
    const [, visitorId, totpCode] = fallbackMatch;
    if (UUID_REGEX.test(visitorId) && TOTP_REGEX.test(totpCode)) {
      return { visitorId, totpCode, raw };
    }
  }

  return null;
}

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
  const [flash, setFlash] = useState<GateFlash | null>(null);
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
  const [qrScannerActive, setQrScannerActive] = useState(false);
  const [qrScannerError, setQrScannerError] = useState("");
  const [lastScannedRaw, setLastScannedRaw] = useState("");
  const [pendingAutoVerify, setPendingAutoVerify] = useState<ScannedGuestPass | null>(null);
  const [activeModal, setActiveModal] = useState<null | "single" | "multi" | "frequent" | "logs">(null);
  const [cameraError, setCameraError] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode | null>(null);
  const [capturedImages, setCapturedImages] = useState<Record<CaptureMode, string | null>>({
    single: null,
    multi: null,
    unknown: null,
    expected: null,
  });
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const qrScannerVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrScannerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const qrScannerStreamRef = useRef<MediaStream | null>(null);
  const qrScannerFrameRef = useRef<number | null>(null);
  const qrScannerBusyRef = useRef(false);

  const showGateFlash = useCallback(
    (tone: "success" | "danger", title: string, subtitle: string) => {
      setFlash({ visible: true, tone, title, subtitle });
      window.setTimeout(() => setFlash(null), (flashDuration || 8) * 1000);
    },
    [flashDuration],
  );

  const visitorSelfServeUrl = useMemo(() => {
    const params = new URLSearchParams({
      source: "guard-kiosk",
      flat: flatNumber,
    });

    if (typeof window === "undefined") {
      return `/visitor?${params.toString()}`;
    }

    return `${window.location.origin}/visitor?${params.toString()}`;
  }, [flatNumber]);

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
          showGateFlash("success", `ENTRY GRANTED: ${name}`, "Known visitor verified by real-time TOTP.");
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
  }, [wsBase, showGateFlash]);

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

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Camera is not supported in this browser.");
      return;
    }

    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {
          // autoplay can fail until user interaction; stream remains attached.
        });
      }

      setCameraActive(true);
    } catch {
      setCameraError("Unable to access camera. Check permission and retry.");
      setCameraActive(false);
    }
  }, [stopCamera]);

  const stopQrScanner = useCallback(() => {
    if (qrScannerFrameRef.current !== null) {
      window.cancelAnimationFrame(qrScannerFrameRef.current);
      qrScannerFrameRef.current = null;
    }

    if (qrScannerStreamRef.current) {
      qrScannerStreamRef.current.getTracks().forEach((track) => track.stop());
      qrScannerStreamRef.current = null;
    }

    if (qrScannerVideoRef.current) {
      qrScannerVideoRef.current.srcObject = null;
    }

    qrScannerBusyRef.current = false;
    setQrScannerActive(false);
  }, []);

  const startQrScanner = useCallback(async () => {
    setQrScannerError("");
    setLastScannedRaw("");
    setPendingAutoVerify(null);
    qrScannerBusyRef.current = false;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setQrScannerError("Camera access is unavailable in this browser.");
      return;
    }

    stopQrScanner();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      qrScannerStreamRef.current = stream;
      const video = qrScannerVideoRef.current;
      if (!video) {
        throw new Error("Scanner preview is unavailable.");
      }

      const scannerCanvas = qrScannerCanvasRef.current;
      if (!scannerCanvas) {
        throw new Error("Scanner frame buffer is unavailable.");
      }
      const scannerContext = scannerCanvas.getContext("2d", { willReadFrequently: true });
      if (!scannerContext) {
        throw new Error("Scanner frame buffer context is unavailable.");
      }

      video.srcObject = stream;
      await video.play().catch(() => {
        // Autoplay can be blocked before user gesture.
      });

      setQrScannerActive(true);

      const tick = () => {
        const scannerVideo = qrScannerVideoRef.current;
        if (!scannerVideo || !qrScannerStreamRef.current) {
          return;
        }

        const width = scannerVideo.videoWidth;
        const height = scannerVideo.videoHeight;

        if (width > 0 && height > 0) {
          if (scannerCanvas.width !== width || scannerCanvas.height !== height) {
            scannerCanvas.width = width;
            scannerCanvas.height = height;
          }

          scannerContext.drawImage(scannerVideo, 0, 0, width, height);

          try {
            const frame = scannerContext.getImageData(0, 0, width, height);
            const detected = jsQR(frame.data, frame.width, frame.height, {
              inversionAttempts: "dontInvert",
            });

            if (detected?.data) {
              const rawValue = detected.data;
              const parsed = parseScannedGuestPass(rawValue);
              setLastScannedRaw(rawValue);

              if (parsed) {
                if (!qrScannerBusyRef.current) {
                  qrScannerBusyRef.current = true;
                  setVerifyVisitorId(parsed.visitorId);
                  setVerifyCode(parsed.totpCode);
                  setPendingAutoVerify(parsed);
                  setStatusText("Guest QR scanned. Verifying now...");
                  setQrScannerError("");
                  stopQrScanner();
                  return;
                }
              } else {
                setQrScannerError("Scanned QR is not a valid AuraGate guest pass.");
              }
            }
          } catch {
            // Keep scanning when frame reads fail intermittently.
          }
        }

        qrScannerFrameRef.current = window.requestAnimationFrame(() => {
          tick();
        });
      };

      qrScannerFrameRef.current = window.requestAnimationFrame(() => {
        tick();
      });
    } catch (error) {
      stopQrScanner();
      setQrScannerError(error instanceof Error ? error.message : "Unable to start QR scanner.");
    }
  }, [stopQrScanner]);

  const activeCaptureMode = useMemo<CaptureMode | null>(() => {
    if (activeModal === "single") return "single";
    if (activeModal === "multi") return "multi";
    if (activeModal === "logs") return "unknown";
    return null;
  }, [activeModal]);

  useEffect(() => {
    if (verifyModalOpen) {
      qrScannerBusyRef.current = false;
      setPendingAutoVerify(null);
      void startQrScanner();
    } else {
      stopQrScanner();
      setQrScannerError("");
      setLastScannedRaw("");
      setPendingAutoVerify(null);
    }

    return () => {
      if (!verifyModalOpen) {
        stopQrScanner();
      }
    };
  }, [verifyModalOpen, startQrScanner, stopQrScanner]);

  useEffect(() => {
    setCaptureMode(activeCaptureMode);
    setCameraError("");

    if (activeCaptureMode && !capturedImages[activeCaptureMode]) {
      void startCamera();
    }

    if (!activeCaptureMode) {
      stopCamera();
    }

    return () => {
      if (!activeCaptureMode) {
        stopCamera();
      }
    };
  }, [activeCaptureMode, capturedImages, startCamera, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
      stopQrScanner();
    };
  }, [stopCamera, stopQrScanner]);

  const capturePhoto = useCallback(() => {
    const mode = captureMode;
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!mode || !video || !canvas) {
      setCameraError("Camera is not ready yet.");
      return;
    }

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;

    if (width === 0 || height === 0) {
      setCameraError("No frame available. Please try again.");
      return;
    }

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Unable to capture frame.");
      return;
    }

    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    setCapturedImages((prev) => ({ ...prev, [mode]: dataUrl }));
    setStatusText("Photo captured. Ready to submit.");
    stopCamera();
  }, [captureMode, stopCamera]);

  const retakePhoto = useCallback(() => {
    const mode = captureMode;
    if (!mode) return;
    setCapturedImages((prev) => ({ ...prev, [mode]: null }));
    void startCamera();
  }, [captureMode, startCamera]);

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
          image_payload: capturedImages.single,
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
      setCapturedImages((prev) => ({ ...prev, single: null }));

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
        body: JSON.stringify({
          visitor_name: visitorName || "Delivery",
          visitor_type: visitorType,
          flat_numbers: flats,
          image_payload: capturedImages.multi,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(typeof err?.detail === "string" ? err.detail : "Multi-flat check-in failed.");
      }

      const payload = await response.json();
      setStatusText(`${payload.message} Group ID: ${payload.group_id}`);
      setVisitorName("");
      setMultiFlats("");
      setCapturedImages((prev) => ({ ...prev, multi: null }));
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
    const normalizedVisitorName = visitorName.trim();

    if (!normalizedVisitorName) {
      setStatusText("Guest name is required to generate a pass.");
      return;
    }

    setStatusText("");
    try {
      const api = backendBase
        ? `${backendBase}/api/totp/generate?guest_name=${encodeURIComponent(normalizedVisitorName)}&flat_number=${encodeURIComponent(flatNumber)}`
        : `/api/totp/generate?guest_name=${encodeURIComponent(normalizedVisitorName)}&flat_number=${encodeURIComponent(flatNumber)}`;
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
  const verifyTotp = useCallback(
    async (override?: { visitorId: string; totpCode: string }) => {
      const normalizedVisitorId = (override?.visitorId ?? verifyVisitorId).trim();
      const normalizedCode = (override?.totpCode ?? verifyCode).trim();

      if (!normalizedVisitorId || !normalizedCode) {
        setStatusText("Visitor ID and 6-digit pass code are required.");
        qrScannerBusyRef.current = false;
        return;
      }

      setVerifying(true);
      setStatusText("");
      try {
        const api = backendBase ? `${backendBase}/api/visitors/verify-totp` : `/api/visitors/verify-totp`;
        const res = await fetch(api, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ visitor_id: normalizedVisitorId, scanned_code: normalizedCode }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const detail = typeof err?.detail === "string" ? err.detail : "Verification failed";

          if ([400, 401, 404].includes(res.status)) {
            setStatusText(`Entry denied: ${detail}`);
            showGateFlash("danger", "ENTRY DENIED", "Invalid or expired guest pass. Reissue and rescan.");
            return;
          }

          throw new Error(detail);
        }

        await res.json();
        setStatusText("Entry granted. Guest approved by TOTP.");
        showGateFlash("success", "ENTRY GRANTED", "Known visitor verified by real-time TOTP.");
        setVerifyModalOpen(false);
        setVerifyVisitorId("");
        setVerifyCode("");
        void fetchVisitorHistory();
      } catch (err) {
        if (err instanceof TypeError) {
          const baseHint = backendBase || "https://auragate-core-production.up.railway.app";
          setStatusText(`Verification failed: backend unreachable at ${baseHint}`);
        } else {
          setStatusText(err instanceof Error ? err.message : "Verification failed");
        }
      } finally {
        setVerifying(false);
        qrScannerBusyRef.current = false;
      }
    },
    [backendBase, fetchVisitorHistory, showGateFlash, verifyCode, verifyVisitorId],
  );

  useEffect(() => {
    if (!pendingAutoVerify) {
      return;
    }

    void verifyTotp({ visitorId: pendingAutoVerify.visitorId, totpCode: pendingAutoVerify.totpCode });
    setPendingAutoVerify(null);
  }, [pendingAutoVerify, verifyTotp]);

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
          image_payload: capturedImages.unknown,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(typeof err?.detail === "string" ? err.detail : "Identity check failed");
      }
      const payload = await res.json();
      setStatusText(payload.message || "Unknown visitor logged and resident alerted.");
      setCapturedImages((prev) => ({ ...prev, unknown: null }));
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

  const renderCameraCapture = (mode: CaptureMode, title: string) => {
    const capturedImage = capturedImages[mode];
    const isCurrentMode = captureMode === mode;

    return (
      <div className="border-4 border-navy bg-white p-4">
        <div className="relative aspect-video w-full overflow-hidden border-2 border-navy bg-vintage">
          {capturedImage ? (
            <Image
              src={capturedImage}
              alt={`${mode} capture`}
              fill
              unoptimized
              className="object-cover"
            />
          ) : (
            <video
              ref={isCurrentMode ? videoRef : null}
              className="h-full w-full object-cover"
              autoPlay
              muted
              playsInline
            />
          )}
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-black uppercase tracking-[0.14em] text-navy">{title}</p>

          {capturedImage ? (
            <button
              type="button"
              onClick={retakePhoto}
              className="border-2 border-navy bg-vintage px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-navy"
            >
              Retake Photo
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (!cameraActive || !isCurrentMode) {
                  void startCamera();
                  return;
                }
                capturePhoto();
              }}
              className="border-2 border-navy bg-navy px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white"
            >
              {cameraActive ? "Take Photo" : "Enable Camera"}
            </button>
          )}
        </div>

        {isCurrentMode && cameraError ? (
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.08em] text-danger">{cameraError}</p>
        ) : null}
      </div>
    );
  };

  return (
    <>
      <canvas ref={canvasRef} className="hidden" />
      <canvas ref={qrScannerCanvasRef} className="hidden" />
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

          <section className="border-4 border-navy bg-white p-3 shadow-[4px_4px_0px_#1B2A47]">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-black uppercase tracking-[0.16em] text-navy">Notification Panel</p>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-navy/70">Live events: {notifications.length}</p>
            </div>
            {notifications.length === 0 ? (
              <p className="border-2 border-navy bg-vintage px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-navy/70">
                No events yet. Visitor check-ins and approvals will stream here.
              </p>
            ) : (
              <div className="max-h-28 space-y-2 overflow-y-auto">
                {notifications.slice(0, 8).map((item, index) => {
                  const eventName =
                    typeof item.payload.event === "string"
                      ? item.payload.event.replaceAll("_", " ")
                      : "guard event";
                  const visitor =
                    typeof item.payload.visitor === "object" && item.payload.visitor !== null
                      ? (item.payload.visitor as Record<string, unknown>)
                      : null;
                  const visitorName =
                    visitor && typeof visitor.visitor_name === "string" ? visitor.visitor_name : "Unknown Visitor";

                  return (
                    <article
                      key={`${item.received_at}-${index}`}
                      className="flex items-center justify-between gap-3 border-2 border-navy bg-vintage px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-black uppercase tracking-[0.12em] text-navy">{eventName}</p>
                        <p className="truncate font-semibold text-navy/80">{visitorName}</p>
                      </div>
                      <p className="shrink-0 font-bold uppercase tracking-[0.1em] text-navy/60">
                        {new Date(item.received_at).toLocaleTimeString()}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}
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
              <div className="border-4 border-navy bg-white p-4">
                <p className="text-sm font-black uppercase tracking-[0.14em] text-navy">QR Scanner</p>
                <div className="mt-2 overflow-hidden border-2 border-navy bg-vintage">
                  <video ref={qrScannerVideoRef} className="h-56 w-full object-cover" autoPlay muted playsInline />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => void startQrScanner()}
                    className="inline-flex w-full items-center justify-center gap-2 border-2 border-navy bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-navy hover:bg-safety hover:text-white"
                  >
                    <ScanLine className="h-4 w-4" />
                    {qrScannerActive ? "Rescan" : "Start Scanner"}
                  </button>
                  <button
                    type="button"
                    onClick={stopQrScanner}
                    disabled={!qrScannerActive}
                    className="inline-flex w-full items-center justify-center gap-2 border-2 border-navy bg-navy px-3 py-2 text-xs font-black uppercase tracking-[0.14em] text-white hover:bg-safety disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Stop Scanner
                  </button>
                </div>
                <p className="mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-navy/70">
                  {qrScannerActive
                    ? "Scanner active. Show visitor pass QR in front of camera."
                    : "Scanner idle. Start scanner to read visitor pass QR."}
                </p>
                {qrScannerError ? (
                  <p className="mt-2 border-2 border-danger bg-danger/10 px-3 py-2 text-xs font-bold uppercase tracking-[0.08em] text-danger">
                    {qrScannerError}
                  </p>
                ) : null}
                {lastScannedRaw ? (
                  <p className="mt-2 border-2 border-navy bg-vintage px-3 py-2 text-[11px] font-semibold text-navy/80">
                    Last scanned payload: {lastScannedRaw}
                  </p>
                ) : null}
              </div>

              <div className="border-2 border-navy bg-vintage px-3 py-2 text-xs font-bold uppercase tracking-[0.12em] text-navy/70">
                Guard TOTP heartbeat: {loadingTotp ? "loading" : totp?.current_otp ?? "unavailable"}
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
                  Generate Guest Pass
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

              {renderCameraCapture("single", "Capture package")}

              <button
                type="submit"
                disabled={submitting || !capturedImages.single}
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

              {renderCameraCapture("multi", "Capture package group")}

              <button
                type="submit"
                disabled={submitting || selectedMultiFlats.size === 0 || !capturedImages.multi}
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

                <div className="border-2 border-navy bg-white p-3">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-navy">Unknown Visitor Self-Serve QR</p>
                  <div className="mt-3 flex justify-center">
                    <div className="border-2 border-navy bg-vintage p-2 shadow-[2px_2px_0px_#1B2A47]">
                      <QRCodeSVG value={visitorSelfServeUrl} size={160} includeMargin />
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-navy/80">
                    Ask unknown visitors to scan this code on their own phone and complete selfie + details on the visitor dashboard.
                  </p>
                </div>

              {renderCameraCapture("unknown", "Take liveness selfie")}

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void submitUnknownVisitor()}
                  disabled={submitting || !capturedImages.unknown}
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
        <div className={`fixed inset-0 z-50 flex items-center justify-center text-white ${flash.tone === "success" ? "bg-safety/95" : "bg-danger/95"}`}>
          <div className={`max-w-lg rounded-lg border-2 border-white/20 p-8 text-center shadow-xl ${flash.tone === "success" ? "bg-safety" : "bg-danger"}`}>
            <h3 className="text-3xl font-black">{flash.title}</h3>
            <p className="mt-2 text-lg">{flash.subtitle}</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
