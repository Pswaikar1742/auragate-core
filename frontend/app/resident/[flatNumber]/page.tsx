"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { resolveBackendBase, resolveWsBase } from "../../../lib/runtimeConfig";

type VisitorPayload = {
  id: string;
  visitor_name: string;
  visitor_type: string;
  flat_number: string;
  status: string;
  timestamp: string;
};

type WsMessage = {
  event: "connected" | "pong" | "visitor_checked_in" | "visitor_approved" | "visitor_escalated";
  flat_number?: string;
  visitor?: VisitorPayload;
};

export default function ResidentPage() {
  const params = useParams<{ flatNumber: string }>();
  const flatNumber = params.flatNumber;
  const backendBase = useMemo(() => resolveBackendBase(), []);
  const wsBase = useMemo(() => resolveWsBase(backendBase), [backendBase]);

  const [connected, setConnected] = useState(false);
  const [currentVisitor, setCurrentVisitor] = useState<VisitorPayload | null>(null);
  const [statusText, setStatusText] = useState("Waiting for gate events...");
  const [approving, setApproving] = useState(false);

  const wsUrl = useMemo(() => {
    const wsRoot = wsBase.replace(/^http/, "ws");
    return `${wsRoot}/ws/resident/${encodeURIComponent(flatNumber)}`;
  }, [flatNumber, wsBase]);

  useEffect(() => {
    if (!flatNumber) {
      return;
    }

    const socket = new WebSocket(wsUrl);
    let pingIntervalId: number | undefined;

    socket.onopen = () => {
      setConnected(true);
      setStatusText("Connected to AuraGate gate channel.");
      pingIntervalId = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send("ping");
        }
      }, 15000);
    };

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as WsMessage;

        if (payload.event === "visitor_checked_in" && payload.visitor) {
          setCurrentVisitor(payload.visitor);
          setStatusText(`Visitor ${payload.visitor.visitor_name} is waiting at the gate.`);
        }

        if (payload.event === "visitor_escalated" && payload.visitor) {
          setStatusText(
            `Visitor ${payload.visitor.visitor_name} escalated to IVR because of no response.`,
          );
          setCurrentVisitor(payload.visitor);
        }

        if (payload.event === "visitor_approved" && payload.visitor) {
          const approvedVisitorId = payload.visitor.id;
          setStatusText(`Visitor ${payload.visitor.visitor_name} approved successfully.`);
          setCurrentVisitor((existing) =>
            existing && existing.id === approvedVisitorId ? null : existing,
          );
        }
      } catch {
        setStatusText("Received non-JSON WebSocket message.");
      }
    };

    socket.onclose = () => {
      setConnected(false);
      setStatusText(`Socket disconnected. Backend channel: ${wsUrl}`);
      if (pingIntervalId) {
        window.clearInterval(pingIntervalId);
      }
    };

    socket.onerror = () => {
      setStatusText(`WebSocket error. Check backend connectivity at ${wsUrl}.`);
    };

    return () => {
      if (pingIntervalId) {
        window.clearInterval(pingIntervalId);
      }
      socket.close();
    };
  }, [flatNumber, wsUrl]);

  const approveVisitor = async () => {
    if (!currentVisitor) {
      return;
    }

    setApproving(true);
    try {
      const apiPath = backendBase
        ? `${backendBase}/api/visitors/${currentVisitor.id}/approve`
        : `/api/visitors/${currentVisitor.id}/approve`;
      const response = await fetch(apiPath, { method: "PUT" });

      if (!response.ok) {
        const errorPayload = await response.json().catch(() => ({}));
        const detail =
          typeof errorPayload?.detail === "string"
            ? errorPayload.detail
            : "Could not approve visitor.";
        throw new Error(detail);
      }

      setStatusText(`Approved ${currentVisitor.visitor_name}. Gate notified.`);
      setCurrentVisitor(null);
    } catch (error) {
      if (error instanceof TypeError) {
        const baseHint = backendBase || "http://127.0.0.1:8001";
        setStatusText(`Approval failed because backend is unreachable. Expected: ${baseHint}`);
      } else {
        setStatusText(error instanceof Error ? error.message : "Unexpected approval failure.");
      }
    } finally {
      setApproving(false);
    }
  };

  return (
    <main className="grid-overlay relative flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10 text-white">
      <section className="w-full max-w-3xl rounded-2xl border border-slate-700/80 bg-slate-900/70 p-8 shadow-neon backdrop-blur-xl">
        <h1 className="headline text-center text-3xl font-bold tracking-widest text-neon-green md:text-4xl">
          Resident Console
        </h1>
        <p className="mt-2 text-center text-lg text-slate-300">Flat {flatNumber}</p>
        <p className="mt-1 text-center text-xs text-slate-400">Backend target: {backendBase || "relative /api"}</p>

        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
          <p>
            WebSocket Status: {" "}
            <span className={connected ? "font-semibold text-neon-green" : "font-semibold text-neon-red"}>
              {connected ? "Connected" : "Disconnected"}
            </span>
          </p>
          <p className="mt-2 text-slate-300">{statusText}</p>
        </div>
      </section>

      {currentVisitor && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-xl rounded-2xl border border-neon-red bg-slate-950 p-6 shadow-danger">
            <h2 className="headline text-2xl font-bold text-neon-red">Visitor Alert</h2>
            <p className="mt-3 text-lg text-slate-100">
              Visitor <span className="font-semibold text-neon-green">{currentVisitor.visitor_name}</span> at the
              gate for <span className="font-semibold text-neon-green">{currentVisitor.visitor_type}</span>.
            </p>
            <p className="mt-1 text-sm text-slate-400">Status: {currentVisitor.status}</p>

            <button
              onClick={approveVisitor}
              disabled={approving}
              className="headline mt-6 w-full rounded-lg border border-neon-green px-4 py-3 font-semibold text-neon-green transition hover:bg-neon-green hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {approving ? "Approving..." : "Approve Visitor"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
