import {
  Microphone,
  MicrophoneSlash,
  VideoCamera,
  VideoCameraSlash,
  UsersThree,
  ChatText,
  Article,
  Translate,
  PhoneSlash,
  Square,
} from "@phosphor-icons/react";
import type { DisplayLanguage } from "../../lib/types";

interface ControlBarProps {
  isHost: boolean;
  participantCount: number;
  micEnabled: boolean;
  cameraEnabled: boolean;
  onToggleMic: () => void;
  onToggleCamera: () => void;
  participantsOpen: boolean;
  onToggleParticipants: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  transcriptOpen: boolean;
  onToggleTranscript: () => void;
  language: DisplayLanguage;
  onToggleLanguage: () => void;
  onLeave: () => void;
  onEnd: () => void;
}

function LeaveIcon() {
  return <PhoneSlash size={20} weight="fill" aria-hidden="true" />;
}

export function ControlBar({
  isHost,
  participantCount,
  micEnabled,
  cameraEnabled,
  onToggleMic,
  onToggleCamera,
  participantsOpen,
  onToggleParticipants,
  chatOpen,
  onToggleChat,
  transcriptOpen,
  onToggleTranscript,
  language,
  onToggleLanguage,
  onLeave,
  onEnd,
}: ControlBarProps) {
  return (
    <div className="controlbar">
      <div className="controlbar__group controlbar__group--left">
        <ControlButton
          label={micEnabled ? "Turn off microphone" : "Turn on microphone"}
          active={micEnabled}
          pressed={micEnabled}
          onClick={onToggleMic}
        >
          {micEnabled ? <Microphone size={22} weight="fill" aria-hidden="true" /> : <MicrophoneSlash size={22} weight="fill" aria-hidden="true" />}
        </ControlButton>

        <ControlButton
          label={cameraEnabled ? "Turn off camera" : "Turn on camera"}
          active={cameraEnabled}
          pressed={cameraEnabled}
          onClick={onToggleCamera}
        >
          {cameraEnabled ? <VideoCamera size={22} weight="fill" aria-hidden="true" /> : <VideoCameraSlash size={22} weight="fill" aria-hidden="true" />}
        </ControlButton>
      </div>

      <div className="controlbar__group controlbar__group--right">
        <ControlButton
          label="Participants"
          active={!participantsOpen}
          highlighted={participantsOpen}
          badge={String(participantCount)}
          onClick={onToggleParticipants}
        >
          <UsersThree size={22} weight="fill" aria-hidden="true" />
        </ControlButton>

        <ControlButton
          label="Chat"
          active={!chatOpen}
          highlighted={chatOpen}
          onClick={onToggleChat}
        >
          <ChatText size={22} weight="fill" aria-hidden="true" />
        </ControlButton>

        <ControlButton
          label="Transcript"
          active={!transcriptOpen}
          highlighted={transcriptOpen}
          onClick={onToggleTranscript}
        >
          <Article size={22} weight="fill" aria-hidden="true" />
        </ControlButton>

        <LanguageToggle language={language} onToggle={onToggleLanguage} />

        <div className="controlbar__leave">
          <button type="button" className="ctl ctl--leave" onClick={onLeave} aria-label="Leave meeting">
            <LeaveIcon />
            <span className="ctl__label">Leave</span>
          </button>
          {isHost && (
            <button
              type="button"
              className="ctl ctl--end"
              onClick={onEnd}
              aria-label="End meeting for everyone"
              title="End meeting for everyone"
            >
              <Square size={18} weight="fill" aria-hidden="true" />
              <span className="ctl__label">End</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// participants count is supplied by the meeting page (includes self).

interface ControlButtonProps {
  label: string;
  children: React.ReactNode;
  active: boolean;
  highlighted?: boolean;
  pressed?: boolean;
  badge?: string;
  onClick: () => void;
}

function ControlButton({ label, children, active, highlighted = false, pressed, badge, onClick }: ControlButtonProps) {
  return (
    <button
      type="button"
      className={["ctl", active ? "ctl--on" : "", highlighted ? "ctl--active" : ""].join(" ")}
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={highlighted ? true : undefined}
      title={label}
    >
      {children}
      {badge && <span className="ctl__badge">{badge}</span>}
    </button>
  );
}

function LanguageToggle({ language, onToggle }: { language: DisplayLanguage; onToggle: () => void }) {
  const tamilActive = language === "ta";
  return (
    <button
      type="button"
      className={["ctl", tamilActive ? "ctl--on" : "ctl--lang-off"].join(" ")}
      onClick={onToggle}
      aria-pressed={tamilActive}
      aria-label={
        tamilActive
          ? "Captions displayed in Tamil. Press to switch to English."
          : "Captions displayed in English. Press to switch to Tamil."
      }
      title="Switch caption language"
    >
      <Translate size={22} weight="fill" aria-hidden="true" />
      <span className="ctl__lang">{tamilActive ? "தமிழ்" : "EN"}</span>
    </button>
  );
}
