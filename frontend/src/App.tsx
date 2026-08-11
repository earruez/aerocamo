import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from '@store/authStore';
import { authApi } from '@api/auth.api';
import LoginPage from '@pages/LoginPage';
import DashboardPage from '@pages/DashboardPage';
import AircraftPage from '@pages/AircraftPage';
import ComponentsPage from '@pages/ComponentsPage';
import CompliancePage from '@pages/CompliancePage';
import MaintenancePlanPage from '@pages/MaintenancePlanPage';
import WorkOrdersPage from '@pages/WorkOrdersPage';
import WorkOrderDetailPage from '@pages/WorkOrderDetailPage';
import ReportsPage from '@pages/ReportsPage';
import SettingsPage from '@pages/SettingsPage';
import NotificationsPage from '@pages/NotificationsPage';
import LibraryPage from '@pages/LibraryPage';
import WorkRequestsPage from '@pages/WorkRequestsPage';
import AircraftAlterationsPage from '@pages/AircraftAlterationsPage';
import ConformitiesPage from '@pages/ConformitiesPage';
import AircraftProfilePage from '@pages/AircraftProfilePage';
import RemanentesPage from '@pages/RemanentesPage';
import PlatformPage from '@pages/PlatformPage';
import AppLayout from '@components/layout/AppLayout';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token);
  return token ? <>{children}</> : <Navigate to="/login" replace />;
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  return user?.role === 'SUPER_ADMIN' ? <>{children}</> : <Navigate to="/dashboard" replace />;
}

function HomeRedirect() {
  const user = useAuthStore((s) => s.user);
  return <Navigate to={user?.role === 'SUPER_ADMIN' ? '/platform' : '/dashboard'} replace />;
}

/** Validates the stored session against the DB on every app load.
 *  If the organizationId in the JWT is stale (e.g. after a DB reseed),
 *  the server returns 401, the axios interceptor calls logout(), and the
 *  PrivateRoute redirects to /login automatically. */
function SessionGuard() {
  const token = useAuthStore((s) => s.token);
  useEffect(() => {
    if (token) {
      authApi.me().catch(() => { /* 401 handled by axios interceptor → logout + redirect */ });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <SessionGuard />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<PrivateRoute><AppLayout /></PrivateRoute>}>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/platform" element={<SuperAdminRoute><PlatformPage /></SuperAdminRoute>} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/aircraft" element={<AircraftPage />} />
          <Route path="/aircraft/:id" element={<AircraftProfilePage />} />
          <Route path="/components" element={<ComponentsPage />} />
          <Route path="/compliance" element={<CompliancePage />} />
          <Route path="/maintenance-plan" element={<MaintenancePlanPage />} />
          <Route path="/work-requests" element={<WorkRequestsPage />} />
          <Route path="/aircraft-alterations" element={<AircraftAlterationsPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/work-orders" element={<WorkOrdersPage />} />
          <Route path="/work-orders/:id" element={<WorkOrderDetailPage />} />
          <Route path="/conformities" element={<ConformitiesPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/remanentes" element={<RemanentesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/notificaciones" element={<NotificationsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
