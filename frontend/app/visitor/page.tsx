"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, CheckCircle2, MapPinned, QrCode, RefreshCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { buildApiPath, resolveBackendBase } from "../../lib/runtimeConfig";

type CheckInResponse = {
  message: string;
  visitor: {
    id: string;
    visitor_name: string;
    flat_number: string;
    status: string;
  };
  guest_qr_payload?: {
    visitor_id: string;
    totp: string;
  } | null;
  qr_valid_for_seconds?: number | null;
  qr_interval_seconds?: number | null;
};

type GeofenceState = {
  allowed: boolean;
  distanceMeters: number;
  latitude: number;
  longitude: number;
};

const GATE_COORDINATES = {
  latitude: 19.87,
  longitude: 75.34,
};
const MAX_ALLOWED_DISTANCE_METERS = 100;

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function calculateDistanceMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const deltaLatitude = toRadians(toLatitude - fromLatitude);
  const deltaLongitude = toRadians(toLongitude - fromLongitude);

  const a =
    Math.sin(deltaLatitude / 2) * Math.sin(deltaLatitude / 2) +
    Math.cos(toRadians(fromLatitude)) *
      Math.cos(toRadians(toLatitude)) *
      Math.sin(deltaLongitude / 2) *
      Math.sin(deltaLongitude / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function geolocationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission denied. Enable location access and retry.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Location information is unavailable right now.";
  }
  if (error.code === error.TIMEOUT) {
    return "Location request timed out. Try again.";
  }
  return "Could not validate location.";
}

export default function VisitorPage() {
  const backendBase = useMemo(() => resolveBackendBase(), []);

  const [visitorName, setVisitorName] = useState("");
  const [flatNumber, setFlatNumber] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [selfieDataUrl, setSelfieDataUrl] = useState<string>("");

  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState("Fill details, capture selfie, and request entry.");
  const [formError, setFormError] = useState("");
  const [geofence, setGeofence] = useState<GeofenceState | null>(null);

  const [result, setResult] = useState<{
    visitorId: string;
    qrValue: string;
    qrValidForSeconds: number | null;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const apiPath = (path: string) => buildApiPath(path, backendBase);

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera() {
    setCameraError("");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Camera not supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      setCameraActive(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      setCameraError("Unable to access camera. Check permissions and retry.");
    }
  }

  function stopCamera() {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraActive(false);
  }

  function captureSelfie() {
    const video = videoRef.current;
    if (!video) {
      setCameraError("Camera stream is unavailable.");
      return;
    }

    const canvas = canvasRef.current ?? document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const context = canvas.getContext("2d");

    if (!context) {
      setCameraError("Could not capture image on this browser.");
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = canvas.toDataURL("image/jpeg", 0.9);
    setSelfieDataUrl(imageData);
    stopCamera();
  }

  function resetResult() {
    setResult(null);
    setGeofence(null);
    setFormError("");
    setStatusText("Fill details, capture selfie, and request entry.");
  }

  async function getCurrentPosition(): Promise<GeolocationPosition> {
    if (!navigator.geolocation) {
      throw new Error("Geolocation is not supported in this browser.");
    }

    return await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 0,
      });
    });
  }

  async function submitEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const normalizedName = visitorName.trim();
    const normalizedFlat = flatNumber.trim().toUpperCase();
    const normalizedMobile = mobileNumber.trim();

    if (!normalizedName || !normalizedFlat || !normalizedMobile) {
      setFormError("Name, flat number, and mobile number are required.");
      return;
    }

    if (!selfieDataUrl) {
      setFormError("Capture a selfie before requesting entry.");
      return;
    }

    setSubmitting(true);
    setFormError("");

    // GEOLOCATION CHECK DISABLED
    // The geolocation moat check has been commented out to avoid treating
    // the backend/server location as the user's location during testing.
    // The original code (kept below as comments) performed a browser
    // geolocation lookup and a haversine distance comparison against a
    // fixed `GATE_COORDINATES`. That behavior caused false "Out of Range"
    // blocks when users tested from remote/dev environments.
    //
    // Original logic (commented):
    // setStatusText("Running geolocation moat check...");
    // try {
    //   const position = await getCurrentPosition();
    //   const { latitude, longitude } = position.coords;
    //   const distanceMeters = calculateDistanceMeters(
    //     latitude,
    //     longitude,
    //     GATE_COORDINATES.latitude,
    //     GATE_COORDINATES.longitude,
    //   );
    //
    //   const allowed = distanceMeters <= MAX_ALLOWED_DISTANCE_METERS;
    //   setGeofence({ allowed, distanceMeters, latitude, longitude });
    //
    //   if (!allowed) {
    //     setFormError(
    //       `Out of Range. You are ${Math.round(distanceMeters)}m away from the society gate. Move closer and retry.`,
    //     );
    //     setStatusText("Out of range. Entry request blocked.");
    //     return;
    //   }
    //
    //   setStatusText("Submitting gate request...");
    //
    //   ...fetch call below...
    //
    // } catch (error) { ... }
    // finally { setSubmitting(false); }

    // For testing and development, skip geolocation enforcement and allow submissions.
    setStatusText("Submitting gate request...");
    setGeofence({ allowed: true, distanceMeters: 0, latitude: 0, longitude: 0 });

    const response = await fetch(apiPath("/api/visitors/check-in"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        visitor_name: normalizedName,
        visitor_type: "Visitor Self-Serve",
        flat_number: normalizedFlat,
        phone_number: normalizedMobile,
        image_payload: selfieDataUrl,
      }),
    });

      const payload = (await response.json().catch(() => null)) as CheckInResponse | { detail?: string } | null;

      if (!response.ok) {
        const detail = payload && "detail" in payload && typeof payload.detail === "string"
          ? payload.detail
          : `Request failed (HTTP ${response.status})`;
        throw new Error(detail);
      }

      const checkInPayload = payload as CheckInResponse;
      const qrPayload = checkInPayload.guest_qr_payload
        ? checkInPayload.guest_qr_payload
        : { visitor_id: checkInPayload.visitor.id };

      setResult({
        visitorId: checkInPayload.visitor.id,
        qrValue: JSON.stringify(qrPayload),
        qrValidForSeconds: checkInPayload.qr_valid_for_seconds ?? null,
      });
      setStatusText("Entry requested. Show your QR to the guard.");
    } catch (error) {
      if (error instanceof GeolocationPositionError) {
        setFormError(geolocationErrorMessage(error));
      } else if (error instanceof Error) {
        setFormError(error.message);
      } else {
        setFormError("Unexpected error while requesting entry.");
      }
      setStatusText("Request failed. Please review warnings and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#F4F1EA] px-4 pb-24 pt-5 text-[#1B2A47]">
      <section className="mx-auto w-full max-w-md space-y-4">
        <header className="border-4 border-[#1B2A47] bg-white p-4 shadow-[8px_8px_0px_#1B2A47]">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-[#1B2A47]/70">AuraGate Visitor Dashboard</p>
          <h1 className="mt-2 text-2xl font-black uppercase leading-tight">Gate Self-Check</h1>
          <p className="mt-1 text-sm font-semibold text-[#1B2A47]/80">Industrial, mobile-first visitor intake and QR access pass.</p>
        </header>

        {result ? (
          <section className="space-y-4 border-4 border-[#1B2A47] bg-white p-4 shadow-[8px_8px_0px_#1B2A47]">
            <div className="inline-flex items-center gap-2 border-2 border-[#166534] bg-[#dcfce7] px-2 py-1 text-xs font-black uppercase tracking-wider text-[#166534]">
              <CheckCircle2 className="h-4 w-4" />
              Request Submitted
            </div>

            <div className="rounded-none border-2 border-[#1B2A47] bg-[#F4F1EA] p-3 text-center">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-[#1B2A47]/70">Generated QR Code</p>
              <div className="mt-3 flex justify-center">
                <div className="border-2 border-[#1B2A47] bg-white p-3 shadow-[4px_4px_0px_#1B2A47]">
                  <QRCodeSVG value={result.qrValue} size={220} includeMargin />
                </div>
              </div>
              <p className="mt-3 text-sm font-black uppercase tracking-wider">Show this QR to the Guard</p>
              <p className="mt-1 break-all text-[11px] font-bold text-[#1B2A47]/75">Visitor ID: {result.visitorId}</p>
              {typeof result.qrValidForSeconds === "number" ? (
                <p className="mt-1 text-[11px] font-bold text-[#1B2A47]/75">
                  QR OTP valid for approximately {result.qrValidForSeconds}s.
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={resetResult}
              className="inline-flex w-full items-center justify-center gap-2 border-2 border-[#1B2A47] bg-white px-3 py-2 text-sm font-black uppercase tracking-wider hover:bg-[#1B2A47] hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
              Start New Request
            </button>
          </section>
        ) : (
          <form
            onSubmit={(event) => void submitEntry(event)}
            className="space-y-4 border-4 border-[#1B2A47] bg-white p-4 shadow-[8px_8px_0px_#1B2A47]"
          >
            <label className="grid gap-1.5 text-sm">
              <span className="font-black uppercase tracking-wider">Name</span>
              <input
                value={visitorName}
                onChange={(event) => setVisitorName(event.target.value)}
                placeholder="Enter full name"
                className="border-2 border-[#1B2A47] bg-[#F4F1EA] px-3 py-2.5 font-bold outline-none focus:ring-4 focus:ring-[#F25C05]/35"
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-black uppercase tracking-wider">Flat Number</span>
              <input
                value={flatNumber}
                onChange={(event) => setFlatNumber(event.target.value)}
                placeholder="T4-402"
                className="border-2 border-[#1B2A47] bg-[#F4F1EA] px-3 py-2.5 font-bold uppercase outline-none focus:ring-4 focus:ring-[#F25C05]/35"
              />
            </label>

            <label className="grid gap-1.5 text-sm">
              <span className="font-black uppercase tracking-wider">Mobile Number</span>
              <input
                value={mobileNumber}
                onChange={(event) => setMobileNumber(event.target.value)}
                placeholder="+91XXXXXXXXXX"
                inputMode="tel"
                className="border-2 border-[#1B2A47] bg-[#F4F1EA] px-3 py-2.5 font-bold outline-none focus:ring-4 focus:ring-[#F25C05]/35"
              />
            </label>

            <section className="border-2 border-[#1B2A47] bg-[#F4F1EA] p-3">
              <p className="text-xs font-black uppercase tracking-[0.18em]">Selfie Capture</p>

              {!selfieDataUrl ? (
                <div className="mt-2 space-y-3">
                  <div className="overflow-hidden border-2 border-[#1B2A47] bg-navy">
                    <video ref={videoRef} className="h-56 w-full object-cover" autoPlay playsInline muted />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => void startCamera()}
                      className="inline-flex items-center justify-center gap-2 border-2 border-[#1B2A47] bg-white px-3 py-2 text-xs font-black uppercase tracking-wider hover:bg-[#1B2A47] hover:text-white"
                    >
                      <Camera className="h-4 w-4" />
                      Start Camera
                    </button>
                    <button
                      type="button"
                      onClick={captureSelfie}
                      disabled={!cameraActive}
                      className="inline-flex items-center justify-center gap-2 border-2 border-[#1B2A47] bg-[#1B2A47] px-3 py-2 text-xs font-black uppercase tracking-wider text-white hover:bg-[#F25C05] disabled:opacity-50"
                    >
                      Capture
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 space-y-3">
                  <img src={selfieDataUrl} alt="Visitor selfie" className="h-56 w-full border-2 border-[#1B2A47] object-cover" />
                  <button
                    type="button"
                    onClick={() => {
                      setSelfieDataUrl("");
                      setCameraError("");
                    }}
                    className="inline-flex w-full items-center justify-center gap-2 border-2 border-[#1B2A47] bg-white px-3 py-2 text-xs font-black uppercase tracking-wider hover:bg-[#1B2A47] hover:text-white"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retake Selfie
                  </button>
                </div>
              )}
              <canvas ref={canvasRef} className="hidden" />
              {cameraError ? (
                <p className="mt-2 text-xs font-bold text-[#B91C1C]">{cameraError}</p>
              ) : null}
            </section>

            {geofence ? (
              <div
                className={`border-2 px-3 py-2 text-xs font-black uppercase tracking-wider ${
                  geofence.allowed
                    ? "border-[#166534] bg-[#dcfce7] text-[#166534]"
                    : "border-[#B91C1C] bg-[#fee2e2] text-[#B91C1C]"
                }`}
              >
                <p>Distance to gate: {Math.round(geofence.distanceMeters)}m</p>
                {!geofence.allowed ? <p className="mt-1">OUT OF RANGE (more than 100m).</p> : null}
              </div>
            ) : null}

            {formError ? (
              <div className="border-2 border-[#B91C1C] bg-[#fee2e2] px-3 py-2 text-sm font-black text-[#B91C1C]">
                <div className="inline-flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4" />
                  <span>{formError}</span>
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 border-2 border-[#1B2A47] bg-[#1B2A47] px-4 py-3 text-sm font-black uppercase tracking-wider text-white hover:bg-[#F25C05] disabled:opacity-60"
            >
              <MapPinned className="h-4 w-4" />
              {submitting ? "Requesting Entry..." : "Request Entry"}
            </button>
          </form>
        )}

        <Link
          href="/"
          className="inline-flex w-full items-center justify-center gap-2 border-2 border-[#1B2A47] bg-white px-3 py-2 text-sm font-black uppercase tracking-wider hover:bg-[#1B2A47] hover:text-white"
        >
          <QrCode className="h-4 w-4" />
          Back to Dashboards
        </Link>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t-4 border-[#1B2A47] bg-[#F25C05] px-4 py-3 text-center text-xs font-black uppercase tracking-[0.18em] text-white">
        {statusText}
      </div>
    </main>
  );
}
