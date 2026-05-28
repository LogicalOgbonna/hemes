"use client";

import { useState, useEffect } from "react";

interface Todo {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/todos");
        if (!res.ok) throw new Error("Failed to fetch");
        const data = await res.json();
        if (!cancelled) {
          setTodos(data);
          setError(null);
        }
      } catch {
        if (!cancelled) setError("Failed to load todos");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setTitle("");
    try {
      const res = await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) throw new Error("Failed to create");
      const todo = await res.json();
      setTodos((prev) => [todo, ...prev]);
    } catch {
      setError("Failed to add todo");
    }
  };

  const toggleTodo = async (id: string) => {
    try {
      const res = await fetch(`/api/todos/${id}`, { method: "PATCH" });
      if (!res.ok) throw new Error("Failed to update");
      const updated = await res.json();
      setTodos((prev) =>
        prev.map((t) => (t.id === id ? updated : t))
      );
    } catch {
      setError("Failed to update todo");
    }
  };

  const deleteTodo = async (id: string) => {
    try {
      const res = await fetch(`/api/todos/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setTodos((prev) => prev.filter((t) => t.id !== id));
    } catch {
      setError("Failed to delete todo");
    }
  };

  return (
    <div className="flex flex-col flex-1 items-center bg-zinc-50 font-sans dark:bg-zinc-900">
      <main className="w-full max-w-xl px-4 py-12">
        <h1 className="mb-8 text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          Todos
        </h1>

        <form onSubmit={addTodo} className="mb-8 flex gap-2">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            className="flex-1 rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-zinc-900 placeholder-zinc-400 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-50 dark:placeholder-zinc-500"
          />
          <button
            type="submit"
            disabled={!title.trim()}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 font-medium text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Add
          </button>
        </form>

        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-zinc-500 dark:text-zinc-400">Loading...</p>
        ) : todos.length === 0 ? (
          <p className="text-zinc-500 dark:text-zinc-400">
            No todos yet. Add one above!
          </p>
        ) : (
          <ul className="space-y-1">
            {todos.map((todo) => (
              <li
                key={todo.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-100 bg-white px-4 py-3 transition-colors hover:border-zinc-200 dark:border-zinc-800 dark:bg-zinc-800/50 dark:hover:border-zinc-700"
              >
                <button
                  onClick={() => toggleTodo(todo.id)}
                  className="flex-shrink-0"
                  aria-label={todo.completed ? "Mark incomplete" : "Mark complete"}
                >
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded border-2 transition-colors ${
                      todo.completed
                        ? "border-zinc-900 bg-zinc-900 dark:border-zinc-50 dark:bg-zinc-50"
                        : "border-zinc-300 hover:border-zinc-400 dark:border-zinc-600"
                    }`}
                  >
                    {todo.completed && (
                      <svg
                        className="h-3 w-3 text-white dark:text-zinc-900"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    )}
                  </div>
                </button>

                <div className="flex-1 min-w-0">
                  <p
                    className={`truncate text-sm ${
                      todo.completed
                        ? "text-zinc-400 line-through dark:text-zinc-500"
                        : "text-zinc-900 dark:text-zinc-50"
                    }`}
                  >
                    {todo.title}
                  </p>
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    {new Date(todo.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </p>
                </div>

                <button
                  onClick={() => deleteTodo(todo.id)}
                  className="flex-shrink-0 rounded p-1 text-zinc-400 transition-colors hover:text-red-500 dark:text-zinc-500 dark:hover:text-red-400"
                  aria-label="Delete todo"
                >
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
