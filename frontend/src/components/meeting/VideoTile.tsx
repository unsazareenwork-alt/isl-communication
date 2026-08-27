import { useEffect, useRef } from "react";
import { MicrophoneSlash, VideoCameraSlash } from "@phosphor-icons/react";

interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  isLocal?: boolean;
  micMuted?: boolean;
  cameraOff?: boolean;
}

export function VideoTile({ stream, name, isLocal = false, micMuted = false, cameraOff = false }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (el && stream) {
      el.srcObject = stream;
    }
    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream]);

  const hasVideo = !cameraOff;

  return (
    <div className={`vt ${!hasVideo ? "vt--no-video" : ""}`}>
      <video
        ref={videoRef}
        className="vt__video"
        autoPlay
        playsInline
        muted={isLocal}
        aria-label={`${name}${isLocal ? " (you)" : ""}`}
      />
      {!hasVideo && (
        <div className="vt__placeholder" aria-hidden="true">
          <span className="vt__avatar">{initials(name)}</span>
        </div>
      )}
      <div className="vt__bar">
        <span className="vt__name">
          {name}
          {isLocal && <span className="vt__you"> (you)</span>}
        </span>
        {(micMuted || cameraOff) && (
          <span className="vt__badges">
            {micMuted && (
              <span className="vt__badge" title="Microphone off">
                <MicrophoneSlash size={15} weight="fill" aria-hidden="true" />
              </span>
            )}
            {cameraOff && (
              <span className="vt__badge" title="Camera off">
                <VideoCameraSlash size={15} weight="fill" aria-hidden="true" />
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
