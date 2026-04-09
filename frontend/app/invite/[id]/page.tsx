"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Clock3, Loader2, MapPin, QrCode, ShieldAlert, ShieldCheck } from "lucide-react";
import * as OTPAuth from "otpauth";
import { buildApiPath, resolveBackendBase } from "../../../lib/runtimeConfig";

type InviteTotpSeedResponse = {
  visitor_id: string;
  secret_seed: string;
  interval_seconds: number;
};

type GeoState = "checking" | "denied" | "allowed";

const GATE_COORDS = { latitude: 12.9716, longitude: 77.5946 };
const PROXIMITY_THRESHOLD_METERS = 100;

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const earthRadius = 6371000;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);

  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  return earthRadius * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export default function InvitePassPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const backendBase = useMemo(() => resolveBackendBase(), []);

  const [geoState, setGeoState] = useState<GeoState>("checking");
  const [distance, setDistance] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const [inviteTotp, setInviteTotp] = useState<InviteTotpSeedResponse | null>(null);
  const [currentTotp, setCurrentTotp] = useState("");
  const [validFor, setValidFor] = useState(60);
  const [pulseKey, setPulseKey] = useState(0);

  const inviteId = params.id;
  const guestName = useMemo(
    () => searchParams.get("guest")?.trim() || `Guest-${inviteId}`,
    [inviteId, searchParams],
  );
  const visitPurpose = useMemo(
    () => searchParams.get("purpose")?.trim() || "General Visit",
    [searchParams],
  );
  const flatNumber = useMemo(() => searchParams.get("flat")?.trim() || "T4-402", [searchParams]);
  const flatHint = flatNumber;
  const guestLabel = `${guestName}-${inviteId}`;

  const loadTotpSeed = useCallback(async () => {
    const guestQuery = encodeURIComponent(guestLabel);
    const flatQuery = encodeURIComponent(flatNumber);
    const apiPath = buildApiPath(
      `/api/totp/generate?guest_name=${guestQuery}&flat_number=${flatQuery}`,
      backendBase,
    );
    const response = await fetch(apiPath, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Could not generate invite QR (HTTP ${response.status}).`);
    }

    const payload = (await response.json()) as InviteTotpSeedResponse;
    if (!payload.visitor_id || !payload.secret_seed) {
      throw new Error("Invite seed payload is invalid.");
    }

    setInviteTotp(payload);
    setPulseKey((value) => value + 1);
  }, [backendBase, flatNumber, guestLabel]);

  const generateTotpCode = useCallback(
    (secretSeed: string, intervalSeconds: number): string => {
      const totp = new OTPAuth.TOTP({
        issuer: "AuraGate Invite",
        label: guestLabel,
        algorithm: "SHA1",
        digits: 6,
        period: intervalSeconds,
        secret: OTPAuth.Secret.fromBase32(secretSeed),
      });
      return totp.generate();
    },
    [guestLabel],
  );

  const verifyProximity = useCallback(async () => {
    setGeoState("checking");
    setErrorMessage("");

    try {
      if (!("geolocation" in navigator)) {
        throw new Error("Geolocation is not supported by this browser.");
      }

      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 9000,
          maximumAge: 0,
        });
      });

      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;

      const meterDistance = distanceMeters(
        latitude,
        longitude,
        GATE_COORDS.latitude,
        GATE_COORDS.longitude,
      );
      setDistance(meterDistance);

      if (meterDistance > PROXIMITY_THRESHOLD_METERS) {
        setGeoState("denied");
        return;
      }

      await loadTotpSeed();
      setGeoState("allowed");
    } catch (error) {
      setGeoState("denied");
      setErrorMessage(error instanceof Error ? error.message : "Unable to verify location.");
    }
  }, [loadTotpSeed]);

  useEffect(() => {
    void verifyProximity();
  }, [verifyProximity]);

  useEffect(() => {
    if (geoState !== "allowed") {
      return;
    }

    if (!inviteTotp) {
      return;
    }

    const intervalSeconds = inviteTotp.interval_seconds || 60;
    let rotationIntervalId: number | null = null;

    const updateCountdown = () => {
      const nowEpoch = Math.floor(Date.now() / 1000);
      const secondsLeft = intervalSeconds - (nowEpoch % intervalSeconds);
      setValidFor(secondsLeft === 0 ? intervalSeconds : secondsLeft);
    };

    const refreshTotp = () => {
      const nextCode = generateTotpCode(inviteTotp.secret_seed, intervalSeconds);
      setCurrentTotp(nextCode);
      setPulseKey((value) => value + 1);
      updateCountdown();
    };

    refreshTotp();
    const countdownIntervalId = window.setInterval(updateCountdown, 1000);

    const nowEpoch = Math.floor(Date.now() / 1000);
    const secondsToBoundary = intervalSeconds - (nowEpoch % intervalSeconds);
    const boundaryTimeoutId = window.setTimeout(() => {
      refreshTotp();
      rotationIntervalId = window.setInterval(refreshTotp, intervalSeconds * 1000);
    }, secondsToBoundary * 1000);

    return () => {
      window.clearInterval(countdownIntervalId);
      window.clearTimeout(boundaryTimeoutId);
      if (rotationIntervalId !== null) {
        window.clearInterval(rotationIntervalId);
      }
    };
  }, [geoState, generateTotpCode, inviteTotp]);

  const qrValue = useMemo(() => {
    if (!inviteTotp || !currentTotp) {
      return JSON.stringify({ visitor_id: "", totp: "" });
    }

    return JSON.stringify({
      visitor_id: inviteTotp.visitor_id,
      totp: currentTotp,
    });
  }, [currentTotp, inviteTotp]);

  return (
    <>
      <main className="grid-overlay min-h-screen bg-slate-900 px-4 py-6 text-white sm:hidden">
        <section className="mx-auto w-full max-w-sm rounded-2xl border border-slate-700/70 bg-slate-800/60 p-5 shadow-[0_0_34px_rgba(34,211,238,0.16)] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-300">AuraGate Invite Pass</p>
            <MapPin className="h-5 w-5 text-cyan-200" />
          </div>
          <h1 className="headline mt-2 text-2xl text-cyan-100">Visitor Pass #{inviteId}</h1>
          <p className="mt-1 text-xs text-slate-300">
            {guestName} • {visitPurpose} • {flatHint}
          </p>

          {geoState === "checking" && (
            <div className="mt-5 rounded-xl border border-cyan-300/60 bg-cyan-400/10 p-4 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-200" />
              <p className="mt-3 text-sm text-cyan-100">Verifying Proximity to Gate...</p>
            </div>
          )}

          {geoState === "denied" && (
            <div className="mt-5 rounded-xl border border-rose-400/70 bg-rose-500/10 p-4">
              <div className="flex items-start gap-2">
                <ShieldAlert className="mt-0.5 h-5 w-5 text-rose-300" />
                <div>
                  <p className="font-semibold text-rose-200">
                    🛑 You are not at the gate. QR will unlock upon arrival.
                  </p>
                  {distance !== null && <p className="mt-1 text-xs text-rose-100">Distance: {Math.round(distance)}m</p>}
                  {errorMessage && <p className="mt-1 text-xs text-rose-100">{errorMessage}</p>}
                  <button
                    type="button"
                    onClick={() => void verifyProximity()}
                    className="mt-3 rounded-md border border-rose-300/70 bg-rose-300/10 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-300 hover:text-slate-950"
                  >
                    I am at the gate - Recheck location
                  </button>
                </div>
              </div>
            </div>
          )}

          {geoState === "allowed" && inviteTotp && (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-emerald-400/70 bg-emerald-500/10 p-3 text-emerald-100">
                <p className="inline-flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4" />
                  Proximity check passed. Gate unlock QR active.
                </p>
              </div>

              <div className="rounded-2xl border border-fuchsia-400/60 bg-slate-950/80 p-4 shadow-[0_0_28px_rgba(217,70,239,0.24)]">
                <div className="mb-3 flex items-center justify-between text-xs text-fuchsia-200">
                  <span className="inline-flex items-center gap-1">
                    <QrCode className="h-3.5 w-3.5" />
                    Dynamic TOTP QR
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5" />
                    Refresh in {validFor}s
                  </span>
                </div>
                <div
                  key={pulseKey}
                  className="mx-auto flex w-fit justify-center rounded-xl border border-fuchsia-300/50 bg-slate-900 p-3 animate-pulse"
                >
                  <QRCodeSVG value={qrValue} size={220} bgColor="#0f172a" fgColor="#22d3ee" />
                </div>
                <p className="mt-3 text-center text-xs text-slate-400">Visitor ID: {inviteTotp.visitor_id}</p>
                <p className="mt-1 text-center text-xs text-slate-400">OTP Snapshot: {currentTotp}</p>
              </div>
            </div>
          )}
        </section>
      </main>

      <main className="hidden min-h-screen items-center justify-center bg-slate-900 px-8 text-white sm:flex">
        <section className="rounded-2xl border border-slate-700/80 bg-slate-800/60 p-8 text-center shadow-[0_0_30px_rgba(56,189,248,0.14)] backdrop-blur-xl">
          <p className="headline text-2xl text-cyan-100">Open This Pass on Mobile</p>
          <p className="mt-2 text-slate-300">The invite QR unlock flow is optimized for phone geolocation and camera scanning.</p>
        </section>
      </main>
    </>
  );
}
