import { useCallback, useEffect, useRef, useState } from "react";
import { MeetingSession } from "../lib/session";
import type { RemoteTile } from "../lib/session";
import type { Message } from "../lib/types";

export interface MeetingSessionConfig {
  meetingCode: string;
  meetingId: string;
  userName: string;
  userId: string;
}

export interface CaptionItem {
  id: string;
  userName: string;
  original: string;
  translated: string | null;
  timestamp: number;
}

export function useMeetingSession({
  meetingCode,
  meetingId,
  userName,
  userId,
}: MeetingSessionConfig) {
  const [localSocketId, setLocalSocketId] = useState<string | null>(null);
  // Ref mirrors the live socket id so callbacks created once (the participant
  // list pruner) read the current value instead of a stale initial `null`.
  const localSocketIdRef = useRef<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Record<string, RemoteTile>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [captions, setCaptions] = useState<CaptionItem[]>([]);
  const [disconnected, setDisconnected] = useState(false);

  const sessionRef = useRef<MeetingSession | null>(null);
  const tilesRef = useRef<Record<string, RemoteTile>>({});
  // Guard against the same message/caption being appended more than once if
  // Socket.IO ever re-delivers an event (lightweight id-based de-duplication).
  const seenMessageIds = useRef<Set<string>>(new Set());
  const seenCaptionIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const session = new MeetingSession(
      { meetingCode, meetingId, userName, userId },
      {
        onLocalSocketId: (id) => {
          localSocketIdRef.current = id;
          setLocalSocketId(id);
        },
        onLocalStream: setLocalStream,
        onMediaState: (state) => {
          setMicEnabled(state.micEnabled);
          setCameraEnabled(state.cameraEnabled);
        },
        onMediaError: (message) => setMediaError(message),
        onParticipantList: (list) => {
          const ownId = localSocketIdRef.current;
          const next = { ...tilesRef.current };
          // add any newly listed participants
          for (const t of list) {
            const existing = next[t.socketId];
            next[t.socketId] = { ...t, stream: existing?.stream ?? null };
          }
          // prune any that are no longer in the list (only safe for tiles we listed)
          for (const id of Object.keys(next)) {
            if (id === ownId) continue;
            if (!list.some((x) => x.socketId === id)) {
              delete next[id];
            }
          }
          tilesRef.current = next;
          setTiles(next);
        },
        onParticipantJoined: (p) => {
          tilesRef.current = {
            ...tilesRef.current,
            [p.socketId]: { socketId: p.socketId, userName: p.userName, stream: null },
          };
          setTiles(tilesRef.current);
        },
        onParticipantLeft: (socketId) => {
          const next = { ...tilesRef.current };
          delete next[socketId];
          tilesRef.current = next;
          setTiles(next);
        },
        onRemoteStream: (socketId, stream) => {
          const next = { ...tilesRef.current };
          const tile = next[socketId];
          if (tile) {
            next[socketId] = { ...tile, stream };
            tilesRef.current = next;
            setTiles(next);
          } else {
            // stream arrived before participant metadata; keep a placeholder
            next[socketId] = { socketId, userName: "Participant", stream };
            tilesRef.current = next;
            setTiles(next);
          }
        },
        onMessage: (message) => {
          if (seenMessageIds.current.has(message.id)) return;
          seenMessageIds.current.add(message.id);
          setMessages((prev) => [...prev, message]);
        },
        onCaption: (message) => {
          if (seenCaptionIds.current.has(message.id)) return;
          seenCaptionIds.current.add(message.id);
          setCaptions((prev) =>
            [
              ...prev,
              {
                id: message.id,
                userName: message.sender_name || "",
                original: message.original_text,
                translated: message.translated_text,
                timestamp: Date.now(),
              },
            ].slice(-4),
          );
        },
        onDisconnected: () => setDisconnected(true),
      },
    );

    sessionRef.current = session;

    return () => {
      session.destroy();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingCode, meetingId, userName, userId]);

  const toggleMic = useCallback(() => {
    sessionRef.current?.toggleMic();
  }, []);

  const toggleCamera = useCallback(() => {
    sessionRef.current?.toggleCamera();
  }, []);

  const leaveRoom = useCallback(() => {
    // destroy() now disconnects the session-owned socket and stops media.
    sessionRef.current?.destroy();
  }, []);

  const retryMedia = useCallback(() => {
    sessionRef.current?.retryMedia();
  }, []);

  const participantTiles = Object.values(tiles).filter(
    (t) => t.socketId !== localSocketIdRef.current,
  );

  return {
    localSocketId,
    localStream,
    micEnabled,
    cameraEnabled,
    mediaError,
    remoteTiles: participantTiles,
    messages,
    captions,
    disconnected,
    toggleMic,
    toggleCamera,
    leaveRoom,
    retryMedia,
  };
}
