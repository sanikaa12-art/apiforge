import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { http } from "./api";
import type { Environment } from "./types";
import { useAuth } from "./auth";

const KEY = "apiforge.activeEnvironment";
const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

interface EnvState {
  environments: Environment[];
  activeId: string | null;
  active: Environment | null;
  setActiveId: (id: string | null) => void;
  isLoading: boolean;
}
const Ctx = createContext<EnvState | null>(null);

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["environments"], queryFn: () => http.get<Environment[]>("/environments"), enabled: !!user });
  const [activeId, setActive] = useState<string | null>(read);
  const environments = q.data ?? [];

  useEffect(() => {
    if (!q.data) return;
    if (activeId && !q.data.some((e) => e.id === activeId)) setActiveId(q.data[0]?.id ?? null);
    if (!activeId && q.data[0]) setActiveId(q.data[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);

  function setActiveId(id: string | null) {
    setActive(id);
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* storage unavailable — selection just won't persist */
    }
  }

  return (
    <Ctx.Provider value={{ environments, activeId, active: environments.find((e) => e.id === activeId) ?? null, setActiveId, isLoading: q.isLoading }}>
      {children}
    </Ctx.Provider>
  );
}

export function useEnvironment() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useEnvironment outside provider");
  return c;
}
