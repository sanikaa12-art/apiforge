import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { http, refreshSession, setAccessToken, setSessionExpiredHandler } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    // Restore the session from the httpOnly refresh cookie on page load.
    refreshSession()
      .then((s) => setUser(s?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      setUser(null);
      qc.clear();
    });
  }, [qc]);

  const handleSession = useCallback((s: { user: User; accessToken: string }) => {
    setAccessToken(s.accessToken);
    setUser(s.user);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      login: async (email, password) => handleSession(await http.post("/auth/login", { email, password })),
      register: async (name, email, password) => handleSession(await http.post("/auth/register", { name, email, password })),
      logout: async () => {
        await http.post("/auth/logout").catch(() => undefined);
        setAccessToken(null);
        setUser(null);
        qc.clear();
      },
    }),
    [user, loading, handleSession, qc],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
