"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      let msg = "Login failed";
      try { const d = await res.json(); msg = d.error || msg; } catch {}
      setError(msg);
      setLoading(false);
      return;
    }
    router.push("/");
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh]">
      <h1 className="text-2xl font-bold mb-8">Diurn</h1>
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
        <div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            autoFocus
          />
        </div>
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
        >
          {loading ? "..." : "Login"}
        </button>
      </form>

      <div className="w-full max-w-sm mt-8 text-xs text-zinc-500 space-y-3">
        <p>There is no default password — you set yours the first time you ran Diurn.</p>
        <details>
          <summary className="cursor-pointer hover:text-zinc-400">Forgot your password?</summary>
          <div className="mt-2 p-3 bg-zinc-900 border border-zinc-800 rounded text-zinc-400 space-y-2">
            <p>Self-hosted single-user. To reset:</p>
            <ol className="list-decimal pl-5 space-y-1">
              <li>Stop the server (Ctrl+C in the terminal running it).</li>
              <li>Delete the database: <code className="text-emerald-400">rm ~/.diurn/data.db</code></li>
              <li>Restart the app. The setup page will appear again.</li>
            </ol>
            <p className="text-zinc-500 mt-2">Your markdown entries in <code>daily_note_folder</code> are kept separately.</p>
          </div>
        </details>
      </div>
    </div>
  );
}
