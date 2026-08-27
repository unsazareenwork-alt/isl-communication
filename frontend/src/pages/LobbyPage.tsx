import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useMeeting } from "../context/MeetingContext";
import { createMeeting, joinMeeting } from "../lib/meetings";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Field";
import { Input } from "../components/ui/Input";
import { Alert } from "../components/ui/Alert";
import { Logo } from "../components/ui/Logo";

interface CreatedMeeting {
  id: string;
  code: string;
}

export function LobbyPage() {
  const { user, token, logout, handleUnauthorized } = useAuth();
  const { setMeeting } = useMeeting();
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedMeeting | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const displayName = user?.user_metadata?.name || user?.email || "";

  async function handleCreate() {
    if (!token) return;
    setCreating(true);
    try {
      const res = await createMeeting(token, handleUnauthorized);
      const meeting = res.meeting;
      const active = { id: meeting.id, code: meeting.meeting_code, isHost: true };
      setCreated(active);
      setMeeting(active);
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
      // Host status is governed by the backend: whoever created the meeting.
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

  // After creating a meeting, show the shareable code until the user enters.
  return (
    <div className="app-shell">
      <header className="lobby__header">
        <div className="container lobby__header-inner">
          <Logo />
          <div className="lobby__user">
            <span className="lobby__user-name">{displayName}</span>
            <Button variant="ghost" size="sm" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <main className="container lobby__main">
        <h1 className="lobby__title">Start or join a meeting</h1>
        <p className="lobby__subtitle">
          Create a room to share a code, or enter a code you were given.
        </p>

        <div className="lobby__grid">
          <section className="lobby__panel" aria-labelledby="create-title">
            <h2 id="create-title" className="lobby__panel-title">
              Start a meeting
            </h2>
            <p className="lobby__panel-desc">
              Create a room and share the code so others can join you.
            </p>
            {created && !creating ? (
              <div className="lobby__created">
                <p className="lobby__created-label">Share this code with others</p>
                <div className="lobby__codebox">
                  <code className="lobby__code">{created.code}</code>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(created.code);
                        setCopied(true);
                        window.setTimeout(() => setCopied(false), 2000);
                      } catch {
                        // fallback: no-op; clipboard unavailable
                      }
                    }}
                  >
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  className="lobby__cta"
                  onClick={() => navigate(`/meeting/${created.code}`)}
                >
                  Enter meeting
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                size="lg"
                loading={creating}
                onClick={handleCreate}
                className="lobby__cta"
              >
                Create a meeting
              </Button>
            )}
          </section>

          <section className="lobby__panel" aria-labelledby="join-title">
            <h2 id="join-title" className="lobby__panel-title">
              Join a meeting
            </h2>
            <p className="lobby__panel-desc">
              Enter the code the host shared with you.
            </p>
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
                Join meeting
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
