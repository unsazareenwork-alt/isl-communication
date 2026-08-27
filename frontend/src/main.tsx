import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import "./styles/components.css";
import "./styles/pages.css";
import "./styles/meeting.css";
import { AuthProvider } from "./context/AuthContext";
import { MeetingProvider } from "./context/MeetingContext";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <MeetingProvider>
          <App />
        </MeetingProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
