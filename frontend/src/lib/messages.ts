import { request } from "./api";
import type { Message, MessageType } from "./types";

interface SaveMessageResponse {
  message: string;
  data: Message;
}

interface TranscriptResponse {
  messages: Message[];
}

/**
 * Persist a message to the backend. This also broadcasts the saved message
 * live to everyone in the meeting via the `new-message` Socket.IO event.
 */
export function saveMessage(
  input: {
    meeting_id: string;
    message_type: MessageType;
    original_text: string;
    translated_text?: string | null;
    language?: string;
  },
  token: string,
  onUnauthorized?: () => void,
) {
  return request<SaveMessageResponse>("/api/messages", {
    method: "POST",
    body: input,
    token,
    onUnauthorized,
  });
}

/**
 * Fetch the full saved message history (transcript) for a meeting.
 */
export function fetchTranscript(meetingId: string, token: string, onUnauthorized?: () => void) {
  return request<TranscriptResponse>(`/api/messages/${meetingId}`, {
    token,
    onUnauthorized,
  });
}
