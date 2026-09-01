import { useEffect, useRef } from "react";
import { Microphone, MicrophoneSlash, VideoCameraSlash } from "@phosphor-icons/react";

interface VideoTileProps {
  stream: MediaStream | null;
  name: string;
  isLocal?: boolean;
  micMuted?: boolean;
  cameraOff?: boolean;
  host?: boolean;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function VideoTile({
  stream,
  name,
  isLocal = false,
  micMuted = false,
  cameraOff = false,
  host = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const mountCount = useRef(0);

  // [DIAG] Mount/update/unmount
  useEffect(() => {
    mountCount.current += 1;
    console.log(
      `[MEDIA] VideoTile MOUNT #${mountCount.current}`, { isLocal, name, streamId: stream?.id ?? null, vTracks: stream?.getVideoTracks().length ?? 0, cameraOff },
    );
    return () => {
      console.log(`[MEDIA] VideoTile UNMOUNT`, { isLocal, name, streamId: stream?.id ?? null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;

    console.log(
      `[MEDIA] VideoTile UPDATE`, { isLocal, name, streamId: stream?.id ?? null, vTracks: stream?.getVideoTracks().length ?? 0, cameraOff, videoPaused: el.paused },
    );

    if (stream) {
      if (el.srcObject !== stream) {
        el.srcObject = stream;
      }
      el.play().catch((error) => {
        console.error("VIDEO_PLAY_FAILED", error, { isLocal, name });
      });
    } else {
      el.srcObject = null;
    }

    return () => {
      el.srcObject = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  useEffect(() => {
    if (!cameraOff && stream) {
      const el = videoRef.current;
      if (el && el.paused) {
        el.play().catch((error) => {
          console.error("VIDEO_PLAY_FAILED(2)", error, { isLocal, name });
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOff, stream]);

  // [DIAG] video element events + dimensions
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const log = (evt: string) => {
      console.log(`[MEDIA] <video> ${evt}`, {
        isLocal, name,         streamId: (el.srcObject as MediaStream | null)?.id ?? null,
        readyState: el.readyState, paused: el.paused,
        videoWidth: el.videoWidth, videoHeight: el.videoHeight,
        clientW: el.clientWidth, clientH: el.clientHeight,
      });
    };
    const events = ["loadedmetadata", "canplay", "playing", "pause", "stalled", "error"];
    const handlers: Array<[string, () => void]> = events.map((e) => [e, () => log(e)]);
    handlers.forEach(([e, h]) => el.addEventListener(e, h));
    return () => {
      handlers.forEach(([e, h]) => el.removeEventListener(e, h));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasVideo = !cameraOff;

  return (
    <div
      className={["vt", !hasVideo ? "vt--no-video" : ""].join(" ")}
    >
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
          <span className="vt__placeholder-name">{name}</span>
          <span className="vt__off-label">
            <VideoCameraSlash size={14} weight="fill" aria-hidden="true" />
            Camera is off
          </span>
        </div>
      )}

      <div className="vt__bar">
        <span className="vt__name">
          {name}
          {isLocal && <span className="vt__you"> (you)</span>}
          {host && <span className="vt__host">Host</span>}
        </span>
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
            {!micMuted && (
              <span className="vt__badge vt__badge--live" title="Microphone on">
                <Microphone size={15} weight="fill" aria-hidden="true" />
              </span>
            )}
          </span>
      </div>
    </div>
  );
}
