"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, ShieldCheck } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildApiPath, resolveBackendBase } from "../../lib/runtimeConfig";

type VisitorRecord = {
  id: string;
  visitor_name: string;
  visitor_type: string;
  flat_number: string;
  status: string;
  timestamp: string;
};

type VisitorHistoryResponse = {
  visitors: VisitorRecord[];
};

const SCOUT_ANOMALIES_BLOCKED = 14;
const AVG_PROCESSING_SECONDS = 8;

const PEAK_DELIVERY_DATA = [
  { slot: "08:00", deliveries: 8 },
  { slot: "10:00", deliveries: 18 },
  { slot: "12:00", deliveries: 27 },
  { slot: "14:00", deliveries: 21 },
  { slot: "16:00", deliveries: 13 },
  { slot: "18:00", deliveries: 24 },
];

function prettyTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
}

function statusClass(status: string): string {
  if (status === "approved") {
    return "border-emerald-400/70 bg-emerald-400/10 text-emerald-200";
  }
  if (status === "escalated_ivr") {
    return "border-rose-400/70 bg-rose-400/10 text-rose-200";
  }
  if (status === "pending") {
    return "border-amber-300/70 bg-amber-300/10 text-amber-100";
  }
  return "border-slate-500/70 bg-slate-500/10 text-slate-200";
}

export default function AdminDashboardPage() {
  const backendBase = useMemo(() => resolveBackendBase(), []);
  const [history, setHistory] = useState<VisitorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState("");
  const [chartReady, setChartReady] = useState(false);

  useEffect(() => {
    setChartReady(true);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const loadHistory = async () => {
      try {
        const apiPath = buildApiPath("/api/visitors/history?limit=60", backendBase);
        const response = await fetch(apiPath, { cache: "no-store" });
        if (!response.ok) {
          throw new Error(`History API failed (HTTP ${response.status}).`);
        }

        const payload = (await response.json()) as VisitorHistoryResponse;
        if (isMounted) {
          setHistory(payload.visitors ?? []);
          setErrorText("");
        }
      } catch (error) {
        if (isMounted) {
          if (error instanceof TypeError) {
            const baseHint = backendBase || "http://127.0.0.1:8001";
            setErrorText(`Backend history feed is unreachable. Expected: ${baseHint}`);
          } else {
            setErrorText(error instanceof Error ? error.message : "Unable to load visitor history.");
          }
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    void loadHistory();
    const intervalId = window.setInterval(() => void loadHistory(), 10000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [backendBase]);

  const totalEntriesToday = useMemo(() => {
    const today = new Date();
    return history.filter((entry) => {
      const rowDate = new Date(entry.timestamp);
      return (
        rowDate.getFullYear() === today.getFullYear() &&
        rowDate.getMonth() === today.getMonth() &&
        rowDate.getDate() === today.getDate()
      );
    }).length;
  }, [history]);

  return (
    <main className="grid-overlay min-h-screen bg-slate-900 px-4 py-8 text-white md:px-8">
      <section className="mx-auto w-full max-w-7xl space-y-6">
        <header className="rounded-2xl border border-slate-700/70 bg-slate-800/60 p-6 shadow-[0_0_36px_rgba(56,189,248,0.12)] backdrop-blur-xl">
          <h1 className="headline text-3xl text-cyan-100 md:text-4xl">Admin Analytics Command Center</h1>
          <p className="mt-2 text-slate-300">Enterprise-grade visibility across gate operations and anomalies.</p>
          <p className="mt-1 text-xs text-slate-400">Backend target: {backendBase || "relative /api"}</p>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <article className="rounded-xl border border-cyan-300/60 bg-cyan-400/10 p-4 shadow-[0_0_25px_rgba(34,211,238,0.18)]">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-cyan-100">
              <Activity className="h-4 w-4" />
              Total Entries Today
            </p>
            <p className="headline mt-3 text-4xl text-cyan-100">{totalEntriesToday}</p>
          </article>

          <article className="rounded-xl border border-rose-300/60 bg-rose-400/10 p-4 shadow-[0_0_25px_rgba(251,113,133,0.18)]">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-rose-100">
              <AlertTriangle className="h-4 w-4" />
              Scout Anomalies Blocked: {SCOUT_ANOMALIES_BLOCKED}
            </p>
            <p className="headline mt-3 text-4xl text-rose-100">{SCOUT_ANOMALIES_BLOCKED}</p>
          </article>

          <article className="rounded-xl border border-emerald-300/60 bg-emerald-400/10 p-4 shadow-[0_0_25px_rgba(16,185,129,0.18)]">
            <p className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-emerald-100">
              <Clock3 className="h-4 w-4" />
              Avg Processing Time
            </p>
            <p className="headline mt-3 text-4xl text-emerald-100">{AVG_PROCESSING_SECONDS}s</p>
          </article>
        </section>

        <section className="rounded-2xl border border-slate-700/70 bg-slate-800/60 p-5 shadow-[0_0_32px_rgba(99,102,241,0.16)] backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-fuchsia-200" />
            <h2 className="headline text-xl text-fuchsia-100">Peak Delivery Hours</h2>
          </div>
          <div className="h-72 w-full rounded-xl border border-slate-700 bg-slate-950/75 p-2">
            {chartReady ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={PEAK_DELIVERY_DATA} margin={{ top: 12, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="slot" stroke="#cbd5e1" fontSize={12} />
                  <YAxis stroke="#cbd5e1" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0f172a",
                      border: "1px solid #475569",
                      borderRadius: "0.75rem",
                      color: "#e2e8f0",
                    }}
                  />
                  <Bar dataKey="deliveries" radius={[8, 8, 0, 0]} fill="#22d3ee" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">Loading chart...</div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700/70 bg-slate-800/60 p-5 shadow-[0_0_28px_rgba(57,255,20,0.12)] backdrop-blur-xl">
          <h2 className="headline text-xl text-neon-green">VisitorLog History</h2>
          <p className="mt-1 text-sm text-slate-300">Live table refreshes every 10 seconds.</p>

          {loading ? (
            <p className="mt-4 text-slate-300">Loading visitor history...</p>
          ) : errorText ? (
            <p className="mt-4 rounded-lg border border-rose-400/70 bg-rose-400/10 p-3 text-sm text-rose-100">
              {errorText}
            </p>
          ) : history.length === 0 ? (
            <p className="mt-4 text-slate-300">No visitor records yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-700">
              <table className="w-full min-w-[760px] divide-y divide-slate-700 text-left text-sm">
                <thead className="bg-slate-950/85 text-slate-300">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Visitor</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Flat</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 bg-slate-950/60">
                  {history.map((row) => (
                    <tr key={row.id}>
                      <td className="px-4 py-3 text-slate-300">{prettyTimestamp(row.timestamp)}</td>
                      <td className="px-4 py-3 text-slate-100">{row.visitor_name}</td>
                      <td className="px-4 py-3 text-slate-200">{row.visitor_type}</td>
                      <td className="px-4 py-3 text-slate-200">{row.flat_number}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold uppercase tracking-wide ${statusClass(
                            row.status,
                          )}`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
