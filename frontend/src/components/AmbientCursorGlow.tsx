import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

/**
 * Global mouse-following ambient glow.
 *
 * This is the Login/Signup cursor glow (previously `.auth__cursor-glow` in
 * AuthPage) extracted verbatim into a single reusable, route-agnostic layer:
 *  - one element, one `pointermove` listener, one rAF loop
 *  - pointer coordinates are lerped with a frame-rate-independent exponential
 *    follow (~450ms time constant) and written straight to CSS custom
 *    properties on the host — no React state, no rerenders on mouse move
 *  - the same device / reduced-motion guards as the original auth effect
 *
 * The only surface that must not show the glow is the active live Meeting
 * Room (`<div class="meeting">`). MeetingHost switches from the PreJoin page
 * to the room internally, with no route change, so the glow watches for the
 * room element in the DOM rather than keying off the pathname (which is
 * `/meeting/:code` for both phases). Every other page — Login, Signup,
 * Dashboard/Lobby and the Join Meeting (PreJoin) page — gets the exact same
 * shared glow.
 */
export function AmbientCursorGlow() {
  const ref = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const [meetingRoomActive, setMeetingRoomActive] = useState(false);

  const onMeetingRoute = location.pathname.startsWith("/meeting/");

  useEffect(() => {
    if (!onMeetingRoute) return;

    const isLiveRoom = () => document.querySelector(".meeting") !== null;
    const sync = () => setMeetingRoomActive(isLiveRoom());

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [onMeetingRoute]);

  // Treat the DOM as the source of truth at render time as a safety net, so a
  // stale state value can never keep the glow hidden once the room is gone.
  const liveRoomAtRender =
    typeof document !== "undefined" && document.querySelector(".meeting") !== null;
  const active = !onMeetingRoute || (!meetingRoomActive && !liveRoomAtRender);

  useEffect(() => {
    if (!active) return;

    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hasPointerHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (!hasPointerHover) return;

    const el = ref.current;
    if (!el) return;

    let curX = window.innerWidth / 2;
    let curY = window.innerHeight / 2;
    let tgtX = curX;
    let tgtY = curY;
    let raf = 0;
    let last = performance.now();
    const FOLLOW_MS = 80;

    el.style.setProperty("--ambient-x", `${curX}px`);
    el.style.setProperty("--ambient-y", `${curY}px`);

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
      el.style.setProperty("--ambient-x", `${curX}px`);
      el.style.setProperty("--ambient-y", `${curY}px`);
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
  }, [active]);

  if (!active) return null;

  return <div ref={ref} className="ambient-glow" aria-hidden="true" />;
}