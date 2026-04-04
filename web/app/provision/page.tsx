"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/app/auth-context";
import { ProvisionForm } from "@/components/provision-form";

export default function ProvisionPage() {
  const { token, isReady } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isReady && !token) {
      router.replace("/login");
    }
  }, [isReady, token, router]);

  if (!isReady || !token) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[#020617] text-slate-400">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-500" />
        <p className="text-sm">Loading…</p>
      </div>
    );
  }

  return <ProvisionForm />;
}
