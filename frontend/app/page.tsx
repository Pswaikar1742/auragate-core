import Link from "next/link";

export default function HomePage() {
  return (
    <main className="grid-overlay flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10 text-white">
      <section className="w-full max-w-3xl rounded-2xl border border-slate-700/80 bg-slate-900/70 p-8 shadow-neon backdrop-blur-xl">
        <h1 className="headline text-center text-3xl font-bold tracking-widest text-neon-green md:text-4xl">
          AuraGate Stateful Prototype
        </h1>
        <p className="mt-3 text-center text-lg text-slate-300">
          Prestige Falcon City, Tower 4 | Omni-Channel Escalation
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Link
            href="/guard"
            className="rounded-xl border border-neon-green bg-slate-950/50 p-6 transition hover:bg-neon-green hover:text-slate-950"
          >
            <h2 className="headline text-xl">Guard Tablet</h2>
            <p className="mt-2 text-base">QR + visitor check-in form + API submission.</p>
          </Link>

          <Link
            href="/resident/T4-402"
            className="rounded-xl border border-neon-red bg-slate-950/50 p-6 transition hover:bg-neon-red hover:text-slate-950"
          >
            <h2 className="headline text-xl">Resident App (T4-402)</h2>
            <p className="mt-2 text-base">WebSocket alerts and real-time approve action.</p>
          </Link>
        </div>
      </section>
    </main>
  );
}