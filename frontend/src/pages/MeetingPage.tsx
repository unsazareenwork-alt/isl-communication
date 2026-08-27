import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useMeeting } from "../context/MeetingContext";
import { joinMeeting } from "../lib/meetings";
import { MeetingRoom } from "../components/meeting/MeetingRoom";
import { Alert } from "../components/ui/Alert";

interface ResolvedMeeting {
  id: string;
  code: string;
  isHost: boolean;
}

export function MeetingPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const { token, user, handleUnauthorized } = useAuth();
  const { meeting } = useMeeting();

  const [resolved, setResolved] = useState<ResolvedMeeting | null>(null);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contextMatches = meeting !== null && meeting.code === code;

  // Resolve the active meeting:
  //  - Prefer the session established in the lobby (create/join).
  //  - Otherwise resolve by joining via REST (direct URL load).
  const needsResolve = !contextMatches;

  const authToken = token;
  const handleAuth = handleUnauthorized;

  useEffect(() => {
    if (contextMatches && meeting) {
      setResolved({ id: meeting.id, code: meeting.code, isHost: meeting.isHost });
      return;
    }
    if (!authToken) return;

    let cancelled = false;
    setJoining(true);
    setError(null);

    joinMeeting(code, authToken, handleAuth)
      .then((res) => {
        if (cancelled) return;
        // Host status is backend-governed: the meeting creator is host.
        setResolved({
          id: res.meeting.id,
          code: res.meeting.meeting_code,
          isHost: res.meeting.host_id === user?.id,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "This meeting could not be joined.");
      })
      .finally(() => {
        if (!cancelled) setJoining(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, contextMatches]);

  const room = useMemo(() => {
    if (!resolved) return null;
    return {
      key: resolved.id,
      id: resolved.id,
      code: resolved.code,
      isHost: resolved.isHost,
    };
  }, [resolved]);

  function handleExited() {
    navigate("/", { replace: true });
  }

  if (needsResolve && joining) {
    return (
      <div className="meeting__loading">
        <span className="spin" aria-hidden="true" />
        <p>Joining meeting…</p>
      </div>
    );
  }

  if (needsResolve && error) {
    return (
      <div className="meeting__loading">
        <div className="meeting__loading-inner">
          <Alert tone="error">{error}</Alert>
          <button
            type="button"
            className="btn btn--secondary btn--md"
            onClick={() => navigate("/", { replace: true })}
          >
            Back to lobby
          </button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="meeting__loading">
        <span className="spin" aria-hidden="true" />
        <p>Preparing your meeting…</p>
      </div>
    );
  }

  return (
    <MeetingRoom
      key={room.key}
      meetingId={room.id}
      meetingCode={room.code}
      isHost={room.isHost}
      onExited={handleExited}
    />
  );
}
