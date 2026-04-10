import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-x-hidden bg-vintage px-4 py-6 text-navy sm:px-6 lg:px-8">
      <section className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header className="border border-slate-300 bg-white/30 p-4 sm:p-6">
          <p className="inline-flex border-2 border-navy bg-white px-3 py-2 text-xs font-bold uppercase tracking-[0.22em] shadow-[2px_2px_0px_#1B2A47]">
            AuraGate Persona Portal
          </p>
          <h1 className="mt-4 text-3xl font-black uppercase tracking-[0.2em] text-navy sm:text-5xl">Operations Console</h1>
          <p className="mt-3 max-w-3xl text-sm font-semibold uppercase tracking-[0.14em] text-navy/70 sm:text-base">
            Same white-mode brutalist system across guard kiosk, resident approvals, admin operations, and guest flows.
          </p>
        </header>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Link
            href="/guard"
            className="group flex min-h-[180px] flex-col justify-between border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
          >
            <h2 className="text-3xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Guard Kiosk</h2>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-navy/70 transition-colors duration-200 group-hover:text-white">
              Launch gate terminal with QR, delivery, multi-flat, staff, and unknown visitor workflows.
            </p>
          </Link>

          <Link
            href="/resident/login"
            className="group flex min-h-[180px] flex-col justify-between border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
          >
            <h2 className="text-3xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Resident Login</h2>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-navy/70 transition-colors duration-200 group-hover:text-white">
              Authenticate residents, review live alerts, and approve visitors in real time.
            </p>
          </Link>

          <Link
            href="/invite/demo-pass"
            className="group flex min-h-[180px] flex-col justify-between border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
          >
            <h2 className="text-3xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Guest Pass</h2>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-navy/70 transition-colors duration-200 group-hover:text-white">
              Issue invite links and rotating pass codes for expected visitors.
            </p>
          </Link>

          <Link
            href="/admin"
            className="group flex min-h-[180px] flex-col justify-between border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
          >
            <h2 className="text-3xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Admin Analytics</h2>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-navy/70 transition-colors duration-200 group-hover:text-white">
              Observe trends, operational KPIs, and resident-response timelines.
            </p>
          </Link>

          <Link
            href="/visitor"
            className="group flex min-h-[180px] flex-col justify-between border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
          >
            <h2 className="text-3xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Visitor Intake</h2>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-navy/70 transition-colors duration-200 group-hover:text-white">
              Mobile-first visitor self-serve flow with guided onboarding.
            </p>
          </Link>

          <Link
            href="/resident"
            className="group flex min-h-[180px] flex-col justify-between border-4 border-navy bg-white p-6 shadow-[6px_6px_0px_#1B2A47] transition-colors duration-200 hover:bg-safety"
          >
            <h2 className="text-3xl font-black uppercase tracking-[0.16em] text-navy transition-colors duration-200 group-hover:text-white">Resident Index</h2>
            <p className="text-sm font-bold uppercase tracking-[0.12em] text-navy/70 transition-colors duration-200 group-hover:text-white">
              Quick flat-directory handoff for live demonstrations.
            </p>
          </Link>
        </div>
      </section>
    </main>
  );
}