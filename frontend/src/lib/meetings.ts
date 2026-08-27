import { request } from "./api";
import type { Meeting, MeetingParticipant } from "./types";

export interface CreateMeetingResponse {
  message: string;
  meeting: Meeting;
}

export interface JoinMeetingResponse {
  message: string;
  meeting: Meeting;
  participant: MeetingParticipant;
}

export interface LeaveMeetingResponse {
  message: string;
  participant: MeetingParticipant;
}

export interface EndMeetingResponse {
  message: string;
  meeting: Meeting;
}

/**
 * Create a new meeting. The authenticated user becomes host.
 */
export function createMeeting(token: string, onUnauthorized?: () => void) {
  return request<CreateMeetingResponse>("/api/meetings/create", {
    method: "POST",
    token,
    onUnauthorized,
  });
}

/**
 * Join an existing meeting by its short shareable code.
 */
export function joinMeeting(code: string, token: string, onUnauthorized?: () => void) {
  return request<JoinMeetingResponse>(`/api/meetings/join/${encodeURIComponent(code)}`, {
    method: "POST",
    token,
    onUnauthorized,
  });
}

/**
 * Explicitly leave a meeting (records left_at for the participant).
 */
export function leaveMeeting(meetingId: string, token: string, onUnauthorized?: () => void) {
  return request<LeaveMeetingResponse>(`/api/meetings/leave/${meetingId}`, {
    method: "POST",
    token,
    onUnauthorized,
  });
}

/**
 * End a meeting. Only the host may end a meeting.
 */
export function endMeeting(meetingId: string, token: string, onUnauthorized?: () => void) {
  return request<EndMeetingResponse>(`/api/meetings/end/${meetingId}`, {
    method: "POST",
    token,
    onUnauthorized,
  });
}
