export interface AuthUser {
  id: string;
  email: string;
  user_metadata?: {
    name?: string;
  };
}

export interface Session {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
}

export interface Meeting {
  id: string;
  host_id: string;
  meeting_code: string;
  status: string;
  started_at?: string;
  ended_at?: string;
}

export interface MeetingParticipant {
  id: string;
  meeting_id: string;
  user_id: string;
  joined_at?: string;
  left_at?: string | null;
}

export type MessageType = "chat" | "sign_translation" | "speech_translation";

export interface Message {
  id: string;
  meeting_id: string;
  sender_id: string;
  message_type: MessageType;
  original_text: string;
  translated_text: string | null;
  language: string;
  created_at: string;
  sender_name?: string | null;
}

export type DisplayLanguage = "en" | "ta";
