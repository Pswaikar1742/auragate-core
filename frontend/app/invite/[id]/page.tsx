"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircle2, Clock3, Loader2, QrCode, ShieldCheck } from "lucide-react";
import * as OTPAuth from "otpauth";
import { buildApiPath, resolveBackendBase } from "../../../lib/runtimeConfig";

type InviteTotpSeedResponse = {
  visitor_id: string;
  visitor_name: string;
  flat_number: string;
  secret_seed: string;
  interval_seconds: number;
};

export default function InvitePassPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const backendBase = useMemo(() => resolveBackendBase(), []);

  const [loadingSeed, setLoadingSeed] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [inviteTotp, setInviteTotp] = useState<InviteTotpSeedResponse | null>(null);
  const [currentTotp, setCurrentTotp] = useState("");
  const [validFor, setValidFor] = useState(60);
  const [pulseKey, setPulseKey] = useState(0);

  const inviteId = useMemo(() => (params.id || "").trim(), [params.id]);
  const visitPurpose = useMemo(
    () => searchParams.get("purpose")?.trim() || "General Visit",
    [searchParams],
  );
  const guestName = inviteTotp?.visitor_name || "";
  const flatHint = inviteTotp?.flat_number || "";
  const inviteLabel = useMemo(() => {
    if (inviteTotp?.visitor_name) {
      return `${inviteTotp.visitor_name}-${inviteTotp.visitor_id}`;
    }
    return inviteId;
  }, [inviteId, inviteTotp]);

  const loadTotpSeed = useCallback(async () => {
    if (!inviteId) {
      throw new Error("Invite link is invalid.");
    }

    setLoadingSeed(true);
    setErrorMessage("");
    const apiPath = buildApiPath(`/api/totp/invite/${encodeURIComponent(inviteId)}`, backendBase);
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
    setLoadingSeed(false);
  }, [backendBase, inviteId]);

  const generateTotpCode = useCallback(
    (secretSeed: string, intervalSeconds: number): string => {
      const totp = new OTPAuth.TOTP({
        issuer: "AuraGate Invite",
        label: inviteLabel,
        algorithm: "SHA1",
        digits: 6,
        period: intervalSeconds,
        secret: OTPAuth.Secret.fromBase32(secretSeed),
      });
      return totp.generate();
    },
    [inviteLabel],
  );

  useEffect(() => {
    // Location gate intentionally disabled by product request.
    // Previous geofence checks blocked valid invite usage on phones.
    // We now proceed directly with TOTP invite generation.
    void loadTotpSeed().catch((error) => {
      setLoadingSeed(false);
      setErrorMessage(error instanceof Error ? error.message : "Unable to generate invite pass.");
    });
  }, [loadTotpSeed]);

  useEffect(() => {
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
  }, [generateTotpCode, inviteTotp]);

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
      <main className="grid-overlay min-h-screen bg-vintage px-4 py-6 text-navy sm:hidden">
        <section className="mx-auto w-full max-w-sm border-4 border-navy bg-white p-5 shadow-[6px_6px_0px_#F25C05]">
          <div className="flex items-center justify-between">
            <p className="text-xs uppercase tracking-[0.2em] text-navy/70">AuraGate Invite Pass</p>
            <ShieldCheck className="h-5 w-5 text-navy/60" />
          </div>
          <h1 className="headline mt-2 text-3xl text-navy">Visitor Pass #{inviteId}</h1>
          <p className="mt-1 text-xs text-navy/70">
            {guestName || "Loading guest"} • {visitPurpose} • {flatHint || "Loading flat"}
          </p>

          {loadingSeed && (
            <div className="mt-5 border-2 border-navy/60 bg-vintage p-4 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-navy/60" />
              <p className="mt-3 text-sm font-semibold uppercase tracking-[0.14em] text-navy/70">Generating secure invite pass...</p>
            </div>
          )}

          {!loadingSeed && errorMessage && (
            <div className="mt-5 border-2 border-danger bg-vintage p-4">
              <p className="text-sm font-semibold text-danger">{errorMessage}</p>
              <button
                type="button"
                onClick={() => void loadTotpSeed().catch((error) => {
                  setLoadingSeed(false);
                  setErrorMessage(error instanceof Error ? error.message : "Unable to generate invite pass.");
                })}
                className="mt-3 border-2 border-navy bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-navy"
              >
                Retry
              </button>
            </div>
          )}

          {!loadingSeed && !errorMessage && inviteTotp && (
            <div className="mt-5 space-y-4">
              <div className="border-2 border-navy/60 bg-vintage p-3 text-navy">
                <p className="inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.12em]">
                  <CheckCircle2 className="h-4 w-4 text-safety" />
                  Location gate disabled. QR + TOTP approval active.
                </p>
              </div>

              <div className="border-4 border-navy bg-white p-4 shadow-[4px_4px_0px_#F25C05]">
                <div className="mb-3 flex items-center justify-between text-xs text-navy/60">
                  <span className="inline-flex items-center gap-1">
                    <QrCode className="h-3.5 w-3.5 text-navy/70" />
                    Dynamic TOTP QR
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5 text-navy/70" />
                    Refresh in {validFor}s
                  </span>
                </div>
                <div
                  key={pulseKey}
                  className="mx-auto flex w-fit justify-center border-2 border-navy/60 bg-white p-3 animate-pulse"
                >
                  <QRCodeSVG value={qrValue} size={220} bgColor="#F4F1EA" fgColor="#1B2A47" />
                </div>
                <p className="mt-3 text-center text-xs text-navy/60">Visitor ID: {inviteTotp.visitor_id}</p>
                <p className="mt-1 text-center text-xs text-navy/60">OTP Snapshot: {currentTotp}</p>
                <p className="mt-2 border-t border-navy/30 pt-2 text-center text-xs font-semibold uppercase tracking-[0.12em] text-navy/70">
                  Show this QR at gate for guard-side TOTP approval.
                </p>
              </div>
            </div>
          )}
        </section>
      </main>

      <main className="hidden min-h-screen items-center justify-center bg-vintage px-8 text-navy sm:flex">
        <section className="rounded-2xl border border-navy/80 bg-white p-8 text-center shadow-offset-safety">
          <p className="headline text-2xl text-navy">Open This Pass on Mobile</p>
          <p className="mt-2 text-navy/70">The invite QR unlock flow is optimized for phone geolocation and camera scanning.</p>
        </section>
      </main>
    </>
  );
}
