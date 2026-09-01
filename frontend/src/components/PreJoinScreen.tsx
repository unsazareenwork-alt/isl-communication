import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  VideoCamera,
  Microphone,
  VideoCameraSlash,
  MicrophoneSlash,
  Copy,
  ArrowLeft,
  User,
} from "@phosphor-icons/react";
import { callerDisplayName } from "../lib/identity";
import type { MeetingSessionHandle } from "../hooks/useMeetingSession";
import type { AuthUser } from "../lib/types";
import { Logo } from "./ui/Logo";
import { Button } from "./ui/Button";
import { DeviceSettings } from "./meeting/DeviceSettings";

interface PreJoinScreenProps {
  session: MeetingSessionHandle;
  meetingCode: string;
  userName: string;
  user: AuthUser | null;
  onJoin: () => void;
  onBack: () => void;
}

export function PreJoinScreen({
  session,
  meetingCode,
  userName,
  user,
  onJoin,
  onBack,
}: PreJoinScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [copied, setCopied] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const displayName = userName || callerDisplayName(user);

  // The parent (MeetingHost) calls session.startPreview() once the session exists;
  // here we only mirror the resulting local stream and show live mic activity.
  // Mirror the local stream to the preview <video>.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (session.localStream) {
      if (el.srcObject !== session.localStream) el.srcObject = session.localStream;
      el.play().catch(() => {});
    } else {
      el.srcObject = null;
    }
    return () => {
      el.srcObject = null;
    };
  }, [session.localStream]);

  // Live microphone activity indicator. Depends on the audio track so it
  // reconnects when the microphone is switched (track identity changes even
  // though the MediaStream object is reused).
  useEffect(() => {
    const track = session.localStream?.getAudioTracks()[0];
    if (!session.localStream || !track) return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(session.localStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i];
      const avg = sum / data.length;
      setMicLevel(Math.min(100, Math.round((avg / 255) * 100)));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      ctx.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.localStream?.getAudioTracks()[0]]);

  async function handleCopyCode() {
    try {
      await navigator.clipboard.writeText(meetingCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  const cameraOff = !session.cameraEnabled;
  const micOff = !session.micEnabled;
  const initialized = Boolean(session.localStream) || Boolean(session.mediaError);

  return (
    <div className="prejoin">
      <div className="prejoin__glow prejoin__glow--1" aria-hidden="true" />
      <div className="prejoin__glow prejoin__glow--2" aria-hidden="true" />

      <header className="prejoin__header">
        <button type="button" className="prejoin__back" onClick={onBack} aria-label="Back to lobby">
          <ArrowLeft size={20} weight="bold" aria-hidden="true" />
        </button>
        <Logo size={30} />
        <div className="prejoin__header-right">
          <span className="prejoin__user">{displayName}</span>
        </div>
      </header>

      <motion.main
        className="prejoin__main"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
      >
        <div className="prejoin__intro">
          <span className="prejoin__eyebrow">Shiksha-Sanket</span>
          <h1 className="prejoin__title">Join meeting</h1>
          <p className="prejoin__subtitle">Check your camera and microphone before entering the meeting.</p>
        </div>

        <div className="prejoin__card">
          <div className="prejoin__preview">
            {session.localStream && !cameraOff ? (
              <video
                ref={videoRef}
                className="prejoin__video"
                autoPlay
                playsInline
                muted
                aria-label="Camera preview"
              />
            ) : (
              <div className="prejoin__placeholder">
                <span className="prejoin__avatar">
                  {cameraOff ? (
                    <VideoCameraSlash size={40} weight="fill" aria-hidden="true" />
                  ) : (
                    <User size={48} weight="fill" aria-hidden="true" />
                  )}
                </span>
                <span className="prejoin__placeholder-label">
                  {cameraOff ? "Camera is off" : "No camera preview"}
                </span>
                {displayName && <span className="prejoin__placeholder-name">{displayName}</span>}
              </div>
            )}

            <div className="prejoin__preview-badges">
              <span className={["prejoin__state", camState(cameraOff, initialized)].join(" ")}>
                {cameraOff ? <VideoCameraSlash size={14} weight="fill" /> : <VideoCamera size={14} weight="fill" />}
                {cameraOff ? "Camera off" : "Camera on"}
              </span>
              <span className={["prejoin__state", micState(micOff)].join(" ")}>
                {micOff ? <MicrophoneSlash size={14} weight="fill" /> : <Microphone size={14} weight="fill" />}
                {micOff ? "Mic off" : "Mic on"}
              </span>
              {!micOff && (
                <span className="prejoin__mic-meter" aria-hidden="true">
                  <span className="prejoin__mic-fill" style={{ width: `${micLevel}%` }} />
                </span>
              )}
            </div>
          </div>

          <div className="prejoin__panel">
            <div className="prejoin__panel-head">
              <h2 className="prejoin__panel-title">Ready to join?</h2>
              <p className="prejoin__panel-sub">
                You are joining: <code className="prejoin__code-val">{meetingCode}</code>
                <button
                  type="button"
                  className="prejoin__copy"
                  aria-label="Copy meeting code"
                  onClick={handleCopyCode}
                >
                  {copied ? <Copy size={15} weight="fill" aria-label="Copied" /> : <Copy size={15} weight="bold" />}
                </button>
              </p>
            </div>

            {session.mediaError && <p className="prejoin__error">{session.mediaError}</p>}

            <div className="prejoin__settings">
              <DeviceSettings
                devices={session.devices}
                selectedCameraId={session.selectedCameraId}
                selectedMicrophoneId={session.selectedMicrophoneId}
                onCameraChange={(id) => session.switchCamera(id)}
                onMicrophoneChange={(id) => session.switchMicrophone(id)}
                cameraError={session.mediaError}
              />
            </div>

            <div className="prejoin__actions">
              <Button variant="primary" size="lg" onClick={onJoin} className="prejoin__join">
                Join meeting
              </Button>
              <Button variant="ghost" size="md" onClick={onBack} className="prejoin__backbtn">
                Back
              </Button>
            </div>
          </div>
        </div>
      </motion.main>
    </div>
  );
}

function camState(off: boolean, initialized: boolean): string {
  if (!initialized) return "prejoin__state--unknown";
  return off ? "prejoin__state--off" : "prejoin__state--on";
}
function micState(off: boolean): string {
  return off ? "prejoin__state--off" : "prejoin__state--on";
}
