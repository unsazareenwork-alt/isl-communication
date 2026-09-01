import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PaperPlaneTilt } from "@phosphor-icons/react";
import type { DisplayLanguage, Message } from "../../lib/types";
import { messageDisplayText } from "../../lib/text";

interface ChatPanelProps {
  messages: Message[];
  language: DisplayLanguage;
  currentUserId: string;
  currentUserName: string;
  senderNames: Record<string, string>;
  onSend: (text: string) => Promise<void>;
}

export function ChatPanel({ messages, language, currentUserId, currentUserName, senderNames, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const chatMessages = messages.filter((m) => m.message_type === "chat");

  function senderDisplayName(m: Message): string {
    if (m.sender_id === currentUserId) return currentUserName || "You";
    const resolved = senderNames[m.sender_id];
    if (resolved) return resolved;
    if (m.sender_name && m.sender_name.trim() && m.sender_name !== "Participant") return m.sender_name;
    return "Participant";
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages.length]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await onSend(text);
      setDraft("");
    } catch {
      // Keep the draft on failure; a 401 triggers a session reset elsewhere.
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="chat" aria-label="Meeting chat">
      <div className="chat__messages" ref={scrollRef}>
        {chatMessages.length === 0 ? (
          <p className="chat__empty">No messages yet. Start the conversation.</p>
        ) : (
          chatMessages.map((m) => {
            const isMe = m.sender_id === currentUserId;
            return (
              <div key={m.id} className={["chat__msg", isMe ? "chat__msg--me" : "chat__msg--them"].join(" ")}>
                <span className="chat__who">
                  {isMe ? (currentUserName || "You") : senderDisplayName(m)}
                </span>
                <span className="chat__body">{messageDisplayText(m, language)}</span>
              </div>
            );
          })
        )}
      </div>

      <form className="chat__composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="chat-input">
          Message
        </label>
        <input
          id="chat-input"
          className="chat__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message"
          autoComplete="off"
        />
        <button
          type="submit"
          className="chat__send"
          aria-label="Send message"
          disabled={!draft.trim() || sending}
        >
          <PaperPlaneTilt size={20} weight="fill" aria-hidden="true" />
        </button>
      </form>
    </section>
  );
}
