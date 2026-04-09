import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="grid-overlay flex min-h-screen items-center justify-center bg-slate-900 px-4 py-10 text-white">
      <section className="w-full max-w-2xl rounded-2xl border border-slate-700/80 bg-slate-900/70 p-8 shadow-neon backdrop-blur-xl">
        <h1 className="headline text-center text-3xl font-bold tracking-widest text-neon-red md:text-4xl">
          Route Not Found
        </h1>
        <p className="mt-3 text-center text-slate-300">
          This is an app-level 404. Use one of the verified routes below.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Link
            href="/"
            className="rounded-xl border border-slate-600 bg-slate-950/50 p-4 text-center font-semibold transition hover:border-neon-green hover:text-neon-green"
          >
            Home
          </Link>
          <Link
            href="/guard"
            className="rounded-xl border border-slate-600 bg-slate-950/50 p-4 text-center font-semibold transition hover:border-neon-green hover:text-neon-green"
          >
            Guard
          </Link>
          <Link
            href="/resident"
            className="rounded-xl border border-slate-600 bg-slate-950/50 p-4 text-center font-semibold transition hover:border-neon-green hover:text-neon-green"
          >
            Resident
          </Link>
        </div>
      </section>
    </main>
  );
}
