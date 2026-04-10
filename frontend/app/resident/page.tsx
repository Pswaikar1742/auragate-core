import Link from "next/link";

const DEMO_FLATS = ["T4-401", "T4-402", "T4-503"];

export default function ResidentIndexPage() {
  return (
    <main className="grid-overlay flex min-h-screen items-center justify-center bg-vintage px-4 py-10 text-navy">
      <section className="w-full max-w-3xl rounded-2xl border-4 border-navy bg-white p-8 shadow-offset-navy">
        <h1 className="headline text-center text-3xl font-bold tracking-widest text-navy md:text-4xl">
          Resident Entry
        </h1>
        <p className="mt-3 text-center text-navy/70">
          Choose a flat profile. This page is available even if backend APIs are temporarily unavailable.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {DEMO_FLATS.map((flat) => (
            <Link
              key={flat}
              href={`/resident/${flat}`}
              className="rounded-xl border-2 border-navy bg-vintage p-4 text-center font-semibold text-navy transition hover:bg-navy hover:text-white"
            >
              {flat}
            </Link>
          ))}
        </div>

        <div className="mt-6 text-center">
          <Link
            href="/guard"
            className="text-sm text-navy/70 underline decoration-navy underline-offset-4 hover:text-safety"
          >
            Go to Guard Page
          </Link>
        </div>
      </section>
    </main>
  );
}
