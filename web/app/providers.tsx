"use client";

import { AuthProvider } from "@/app/auth-context";

export function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
