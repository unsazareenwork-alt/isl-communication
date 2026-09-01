import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, X, UsersThree, ChatText, Article, Copy } from "@phosphor-icons/react";
import { useAuth } from "../../context/AuthContext";
import { useMeeting } from "../../context/MeetingContext";
import type { MeetingSessionHandle } from "../../hooks/useMeetingSession";
import { callerDisplayName } from "../../lib/identity";
import { endMeeting, leaveMeeting } from "../../lib/meetings";
import { saveMessage } from "../../lib/messages";
import type { DisplayLanguage } from "../../lib/types";
import { VideoGrid } from "./VideoGrid";
import { ControlBar } from "./ControlBar";
import { ChatPanel } from "./ChatPanel";
import { ParticipantsPanel } from "./ParticipantsPanel";
import { TranscriptPanel } from "./TranscriptPanel";
import { CaptionsOverlay } from "./CaptionsOverlay";
import { Logo } from "../ui/Logo";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";

interface MeetingRoomProps {
  meetingId: string;
  meetingCode: string;
  isHost: boolean;
  onExited: () => void;
  session: MeetingSessionHandle;
}

type Panel = "chat" | "participants" | "transcript" | null;

export function MeetingRoom({ meetingId, meetingCode, isHost, onExited, session }: MeetingRoomProps) {
  const { user, token, handleUnauthorized } = useAuth();
  const { setMeeting } = useMeeting();
  const userName = callerDisplayName(user);
  const userId = user?.id || "";

  const [activePanel, setActivePanel] = useState<Panel>(null);
  const [language, setLanguage] = useState<DisplayLanguage>("en");
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const participantCount = session.participants.length;

  function openPanel(panel: Exclude<Panel, null>) {
    setActivePanel((prev) => (prev === panel ? null : panel));
  }

  function copiesToClipboard(text: string): Promise<boolean> {
    try {
      return navigator.clipboard.writeText(text).then(
        () => true,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  }

  async function handleCopyCode() {
    const ok = await copiesToClipboard(meetingCode);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }

  async function handleSendChat(text: string) {
    if (!token) return;
    await saveMessage(
      {
        meeting_id: meetingId,
        message_type: "chat",
        original_text: text,
        language: language === "ta" ? "ta" : "en",
      },
      token,
      handleUnauthorized,
    );
  }

  function confirmLeave(): boolean {
    return window.confirm("Leave this meeting?");
  }

  async function handleLeave() {
    if (!confirmLeave()) return;
    setActionError(null);
    try {
      if (token) {
        await leaveMeeting(meetingId, token, handleUnauthorized);
      }
    } catch {
      // leave is best-effort; still exit locally
    }
    session.leaveRoom();
    setMeeting(null);
    onExited();
  }

  async function handleEnd() {
    if (!window.confirm("End the meeting for everyone?")) return;
    setActionError(null);
    try {
      if (!token) {
        throw new Error("You must be signed in to end the meeting.");
      }
      await endMeeting(meetingId, token, handleUnauthorized);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not end the meeting.");
      return;
    }
    session.leaveRoom();
    setMeeting(null);
    onExited();
  }

  return (
    <div className="meeting">
      <header className="meeting__top">
        <div className="meeting__top-left">
          <button
            type="button"
            className="meeting__back"
            aria-label="Leave meeting"
            onClick={handleLeave}
          >
            <ArrowLeft size={20} weight="bold" aria-hidden="true" />
          </button>
          <Logo size={28} variant="on-dark" />
          <span className="meeting__code">{meetingCode}</span>
          <button
            type="button"
            className="meeting__copy"
            aria-label="Copy meeting code"
            title="Copy meeting code"
            onClick={handleCopyCode}
          >
            {copied ? <Copy size={16} weight="fill" aria-label="Copied" /> : <Copy size={16} weight="bold" aria-hidden="true" />}
          </button>
          {isHost && <span className="meeting__host-badge">Host</span>}
        </div>
        <span className="meeting__lang-indicator">
          Captions · <b>{language === "en" ? "English" : "தமிழ்"}</b>
        </span>
      </header>

      {session.mediaError && (
        <div className="meeting__banner">
          <div className="meeting__banner-inner">
            <Alert tone="error">{session.mediaError}</Alert>
            <Button
              variant="secondary"
              size="sm"
              onClick={session.retryMedia}
              className="meeting__banner-action"
            >
              Try camera/mic again
            </Button>
          </div>
        </div>
      )}

      {actionError && (
        <div className="meeting__banner">
          <Alert tone="error">{actionError}</Alert>
        </div>
      )}

      {session.disconnected && (
        <div className="meeting__banner">
          <Alert tone="info">Connection lost. Trying to reconnect…</Alert>
        </div>
      )}

      <main className="meeting__stage">
        <VideoGrid
          participants={session.participants}
          localName={userName}
          micEnabled={session.micEnabled}
          cameraEnabled={session.cameraEnabled}
          isHost={isHost}
        />

        <CaptionsOverlay captions={session.captions} language={language} />

        <AnimatePresence>
          {activePanel && (
            <motion.aside
              className="meeting__drawer"
              aria-label="Meeting panel"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
            >
              <header className="drawer__header">
              <div className="drawer__header-title">
                <h2 className="drawer__title">{panelTitle(activePanel)}</h2>
                <p className="drawer__room">
                  Room <code>{meetingCode}</code>
                </p>
              </div>
              <button
                type="button"
                className="meeting__drawer-close"
                aria-label="Close panel"
                onClick={() => setActivePanel(null)}
              >
                <X size={20} weight="bold" aria-hidden="true" />
              </button>
            </header>

            <div className="drawer__tabs" role="tablist" aria-label="Meeting panels">
              <DrawerTab
                active={activePanel === "participants"}
                label="Participants"
                icon={<UsersThree size={18} weight="fill" aria-hidden="true" />}
                count={participantCount}
                onClick={() => setActivePanel("participants")}
              />
              <DrawerTab
                active={activePanel === "chat"}
                label="Chat"
                icon={<ChatText size={18} weight="fill" aria-hidden="true" />}
                onClick={() => setActivePanel("chat")}
              />
              <DrawerTab
                active={activePanel === "transcript"}
                label="Transcript"
                icon={<Article size={18} weight="fill" aria-hidden="true" />}
                onClick={() => setActivePanel("transcript")}
              />
            </div>

            <div className="drawer__body">
              {activePanel === "chat" && (
                <ChatPanel
                  messages={session.messages}
                  language={language}
                  currentUserId={userId}
                  currentUserName={userName}
                  senderNames={session.senderNames}
                  onSend={handleSendChat}
                />
              )}

              {activePanel === "participants" && (
                <ParticipantsPanel
                  participants={session.participants}
                  localName={userName}
                  meetingCode={meetingCode}
                  isHost={isHost}
                  localMicEnabled={session.micEnabled}
                  localCameraEnabled={session.cameraEnabled}
                />
              )}

              {activePanel === "transcript" && token && (
                <TranscriptPanel
                  meetingId={meetingId}
                  token={token}
                  language={language}
                  currentUserId={userId}
                  currentUserName={userName}
                  senderNames={session.senderNames}
                  onUnauthorized={handleUnauthorized}
                />
              )}
            </div>
            </motion.aside>
          )}
        </AnimatePresence>
      </main>

      <footer className="meeting__controls">
        <ControlBar
          isHost={isHost}
          participantCount={participantCount}
          micEnabled={session.micEnabled}
          cameraEnabled={session.cameraEnabled}
          onToggleMic={session.toggleMic}
          onToggleCamera={session.toggleCamera}
          activePanel={activePanel}
          onOpenPanel={openPanel}
          language={language}
          onToggleLanguage={() => setLanguage((l) => (l === "en" ? "ta" : "en"))}
          onLeave={handleLeave}
          onEnd={handleEnd}
          devices={session.devices}
          selectedCameraId={session.selectedCameraId}
          selectedMicrophoneId={session.selectedMicrophoneId}
          onSwitchCamera={session.switchCamera}
          onSwitchMicrophone={session.switchMicrophone}
          mediaError={session.mediaError}
        />
      </footer>
    </div>
  );
}

function DrawerTab({
  active,
  label,
  icon,
  onClick,
  count,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={["drawer__tab", active ? "drawer__tab--active" : ""].join(" ")}
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
      {typeof count === "number" && <span className="drawer__tab-count">{count}</span>}
    </button>
  );
}

function panelTitle(panel: Exclude<Panel, null>): string {
  switch (panel) {
    case "participants":
      return "Participants";
    case "chat":
      return "Chat";
    case "transcript":
      return "Transcript";
  }
}
