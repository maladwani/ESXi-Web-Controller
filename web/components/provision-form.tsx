"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Search, Server } from "lucide-react";
import { useAuth } from "@/app/auth-context";
import { apiFetch, parseApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

function CheckboxRow({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-white/20 bg-slate-900"
      />
      {label}
    </label>
  );
}

type Options = {
  datacenter: string;
  host_name: string;
  datastores: { name: string; free_space_bytes: number; capacity_bytes: number; type: string }[];
  networks: { name: string; type: string }[];
  guest_os: { id: string; label: string }[];
  hardware_versions: { id: string; label: string }[];
  scsi_controller_types: { id: string; label: string }[];
  nic_types: { id: string; label: string }[];
  disk_provisioning: { id: string; label: string }[];
};

const defaultForm = {
  name: "",
  datastore: "",
  iso_path: "",
  cpu: 2,
  cores_per_socket: 1,
  memory_mb: 4096,
  disk_size_mb: 40960,
  disk_provisioning: "thin" as const,
  network_name: "",
  guest_id: "ubuntu64Guest",
  boot_firmware: "bios" as const,
  hardware_version: "vmx-20",
  nic_type: "vmxnet3" as const,
  scsi_controller_type: "lsilogicsas" as const,
  connect_cdrom: true,
  connect_nic: true,
  boot_from_iso_first: true,
  cpu_hot_add: false,
  memory_hot_plug: false,
  auto_power_on: false,
};

export function ProvisionForm() {
  const { token, logout } = useAuth();
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [isoList, setIsoList] = useState<{ path: string; size_bytes: number }[]>([]);
  const [isoSearchBusy, setIsoSearchBusy] = useState(false);
  const [isoSubpath, setIsoSubpath] = useState("");

  const loadOptions = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const res = await apiFetch("/provision/options", token);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(parseApiError(data));
      setOptions(data as Options);
      const ds = (data as Options).datastores[0]?.name ?? "";
      setForm((f) => ({ ...f, datastore: f.datastore || ds }));
      const net = (data as Options).networks[0]?.name ?? "";
      setForm((f) => ({ ...f, network_name: f.network_name || net }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load options");
    } finally {
      setLoading(false);
    }
  }, [token, logout, router]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  async function searchIsos() {
    if (!token || !form.datastore) return;
    setIsoSearchBusy(true);
    setErr(null);
    try {
      const q = new URLSearchParams({ datastore: form.datastore, subpath: isoSubpath });
      const res = await apiFetch(`/provision/isos?${q}`, token);
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(parseApiError(data));
      setIsoList((data as { isos?: typeof isoList }).isos ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "ISO search failed");
    } finally {
      setIsoSearchBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await apiFetch("/provision/fromiso", token, {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(),
          datastore: form.datastore,
          iso_path: form.iso_path.trim(),
          cpu: form.cpu,
          cores_per_socket: form.cores_per_socket,
          memory_mb: form.memory_mb,
          disk_size_mb: form.disk_size_mb,
          disk_provisioning: form.disk_provisioning,
          network_name: form.network_name,
          guest_id: form.guest_id,
          boot_firmware: form.boot_firmware,
          hardware_version: form.hardware_version,
          nic_type: form.nic_type,
          scsi_controller_type: form.scsi_controller_type,
          connect_cdrom: form.connect_cdrom,
          connect_nic: form.connect_nic,
          boot_from_iso_first: form.boot_from_iso_first,
          cpu_hot_add: form.cpu_hot_add,
          memory_hot_plug: form.memory_hot_plug,
          auto_power_on: form.auto_power_on,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        logout();
        router.replace("/login");
        return;
      }
      if (!res.ok) throw new Error(parseApiError(data));
      router.push("/");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Provision failed");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !options) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#020617] text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
        <p className="text-sm">Loading ESXi provisioning options…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_#1e293b_0%,_#0f172a_45%,_#020617_100%)] px-4 py-10 text-slate-100">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to VMs
          </Link>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500 to-indigo-600">
              <Server className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold">
                Provision VM
              </h1>
              <p className="text-xs text-slate-400">
                {options.datacenter} · {options.host_name}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-6 rounded-2xl border border-white/10 bg-slate-900/50 p-6 backdrop-blur-xl">
          {err && (
            <div
              className="rounded-xl border border-rose-500/30 bg-rose-950/40 px-4 py-3 text-sm text-rose-200"
              role="alert"
            >
              {err}
            </div>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Identity</h2>
            <label className="block text-xs text-slate-400">Virtual machine name</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm outline-none ring-cyan-500/30 focus:ring-2"
              placeholder="my-new-vm"
            />
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Storage & ISO</h2>
            <label className="block text-xs text-slate-400">Datastore</label>
            <select
              required
              value={form.datastore}
              onChange={(e) => setForm({ ...form, datastore: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm outline-none ring-cyan-500/30 focus:ring-2"
            >
              <option value="">Select datastore</option>
              {options.datastores.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.name} ({Math.round(d.free_space_bytes / (1024 ** 3))} GB free)
                </option>
              ))}
            </select>

            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label className="block text-xs text-slate-400">Search ISO subfolder (optional)</label>
                <input
                  value={isoSubpath}
                  onChange={(e) => setIsoSubpath(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none ring-cyan-500/30 focus:ring-2"
                  placeholder="e.g. ISO or isos/linux"
                />
              </div>
              <button
                type="button"
                onClick={() => void searchIsos()}
                disabled={isoSearchBusy || !form.datastore}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-500/40 bg-cyan-950/40 px-4 py-2 text-sm font-medium text-cyan-200 hover:bg-cyan-900/40 disabled:opacity-50"
              >
                {isoSearchBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Find ISOs
              </button>
            </div>

            {isoList.length > 0 && (
              <div>
                <label className="block text-xs text-slate-400">Pick an ISO (sets path below)</label>
                <select
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm"
                  value=""
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v) setForm((f) => ({ ...f, iso_path: v }));
                  }}
                >
                  <option value="">— Select —</option>
                  {isoList.map((iso) => (
                    <option key={iso.path} value={iso.path}>
                      {iso.path} ({Math.round(iso.size_bytes / (1024 * 1024))} MB)
                    </option>
                  ))}
                </select>
              </div>
            )}

            <label className="block text-xs text-slate-400">
              ISO path{" "}
              <span className="text-slate-500">
                ([datastore] folder/file.iso — filled when you pick from search or type manually)
              </span>
            </label>
            <input
              required
              value={form.iso_path}
              onChange={(e) => setForm({ ...form, iso_path: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 font-mono text-xs outline-none ring-cyan-500/30 focus:ring-2"
              placeholder="[datastore1] ISO/ubuntu-22.04.iso"
            />

            <label className="block text-xs text-slate-400">Disk provisioning</label>
            <select
              value={form.disk_provisioning}
              onChange={(e) =>
                setForm({
                  ...form,
                  disk_provisioning: e.target.value as (typeof form)["disk_provisioning"],
                })
              }
              className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm"
            >
              {options.disk_provisioning.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400">vCPUs (total)</label>
              <input
                type="number"
                min={1}
                required
                value={form.cpu}
                onChange={(e) => setForm({ ...form, cpu: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Cores per socket</label>
              <input
                type="number"
                min={1}
                required
                value={form.cores_per_socket}
                onChange={(e) => setForm({ ...form, cores_per_socket: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Memory (MB)</label>
              <input
                type="number"
                min={256}
                required
                value={form.memory_mb}
                onChange={(e) => setForm({ ...form, memory_mb: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Disk size (MB)</label>
              <input
                type="number"
                min={1024}
                required
                value={form.disk_size_mb}
                onChange={(e) => setForm({ ...form, disk_size_mb: Number(e.target.value) })}
                className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
              />
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Network & guest</h2>
            <label className="block text-xs text-slate-400">Port group / network</label>
            <select
              required
              value={form.network_name}
              onChange={(e) => setForm({ ...form, network_name: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm"
            >
              <option value="">Select network</option>
              {options.networks.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name} ({n.type})
                </option>
              ))}
            </select>

            <label className="block text-xs text-slate-400">Guest OS</label>
            <select
              value={form.guest_id}
              onChange={(e) => setForm({ ...form, guest_id: e.target.value })}
              className="w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2.5 text-sm"
            >
              {options.guest_os.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-400">Firmware</label>
                <select
                  value={form.boot_firmware}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      boot_firmware: e.target.value as (typeof form)["boot_firmware"],
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm"
                >
                  <option value="bios">BIOS</option>
                  <option value="efi">UEFI</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">Hardware compatibility</label>
                <select
                  value={form.hardware_version}
                  onChange={(e) => setForm({ ...form, hardware_version: e.target.value })}
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm"
                >
                  {options.hardware_versions.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">Devices</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-400">SCSI controller</label>
                <select
                  value={form.scsi_controller_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      scsi_controller_type: e.target.value as (typeof form)["scsi_controller_type"],
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm"
                >
                  {options.scsi_controller_types.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400">Network adapter</label>
                <select
                  value={form.nic_type}
                  onChange={(e) =>
                    setForm({ ...form, nic_type: e.target.value as (typeof form)["nic_type"] })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm"
                >
                  {options.nic_types.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            <CheckboxRow
              checked={form.connect_cdrom}
              onChange={(v) => setForm({ ...form, connect_cdrom: v })}
              label="Connect CD/DVD (ISO) at power on"
            />
            <CheckboxRow
              checked={form.connect_nic}
              onChange={(v) => setForm({ ...form, connect_nic: v })}
              label="Connect network adapter at power on"
            />
            <CheckboxRow
              checked={form.boot_from_iso_first}
              onChange={(v) => setForm({ ...form, boot_from_iso_first: v })}
              label="Boot order: ISO before disk"
            />
            <CheckboxRow
              checked={form.cpu_hot_add}
              onChange={(v) => setForm({ ...form, cpu_hot_add: v })}
              label="CPU hot add"
            />
            <CheckboxRow
              checked={form.memory_hot_plug}
              onChange={(v) => setForm({ ...form, memory_hot_plug: v })}
              label="Memory hot plug"
            />
            <CheckboxRow
              checked={form.auto_power_on}
              onChange={(v) => setForm({ ...form, auto_power_on: v })}
              label="Power on VM after creation"
            />
          </section>

          <button
            type="submit"
            disabled={saving}
            className={cn(
              "w-full rounded-xl bg-gradient-to-r from-cyan-600 to-indigo-600 py-3 text-sm font-semibold text-white shadow-lg transition",
              "hover:from-cyan-500 hover:to-indigo-500 disabled:opacity-60"
            )}
          >
            {saving ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating…
              </span>
            ) : (
              "Create virtual machine"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
