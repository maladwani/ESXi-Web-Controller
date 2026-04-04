"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getApiBase } from "@/lib/api";

const TOKEN_KEY = "esxi_web_token";

type AuthContextValue = {
  token: string | null;
  isReady: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    try {
      setToken(sessionStorage.getItem(TOKEN_KEY));
    } catch {
      setToken(null);
    }
    setIsReady(true);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const res = await fetch(`${getApiBase()}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        data && typeof data === "object" && "detail" in data
          ? typeof (data as { detail: unknown }).detail === "string"
            ? (data as { detail: string }).detail
            : "Login failed"
          : "Login failed";
      throw new Error(msg);
    }
    const t = (data as { access_token?: string }).access_token;
    if (!t) throw new Error("No access token in response");
    sessionStorage.setItem(TOKEN_KEY, t);
    setToken(t);
  }, []);

  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setToken(null);
  }, []);

  const value = useMemo(
    () => ({ token, isReady, login, logout }),
    [token, isReady, login, logout]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
