import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { configured } from './lib/supabase';
import Layout from './components/Layout';
import Landing from './pages/Landing';
import BarangayDashboard from './pages/BarangayDashboard';
import LguDashboard from './pages/LguDashboard';
import LiveMap from './pages/LiveMap';
import Schedules from './pages/Schedules';
import Emergency from './pages/Emergency';
import Routes_ from './pages/ZoneRoutes';
import Feedback from './pages/Feedback';
import Collectors from './pages/Collectors';
import WasteCategories from './pages/WasteCategories';
import Announcements from './pages/Announcements';
import Reports from './pages/Reports';
import SubmittedReports from './pages/SubmittedReports';
import Trucks from './pages/Trucks';
import BarangayAdmins from './pages/BarangayAdmins';
import Residents from './pages/Residents';

function Setup() {
  return (
    <div style={{ maxWidth: 640, margin: '80px auto', padding: 24, fontFamily: 'system-ui' }}>
      <h1>Supabase is not set up yet</h1>
      <p>Copy <code>web/.env.example</code> to <code>web/.env</code>, fill in <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart <code>npm run dev</code>. See SETUP.md.</p>
    </div>
  );
}

/** Only signed-in admins with this role may open the panel; others go home. */
function Panel({ role }) {
  const auth = useAuth();
  if (auth.loading) return <div className="empty" style={{ marginTop: 80 }}><div className="skeleton" style={{ height: 14, width: 180 }} /><span>Loading…</span></div>;
  if (!auth.signedIn) return <Navigate to="/" replace />;
  if (role !== auth.activeRole) {
    // Not the panel this sign-in is for: open their own panel instead (same as the PHP role guard).
    return auth.activeRole ? <Navigate to={`/${auth.activeRole}/dashboard`} replace /> : <Navigate to="/" replace />;
  }
  return <Layout role={role} />;
}


function PanelRoutes({ role }) {
  return (
    <Route path={`/${role}`} element={<Panel role={role} />}>
      <Route index element={<Navigate to="dashboard" replace />} />
      <Route path="dashboard" element={role === 'lgu' ? <LguDashboard /> : <BarangayDashboard />} />
      <Route path="map" element={<LiveMap />} />
      <Route path="schedules" element={<Schedules />} />
      <Route path="emergency" element={<Emergency />} />
      <Route path="routes" element={<Routes_ />} />
      <Route path="feedback" element={<Feedback />} />
      <Route path="collectors" element={<Collectors />} />
      <Route path="waste-categories" element={<WasteCategories />} />
      <Route path="announcements" element={<Announcements />} />
      <Route path="reports" element={<Reports />} />
      <Route path="submitted" element={<SubmittedReports />} />
      <Route path="trucks" element={<Trucks />} />
      {role === 'lgu' && <Route path="barangay-admins" element={<BarangayAdmins />} />}
      {role === 'lgu' && <Route path="residents" element={<Residents />} />}
      <Route path="*" element={<Navigate to="dashboard" replace />} />
    </Route>
  );
}

export default function App() {
  if (!configured) return <Setup />;
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      {PanelRoutes({ role: 'barangay' })}
      {PanelRoutes({ role: 'lgu' })}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
