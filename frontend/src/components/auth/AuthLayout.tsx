import type { ReactNode } from "react";
import { motion } from "motion/react";
import { Logo } from "../ui/Logo";

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth__glow auth__glow--1" aria-hidden="true" />
      <div className="auth__glow auth__glow--2" aria-hidden="true" />

      <div className="auth__brand-block">
        <span className="auth__brand" style={{ display: "inline-flex" }}>
          <Logo size={52} showWordmark={false} />
        </span>
        <h1 className="auth__wordmark">Shiksha-Sanket</h1>
        <p className="auth__tagline">Precision ISL Translation Platform</p>
      </div>

      <motion.div
        className="auth__card"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        {children}
      </motion.div>

      <p className="auth__footnote">
        Inclusive video meetings with live sign-language captions — English &amp; Tamil.
      </p>
    </div>
  );
}
