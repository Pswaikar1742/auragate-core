// Minimal `cn` helper to avoid external dependency on `clsx` and `tailwind-merge`
// It joins string arguments and filters falsy values. This is sufficient for
// className composition in our app; replace with `clsx`/`tailwind-merge` when
// adding those packages to `package.json`.
export function cn(...inputs: Array<string | false | null | undefined>) {
  return inputs
    .flatMap((i) => (typeof i === "string" ? i.split(" ") : []))
    .filter(Boolean)
    .join(" ");
}
