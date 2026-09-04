import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "../ui/Logo";
import { AuthForm } from "./AuthForm";
import { useAuth } from "../../context/AuthContext";

/**
 * AuthPage — layout route, stays mounted across /login ↔ /signup.
 *
 * Source of truth for the transition = the reference animation in
 * `animation_login_signup_page/SignUp_LogIn_Form.{html,css,js}`.
 *
 * Its mechanism is ported as-is (CSS class choreography, no Motion):
 *  - the card container clips an oversized ~300%-wide rounded toggle
 *    surface that slides horizontally across the composition
 *  - two 50%-wide form panels (login + register) sit side by side and
 *    translate to the opposite half, with staggered delays
 *  - two toggle panels ride the toggle surface and carry the switch
 *    buttons
 *
 * Toggling `.active` is exactly the reference's `.container.active`.
 * React derives `active` from the current route, so /login ↔ /signup
 * navigation, browser Back/Forward and direct loads all drive the same
 * animation — nothing is faked, and the real AuthContext handlers remain.
 */
export function AuthPage() {
  const { login, signup, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? "/";

  const active = location.pathname === "/signup";

  // ── mouse-following ambient glow ────────────────────────────────────
  // Lightweight rAF + lerp loop that writes to CSS custom properties
  // on a dedicated element.  Zero React re-renders on mouse move.
  useEffect(() => {
    const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hasPointerHover = matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!hasPointerHover) return;

    const el = document.querySelector<HTMLElement>(".auth__cursor-glow");
    if (!el) return;

    let curX = window.innerWidth / 2;
    let curY = window.innerHeight / 2;
    let tgtX = curX;
    let tgtY = curY;
    let raf = 0;
    let last = performance.now();
    const FOLLOW_MS = 80;

    el.style.setProperty("--mx", `${curX}px`);
    el.style.setProperty("--my", `${curY}px`);

    const tick = (now: number) => {
      const dt = Math.min(now - last, 100);
      last = now;
      if (prefersReduced) {
        curX = tgtX;
        curY = tgtY;
      } else {
        // frame-rate independent exponential follow, ~450ms time constant
        const ease = 1 - Math.exp(-dt / FOLLOW_MS);
        curX += (tgtX - curX) * ease;
        curY += (tgtY - curY) * ease;
      }
      el.style.setProperty("--mx", `${curX}px`);
      el.style.setProperty("--my", `${curY}px`);
      raf = requestAnimationFrame(tick);
    };

    const onMove = (e: PointerEvent) => {
      tgtX = e.clientX;
      tgtY = e.clientY;
    };

    raf = requestAnimationFrame(tick);
    window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const go = (path: string) => navigate(path, { state: location.state });

  return (
    <div className="auth pathway-lines">
      <div className="auth__glow auth__glow--1" aria-hidden="true" />
      <div className="auth__glow auth__glow--2" aria-hidden="true" />
      <div className="auth__cursor-glow" aria-hidden="true" />

      <div className={active ? "auth__card active" : "auth__card"}>
        {/* login form panel — right half by default, slides to the left half */}
        <div className="auth__form-box auth__form-box--login" inert={active}>
          <AuthForm
            mode="login"
            hideSwitch
            onSubmit={async (email, password, _name, remember) => {
              await login(email, password, remember);
              navigate(from, { replace: true });
            }}
          />
        </div>

        {/* register form panel — hidden by default, revealed on the left half */}
        <div className="auth__form-box auth__form-box--register" inert={!active}>
          <AuthForm
            mode="signup"
            hideSwitch
            onSubmit={async (email, password, name) => {
              await signup(name ?? "", email, password);
              navigate(from, { replace: true });
            }}
          />
        </div>

        {/* toggle overlay — oversized rounded surface + switch panels */}
        <div className="auth__toggle-box">
          <div className="auth__toggle-surface" aria-hidden="true" />

          <div className="auth__toggle-panel auth__toggle-panel--left" inert={active}>
            <span className="auth__brand">
              <Logo size={44} showWordmark={false} />
            </span>
            <p className="auth__toggle-title">Shiksha-Sanket</p>
            <p className="auth__toggle-copy">
              Precision ISL translation — right inside your meetings.
            </p>
            <button type="button" className="auth__toggle-btn" onClick={() => go("/signup")}>
              Create an account
            </button>
          </div>

          <div className="auth__toggle-panel auth__toggle-panel--right" inert={!active}>
            <span className="auth__brand">
              <Logo size={44} showWordmark={false} />
            </span>
            <p className="auth__toggle-title">Welcome back</p>
            <p className="auth__toggle-copy">Sign in to join or start a meeting.</p>
            <button type="button" className="auth__toggle-btn" onClick={() => go("/login")}>
              Sign in
            </button>
          </div>
        </div>
      </div>

      <p className="auth__footnote">
        Inclusive video meetings with live sign-language captions — English &amp; Tamil.
      </p>
    </div>
  );
}