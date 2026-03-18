import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { SessionPage } from './pages/SessionPage';
import { ReportPage } from './pages/ReportPage';
import { ScriptsPage } from './pages/ScriptsPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/session/new" element={<SessionPage />} />
        <Route path="/session/:id" element={<SessionPage />} />
        <Route path="/report/:session_id" element={<ReportPage />} />
        <Route path="/scripts" element={<ScriptsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
