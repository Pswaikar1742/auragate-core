import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="grid-overlay flex min-h-screen items-center justify-center bg-vintage px-4 py-10 text-navy">
      <section className="w-full max-w-2xl rounded-2xl border-4 border-navy bg-white p-8 shadow-offset-navy">
        <h1 className="headline text-center text-3xl font-bold tracking-widest text-danger md:text-4xl">
          Route Not Found
        </h1>
        <p className="mt-3 text-center text-navy/70">
          This is an app-level 404. Use one of the verified routes below.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <Link
            href="/"
            className="rounded-xl border-2 border-navy bg-vintage p-4 text-center font-semibold text-navy transition hover:border-safety hover:text-safety"
          >
            Home
          </Link>
          <Link
            href="/guard"
            className="rounded-xl border-2 border-navy bg-vintage p-4 text-center font-semibold text-navy transition hover:border-safety hover:text-safety"
          >
            Guard
          </Link>
          <Link
            href="/resident"
            className="rounded-xl border-2 border-navy bg-vintage p-4 text-center font-semibold text-navy transition hover:border-safety hover:text-safety"
          >
            Resident
          </Link>
        </div>
      </section>
    </main>
  );
}
