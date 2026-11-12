import { Boxes, FileCode2, FlaskConical, Gauge, Layers, LogOut, Menu, Send, X } from "lucide-react";
import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useEnvironment } from "../lib/environment";
import { cx, Select } from "./ui";

const nav = [
  { to: "/", label: "Dashboard", icon: Gauge, end: true },
  { to: "/workspace", label: "API Client", icon: Send },
  { to: "/collections", label: "Collections", icon: Boxes },
  { to: "/environments", label: "Environments", icon: Layers },
  { to: "/tests", label: "Test Suites", icon: FlaskConical },
  { to: "/openapi", label: "OpenAPI Import", icon: FileCode2 },
];

const kindDot: Record<string, string> = { DEVELOPMENT: "bg-ok", STAGING: "bg-warn", PRODUCTION: "bg-bad", CUSTOM: "bg-info" };

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-[#5a4be0] shadow-lg shadow-accent/20">
        <svg viewBox="0 0 32 32" className="size-4">
          <path d="M9 21.5 15 8l2.2 5.1M12.2 17h7.6M17.6 14.6 23 24" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
      <span className="text-[15px] font-semibold tracking-tight">APIForge</span>
    </div>
  );
}

export function EnvironmentPicker({ className }: { className?: string }) {
  const { environments, activeId, setActiveId, active } = useEnvironment();
  return (
    <div className={cx("relative", className)}>
      <span className={cx("pointer-events-none absolute left-3 top-1/2 size-2 -translate-y-1/2 rounded-full", active ? kindDot[active.kind] : "bg-faint")} />
      <Select aria-label="Active environment" value={activeId ?? ""} onChange={(e) => setActiveId(e.target.value || null)} className="h-8 py-0 pl-7 text-[13px]">
        <option value="">No environment</option>
        {environments.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
          </option>
        ))}
      </Select>
    </div>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const fullBleed = location.pathname.startsWith("/workspace");

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-4 flex items-center justify-between px-2 pt-1">
        <Logo />
        <button className="lg:hidden" aria-label="Close menu" onClick={() => setOpen(false)}>
          <X className="size-4 text-muted" />
        </button>
      </div>
      <div className="mb-3 px-1">
        <span className="label px-1">Environment</span>
        <EnvironmentPicker />
      </div>
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={() => setOpen(false)}
          className={({ isActive }) => cx("flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13.5px] font-medium transition-colors", isActive ? "bg-surface-3 text-fg shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:bg-surface-2 hover:text-fg")}
        >
          <Icon className="size-4" />
          {label}
        </NavLink>
      ))}
      <div className="mt-auto rounded-lg border border-line bg-surface-2 p-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{user?.name.slice(0, 2).toUpperCase()}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{user?.name}</div>
            <div className="truncate text-[11px] text-faint">{user?.email}</div>
          </div>
          <button aria-label="Sign out" title="Sign out" onClick={() => void logout()} className="rounded-md p-1.5 text-muted hover:bg-surface-3 hover:text-fg">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface/60 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 border-r border-line bg-surface animate-slide-up" onClick={(e) => e.stopPropagation()}>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 items-center gap-3 border-b border-line px-4 lg:hidden">
          <button aria-label="Open menu" onClick={() => setOpen(true)}>
            <Menu className="size-5 text-muted" />
          </button>
          <Logo />
        </header>
        <main className={cx("min-h-0 flex-1", fullBleed ? "overflow-hidden" : "overflow-y-auto")}>
          {fullBleed ? (
            <Outlet />
          ) : (
            <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              <Outlet />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
