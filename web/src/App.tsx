import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { EnvironmentProvider } from "./lib/environment";
import { Layout } from "./components/Layout";
import { LoadingBlock } from "./components/ui";
import { LoginPage, RegisterPage } from "./pages/AuthPages";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Workspace = lazy(() => import("./pages/Workspace"));
const Collections = lazy(() => import("./pages/Collections"));
const Environments = lazy(() => import("./pages/Environments"));
const Suites = lazy(() => import("./pages/Suites"));
const SuiteDetail = lazy(() => import("./pages/SuiteDetail"));
const RunDetail = lazy(() => import("./pages/RunDetail"));
const OpenApiImport = lazy(() => import("./pages/OpenApiImport"));

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingBlock label="Restoring your session…" />
      </div>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <EnvironmentProvider>{children}</EnvironmentProvider>;
}

export function App() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="workspace" element={<Workspace />} />
          <Route path="collections" element={<Collections />} />
          <Route path="environments" element={<Environments />} />
          <Route path="tests" element={<Suites />} />
          <Route path="tests/:suiteId" element={<SuiteDetail />} />
          <Route path="runs/:runId" element={<RunDetail />} />
          <Route path="openapi" element={<OpenApiImport />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
