import { useState } from "react";
import { ArrowLeft, X } from "@phosphor-icons/react";
import { useAuth } from "../../context/AuthContext";
import { useMeeting } from "../../context/MeetingContext";
import { useMeetingSession } from "../../hooks/useMeetingSession";
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
}

export function MeetingRoom({ meetingId, meetingCode, isHost, onExited }: MeetingRoomProps) {
  const { user, token, handleUnauthorized } = useAuth();
  const { setMeeting } = useMeeting();
  const userName = callerDisplayName(user);
  const userId = user?.id || "";

  const session = useMeetingSession({
    meetingCode,
    meetingId,
    userName,
    userId,
  });

  const [chatOpen, setChatOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [language, setLanguage] = useState<DisplayLanguage>("en");
  const [actionError, setActionError] = useState<string | null>(null);

  const participantCount = session.remoteTiles.length + 1;

  function openOnly(panel: "chat" | "participants" | "transcript", opening: boolean) {
    if (!opening) {
      if (panel === "chat") setChatOpen(false);
      else if (panel === "participants") setParticipantsOpen(false);
      else setTranscriptOpen(false);
      return;
    }
    setChatOpen(panel === "chat");
    setParticipantsOpen(panel === "participants");
    setTranscriptOpen(panel === "transcript");
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
          <Logo size={30} showWordmark={false} />
          <span className="meeting__code">{meetingCode}</span>
          {isHost && <span className="meeting__host-badge">Host</span>}
        </div>
        <div className="meeting__lang-indicator">
          Captions: {language === "en" ? "English" : "Tamil"}
        </div>
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
          localStream={session.localStream}
          localName={userName}
          micEnabled={session.micEnabled}
          cameraEnabled={session.cameraEnabled}
          remoteTiles={session.remoteTiles}
        />

        <CaptionsOverlay captions={session.captions} language={language} />

        {chatOpen && (
          <aside className="meeting__drawer">
            <ChatPanel
              messages={session.messages}
              language={language}
              currentUserId={userId}
              onSend={handleSendChat}
            />
            <button
              type="button"
              className="meeting__drawer-close"
              aria-label="Close chat"
              onClick={() => setChatOpen(false)}
            >
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </aside>
        )}

        {participantsOpen && (
          <aside className="meeting__drawer meeting__drawer--right">
            <ParticipantsPanel
              localName={userName}
              remoteTiles={session.remoteTiles}
              meetingCode={meetingCode}
            />
            <button
              type="button"
              className="meeting__drawer-close"
              aria-label="Close participants"
              onClick={() => setParticipantsOpen(false)}
            >
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </aside>
        )}

        {transcriptOpen && token && (
          <aside className="meeting__drawer">
            <TranscriptPanel
              meetingId={meetingId}
              token={token}
              language={language}
              currentUserId={userId}
              onUnauthorized={handleUnauthorized}
            />
            <button
              type="button"
              className="meeting__drawer-close"
              aria-label="Close transcript"
              onClick={() => setTranscriptOpen(false)}
            >
              <X size={20} weight="bold" aria-hidden="true" />
            </button>
          </aside>
        )}
      </main>

      <footer className="meeting__controls">
        <ControlBar
          isHost={isHost}
          participantCount={participantCount}
          micEnabled={session.micEnabled}
          cameraEnabled={session.cameraEnabled}
          onToggleMic={session.toggleMic}
          onToggleCamera={session.toggleCamera}
          participantsOpen={participantsOpen}
          onToggleParticipants={() => openOnly("participants", !participantsOpen)}
          chatOpen={chatOpen}
          onToggleChat={() => openOnly("chat", !chatOpen)}
          transcriptOpen={transcriptOpen}
          onToggleTranscript={() => openOnly("transcript", !transcriptOpen)}
          language={language}
          onToggleLanguage={() => setLanguage((l) => (l === "en" ? "ta" : "en"))}
          onLeave={handleLeave}
          onEnd={handleEnd}
        />
      </footer>
    </div>
  );
}
