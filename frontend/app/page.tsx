import Link from "next/link";

export default function HomePage() {
  return (
    <main className="grid-overlay flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10 text-white">
      <section className="w-full max-w-3xl rounded-2xl border border-slate-700/80 bg-slate-900/70 p-8 shadow-neon backdrop-blur-xl">
        <h1 className="headline text-center text-3xl font-bold tracking-widest text-neon-green md:text-4xl">
          AuraGate Persona Dashboards
        </h1>
        <p className="mt-3 text-center text-lg text-slate-300">
          Cyber-Dark SaaS command surface for residents, guests, guards, and admins.
        </p>

        <div className="mt-8 grid gap-4 md:grid-cols-2">
          <Link
            href="/resident/login"
            className="rounded-xl border border-fuchsia-400/70 bg-slate-950/50 p-6 transition hover:bg-fuchsia-400 hover:text-slate-950"
          >
            <h2 className="headline text-xl">Resident Login</h2>
            <p className="mt-2 text-base">Sign in with flat + PIN, then open your resident approval dashboard.</p>
          </Link>

          <Link
            href="/invite/demo-pass"
            className="rounded-xl border border-cyan-400/70 bg-slate-950/50 p-6 transition hover:bg-cyan-400 hover:text-slate-950"
          >
            <h2 className="headline text-xl">Visitor Guest Pass</h2>
            <p className="mt-2 text-base">Geo-verified access control and rotating TOTP QR.</p>
          </Link>

          <Link
            href="/guard"
            className="rounded-xl border border-neon-green bg-slate-950/50 p-6 transition hover:bg-neon-green hover:text-slate-950"
          >
            <h2 className="headline text-xl">Guard Kiosk Tablet</h2>
            <p className="mt-2 text-base">Expected guest scanner + unplanned visitor quick actions.</p>
          </Link>

          <Link
            href="/admin"
            className="rounded-xl border border-cyan-300 bg-slate-950/50 p-6 transition hover:bg-cyan-300 hover:text-slate-950"
          >
            <h2 className="headline text-xl">Admin Analytics</h2>
            <p className="mt-2 text-base">KPI cards, delivery-hour chart, and live VisitorLog table.</p>
          </Link>

          <Link
            href="/visitor"
            className="rounded-xl border border-amber-300 bg-slate-950/50 p-6 transition hover:bg-amber-300 hover:text-slate-950"
          >
            <h2 className="headline text-xl">Visitor Self-Serve</h2>
            <p className="mt-2 text-base">Mobile-first intake, selfie capture, geofence moat, and QR pass.</p>
          </Link>
        </div>
      </section>
    </main>
  );
}