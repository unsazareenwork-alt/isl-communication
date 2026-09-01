import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useMeeting } from "../context/MeetingContext";
import { createMeeting, joinMeeting } from "../lib/meetings";
import { VideoCamera, Key, SignOut, Plus } from "@phosphor-icons/react";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Alert } from "../components/ui/Alert";
import { Logo } from "../components/ui/Logo";
import { callerDisplayName } from "../lib/identity";

export function LobbyPage() {
  const { user, token, logout, handleUnauthorized } = useAuth();
  const { setMeeting } = useMeeting();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const displayName = callerDisplayName(user);

  async function handleCreate() {
    if (!token) return;
    setCreating(true);
    setJoinError(null);
    try {
      const res = await createMeeting(token, handleUnauthorized);
      const meeting = res.meeting;
      const active = { id: meeting.id, code: meeting.meeting_code, isHost: true };
      setMeeting(active);
      navigate(`/meeting/${meeting.meeting_code}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not create the meeting.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(e: FormEvent) {
    e.preventDefault();
    if (!token) return;
    const code = joinCode.trim();
    if (!code) {
      setJoinError("Enter a meeting code to join.");
      return;
    }
    setJoinError(null);
    setJoining(true);
    try {
      const res = await joinMeeting(code, token, handleUnauthorized);
      const meeting = res.meeting;
      setMeeting({
        id: meeting.id,
        code: meeting.meeting_code,
        isHost: meeting.host_id === user?.id,
      });
      navigate(`/meeting/${meeting.meeting_code}`);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : "Could not join the meeting.");
      setJoining(false);
    }
  }

  return (
    <div className="app-shell lobby">
      <div className="lobby__glow lobby__glow--1" aria-hidden="true" />
      <div className="lobby__glow lobby__glow--2" aria-hidden="true" />

      <header className="lobby__header">
        <div className="container lobby__header-inner">
          <Logo />
          <div className="lobby__user">
            <span className="lobby__user-name">{displayName}</span>
            <Button variant="ghost" size="sm" onClick={logout}>
              <SignOut size={16} weight="bold" aria-hidden="true" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="lobby__main">
        <div className="lobby__hero">
          <span className="lobby__eyebrow">Real-time ISL communication</span>
          <h1 className="lobby__title">Connect with Clarity</h1>
          <p className="lobby__subtitle">
            High-fidelity ISL translation for seamless, video-first communication. Start a new
            session or join an existing room.
          </p>
        </div>

        <div className="lobby__grid">
          <section className="lobby__panel" aria-labelledby="create-title">
            <span className="lobby__panel-decor" aria-hidden="true">
              <Plus size={120} weight="regular" />
            </span>
            <span className="lobby__panel-icon" aria-hidden="true">
              <VideoCamera size={24} weight="fill" />
            </span>
            <div className="lobby__panel-copy">
              <h2 id="create-title" className="lobby__panel-title">
                New Meeting
              </h2>
              <p className="lobby__panel-desc">
                Generate a code to start translating instantly.
              </p>
            </div>
            <Button
              variant="primary"
              size="lg"
              loading={creating}
              onClick={handleCreate}
              className="lobby__cta"
            >
              Create Room
            </Button>
          </section>

          <section className="lobby__panel" aria-labelledby="join-title">
            <span className="lobby__panel-icon lobby__panel-icon--muted" aria-hidden="true">
              <Key size={24} weight="fill" />
            </span>
            <div className="lobby__panel-copy">
              <h2 id="join-title" className="lobby__panel-title">
                Join Meeting
              </h2>
              <p className="lobby__panel-desc">
                Enter the code the host shared with you.
              </p>
            </div>
            <form onSubmit={handleJoin} className="lobby__join">
              <Field label="Meeting code" htmlFor="meeting-code">
                <Input
                  id="meeting-code"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="abc1-de2f-gh3i"
                  autoComplete="off"
                  spellCheck={false}
                  aria-describedby="meeting-code-hint"
                />
                <p id="meeting-code-hint" className="sr-only">
                  Enter the meeting code you received
                </p>
              </Field>
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={joining}
                disabled={!joinCode.trim()}
                className="lobby__cta"
              >
                Join Room
              </Button>
            </form>
          </section>
        </div>

        {joinError && (
          <div className="lobby__error">
            <Alert tone="error">{joinError}</Alert>
          </div>
        )}
      </main>
    </div>
  );
}
