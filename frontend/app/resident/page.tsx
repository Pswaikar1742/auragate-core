import Link from "next/link";

const DEMO_FLATS = ["T4-401", "T4-402", "T4-503"];

export default function ResidentIndexPage() {
  return (
    <main className="grid-overlay flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10 text-white">
      <section className="w-full max-w-3xl rounded-2xl border border-slate-700/80 bg-slate-900/70 p-8 shadow-neon backdrop-blur-xl">
        <h1 className="headline text-center text-3xl font-bold tracking-widest text-neon-green md:text-4xl">
          Resident Entry
        </h1>
        <p className="mt-3 text-center text-slate-300">
          Choose a flat profile. This page is available even if backend APIs are temporarily unavailable.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {DEMO_FLATS.map((flat) => (
            <Link
              key={flat}
              href={`/resident/${flat}`}
              className="rounded-xl border border-neon-green bg-slate-950/50 p-4 text-center font-semibold transition hover:bg-neon-green hover:text-slate-950"
            >
              {flat}
            </Link>
          ))}
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/guard"
            className="text-sm text-slate-300 underline decoration-slate-500 underline-offset-4 hover:text-neon-green"
          >
            Go to Guard Page
          </Link>
        </div>
      </section>
    </main>
  );
}
