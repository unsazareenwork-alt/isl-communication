import { Routes, Route } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { AmbientCursorGlow } from "./components/AmbientCursorGlow";
import { AuthPage } from "./components/auth/AuthPage";
import { LobbyPage } from "./pages/LobbyPage";
import { MeetingPage } from "./pages/MeetingPage";

export default function App() {
  return (
    <>
      <AmbientCursorGlow />
      <Routes>
        <Route element={<AuthPage />}>
          <Route path="/login" element={null} />
          <Route path="/signup" element={null} />
        </Route>
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <LobbyPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/meeting/:code"
          element={
            <ProtectedRoute>
              <MeetingPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<ProtectedRoute><LobbyPage /></ProtectedRoute>} />
      </Routes>
    </>
  );
}
