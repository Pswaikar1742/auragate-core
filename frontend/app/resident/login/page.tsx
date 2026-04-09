"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogIn, ShieldCheck, UserCog } from "lucide-react";
import { buildApiPath as makeApiPath, resolveBackendBase } from "../../../lib/runtimeConfig";

type DemoResidentHint = {
  flatNumber: string;
  pin: string;
  residentName: string;
};

type ResidentProfile = {
  flat_number: string;
  resident_name: string;
  phone_number: string | null;
};

type ResidentAuthResponse = {
  access_token: string;
  token_type: "bearer";
  expires_at: string;
  resident: ResidentProfile;
};

type ResidentAuthStorage = {
  accessToken: string;
  expiresAt: string;
  resident: ResidentProfile;
  loginAt: string;
};

const AUTH_STORAGE_KEY = "auragate_resident_auth";
const LEGACY_SESSION_STORAGE_KEY = "auragate_resident_session";
const DEMO_RESIDENT_HINTS: DemoResidentHint[] = [
  { flatNumber: "T4-401", pin: "1111", residentName: "Neha Rao" },
  { flatNumber: "T4-402", pin: "1234", residentName: "Aarav Mehta" },
  { flatNumber: "T4-503", pin: "4321", residentName: "Ishita Kulkarni" },
];

export default function ResidentLoginPage() {
  const router = useRouter();
  const backendBase = useMemo(() => resolveBackendBase(), []);

  const residentMap = useMemo(
    () => new Map(DEMO_RESIDENT_HINTS.map((profile) => [profile.flatNumber, profile])),
    [],
  );

  const [flatNumber, setFlatNumber] = useState("T4-402");
  const [pin, setPin] = useState("");
  const [errorText, setErrorText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const buildApiPath = useCallback(
    (path: string): string => {
      return makeApiPath(path, backendBase);
    },
    [backendBase],
  );

  useEffect(() => {
    let mounted = true;

    const verifyExistingSession = async () => {
      const existingRaw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (!existingRaw) {
        localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
        return;
      }

      try {
        const existing = JSON.parse(existingRaw) as ResidentAuthStorage;
        if (!existing.accessToken) {
          throw new Error("Missing access token");
        }

        const response = await fetch(buildApiPath("/api/resident/auth/session"), {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${existing.accessToken}`,
          },
        });

        if (!response.ok) {
          throw new Error("Session validation failed");
        }

        if (mounted) {
          router.replace("/resident/dashboard");
        }
      } catch {
        localStorage.removeItem(AUTH_STORAGE_KEY);
      }
    };

    void verifyExistingSession();

    return () => {
      mounted = false;
    };
  }, [buildApiPath, router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedFlat = flatNumber.trim().toUpperCase();
    const normalizedPin = pin.trim();

    if (!normalizedFlat || !normalizedPin) {
      setErrorText("Flat number and PIN are required.");
      return;
    }

    setSubmitting(true);
    setErrorText("");

    try {
      const response = await fetch(buildApiPath("/api/resident/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          flat_number: normalizedFlat,
          pin: normalizedPin,
        }),
      });

      if (!response.ok) {
        const errorPayload = (await response.json().catch(() => ({}))) as { detail?: string };
        const detail = typeof errorPayload.detail === "string" ? errorPayload.detail : "Login failed.";
        throw new Error(detail);
      }

      const payload = (await response.json()) as ResidentAuthResponse;
      const authStorage: ResidentAuthStorage = {
        accessToken: payload.access_token,
        expiresAt: payload.expires_at,
        resident: payload.resident,
        loginAt: new Date().toISOString(),
      };

      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authStorage));
      localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY);
      router.replace("/resident/dashboard");
    } catch (error) {
      const profile = residentMap.get(normalizedFlat);
      if (profile && profile.pin === normalizedPin) {
        setErrorText("Backend is unreachable. Start backend service and try again.");
      } else {
        const message = error instanceof Error ? error.message : "Invalid flat number or PIN.";
        setErrorText(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const applyDemoIdentity = (profile: DemoResidentHint) => {
    setFlatNumber(profile.flatNumber);
    setPin(profile.pin);
    setErrorText("");
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-vintage px-4 py-8 text-navy">
      <section className="w-full sm:max-w-md md:max-w-lg lg:max-w-xl rounded-2xl border-2 border-navy bg-white p-6 shadow-offset-navy">
        <div className="inline-flex items-center gap-2 rounded-full border border-navy/20 bg-navy/10 px-3 py-1 text-xs uppercase tracking-[0.12em] text-navy">
          <ShieldCheck className="h-3.5 w-3.5" />
          AuraGate Resident Login
        </div>

        <h1 className="headline mt-4 text-2xl sm:text-3xl md:text-4xl text-navy">Enter Flat + PIN</h1>
        <p className="mt-2 text-sm text-navy/70">
          Resident authentication is validated by backend and session is tokenized for dashboard APIs.
        </p>

        <div className="mt-4 rounded-lg border border-navy/20 bg-vintage p-3">
          <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-navy">
            <UserCog className="h-3.5 w-3.5" />
            Demo Credentials (Backend Seed)
          </p>
          <div className="mt-2 grid gap-2">
            {DEMO_RESIDENT_HINTS.map((profile) => (
              <button
                key={profile.flatNumber}
                type="button"
                onClick={() => applyDemoIdentity(profile)}
                className="flex items-center justify-between rounded-md border border-navy/10 bg-white px-3 py-2 text-left text-sm text-navy hover:border-navy"
              >
                <span>{profile.residentName}</span>
                <span className="text-navy/60">{profile.flatNumber} / {profile.pin}</span>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={onSubmit} className="mt-5 space-y-4">
          <label className="grid gap-1.5">
            <span className="text-sm text-navy/70">Flat Number</span>
            <input
              value={flatNumber}
              onChange={(event) => setFlatNumber(event.target.value)}
              placeholder="T4-402"
              className="w-full rounded-md border border-navy/20 bg-white px-3 py-3 text-navy outline-none focus:border-navy focus:ring-2 focus:ring-navy/10"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm text-navy/70">4-digit PIN</span>
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              type="password"
              inputMode="numeric"
              placeholder="1234"
              className="w-full rounded-md border border-navy/20 bg-white px-3 py-3 text-navy outline-none focus:border-navy focus:ring-2 focus:ring-navy/10"
            />
          </label>

          {errorText ? (
            <p className="rounded-md border border-danger/70 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorText}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-navy bg-navy px-4 py-3 text-base font-semibold text-white transition hover:bg-safety"
          >
            <LogIn className="h-4 w-4" />
            {submitting ? "Authenticating..." : "Continue to Resident App"}
          </button>

          <p className="inline-flex items-center gap-2 text-xs text-navy/60">
            <KeyRound className="h-3.5 w-3.5" />
            Demo only. Use seeded credentials from backend startup for validation.
          </p>
        </form>
      </section>
    </main>
  );
}
