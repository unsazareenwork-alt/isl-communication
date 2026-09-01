import { Microphone, MicrophoneSlash, VideoCameraSlash } from "@phosphor-icons/react";
import type { Participant } from "../../lib/session";

interface ParticipantsPanelProps {
  participants: Participant[];
  localName: string;
  meetingCode: string;
  isHost: boolean;
  localMicEnabled: boolean;
  localCameraEnabled: boolean;
}

export function ParticipantsPanel({
  participants,
  localName,
  meetingCode,
  isHost,
  localMicEnabled,
  localCameraEnabled,
}: ParticipantsPanelProps) {
  return (
    <section className="panel" aria-label="Participants">
      <ul className="panel__list">
        {participants.map((p) => {
          const isLocal = p.isLocal;
          const name = isLocal ? localName : p.userName;
          const micOn = isLocal ? localMicEnabled : p.micEnabled;
          const camOn = isLocal ? localCameraEnabled : p.cameraEnabled;
          return (
            <li key={isLocal ? "local" : p.socketId || p.userName} className="panel__item">
              <span className="panel__avatar">{initials(name || "You")}</span>
              <span className="panel__pname">
                {name || "You"} {isLocal && <span className="panel__you">(you)</span>}
              </span>
              {isLocal && isHost && <span className="panel__chip">Host</span>}
              {(!micOn || !camOn) && (
                <span className="panel__media">
                  {!micOn && <MicrophoneSlash size={14} weight="fill" aria-label="Microphone off" />}
                  {!camOn && <VideoCameraSlash size={14} weight="fill" aria-label="Camera off" />}
                  {micOn && <Microphone size={14} weight="fill" aria-label="Microphone on" />}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <footer className="panel__footer">
        <span className="panel__meta">Meeting code</span>
        <code className="panel__code">{meetingCode}</code>
      </footer>
    </section>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
