import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useMe } from "./lib/queries";
import { useTheme } from "./lib/theme";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { Calendar } from "./pages/Calendar";
import { Cards } from "./pages/Cards";
import { Dashboard } from "./pages/Dashboard";
import { LoanDetail } from "./pages/LoanDetail";
import { LoanForm } from "./pages/LoanForm";
import { Loans } from "./pages/Loans";
import { Login } from "./pages/Login";
import { Notifications } from "./pages/Notifications";
import { Settings } from "./pages/Settings";
import { Tools } from "./pages/Tools";

export function AppRoutes() {
  const me = useMe();
  useTheme(me.data?.settings.theme);

  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="loans" element={<Loans />} />
        <Route path="loans/new" element={<LoanForm />} />
        <Route path="loans/:id" element={<LoanDetail />} />
        <Route path="loans/:id/edit" element={<LoanForm />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="cards" element={<Cards />} />
        <Route path="tools" element={<Tools />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
