import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { FlaskConical, ShieldCheck, Sparkles } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Button, Field, Input } from "../components/ui";
import { Logo } from "../components/Layout";

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm animate-slide-up">
          <Logo />
          <h1 className="mt-8 text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden border-l border-line bg-surface lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgb(124_108_255/0.22),transparent_60%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-line)_1px,transparent_1px)] bg-[size:48px_48px] opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
        <div className="relative flex h-full flex-col justify-center gap-5 p-14">
          <h2 className="max-w-md text-3xl font-semibold leading-tight tracking-tight">Build, test and harden your APIs — with AI that writes the edge cases for you.</h2>
          {[
            { icon: Sparkles, t: "AI test generation", d: "Negative, boundary and validation tests from any endpoint or OpenAPI spec." },
            { icon: FlaskConical, t: "Regression tracking", d: "Compare runs and see exactly what broke since last time." },
            { icon: ShieldCheck, t: "Secure by design", d: "Encrypted secrets and an SSRF-hardened request engine." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex max-w-md gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-2 text-accent">
                <Icon className="size-4" />
              </div>
              <div>
                <div className="text-sm font-medium">{t}</div>
                <div className="text-sm text-muted">{d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function useAuthForm() {
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.details) {
        const byField: Record<string, string> = {};
        for (const d of e.details) byField[d.path] = byField[d.path] ? `${byField[d.path]}. ${d.message}` : d.message;
        setFieldErrors(byField);
      }
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };
  return { error, fieldErrors, busy, run };
}

export function LoginPage() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const from = (useLocation().state as { from?: string } | null)?.from ?? "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const f = useAuthForm();
  if (user) return <Navigate to={from} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void f.run(async () => {
      await login(email, password);
      navigate(from, { replace: true });
    });
  };
  return (
    <Shell title="Welcome back" subtitle="Sign in to your APIForge workspace.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" error={f.fieldErrors.email}>
          <Input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        </Field>
        <Field label="Password" error={f.fieldErrors.password}>
          <Input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </Field>
        {f.error && !Object.keys(f.fieldErrors).length && <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{f.error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={f.busy}>
          Sign in
        </Button>
      </form>
      <div className="mt-4 rounded-lg border border-line bg-surface p-3 text-xs text-muted">
        Demo account: <span className="font-mono text-fg">demo@apiforge.dev</span> / <span className="font-mono text-fg">DemoPass123</span>{" "}
        <button
          className="ml-1 text-accent hover:underline"
          onClick={() => {
            setEmail("demo@apiforge.dev");
            setPassword("DemoPass123");
          }}
        >
          Fill in
        </button>
      </div>
      <p className="mt-6 text-sm text-muted">
        New to APIForge?{" "}
        <Link to="/register" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </Shell>
  );
}

export function RegisterPage() {
  const { register, user } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const f = useAuthForm();
  if (user) return <Navigate to="/" replace />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void f.run(async () => {
      await register(form.name, form.email, form.password);
      navigate("/", { replace: true });
    });
  };
  return (
    <Shell title="Create your account" subtitle="Start testing APIs in under a minute.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name" error={f.fieldErrors.name}>
          <Input autoComplete="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ada Lovelace" />
        </Field>
        <Field label="Email" error={f.fieldErrors.email}>
          <Input type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" />
        </Field>
        <Field label="Password" error={f.fieldErrors.password} hint="At least 8 characters, with a letter and a number.">
          <Input type="password" autoComplete="new-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </Field>
        {f.error && !Object.keys(f.fieldErrors).length && <p role="alert" className="rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{f.error}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={f.busy}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </Shell>
  );
}
