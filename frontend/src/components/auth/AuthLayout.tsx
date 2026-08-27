import type { ReactNode } from "react";
import { Logo } from "../ui/Logo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__card">
        <div className="auth__brand">
          <Logo size={40} />
        </div>
        {children}
      </div>
      <p className="auth__footnote">
        Inclusive real-time video meetings with live sign-language captions.
      </p>
    </div>
  );
}
