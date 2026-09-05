import { useCallback, useEffect, useRef, useState } from "react";
import { MeetingSession } from "../lib/session";
import type { DeviceInfo, Participant, ParticipantInfo, RemoteTile } from "../lib/session";
import type { Message } from "../lib/types";

export interface MeetingSessionConfig {
  meetingCode: string;
  meetingId: string;
  userName: string;
  userId: string;
}

export type MeetingSessionHandle = ReturnType<typeof useMeetingSession>;

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
  const localSocketIdRef = useRef<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [micEnabled, setMicEnabled] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [tiles, setTiles] = useState<Record<string, RemoteTile>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [captions, setCaptions] = useState<CaptionItem[]>([]);
  const [disconnected, setDisconnected] = useState(false);
  const [meetingEnded, setMeetingEnded] = useState(false);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState<string | null>(null);
  const [senderNames, setSenderNames] = useState<Record<string, string>>({});

  const sessionRef = useRef<MeetingSession | null>(null);
  const tilesRef = useRef<Record<string, RemoteTile>>({});
  /**
   * userId -> the socketId that currently owns that remote identity in this
   * meeting. Used so that when the same user reconnects with a new socket, the
   * old tile is dropped first (newest wins) and a stale user-left for the old
   * socket never removes the new one.
   */
  const activeSocketByUserIdRef = useRef<Map<string, string>>(new Map());
  const seenMessageIds = useRef<Set<string>>(new Set());
  const seenCaptionIds = useRef<Set<string>>(new Set());
  const isJoiningRef = useRef(false);

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
        onParticipantList: (list: Participant[]) => {
          const next = { ...tilesRef.current };
          activeSocketByUserIdRef.current.clear();
          for (const t of list) {
            if (t.socketId === localSocketIdRef.current) continue;
            const existing = next[t.socketId];
            if (t.userId) activeSocketByUserIdRef.current.set(t.userId, t.socketId);
            next[t.socketId] = {
              socketId: t.socketId,
              userName: t.userName,
              stream: existing?.stream ?? null,
              cameraEnabled: t.cameraEnabled,
              micEnabled: t.micEnabled,
              userId: t.userId,
            };
          }
          for (const id of Object.keys(next)) {
            if (!list.some((x) => x.socketId === id)) {
              delete next[id];
            }
          }
          tilesRef.current = next;
          setTiles(next);
        },
        onParticipantJoined: (p: ParticipantInfo) => {
          if (p.socketId === localSocketIdRef.current) return;
          const next = { ...tilesRef.current };
          const uid = p.userId;
          if (uid) {
            const prev = activeSocketByUserIdRef.current.get(uid);
            if (prev && prev !== p.socketId && next[prev]) {
              delete next[prev];
            }
            activeSocketByUserIdRef.current.set(uid, p.socketId);
          }
          next[p.socketId] = {
            socketId: p.socketId,
            userName: p.userName,
            stream: next[p.socketId]?.stream ?? null,
            cameraEnabled: p.cameraEnabled ?? true,
            micEnabled: p.micEnabled ?? true,
            userId: p.userId,
          };
          tilesRef.current = next;
          setTiles(next);
        },
        onParticipantLeft: (socketId) => {
          const next = { ...tilesRef.current };
          delete next[socketId];
          for (const [uid, sid] of activeSocketByUserIdRef.current) {
            if (sid === socketId) {
              activeSocketByUserIdRef.current.delete(uid);
              break;
            }
          }
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
            next[socketId] = {
              socketId,
              userName: "Participant",
              stream,
              cameraEnabled: true,
              micEnabled: true,
            };
            tilesRef.current = next;
            setTiles(next);
          }
        },
        onRemoteMediaState: (socketId, mediaState) => {
          const next = { ...tilesRef.current };
          const tile = next[socketId];
          if (tile) {
            next[socketId] = { ...tile, ...mediaState };
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
          const resolved = sessionRef.current?.resolveSenderName(message.sender_id);
          setCaptions((prev) =>
            [
              ...prev,
              {
                id: message.id,
                userName:
                  message.sender_name && message.sender_name !== "Participant"
                    ? message.sender_name
                    : (resolved ?? message.sender_name ?? ""),
                original: message.original_text,
                translated: message.translated_text,
                timestamp: Date.now(),
              },
            ].slice(-4),
          );
        },
        onDisconnected: () => setDisconnected(true),
        onMeetingEnded: () => setMeetingEnded(true),
        onDevicesChanged: (list) => {
          setDevices(list);
          const sel = sessionRef.current?.getSelectedDevices();
          setSelectedCameraId(sel?.cameraId ?? null);
          setSelectedMicrophoneId(sel?.microphoneId ?? null);
        },
        onSenderNames: (names) => setSenderNames(names),
      },
    );

    sessionRef.current = session;

    return () => {
      session.destroy();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingCode, meetingId, userName, userId]);

  const startPreview = useCallback(async () => {
    const stream = await sessionRef.current?.startPreview();
    const sel = sessionRef.current?.getSelectedDevices();
    setSelectedCameraId(sel?.cameraId ?? null);
    setSelectedMicrophoneId(sel?.microphoneId ?? null);
    return stream ?? null;
  }, []);

  const switchCamera = useCallback(async (deviceId: string) => {
    await sessionRef.current?.switchCamera(deviceId);
    const sel = sessionRef.current?.getSelectedDevices();
    setSelectedCameraId(sel?.cameraId ?? null);
  }, []);

  const switchMicrophone = useCallback(async (deviceId: string) => {
    await sessionRef.current?.switchMicrophone(deviceId);
    const sel = sessionRef.current?.getSelectedDevices();
    setSelectedMicrophoneId(sel?.microphoneId ?? null);
  }, []);

  const joinMeeting = useCallback(() => {
    if (isJoiningRef.current) return;
    isJoiningRef.current = true;
    sessionRef.current?.joinMeeting();
  }, []);

  const toggleMic = useCallback(() => {
    sessionRef.current?.toggleMic();
  }, []);

  const toggleCamera = useCallback(async () => {
    await sessionRef.current?.toggleCamera();
  }, []);

  const leaveRoom = useCallback(() => {
    sessionRef.current?.destroy();
  }, []);

  const retryMedia = useCallback(() => {
    sessionRef.current?.retryMedia();
  }, []);

  const participantTiles = Object.values(tiles).filter(
    (t) => t.socketId !== localSocketIdRef.current,
  );

  const participants: Participant[] = [
    {
      socketId: localSocketIdRef.current ?? "",
      userName,
      stream: localStream,
      isLocal: true,
      cameraEnabled,
      micEnabled,
    },
    ...participantTiles.map((t) => ({
      socketId: t.socketId,
      userName: t.userName,
      stream: t.stream,
      isLocal: false,
      cameraEnabled: t.cameraEnabled,
      micEnabled: t.micEnabled,
    })),
  ];

  // [DIAG] log the participant list handed to the grid
  if (localStream) {
    console.log(
      "[MEDIA] participants for grid:",
      participants.map((p) => ({
        isLocal: p.isLocal,
        name: p.userName,
        streamIsLocalStream: p.stream === localStream,
        streamId: p.stream?.id ?? null,
        cameraEnabled: p.cameraEnabled,
      })),
    );
  }

  return {
    localSocketId,
    localStream,
    micEnabled,
    cameraEnabled,
    mediaError,
    remoteTiles: participantTiles,
    participants,
    messages,
    captions,
    disconnected,
    meetingEnded,
    devices,
    selectedCameraId,
    selectedMicrophoneId,
    senderNames,
    resolveSenderName: (senderId: string) => sessionRef.current?.resolveSenderName(senderId) ?? null,
    startPreview,
    switchCamera,
    switchMicrophone,
    joinMeeting,
    toggleMic,
    toggleCamera,
    leaveRoom,
    retryMedia,
  };
}
