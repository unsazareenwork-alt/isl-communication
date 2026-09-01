import { useCallback, useEffect, useState } from "react";
import { fetchTranscript } from "../../lib/messages";
import type { DisplayLanguage, Message, MessageType } from "../../lib/types";
import { messageDisplayText } from "../../lib/text";
import { Button } from "../ui/Button";

interface TranscriptPanelProps {
  meetingId: string;
  token: string;
  language: DisplayLanguage;
  currentUserId: string;
  currentUserName: string;
  senderNames: Record<string, string>;
  onUnauthorized: () => void;
}

const TYPE_LABEL: Record<MessageType, string> = {
  chat: "Chat",
  sign_translation: "Sign",
  speech_translation: "Speech",
};

function senderName(m: Message, currentUserId: string, currentUserName: string, senderNames: Record<string, string>): string {
  if (m.sender_id === currentUserId) return currentUserName || "You";
  const resolved = senderNames[m.sender_id];
  if (resolved) return resolved;
  if (m.sender_name && m.sender_name.trim() && m.sender_name !== "Participant") return m.sender_name;
  return "Participant";
}

export function TranscriptPanel({ meetingId, token, language, currentUserId, currentUserName, senderNames, onUnauthorized }: TranscriptPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTranscript(meetingId, token, onUnauthorized)
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the transcript.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [meetingId, token, onUnauthorized]);

  useEffect(() => {
    return load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  return (
    <section className="panel" aria-label="Meeting transcript">
      <div className="transcript__toolbar">
        <span className="transcript__count">{messages.length} entries</span>
        <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      <div className="transcript__body">
        {loading && (
          <div className="transcript__status">
            <span className="spin" aria-hidden="true" />
            <p>Loading transcript…</p>
          </div>
        )}

        {error && !loading && <p className="transcript__status transcript__error">{error}</p>}

        {!loading && !error && messages.length === 0 && (
          <p className="transcript__empty">No transcript entries yet.</p>
        )}

        {!loading &&
          !error &&
          messages.length > 0 && (
            <ol className="transcript__list">
              {messages.map((m) => (
                <li key={m.id} className="transcript__row">
                  <div className="transcript__meta">
                    <span className="transcript__who">
                      {senderName(m, currentUserId, currentUserName, senderNames)}
                    </span>
                    <span className={["transcript__type", `transcript__type--${m.message_type}`].join(" ")}>
                      {TYPE_LABEL[m.message_type]}
                    </span>
                  </div>
                  <p className="transcript__text">{messageDisplayText(m, language)}</p>
                </li>
              ))}
            </ol>
          )}
      </div>
    </section>
  );
}
