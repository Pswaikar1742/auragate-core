type TodoRow = {
  id: string;
  name: string;
};

const DEMO_TODOS: TodoRow[] = [
  { id: "1", name: "Confirm guard shift handover" },
  { id: "2", name: "Validate resident alert delivery" },
  { id: "3", name: "Run end-to-end kiosk smoke test" },
];

export default function TodosPage() {
  return (
    <main className="min-h-screen bg-vintage px-4 py-10 text-navy">
      <section className="mx-auto max-w-3xl rounded-xl border border-navy bg-white p-6">
        <h1 className="text-2xl font-semibold">Operations Todos</h1>
        <p className="mt-2 text-sm text-navy/70">
          This route is kept as a lightweight demo list so builds do not depend on an external Supabase client.
        </p>
        <ul className="mt-4 space-y-2">
          {DEMO_TODOS.map((todo) => (
            <li key={todo.id} className="rounded-md border border-navy px-3 py-2 text-navy">
              {todo.name}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
