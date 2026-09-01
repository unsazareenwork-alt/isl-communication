import { useEffect, useRef, useState } from "react";
import { useMeetingSession } from "../../hooks/useMeetingSession";
import { useAuth } from "../../context/AuthContext";
import { useMeeting } from "../../context/MeetingContext";
import { callerDisplayName } from "../../lib/identity";
import { PreJoinScreen } from "../PreJoinScreen";
import { MeetingRoom } from "./MeetingRoom";

interface MeetingHostProps {
  meetingId: string;
  meetingCode: string;
  isHost: boolean;
  onExited: () => void;
}

type Phase = "prejoin" | "meeting";

export function MeetingHost({ meetingId, meetingCode, isHost, onExited }: MeetingHostProps) {
  const { user } = useAuth();
  const { setMeeting } = useMeeting();
  const userName = callerDisplayName(user);
  const userId = user?.id || "";

  const session = useMeetingSession({ meetingCode, meetingId, userName, userId });

  const [phase, setPhase] = useState<Phase>("prejoin");

  // Start the pre-join camera/mic preview. This effect is declared after
  // useMeetingSession so the session is guaranteed to be created first.
  const startedPreview = useRef(false);
  useEffect(() => {
    if (phase !== "prejoin" || startedPreview.current) return;
    startedPreview.current = true;
    void session.startPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Auto-exit when the backend broadcasts meeting-ended to all participants.
  useEffect(() => {
    if (!session.meetingEnded) return;
    setMeeting(null);
    onExited();
  }, [session.meetingEnded, setMeeting, onExited]);

  function handleJoin() {
    // Start the actual meeting session (WebRTC + Socket.IO join), then show
    // the meeting room. joinMeeting() is synchronous and non-throwing; it
    // reuses the pre-join MediaStream.
    session.joinMeeting();
    setPhase("meeting");
  }

  function handleBack() {
    session.leaveRoom();
    onExited();
  }

  if (phase === "prejoin") {
    return (
      <PreJoinScreen
        session={session}
        meetingCode={meetingCode}
        userName={userName}
        user={user}
        onJoin={handleJoin}
        onBack={handleBack}
      />
    );
  }

  return (
    <MeetingRoom
      meetingId={meetingId}
      meetingCode={meetingCode}
      isHost={isHost}
      onExited={onExited}
      session={session}
    />
  );
}
