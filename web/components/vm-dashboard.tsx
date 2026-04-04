"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import {
  Camera,
  Clapperboard,
  Disc3,
  Loader2,
  LogOut,
  MonitorPlay,
  Power,
  RefreshCw,
  Server,
  Square,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/app/auth-context";
import { apiFetch, parseApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

export type VmRow = {
  id: string;
  name: string;
  status: string;
  os: string;
  memory: string;
  cpu: string;
  ip_address: string;
};

function statusStyles(status: string) {
  return status === "running"
    ? "bg-emerald-500/90 text-white"
    : "bg-rose-500/90 text-white";
}

export function VmDashboard() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [vms, setVms] = useState<VmRow[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{
    type: "info" | "error";
    message: string;
  } | null>(null);

  const [shotOpen, setShotOpen] = useState(false);
  const [shotData, setShotData] = useState<string | null>(null);
  const [shotName, setShotName] = useState("");

  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneSource, setCloneSource] = useState("");
  const [cloneNewName, setCloneNewName] = useState("");

  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const clonePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const showToast = useCallback((message: string, type: "info" | "error" = "info") => {
    setToast({ message, type });
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const loadList = useCallback(async () => {
    if (!token) return;
    try {
      const res = await apiFetch("/list", token);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      if (!res.ok) {
        showToast(parseApiError(data), "error");
        return;
      }
      const list = (data as { vms?: VmRow[] }).vms ?? [];
      setVms(list);
      setLastRefresh(new Date().toLocaleTimeString());
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Failed to load VMs", "error");
    }
  }, [token, logout, router, showToast]);

  useEffect(() => {
    if (!token) return;
    void loadList();
    const id = setInterval(() => void loadList(), 5000);
    return () => clearInterval(id);
  }, [token, loadList]);

  useEffect(() => {
    return () => {
      if (clonePollRef.current) clearInterval(clonePollRef.current);
    };
  }, []);

  async function runAction(
    action: "start" | "stop" | "reset" | "delete",
    vmName: string
  ) {
    if (!token) return;
    if (action === "delete") {
      setConfirmDelete(vmName);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(
        `/${action}?vm_name=${encodeURIComponent(vmName)}`,
        token
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(parseApiError(data));
      showToast((data as { message?: string }).message ?? "Done");
      await loadList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Action failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function confirmDeleteVm() {
    const vmName = confirmDelete;
    if (!vmName || !token) return;
    setConfirmDelete(null);
    setLoading(true);
    try {
      const res = await apiFetch(
        `/delete?vm_name=${encodeURIComponent(vmName)}`,
        token
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(parseApiError(data));
      showToast((data as { message?: string }).message ?? "Deleted");
      await loadList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Delete failed", "error");
    } finally {
      setLoading(false);
    }
  }

  async function takeScreenshot(vmName: string) {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiFetch(
        `/screenshot?vm_name=${encodeURIComponent(vmName)}`,
        token
      );
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(parseApiError(data));
      const b64 = (data as { screenshot?: string }).screenshot;
      if (!b64) {
        showToast((data as { message?: string }).message ?? "No screenshot", "info");
        return;
      }
      setShotName(vmName);
      setShotData(b64);
      setShotOpen(true);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Screenshot failed", "error");
    } finally {
      setLoading(false);
    }
  }

  function openClone(vmName: string) {
    setCloneSource(vmName);
    setCloneNewName("");
    setCloneOpen(true);
  }

  async function submitClone() {
    const name = cloneNewName.trim();
    if (!cloneSource || !name || !token) {
      showToast("Enter a name for the new VM", "error");
      return;
    }
    setCloneOpen(false);
    setLoading(true);
    try {
      const res = await apiFetch("/clone", token, {
        method: "POST",
        body: JSON.stringify({ source_vm: cloneSource, new_vm: name }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(parseApiError(data));
      showToast((data as { message?: string }).message ?? "Clone started");
      if (clonePollRef.current) clearInterval(clonePollRef.current);
      clonePollRef.current = setInterval(async () => {
        const r = await apiFetch("/list", token);
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return;
        const list = (d as { vms?: VmRow[] }).vms ?? [];
        if (list.some((v) => v.name === name)) {
          if (clonePollRef.current) clearInterval(clonePollRef.current);
          showToast(`Clone '${name}' is ready.`);
          await loadList();
        }
      }, 5000);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Clone failed", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative min-h-screen bg-[radial-gradient(ellipse_at_top,_#1e293b_0%,_#0f172a_50%,_#020617_100%)] text-slate-100">
      <header className="relative z-10 border-b border-white/10 bg-slate-900/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-indigo-600 shadow-lg shadow-cyan-500/20">
              <Server className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-tight">
                ESXi Web Manager
              </h1>
              <p className="text-xs text-slate-400">
                Virtual machines · {lastRefresh ? `Updated ${lastRefresh}` : "—"}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/provision"
              className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/30 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-900/40"
            >
              <Disc3 className="h-4 w-4" />
              Provision VM
            </Link>
            <button
              type="button"
              onClick={() => {
                logout();
                router.replace("/login");
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-white/10"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-10">
        {vms.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-slate-900/30 p-16 text-center text-slate-400 backdrop-blur">
            <Server className="mx-auto mb-4 h-12 w-12 opacity-40" />
            <p className="text-lg font-medium text-slate-300">No virtual machines</p>
            <p className="mt-1 text-sm">When VMs appear on the host, they will show up here.</p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-1 lg:grid-cols-2">
            {vms.map((vm) => (
              <article
                key={vm.id}
                className="group rounded-2xl border border-white/10 bg-slate-900/50 p-6 shadow-xl shadow-black/20 backdrop-blur-xl transition hover:border-cyan-500/30 hover:shadow-cyan-500/5"
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500/30 to-indigo-600/40 ring-1 ring-white/10">
                      <Server className="h-7 w-7 text-cyan-200" />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight">{vm.name}</h2>
                      <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400">
                        <MonitorPlay className="h-3.5 w-3.5" />
                        {vm.os}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize",
                      statusStyles(vm.status)
                    )}
                  >
                    {vm.status}
                  </span>
                </div>

                <dl className="mb-6 grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/5">
                    <dt className="text-[10px] uppercase tracking-wider text-slate-500">CPU</dt>
                    <dd className="mt-0.5 font-medium text-slate-200">{vm.cpu}</dd>
                  </div>
                  <div className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/5">
                    <dt className="text-[10px] uppercase tracking-wider text-slate-500">Memory</dt>
                    <dd className="mt-0.5 font-medium text-slate-200">{vm.memory}</dd>
                  </div>
                  <div className="rounded-xl bg-white/5 px-3 py-2 ring-1 ring-white/5">
                    <dt className="text-[10px] uppercase tracking-wider text-slate-500">IP</dt>
                    <dd className="mt-0.5 truncate font-mono text-xs text-slate-200">
                      {vm.ip_address}
                    </dd>
                  </div>
                </dl>

                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  <IconButton
                    label="Start"
                    onClick={() => void runAction("start", vm.name)}
                    className="bg-emerald-600 hover:bg-emerald-500"
                    icon={<Power className="h-4 w-4" />}
                  />
                  <IconButton
                    label="Stop"
                    onClick={() => void runAction("stop", vm.name)}
                    className="bg-rose-600 hover:bg-rose-500"
                    icon={<Square className="h-3.5 w-3.5 fill-current" />}
                  />
                  <IconButton
                    label="Reset"
                    onClick={() => void runAction("reset", vm.name)}
                    className="bg-amber-600 hover:bg-amber-500"
                    icon={<RefreshCw className="h-4 w-4" />}
                  />
                  <IconButton
                    label="Screenshot"
                    onClick={() => void takeScreenshot(vm.name)}
                    className="bg-sky-600 hover:bg-sky-500"
                    icon={<Camera className="h-4 w-4" />}
                  />
                  <IconButton
                    label="Clone"
                    onClick={() => openClone(vm.name)}
                    className="bg-violet-600 hover:bg-violet-500"
                    icon={<Clapperboard className="h-4 w-4" />}
                  />
                  <IconButton
                    label="Delete"
                    onClick={() => void runAction("delete", vm.name)}
                    className="bg-slate-700 hover:bg-slate-600"
                    icon={<Trash2 className="h-4 w-4" />}
                  />
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/90 px-6 py-4 shadow-2xl">
            <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
            <span className="text-sm font-medium">Working…</span>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={cn(
            "fixed bottom-6 right-6 z-50 max-w-md rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl",
            toast.type === "error"
              ? "border-rose-500/40 bg-rose-950/90 text-rose-100"
              : "border-cyan-500/30 bg-slate-900/95 text-slate-100"
          )}
        >
          {toast.message}
        </div>
      )}

      {shotOpen && shotData && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md"
          onClick={() => setShotOpen(false)}
          role="presentation"
        >
          <div
            className="max-h-[90vh] max-w-4xl overflow-auto rounded-2xl border border-white/10 bg-slate-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Screenshot"
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <p className="text-sm text-slate-400">
                <span className="font-medium text-slate-200">{shotName}</span>
                <span className="mx-2">·</span>
                {new Date().toLocaleString()}
              </p>
              <div className="flex gap-2">
                <a
                  href={`data:image/png;base64,${shotData}`}
                  download={`${shotName}-screenshot.png`}
                  className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500"
                >
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setShotOpen(false)}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                >
                  Close
                </button>
              </div>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`data:image/png;base64,${shotData}`}
              alt={`Screenshot of ${shotName}`}
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          </div>
        </div>
      )}

      {cloneOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div
            className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
            role="dialog"
            aria-label="Clone virtual machine"
          >
            <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold">
              Clone VM
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              From <span className="text-slate-200">{cloneSource}</span>
            </p>
            <label className="mt-4 block text-xs font-medium uppercase tracking-wider text-slate-500">
              New VM name
            </label>
            <input
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none ring-cyan-500/40 focus:ring-2"
              value={cloneNewName}
              onChange={(e) => setCloneNewName(e.target.value)}
              placeholder="e.g. web-server-02"
              autoFocus
            />
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloneOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitClone()}
                className="rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-4 py-2 text-sm font-medium text-white hover:from-violet-500 hover:to-indigo-500"
              >
                Start clone
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
          <div
            className="w-full max-w-md rounded-2xl border border-rose-500/20 bg-slate-900 p-6 shadow-2xl"
            role="alertdialog"
            aria-label="Confirm delete"
          >
            <h3 className="text-lg font-semibold text-rose-200">Delete VM</h3>
            <p className="mt-2 text-sm text-slate-400">
              Delete <span className="font-medium text-slate-200">{confirmDelete}</span>? This
              cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteVm()}
                className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  className,
  icon,
}: {
  label: string;
  onClick: () => void;
  className: string;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      className={cn(
        "flex min-h-[44px] items-center justify-center rounded-xl text-white shadow-lg transition active:scale-[0.98]",
        className
      )}
    >
      {icon}
    </button>
  );
}
