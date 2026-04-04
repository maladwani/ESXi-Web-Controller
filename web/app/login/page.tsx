"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/app/auth-context";
import { Loader2, Lock, Server, User } from "lucide-react";

export default function LoginPage() {
  const { token, isReady, login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isReady && token) {
      router.replace("/");
    }
  }, [isReady, token, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username, password);
      router.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#020617]">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
      </div>
    );
  }

  if (token) {
    return null;
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_top,_#1e293b_0%,_#0f172a_45%,_#020617_100%)] px-4 py-16 text-slate-100">
      <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/60 p-8 shadow-2xl shadow-black/40 backdrop-blur-2xl">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 shadow-lg shadow-cyan-500/25">
            <Server className="h-8 w-8 text-white" />
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-tight">
            ESXi Web Manager
          </h1>
          <p className="mt-2 text-sm text-slate-400">Sign in to manage your hosts</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="username"
              className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500"
            >
              <User className="h-3.5 w-3.5" />
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none ring-cyan-500/30 placeholder:text-slate-600 focus:ring-2"
              placeholder="admin"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-500"
            >
              <Lock className="h-3.5 w-3.5" />
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none ring-cyan-500/30 placeholder:text-slate-600 focus:ring-2"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              className="rounded-xl border border-rose-500/30 bg-rose-950/50 px-4 py-3 text-sm text-rose-200"
              role="alert"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-60"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
