import type { Socket } from "socket.io-client";
import { createSocket, disconnectSocket } from "./socket";
import {
  PeerRecovery,
  PendingCandidateQueue,
  candidateMatchesUfrags,
  extractIceUfrags,
  type PeerIceState,
  type PeerLinkState,
  type RecoveryAction,
} from "./webrtcRecovery";
import type { Message } from "./types";

export interface SessionConfig {
  meetingCode: string;
  meetingId: string;
  userName: string;
  userId: string;
}

export interface RemoteTile {
  socketId: string;
  userName: string;
  stream: MediaStream | null;
  cameraEnabled: boolean;
  micEnabled: boolean;
  userId?: string;
}

export interface Participant extends RemoteTile {
  isLocal: boolean;
}

export interface MediaState {
  micEnabled: boolean;
  cameraEnabled: boolean;
}

export interface DeviceInfo {
  deviceId: string;
  kind: "videoinput" | "audioinput";
  label: string;
  groupId: string;
}

export interface SessionCallbacks {
  onLocalSocketId: (socketId: string) => void;
  onLocalStream: (stream: MediaStream) => void;
  onMediaState: (state: MediaState) => void;
  onMediaError: (message: string | null) => void;
  onParticipantList: (participants: Participant[]) => void;
  onParticipantJoined: (p: ParticipantInfo) => void;
  onParticipantLeft: (socketId: string) => void;
  onRemoteStream: (socketId: string, stream: MediaStream | null) => void;
  onRemoteMediaState: (socketId: string, state: MediaState) => void;
  onMessage: (message: Message) => void;
  onCaption: (message: Message) => void;
  onDisconnected: () => void;
  onDevicesChanged: (devices: DeviceInfo[]) => void;
  onSenderNames: (names: Record<string, string>) => void;
  onMeetingEnded: () => void;
}

/** Participant identity/state carried by signaling events. */
export interface ParticipantInfo {
  socketId: string;
  userName: string;
  userId?: string;
  cameraEnabled?: boolean;
  micEnabled?: boolean;
}

/**
 * Payload of the backend `existing-participants` event.
 * The backend sends camera/mic state as `cameraOn`/`micOn`; these map onto the
 * frontend's `cameraEnabled`/`micEnabled` at this boundary.
 */
export interface ExistingParticipant {
  socketId: string;
  userName: string;
  userId?: string;
  cameraOn?: boolean;
  micOn?: boolean;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:openrelay.metered.ca:80" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

const STORAGE_KEY_CAMERA = "shiksha_sanket_selected_camera";
const STORAGE_KEY_MIC = "shiksha_sanket_selected_microphone";

// ===================== Peer connection bookkeeping =====================

/**
 * How long an ICE restart may take to bring the peer back to `connected` before
 * the next recovery attempt is spent. Generous on purpose: it must only fire for
 * a restart that clearly did not help.
 */
const ICE_RESTART_SETTLE_MS = 20000;

/**
 * Everything the session needs to know about one remote peer besides the
 * RTCPeerConnection itself. Kept out of the WebRTC object so a peer can be
 * cleaned up (timers, buffered candidates) even when the connection is already
 * broken.
 */
interface PeerRuntime {
  pc: RTCPeerConnection;
  /** Bounded failure recovery: grace period + limited ICE restarts. */
  recovery: PeerRecovery;
  /** Candidates received before the remote description was applied. */
  candidates: PendingCandidateQueue<RTCIceCandidateInit>;
  /** Serializes addIceCandidate so ordering survives async gaps. */
  candidateChain: Promise<void>;
  hasRemoteDescription: boolean;
  /** `a=ice-ufrag` values of the currently applied remote description. */
  remoteUfrags: string[];
  /** True when this side sent the initial offer, i.e. it drives ICE restarts. */
  offerer: boolean;
  /** Perfect-negotiation tie-break: the polite peer rolls back on glare. */
  polite: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
}

// DEV-only WebRTC diagnostics master switch. Set to false to temporarily
// disable the getStats sampler for regression isolation, keeping all other
// WebRTC behavior unchanged.
const DEV_STATS_ENABLED = false;

/**
 * DEV-only structured WebRTC logging. Only non-sensitive state transitions are
 * reported: never auth material, TURN credentials, SDP bodies, candidate
 * payloads or network addresses. A truncated socket id is the only remote
 * identifier used so reconnects can be correlated across logs.
 */
function logPeerEvent(event: string, remoteSocketId: string, data?: Record<string, unknown>): void {
  if (!import.meta.env.DEV) return;
  console.debug(`[WebRTC] ${event}`, { peer: remoteSocketId.slice(-6), ...data });
}

// ===================== Device persistence =====================

function loadCameraPref(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_CAMERA);
  } catch {
    return null;
  }
}
function loadMicrophonePref(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_MIC);
  } catch {
    return null;
  }
}
function saveCameraPref(deviceId: string | null) {
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEY_CAMERA, deviceId);
    else localStorage.removeItem(STORAGE_KEY_CAMERA);
  } catch { /* storage unavailable */ }
}
function saveMicrophonePref(deviceId: string | null) {
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEY_MIC, deviceId);
    else localStorage.removeItem(STORAGE_KEY_MIC);
  } catch { /* storage unavailable */ }
}

// ===================== Device enumeration =====================

export async function enumerateDevices(): Promise<DeviceInfo[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput" || d.kind === "audioinput")
    .map((d) => ({
      deviceId: d.deviceId,
      kind: d.kind as "videoinput" | "audioinput",
      label: d.label,
      groupId: d.groupId,
    }));
}

// ============ Heuristic scoring (initial default only, never authoritative) ============

function scoreCameraLabel(label: string): number {
  const lower = label.toLowerCase();
  let score = 0;

  if (/\bbuilt[- ]?in\b/.test(lower)) score += 100;
  if (/\bintegrated\b/.test(lower)) score += 100;
  if (/\binternal\b/.test(lower)) score += 80;
  if (/\bfacetime\b/.test(lower)) score += 90;
  if (/\bhd\s*camera\b/.test(lower)) score += 40;
  if (/\bwebcam\b/.test(lower)) score += 30;
  if (/\busb\s*video\b/.test(lower)) score += 20;
  if (/\bcamera\b/.test(lower)) score += 10;

  if (/\bobs\b/.test(lower)) score -= 200;
  if (/\bsnap\s*cam\b/.test(lower)) score -= 200;
  if (/\banyp\.me\b/.test(lower)) score -= 200;
  if (/\bvirtual\b/.test(lower)) score -= 200;
  if (/\bzoom\b/.test(lower)) score -= 200;
  if (/\bteams\b/.test(lower)) score -= 200;

  const words = label.trim().split(/\s+/);
  const capitalizedWords = words.filter((w) => /^[A-Z]/.test(w) && w.length > 1);
  if (capitalizedWords.length >= 3) {
    score -= 60;
  } else if (capitalizedWords.length >= 2) {
    score -= 30;
  }

  if (label.length > 30) score -= 20;
  if (label.length > 50) score -= 40;
  if (!label.trim()) score -= 5;

  return score;
}

function chooseDefaultCameraId(devices: DeviceInfo[]): string | null {
  const videoInputs = devices.filter((d) => d.kind === "videoinput");
  if (videoInputs.length === 0) return null;
  if (videoInputs.length === 1) return videoInputs[0].deviceId;
  if (videoInputs.some((d) => d.deviceId === loadCameraPref())) {
    return loadCameraPref();
  }
  let best: DeviceInfo | null = null;
  let bestScore = -Infinity;
  for (const d of videoInputs) {
    const s = scoreCameraLabel(d.label);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best?.deviceId ?? null;
}

function chooseDefaultMicrophoneId(devices: DeviceInfo[]): string | null {
  const audioInputs = devices.filter((d) => d.kind === "audioinput");
  if (audioInputs.length === 0) return null;
  if (audioInputs.some((d) => d.deviceId === loadMicrophonePref())) {
    return loadMicrophonePref();
  }
  return null; // let the browser pick
}

// ===================== Constraints =====================

function buildVideoConstraints(deviceId: string | null): MediaTrackConstraints {
  if (deviceId) {
    return { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } };
  }
  return { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } };
}

function buildAudioConstraints(deviceId: string | null): MediaTrackConstraints {
  return deviceId
    ? {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        deviceId: { exact: deviceId },
      }
    : {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
}

function friendlyMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Camera or microphone access was denied. Please allow access and try again.";
    case "NotFoundError":
      return "No camera or microphone was found on this device.";
    case "NotReadableError":
      return "Your camera or microphone is already in use by another application.";
    case "OverconstrainedError":
      return "No camera matches the requested settings.";
    default:
      return "Could not start your camera or microphone. Please try again.";
  }
}

// ===================== MeetingSession =====================

export class MeetingSession {
  private socket: Socket;
  private config: SessionConfig;
  private cb: SessionCallbacks;

  private localStream: MediaStream | null = null;
  /** socketId -> live peer state (connection + recovery + candidate buffer). */
  private peerRuntimes = new Map<string, PeerRuntime>();
  private participantNames = new Map<string, string>();
  /** socketId -> remote media state (camera/mic enabled). */
  private remoteMediaStates = new Map<string, MediaState>();

  /** userId -> the remote socketId currently serving that user in THIS meeting. */
  private activeRemoteByUserId = new Map<string, string>();
  /** socketId -> userId (remote participants only; used for stale user-left guards). */
  private userIdByRemoteSocket = new Map<string, string>();
  /** Sockets we decided to ignore because they are copies of the local identity (multi-tab). */
  private ignoredRemoteSockets = new Set<string>();
  private localSocketId: string | null = null;
  private destroyed = false;

  /** Whether we have actually joined the meeting room (emitted join-meeting). */
  private joined = false;
  /** Socket id the current join was announced with; differs after a reconnect. */
  private joinedSocketId: string | null = null;
  /** Whether the user has signalled they want to enter the meeting (pre-join done). */
  private readyToJoin = false;
  /** True while the pre-join preview screen is showing; media is acquired only via startPreview. */
  private preJoinActive = true;
  /** Incremented on every toggleCamera() so an in-flight camera re-acquisition can be aborted. */
  private toggleCameraSeq = 0;

  private availableDevices: DeviceInfo[] = [];
  private selectedCameraId: string | null = null;
  private selectedMicrophoneId: string | null = null;
  private deviceChangeHandler: (() => void) | null = null;
  /** userId -> displayName used to resolve chat/transcript sender names. */
  private namesById = new Map<string, string>();

  /** DEV-only: per-peer diagnostic sampler state (socketId -> accumulator). */
  private statsTimers = new Map<
    string,
    { timer: number; lastPairId: string | null; lastInBytes: number; lastOutBytes: number; lastTs: number }
  >();

  constructor(config: SessionConfig, callbacks: SessionCallbacks) {
    this.config = config;
    this.cb = callbacks;
    // Always know the current user's id -> display name.
    if (config.userId) this.namesById.set(config.userId, config.userName);
    this.socket = createSocket();
    this.attachSocketHandlers();

    if (this.socket.connected) {
      void this.handleConnect();
    }
  }

  /**
   * Resolve a sender_id (DB user id) to a display name.
   * Returns null when the id is unknown (no reliable mapping available).
   */
  resolveSenderName(senderId: string): string | null {
    if (!senderId) return null;
    return this.namesById.get(senderId) ?? null;
  }

  private emitSenderNames() {
    this.cb.onSenderNames(Object.fromEntries(this.namesById));
  }

  private trackNameById(userId: string | undefined, userName: string) {
    if (userId) this.namesById.set(userId, userName);
  }

  /**
   * True when the given userId belongs to the person in THIS tab (the current
   * session). A remote socket carrying this userId is a copy of the local
   * identity (e.g. the same account opened in a second tab) and must not be
   * shown as a participant or peered to.
   */
  private isSelfByUserId(userId: string | undefined): boolean {
    return !!userId && userId === this.config.userId;
  }

  /**
   * Reconcile a freshly-announced remote participant against what we already
   * track for the same authenticated userId within this meeting.
   *
   * - userId matching the local identity  -> ignored (another tab of the user).
   * - userId already mapped to a DIFFERENT active remote socket -> the newer
   *   socket replaces/tears down the old one (prevents ghost duplicates).
   *
   * Returns false when the participant must be skipped entirely, true otherwise.
   */
  private reconcileRemoteParticipant(remoteSocketId: string, userId: string | undefined): boolean {
    if (this.isSelfByUserId(userId)) {
      // Same person in another tab: never peer with or display our own copy.
      this.ignoredRemoteSockets.add(remoteSocketId);
      if (import.meta.env.DEV) {
        console.log(
          "[DEDUP DEBUG] reconcile -> SELF duplicate (ignored)",
          { remoteSocketId, userId, localUserId: this.config.userId },
        );
      }
      return false;
    }

    this.ignoredRemoteSockets.delete(remoteSocketId);

    if (userId) {
      const prev = this.activeRemoteByUserId.get(userId);
      if (prev && prev !== remoteSocketId) {
        // Same user reconnected with a new socket: the newest wins, old is torn down.
        this.takeDownRemote(prev);
        if (import.meta.env.DEV) {
          console.log(
            "[DEDUP DEBUG] reconcile -> REMOTE duplicate (replace)",
            { remoteSocketId, userId, replacedSocketId: prev },
          );
        }
      } else {
        if (import.meta.env.DEV) {
          console.log("[DEDUP DEBUG] reconcile -> accepted (remote, no dup)", {
            remoteSocketId,
            userId,
            localUserId: this.config.userId,
          });
        }
      }
      this.activeRemoteByUserId.set(userId, remoteSocketId);
      this.userIdByRemoteSocket.set(remoteSocketId, userId);
    } else {
      if (import.meta.env.DEV) {
        console.log("[DEDUP DEBUG] reconcile -> accepted (NO userId, cannot dedup)", {
          remoteSocketId,
          userId,
          localUserId: this.config.userId,
        });
      }
    }
    return true;
  }

  /**
   * Fully remove one remote connection: close the RTCPeerConnection, drop its
   * name/media/stats state and its map entries, and remove its React tile.
   * Never touches the local connection.
   */
  private takeDownRemote(remoteSocketId: string) {
    const userId = this.userIdByRemoteSocket.get(remoteSocketId);
    this.removePeer(remoteSocketId);
    this.participantNames.delete(remoteSocketId);
    this.remoteMediaStates.delete(remoteSocketId);
    this.ignoredRemoteSockets.delete(remoteSocketId);
    if (userId && this.activeRemoteByUserId.get(userId) === remoteSocketId) {
      this.activeRemoteByUserId.delete(userId);
    }
    this.userIdByRemoteSocket.delete(remoteSocketId);
    this.cb.onParticipantLeft(remoteSocketId);
    this.emitParticipantList();
  }

  /**
   * Drop every remote after a socket reconnection. All existing peer
   * connections are addressed by the socket id that just died, so none of them
   * can ever be used again; the participants are re-announced by the backend
   * when we re-join and fresh connections are created for them.
   */
  private resetRemoteStateForReconnect() {
    for (const remoteSocketId of [...this.peerRuntimes.keys()]) {
      this.removePeer(remoteSocketId);
    }
    this.participantNames.clear();
    this.remoteMediaStates.clear();
    this.ignoredRemoteSockets.clear();
    this.activeRemoteByUserId.clear();
    this.userIdByRemoteSocket.clear();
    this.cb.onParticipantList([]);
  }

  private attachSocketHandlers() {
    const s = this.socket;

    s.on("connect", () => void this.handleConnect());
    s.on("connect_error", () => {
      // Soft notice; WebRTC can still work once reconnected.
    });
    s.on("disconnect", (reason) => {
      if (this.destroyed) return;
      if (reason === "io client disconnect") return;
      this.cb.onDisconnected();
    });

    s.on("existing-participants", (participants: ExistingParticipant[]) => {
      if (import.meta.env.DEV) {
        console.log("[DEDUP DEBUG] existing-participants list", {
          localUserId: this.config.userId,
          localSocketId: this.localSocketId,
          list: participants.map((p) => ({
            socketId: p.socketId,
            userId: p.userId,
            userName: p.userName,
          })),
        });
      }
      const accepted: string[] = [];
      participants.forEach((p) => {
        if (import.meta.env.DEV) {
          console.log("[DEDUP DEBUG] existing-participants entry", {
            event: "existing-participants",
            localUserId: this.config.userId,
            incomingUserId: p.userId,
            incomingSocketId: p.socketId,
            localSocketId: this.localSocketId,
            isSameUser: p.userId !== undefined && p.userId === this.config.userId,
          });
        }
        this.trackNameById(p.userId, p.userName);
        if (!this.reconcileRemoteParticipant(p.socketId, p.userId)) return;
        this.participantNames.set(p.socketId, p.userName);
        if (p.cameraOn !== undefined && p.micOn !== undefined) {
          this.remoteMediaStates.set(p.socketId, {
            cameraEnabled: p.cameraOn,
            micEnabled: p.micOn,
          });
        }
        this.cb.onParticipantJoined({
          socketId: p.socketId,
          userName: p.userName,
          userId: p.userId,
          cameraEnabled: p.cameraOn,
          micEnabled: p.micOn,
        });
        accepted.push(p.socketId);
      });
      this.emitSenderNames();
      accepted.forEach((socketId) => this.callUser(socketId));
      this.emitParticipantList();
    });

    s.on("user-joined", (data: ParticipantInfo) => {
      if (import.meta.env.DEV) {
        console.log("[DEDUP DEBUG] user-joined", {
          event: "user-joined",
          localUserId: this.config.userId,
          incomingUserId: data.userId,
          incomingSocketId: data.socketId,
          localSocketId: this.localSocketId,
          isSameUser: data.userId !== undefined && data.userId === this.config.userId,
        });
      }
      this.trackNameById(data.userId, data.userName);
      if (!this.reconcileRemoteParticipant(data.socketId, data.userId)) return;
      this.participantNames.set(data.socketId, data.userName);
      if (data.cameraEnabled !== undefined && data.micEnabled !== undefined) {
        this.remoteMediaStates.set(data.socketId, {
          cameraEnabled: data.cameraEnabled,
          micEnabled: data.micEnabled,
        });
      }
      this.cb.onParticipantJoined(data);
      this.emitSenderNames();
      this.emitParticipantList();
    });

    s.on("user-left", (data: { socketId?: string; userId?: string; userName?: string }) => {
      // The REST /api/meetings/leave/:id path emits user-left without a socketId;
      // fall back to the currently active remote socket for that userId.
      const socketId =
        data.socketId ?? (data.userId ? this.activeRemoteByUserId.get(data.userId) : undefined);
      if (!socketId) return;
      // Guard: if this socket is no longer the active connection for its user,
      // a stale user-left (for a replaced old socket) must not remove the newer one.
      const userId = this.userIdByRemoteSocket.get(socketId) || data.userId;
      if (userId && this.activeRemoteByUserId.get(userId) !== socketId) return;
      this.takeDownRemote(socketId);
    });

    s.on("peer-media-toggle", (data: { socketId: string; cameraOn: boolean; micOn: boolean }) => {
      this.remoteMediaStates.set(data.socketId, {
        cameraEnabled: data.cameraOn,
        micEnabled: data.micOn,
      });
      this.cb.onRemoteMediaState(data.socketId, {
        cameraEnabled: data.cameraOn,
        micEnabled: data.micOn,
      });
    });

    s.on("webrtc-offer", (data: { offer: RTCSessionDescriptionInit; from: string }) => {
      void this.handleOffer(data.from, data.offer).catch((err: unknown) => {
        logPeerEvent("offer handling failed", data.from, { error: String(err) });
      });
    });

    s.on("webrtc-answer", (data: { answer: RTCSessionDescriptionInit; from: string }) => {
      void this.handleAnswer(data.from, data.answer);
    });

    s.on("webrtc-ice-candidate", (data: { candidate: RTCIceCandidateInit | null; from: string }) => {
      this.handleRemoteCandidate(data.from, data.candidate);
    });

    s.on("new-message", (message: Message) => this.cb.onMessage(message));
    s.on("sign-translation", (message: Message) => this.cb.onCaption(message));

    s.on("meeting-ended", () => {
      if (this.destroyed) return;
      this.cb.onMeetingEnded();
    });
  }

  private getActualMediaState(): MediaState {
    if (!this.localStream) return { micEnabled: false, cameraEnabled: false };
    const audioTrack = this.localStream.getAudioTracks()[0];
    const videoTrack = this.localStream.getVideoTracks()[0];
    return {
      micEnabled: audioTrack ? audioTrack.enabled && audioTrack.readyState === "live" : false,
      cameraEnabled: videoTrack ? videoTrack.enabled && videoTrack.readyState === "live" : false,
    };
  }

  /**
   * Called when the socket connects (or synchronously if already connected).
   * Acquires media and, if the user is ready to join, emits join-meeting.
   *
   * A reconnection always yields a NEW socket id, and every peer connection is
   * addressed by socket id, so the old ones are unusable. In that case the
   * remote state is dropped and the room is re-joined under the new id, which
   * makes the backend re-announce the other participants and rebuilds the
   * connections from scratch instead of silently keeping dead tiles.
   */
  private async handleConnect() {
    if (this.destroyed) return;
    const previousSocketId = this.localSocketId;
    const socketId = this.socket.id ?? null;
    this.localSocketId = socketId;
    if (socketId) this.cb.onLocalSocketId(socketId);

    if (this.joined) {
      if (!socketId || socketId === this.joinedSocketId) return;
      logPeerEvent("socket reconnected", previousSocketId ?? "unknown", {
        newSocketId: socketId.slice(-6),
      });
      this.resetRemoteStateForReconnect();
      this.emitJoin();
      this.broadcastMediaState();
      return;
    }

    // While the pre-join preview is active, the single media acquisition happens
    // in startPreview(); the socket connecting here must NOT acquire a second
    // stream. Once the user joins (readyToJoin), acquire only if we don't yet
    // have a stream (e.g. reconnect / retry path).
    if (!this.preJoinActive && !this.localStream) {
      try {
        const stream = navigator.mediaDevices.getUserMedia
          ? await navigator.mediaDevices.getUserMedia({
              video: buildVideoConstraints(this.selectedCameraId),
              audio: buildAudioConstraints(this.selectedMicrophoneId),
            })
          : await Promise.reject(new Error("mediaDevices unavailable"));
        if (this.destroyed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        this.localStream = stream;
        this.cb.onLocalStream(stream);
        this.cb.onMediaState(this.getActualMediaState());
        this.bindTrackEnded(stream);
      } catch (err) {
        this.cb.onMediaError(friendlyMediaError(err));
        this.cb.onMediaState({ micEnabled: false, cameraEnabled: false });
      }
    }

    if (this.readyToJoin && !this.joined) {
      this.joined = true;
      this.emitJoin();
    }
  }

  private bindTrackEnded(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (this.destroyed) return;
        this.cb.onMediaState(this.getActualMediaState());
      };
    }
  }

  // ===================== Pre-join API =====================

  /** Enumerate devices and pick sensible defaults, storing them for selection. */
  async startPreview(): Promise<MediaStream | null> {
    if (this.destroyed) return null;
    this.preJoinActive = true;

    try {
      this.availableDevices = await enumerateDevices();
    } catch {
      this.availableDevices = [];
    }
    this.cb.onDevicesChanged(this.availableDevices);

    const chosenCamera = chooseDefaultCameraId(this.availableDevices);
    const chosenMic = chooseDefaultMicrophoneId(this.availableDevices);
    this.selectedCameraId = chosenCamera;
    this.selectedMicrophoneId = chosenMic;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(chosenCamera),
        audio: buildAudioConstraints(chosenMic),
      });
      if (this.destroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }
      this.localStream = stream;
      this.cb.onLocalStream(stream);
      this.cb.onMediaState(this.getActualMediaState());
      this.bindTrackEnded(stream);
      this.attachDeviceListener();
      this.logLocalMedia("startPreview");
      return stream;
    } catch (err) {
      this.cb.onMediaError(friendlyMediaError(err));
      this.cb.onMediaState({ micEnabled: false, cameraEnabled: false });
      // Attach listener anyway so device list can update
      this.attachDeviceListener();
      return null;
    }
  }

  /** Runtime media diagnostics (temporary). */
  private logLocalMedia(source: string) {
    const stream = this.localStream;
    if (!stream) {
      console.log(`[MEDIA] (${source}) localStream is NULL`);
      return;
    }
    const video = stream.getVideoTracks()[0];
    const settings = video?.getSettings?.() || {};
    console.log(`[MEDIA] (${source}) stream.id=${stream.id}`);
    console.log(`[MEDIA] (${source}) videoTracks.length=${stream.getVideoTracks().length}`);
    console.log(`[MEDIA] (${source}) label=${video?.label}`);
    console.log(`[MEDIA] (${source}) readyState=${video?.readyState}`);
    console.log(`[MEDIA] (${source}) enabled=${video?.enabled}`);
    console.log(`[MEDIA] (${source}) settings=`, settings);
    console.log(`[MEDIA] (${source}) width=${settings.width} height=${settings.height}`);
  }

  private attachDeviceListener() {
    if (this.deviceChangeHandler) return;
    this.deviceChangeHandler = async () => {
      if (this.destroyed) return;
      try {
        this.availableDevices = await enumerateDevices();
      } catch {
        return;
      }
      this.cb.onDevicesChanged(this.availableDevices);

      // Fallback if the selected camera disappeared
      if (this.selectedCameraId) {
        const still = this.availableDevices.some(
          (d) => d.deviceId === this.selectedCameraId && d.kind === "videoinput",
        );
        if (!still) this.selectedCameraId = chooseDefaultCameraId(this.availableDevices);
      }
      if (this.selectedMicrophoneId) {
        const still = this.availableDevices.some(
          (d) => d.deviceId === this.selectedMicrophoneId && d.kind === "audioinput",
        );
        if (!still) this.selectedMicrophoneId = chooseDefaultMicrophoneId(this.availableDevices);
      }
    };
    navigator.mediaDevices.addEventListener("devicechange", this.deviceChangeHandler);
  }

  getAvailableDevices(): DeviceInfo[] {
    return this.availableDevices;
  }

  getSelectedDevices(): { cameraId: string | null; microphoneId: string | null } {
    return {
      cameraId: this.selectedCameraId,
      microphoneId: this.selectedMicrophoneId,
    };
  }

  setSelectedCamera(deviceId: string | null) {
    this.selectedCameraId = deviceId;
    saveCameraPref(deviceId);
  }

  setSelectedMicrophone(deviceId: string | null) {
    this.selectedMicrophoneId = deviceId;
    saveMicrophonePref(deviceId);
  }

  /** Switch camera during pre-join or during the meeting. */
  async switchCamera(deviceId: string): Promise<void> {
    if (this.destroyed) return;
    const oldVideoTrack = this.localStream?.getVideoTracks()[0];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(deviceId),
        audio: false,
      });
      const newVideoTrack = stream.getVideoTracks()[0];
      if (!newVideoTrack) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      // Stop any extra tracks from the temporary stream (only video was requested,
      // so normally there are none).
      stream.getTracks().forEach((t) => {
        if (t !== newVideoTrack) t.stop();
      });
      // Stop the old video track only after the new stream is acquired.
      if (this.localStream && oldVideoTrack) {
        this.localStream.removeTrack(oldVideoTrack);
        oldVideoTrack.stop();
      }
      if (this.localStream) {
        this.localStream.addTrack(newVideoTrack);
      } else {
        this.localStream = stream;
      }

      this.selectedCameraId = deviceId;
      saveCameraPref(deviceId);

      if (this.joined) this.replaceTracksOnAllPeers(this.localStream);
      this.replaceLocalVideoOnPeers(this.localStream?.getVideoTracks()[0] ?? null);

      this.cb.onLocalStream(this.localStream);
      this.cb.onMediaState(this.getActualMediaState());
      this.bindTrackEnded(this.localStream);
      this.broadcastMediaState();
    } catch {
      this.cb.onMediaError("Could not switch camera. Your previous camera is still active.");
    }
  }

  /** Switch microphone during pre-join or during the meeting. */
  async switchMicrophone(deviceId: string): Promise<void> {
    if (this.destroyed) return;
    const oldAudioTrack = this.localStream?.getAudioTracks()[0];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: buildAudioConstraints(deviceId),
      });
      const newAudioTrack = stream.getAudioTracks()[0];
      if (!newAudioTrack) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      stream.getTracks().forEach((t) => {
        if (t !== newAudioTrack) t.stop();
      });
      if (this.localStream && oldAudioTrack) {
        this.localStream.removeTrack(oldAudioTrack);
        oldAudioTrack.stop();
      }
      if (this.localStream) {
        this.localStream.addTrack(newAudioTrack);
      } else {
        this.localStream = stream;
      }

      this.selectedMicrophoneId = deviceId;
      saveMicrophonePref(deviceId);

      if (this.joined) this.replaceTracksOnAllPeers(this.localStream);

      this.cb.onLocalStream(this.localStream);
      this.cb.onMediaState(this.getActualMediaState());
      this.bindTrackEnded(this.localStream);
      this.broadcastMediaState();
    } catch {
      this.cb.onMediaError("Could not switch microphone. Your previous microphone is still active.");
    }
  }

  /**
   * Called when the user clicks "Join meeting". Signals readiness to enter the
   * room; actually emits join-meeting through the connected socket.
   * Reuses the pre-join MediaStream for the local participant.
   */
  joinMeeting() {
    if (this.destroyed || this.joined) return;
    this.readyToJoin = true;
    this.preJoinActive = false;
    if (this.socket.connected) {
      void this.handleConnect();
    }
    // If not connected yet, the connect handler will pick up readyToJoin.
  }

  // ===================== Meeting internals =====================

  async retryMedia(): Promise<MediaStream | null> {
    if (this.destroyed) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(this.selectedCameraId),
        audio: buildAudioConstraints(this.selectedMicrophoneId),
      });
      if (this.destroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }
      if (this.localStream) this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = stream;
      this.cb.onLocalStream(stream);
      this.cb.onMediaError(null);
      this.cb.onMediaState(this.getActualMediaState());
      this.bindTrackEnded(stream);
      this.replaceTracksOnAllPeers(stream);
      this.replaceLocalVideoOnPeers(stream.getVideoTracks()[0] ?? null);
      this.broadcastMediaState();
      return stream;
    } catch (err) {
      this.cb.onMediaError(friendlyMediaError(err));
      this.cb.onMediaState({ micEnabled: false, cameraEnabled: false });
      return null;
    }
  }

  private replaceTracksOnAllPeers(newStream: MediaStream) {
    for (const [, runtime] of this.peerRuntimes) {
      const senders = runtime.pc.getSenders();
      for (const sender of senders) {
        if (sender.track?.kind === "video") {
          const newVideo = newStream.getVideoTracks()[0];
          if (newVideo) sender.replaceTrack(newVideo);
        } else if (sender.track?.kind === "audio") {
          const newAudio = newStream.getAudioTracks()[0];
          if (newAudio) sender.replaceTrack(newAudio);
        }
      }
    }
  }

  /**
   * Replace the local video on every peer's video sender (including senders
   * whose track is currently null, e.g. while the camera is off). Passing
   * null mutes the m-line without stopping transmission; a live track resumes
   * it. No SDP renegotiation is required for track swaps.
   */
  private replaceLocalVideoOnPeers(track: MediaStreamTrack | null) {
    for (const [, runtime] of this.peerRuntimes) {
      for (const transceiver of runtime.pc.getTransceivers()) {
        if (transceiver.receiver?.track?.kind !== "video") continue;
        const dir = transceiver.direction;
        if (dir === "sendonly" || dir === "sendrecv") {
          void transceiver.sender.replaceTrack(track).catch(() => {});
        }
      }
    }
  }

  private emitJoin() {
    this.joinedSocketId = this.localSocketId;
    this.socket.emit("join-meeting", {
      meetingCode: this.config.meetingCode,
      userName: this.config.userName,
      userId: this.config.userId,
      meetingId: this.config.meetingId,
    });
  }

  // ===================== DEV WebRTC diagnostics =====================
  // Temporary runtime instrumentation to diagnose participant-audio
  // stuttering. Active only when import.meta.env.DEV is true; inert in
  // production builds. Does NOT modify tracks, senders, receivers, bitrate,
  // or network configuration.

  private startPeerStats(remoteSocketId: string) {
    if (!DEV_STATS_ENABLED) return;
    if (!import.meta.env.DEV) return;
    if (this.statsTimers.has(remoteSocketId)) return;
    const pc = this.peerRuntimes.get(remoteSocketId)?.pc;
    if (!pc) return;

    const state = {
      timer: 0,
      lastPairId: null as string | null,
      lastInBytes: 0,
      lastOutBytes: 0,
      lastTs: 0,
    };

    const sample = () => {
      void pc.getStats().then((report) => {
        const now = performance.now();
        if (state.lastTs === 0) state.lastTs = now;

        // Transport / candidate-pair
        let pairId: string | null = null;
        let currentRoundTripTime: number | null = null;
        let availableOutgoingBitrate: number | null = null;
        let requestsSent: number | null = null;
        let responsesReceived: number | null = null;
        for (const stats of report.values()) {
          if (stats.type === "transport") {
            const st = stats as RTCStats & { selectedCandidatePairId?: string };
            pairId = st.selectedCandidatePairId ?? null;
          } else if (stats.type === "candidate-pair") {
            const cp = stats as RTCStats &
              RTCIceCandidatePairStats & { selected?: boolean; currentRoundTripTime?: number; availableOutgoingBitrate?: number; requestsSent?: number; responsesReceived?: number };
            if (cp.selected) {
              if (state.lastPairId !== null && pairId !== null && pairId !== state.lastPairId) {
                console.info("[WebRTC STATS] Candidate pair changed", {
                  from: state.lastPairId,
                  to: pairId,
                  socketId: remoteSocketId.slice(-6),
                });
              }
              state.lastPairId = pairId;
              currentRoundTripTime = cp.currentRoundTripTime ?? null;
              availableOutgoingBitrate = cp.availableOutgoingBitrate ?? null;
              requestsSent = cp.requestsSent ?? null;
              responsesReceived = cp.responsesReceived ?? null;
            }
          }
        }

        // Inbound (audio) + Outbound (audio) + codec
        let inAudio: Record<string, unknown> | null = null;
        let outAudio: Record<string, unknown> | null = null;
        const codecs = new Map<string, { mimeType?: string; clockRate?: number; channels?: number; sdpFmtpLine?: string }>();
        for (const stats of report.values()) {
          if (stats.type === "codec") {
            const c = stats as RTCStats & { mimeType?: string; clockRate?: number; channels?: number; sdpFmtpLine?: string };
            codecs.set(c.id, { mimeType: c.mimeType, clockRate: c.clockRate, channels: c.channels, sdpFmtpLine: c.sdpFmtpLine });
          } else if (stats.type === "inbound-rtp") {
            const ir = stats as RTCInboundRtpStreamStats;
            if (ir.kind === "audio") inAudio = { ...stats };
          } else if (stats.type === "outbound-rtp") {
            const or = stats as RTCOutboundRtpStreamStats;
            if (or.kind === "audio") outAudio = { ...stats };
          }
        }

        // Inbound derived values
        const inPacketsReceived = (inAudio?.packetsReceived as number) ?? 0;
        const inPacketsLost = (inAudio?.packetsLost as number) ?? 0;
        const inBytesReceived = (inAudio?.bytesReceived as number) ?? 0;
        const lossPercent =
          inPacketsReceived + inPacketsLost > 0
            ? ((inPacketsLost / (inPacketsReceived + inPacketsLost)) * 100).toFixed(2)
            : "0.00";

        // Outbound bitrate from byte delta
        const outBytesSent = (outAudio?.bytesSent as number) ?? 0;
        let outBitrate = 0;
        const dtMs = now - state.lastTs;
        if (state.lastOutBytes > 0 && dtMs > 0) {
          outBitrate = Math.round(((outBytesSent - state.lastOutBytes) * 8) / (dtMs / 1000));
        }
        state.lastOutBytes = outBytesSent;

        // Inbound bitrate from byte delta
        const byteDeltaIn = inBytesReceived - state.lastInBytes;
        let inBitrate = 0;
        if (state.lastInBytes > 0 && dtMs > 0) {
          inBitrate = Math.round((byteDeltaIn * 8) / (dtMs / 1000));
        }
        state.lastInBytes = inBytesReceived;
        state.lastTs = now;

        const inCodec = inAudio?.codecId ? codecs.get(inAudio.codecId as string) : undefined;
        const outCodec = outAudio?.codecId ? codecs.get(outAudio.codecId as string) : undefined;

        console.debug("[WebRTC STATS]", {
          peer: remoteSocketId.slice(-6),
          connState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState: pc.iceGatheringState,
          pairId: pairId?.slice(-6) ?? null,
          rttMs: currentRoundTripTime !== null ? Math.round(currentRoundTripTime * 1000) : null,
          availableOutgoingBitrate: availableOutgoingBitrate ?? null,
          reqSent: requestsSent ?? null,
          respReceived: responsesReceived ?? null,
          inboundAudio: inAudio
            ? {
                packetsReceived: inPacketsReceived,
                packetsLost: inPacketsLost,
                lossPercent,
                jitter: inAudio.jitter ?? null,
                jitterBufferDelay: inAudio.jitterBufferDelay ?? null,
                jitterBufferEmittedCount: inAudio.jitterBufferEmittedCount ?? null,
                concealedSamples: inAudio.concealedSamples ?? null,
                silentConcealedSamples: inAudio.silentConcealedSamples ?? null,
                totalSamplesReceived: inAudio.totalSamplesReceived ?? null,
                bytesReceived: inBytesReceived,
                bitrate: inBitrate,
                audioLevel: inAudio.audioLevel ?? null,
                codec: inCodec,
              }
            : null,
          outboundAudio: outAudio
            ? {
                packetsSent: outAudio.packetsSent ?? null,
                bytesSent: outBytesSent,
                retransmittedPacketsSent: outAudio.retransmittedPacketsSent ?? null,
                bitrate: outBitrate,
                codec: outCodec,
              }
            : null,
        });
      });
    };

    state.timer = window.setInterval(sample, 1000);
    // Fire once immediately for a baseline.
    sample();
    this.statsTimers.set(remoteSocketId, state);
  }

  private stopPeerStats(remoteSocketId: string) {
    const s = this.statsTimers.get(remoteSocketId);
    if (s) {
      window.clearInterval(s.timer);
      this.statsTimers.delete(remoteSocketId);
    }
  }

  /**
   * Perfect-negotiation tie-break. Both peers run this same code, so comparing
   * socket ids yields a stable answer on both sides: exactly one of them is
   * "polite" and yields (rolls back) if both send offers at the same time.
   */
  private isPolitePeer(remoteSocketId: string): boolean {
    if (!this.localSocketId) return true;
    return this.localSocketId < remoteSocketId;
  }

  private createPeerConnection(remoteSocketId: string, offerer: boolean): PeerRuntime {
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const runtime: PeerRuntime = {
      pc,
      recovery: new PeerRecovery(),
      candidates: new PendingCandidateQueue<RTCIceCandidateInit>(),
      candidateChain: Promise.resolve(),
      hasRemoteDescription: false,
      remoteUfrags: [],
      offerer,
      polite: this.isPolitePeer(remoteSocketId),
      graceTimer: null,
      restartTimer: null,
    };

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => pc.addTrack(track, this.localStream!));
      // When the camera is off there is no live video track to add. Reserve a
      // sendonly video sender so a later camera-on can attach the track via
      // replaceTrack without requiring a renegotiation.
      if (!this.localStream.getVideoTracks()[0]) {
        pc.addTransceiver("video", { direction: "sendonly" });
      }
    }

    pc.onicecandidate = (event) => {
      // A null candidate is the end-of-candidates marker: forward it so the far
      // side can stop waiting for more candidates instead of relying on a
      // timeout.
      this.socket.emit("webrtc-ice-candidate", {
        candidate: event.candidate ? event.candidate.toJSON() : null,
        to: remoteSocketId,
      });
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) this.cb.onRemoteStream(remoteSocketId, stream);
    };

    pc.onconnectionstatechange = () => {
      this.applyRecoveryAction(
        remoteSocketId,
        runtime.recovery.observeConnectionState(pc.connectionState as PeerLinkState),
        runtime,
      );
    };

    pc.oniceconnectionstatechange = () => {
      this.applyRecoveryAction(
        remoteSocketId,
        runtime.recovery.observeIceConnectionState(pc.iceConnectionState as PeerIceState),
        runtime,
      );
    };

    this.peerRuntimes.set(remoteSocketId, runtime);
    this.startPeerStats(remoteSocketId);
    logPeerEvent("peer created", remoteSocketId, { offerer, polite: runtime.polite });
    return runtime;
  }

  /**
   * Perform the recovery decision taken by the peer's state machine. The
   * machine only decides; every side effect (timers, ICE restart, teardown)
   * happens here, and only for the runtime that is still the live peer.
   */
  private applyRecoveryAction(remoteSocketId: string, action: RecoveryAction, runtime: PeerRuntime) {
    if (action.type === "none") {
      // A peer that came back cancels the settle timer of the restart in flight.
      if (runtime.recovery.state === "connected" && runtime.restartTimer) {
        clearTimeout(runtime.restartTimer);
        runtime.restartTimer = null;
      }
      return;
    }
    if (this.destroyed) return;
    if (this.peerRuntimes.get(remoteSocketId) !== runtime) return;

    logPeerEvent(`recovery: ${action.type}`, remoteSocketId, {
      linkState: runtime.recovery.state,
      iceRestarts: runtime.recovery.iceRestarts,
      iceConnectionState: runtime.pc.iceConnectionState,
      queuedCandidates: runtime.candidates.size,
    });

    if (action.type === "await-grace") {
      if (runtime.graceTimer) clearTimeout(runtime.graceTimer);
      runtime.graceTimer = setTimeout(() => {
        runtime.graceTimer = null;
        if (this.destroyed || this.peerRuntimes.get(remoteSocketId) !== runtime) return;
        this.applyRecoveryAction(remoteSocketId, runtime.recovery.onGraceExpired(), runtime);
      }, action.timeoutMs);
      return;
    }

    if (action.type === "restart-ice") {
      if (runtime.graceTimer) {
        clearTimeout(runtime.graceTimer);
        runtime.graceTimer = null;
      }
      void this.restartIce(remoteSocketId, runtime, action.attempt);
      return;
    }

    // give-up: the peer did not recover within the bounded attempt budget and
    // is no longer claimed to be in the meeting.
    this.takeDownRemote(remoteSocketId);
  }

  /**
   * Re-offer with a fresh ICE generation. Bounded by PeerRecovery, so a peer
   * that cannot be reached is abandoned after a few attempts instead of
   * renegotiating forever.
   */
  private async restartIce(remoteSocketId: string, runtime: PeerRuntime, attempt: number) {
    const { pc } = runtime;
    if (this.destroyed || pc.connectionState === "closed") return;

    // Candidates buffered for the previous generation are meaningless now; the
    // new offer will bring its own.
    runtime.candidates.clear();

    try {
      if (runtime.offerer && typeof pc.restartIce === "function") {
        pc.restartIce();
      }
      const offer = await pc.createOffer({ iceRestart: true });
      if (this.destroyed || this.peerRuntimes.get(remoteSocketId) !== runtime) return;
      if (pc.signalingState !== "stable") {
        // A negotiation is already in flight (remote-initiated). Let it finish;
        // the state machine escalates again if this attempt did not help.
        logPeerEvent("ice restart skipped, negotiation in flight", remoteSocketId, {
          attempt,
          signalingState: pc.signalingState,
        });
        return;
      }
      await pc.setLocalDescription(offer);
      this.socket.emit("webrtc-offer", { offer: pc.localDescription ?? offer, to: remoteSocketId });
      logPeerEvent("ice restart offered", remoteSocketId, { attempt, signalingState: pc.signalingState });

      // Only a restart we actually sent is given time to settle; if it does not
      // bring the peer back, spend the next attempt (or give up).
      if (runtime.restartTimer) clearTimeout(runtime.restartTimer);
      runtime.restartTimer = setTimeout(() => {
        runtime.restartTimer = null;
        if (this.destroyed || this.peerRuntimes.get(remoteSocketId) !== runtime) return;
        if (runtime.recovery.state === "connected") return;
        this.applyRecoveryAction(remoteSocketId, runtime.recovery.observeConnectionState("failed"), runtime);
      }, ICE_RESTART_SETTLE_MS);
    } catch (err) {
      logPeerEvent("ice restart failed", remoteSocketId, { attempt, error: String(err) });
    }
  }

  /**
   * Establish the WebRTC offer toward an already-registered remote participant.
   * The participant tile/state is created by the user-joined/existing-participants
   * announcement (with full userId info); this method only sets up the connection.
   */
  private async callUser(remoteSocketId: string) {
    if (this.peerRuntimes.has(remoteSocketId)) return;
    if (this.ignoredRemoteSockets.has(remoteSocketId)) return;

    let runtime: PeerRuntime;
    try {
      runtime = this.createPeerConnection(remoteSocketId, true);
    } catch (err) {
      logPeerEvent("peer creation failed", remoteSocketId, { error: String(err) });
      return;
    }

    try {
      const offer = await runtime.pc.createOffer();
      if (this.peerRuntimes.get(remoteSocketId) !== runtime) return;
      await runtime.pc.setLocalDescription(offer);
      this.socket.emit("webrtc-offer", {
        offer: runtime.pc.localDescription ?? offer,
        to: remoteSocketId,
      });
    } catch (err) {
      logPeerEvent("offer failed", remoteSocketId, { error: String(err) });
    }
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    if (this.destroyed) return;
    if (from === this.localSocketId) return;
    if (this.ignoredRemoteSockets.has(from)) return;

    const existing = this.peerRuntimes.get(from);
    if (existing) {
      // A second offer for a known peer: a renegotiation or an ICE restart.
      await this.answerOffer(from, existing, offer);
      return;
    }

    let runtime: PeerRuntime;
    try {
      runtime = this.createPeerConnection(from, false);
    } catch (err) {
      logPeerEvent("peer creation failed", from, { error: String(err) });
      return;
    }
    await this.answerOffer(from, runtime, offer);
  }

  /**
   * Apply a remote offer and answer it. Also handles glare: if both sides offer
   * at once, the impolite peer ignores the incoming offer and the polite peer
   * rolls back its own local offer first.
   */
  private async answerOffer(from: string, runtime: PeerRuntime, offer: RTCSessionDescriptionInit) {
    const { pc } = runtime;
    if (pc.signalingState !== "stable" && pc.signalingState !== "have-remote-offer") {
      if (runtime.polite) {
        try {
          await pc.setLocalDescription({ type: "rollback" });
          logPeerEvent("rolled back local offer (glare)", from, { signalingState: pc.signalingState });
        } catch (err) {
          logPeerEvent("rollback failed", from, { error: String(err) });
          return;
        }
      } else {
        logPeerEvent("ignored incoming offer (glare)", from, { signalingState: pc.signalingState });
        return;
      }
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      if (this.destroyed || this.peerRuntimes.get(from) !== runtime) return;
      runtime.hasRemoteDescription = true;
      runtime.remoteUfrags = extractIceUfrags(pc.remoteDescription?.sdp);
      await this.flushPendingCandidates(from, runtime);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit("webrtc-answer", { answer: pc.localDescription ?? answer, to: from });
    } catch (err) {
      logPeerEvent("answer failed", from, { error: String(err) });
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const runtime = this.peerRuntimes.get(from);
    if (!runtime) {
      // Answer for an unknown/teardown peer: nothing to apply it to.
      logPeerEvent("answer for unknown peer ignored", from);
      return;
    }

    const { pc } = runtime;
    if (pc.signalingState === "stable" || pc.signalingState === "closed") {
      // Duplicate or late answer (e.g. after an ICE restart already settled).
      logPeerEvent("answer ignored, no pending offer", from, { signalingState: pc.signalingState });
      return;
    }

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
      if (this.destroyed || this.peerRuntimes.get(from) !== runtime) return;
      runtime.hasRemoteDescription = true;
      runtime.remoteUfrags = extractIceUfrags(pc.remoteDescription?.sdp);
      await this.flushPendingCandidates(from, runtime);
    } catch (err) {
      logPeerEvent("answer setRemoteDescription failed", from, { error: String(err) });
    }
  }

  /**
   * Route a remote ICE candidate. Candidates that arrive before the remote
   * description is applied are buffered instead of dropped, because
   * addIceCandidate() rejects them and that silently breaks connectivity on slow
   * or reordered signaling.
   *
   * Exactly one branch applies each candidate: either it is queued (and never
   * added here), or it is added once here. It is never both.
   */
  private handleRemoteCandidate(from: string, candidate: RTCIceCandidateInit | null) {
    const runtime = this.peerRuntimes.get(from);
    if (!runtime) {
      // No peer (teardown, or the offer has not arrived yet): buffering here
      // would be unbounded, so it is intentionally dropped.
      logPeerEvent("candidate for unknown peer ignored", from);
      return;
    }

    // Case A: nothing to add to yet -> queue, do not add. The queue is drained
    // in arrival order by flushPendingCandidates() once the description lands.
    if (!runtime.hasRemoteDescription) {
      const result = runtime.candidates.push(candidate);
      if (result === "dropped") {
        logPeerEvent("candidate buffer full", from, { size: runtime.candidates.size });
      }
      return;
    }

    // Case C/D: the remote description is applied, so the candidate (or the
    // end-of-candidates marker, null) is added exactly once. A candidate from a
    // superseded ICE generation is discarded by addRemoteCandidate() against the
    // currently applied ufrags; queueing it here instead would strand it until
    // an unrelated renegotiation and could evict live candidates.
    runtime.candidateChain = runtime.candidateChain
      .then(() => this.addRemoteCandidate(from, runtime, candidate))
      .catch((err: unknown) => {
        logPeerEvent("candidate rejected", from, { error: String(err) });
      });
  }

  /** Apply every candidate buffered before the remote description, in order. */
  private async flushPendingCandidates(remoteSocketId: string, runtime: PeerRuntime) {
    const { candidates, endOfCandidates } = runtime.candidates.drain();
    if (candidates.length === 0 && !endOfCandidates) return;

    runtime.candidateChain = runtime.candidateChain
      .then(async () => {
        for (const candidate of candidates) {
          try {
            await this.addRemoteCandidate(remoteSocketId, runtime, candidate);
          } catch (err) {
            logPeerEvent("buffered candidate rejected", remoteSocketId, { error: String(err) });
          }
        }
        if (endOfCandidates) {
          try {
            await this.addRemoteCandidate(remoteSocketId, runtime, null);
          } catch {
            // End-of-candidates is advisory; ignore a browser that refuses it.
          }
        }
      })
      .catch(() => {});

    await runtime.candidateChain;
  }

  /**
   * Add one remote candidate, skipping candidates that belong to an ICE
   * generation other than the one currently described (an ICE restart changes
   * the ufrag, and stale candidates would be rejected by the browser).
   */
  private async addRemoteCandidate(
    remoteSocketId: string,
    runtime: PeerRuntime,
    candidate: RTCIceCandidateInit | null,
  ) {
    if (candidate === null) {
      await runtime.pc.addIceCandidate();
      return;
    }
    if (!candidateMatchesUfrags(runtime.remoteUfrags, candidate.usernameFragment)) {
      logPeerEvent("candidate skipped, other ICE generation", remoteSocketId);
      return;
    }
    await runtime.pc.addIceCandidate(new RTCIceCandidate(candidate));
  }

  private removePeer(socketId: string) {
    this.stopPeerStats(socketId);
    const runtime = this.peerRuntimes.get(socketId);
    if (!runtime) return;
    if (runtime.graceTimer) clearTimeout(runtime.graceTimer);
    if (runtime.restartTimer) clearTimeout(runtime.restartTimer);
    runtime.graceTimer = null;
    runtime.restartTimer = null;
    runtime.recovery.close();
    runtime.candidates.clear();
    const { pc } = runtime;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    pc.close();
    this.peerRuntimes.delete(socketId);
  }

  private emitParticipantList() {
    const participants: Participant[] = [];
    for (const [socketId, userName] of this.participantNames) {
      const media = this.remoteMediaStates.get(socketId) ?? { cameraEnabled: true, micEnabled: true };
      participants.push({
        socketId,
        userName,
        stream: null,
        isLocal: socketId === this.localSocketId,
        cameraEnabled: media.cameraEnabled,
        micEnabled: media.micEnabled,
      });
    }
    this.cb.onParticipantList(participants);
  }

  // ===================== Controls =====================

  /** Broadcast this participant's current camera/mic state to the meeting room. */
  private broadcastMediaState() {
    if (!this.joined || !this.localSocketId) return;
    const state = this.getActualMediaState();
    this.socket.emit("toggle-media", {
      cameraOn: state.cameraEnabled,
      micOn: state.micEnabled,
    });
  }

  toggleMic() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) audioTrack.enabled = !audioTrack.enabled;
    }
    const state = this.getActualMediaState();
    this.cb.onMediaState(state);
    this.broadcastMediaState();
    return state.micEnabled;
  }

  /**
   * Toggle the camera on/off. Turning the camera OFF fully releases the
   * physical device: the live video track is stopped (indicator turns off)
   * and every peer's video sender is muted via replaceTrack(null). Turning it
   * ON re-acquires the device with the selected camera and attaches the fresh
   * track to every peer's video sender. Audio tracks are never touched.
   * Returns the resulting cameraEnabled state.
   */
  async toggleCamera(): Promise<boolean> {
    if (this.destroyed) return false;

    const videoTrack = this.localStream?.getVideoTracks()[0];
    const isOn = videoTrack ? videoTrack.enabled && videoTrack.readyState === "live" : false;

    if (isOn && this.localStream) {
      // Camera OFF: stop and remove the track so the device is released, then
      // mute the outgoing video on every peer (no renegotiation needed).
      ++this.toggleCameraSeq;
      this.localStream.removeTrack(videoTrack!);
      videoTrack!.stop();
      videoTrack!.enabled = false;
      this.replaceLocalVideoOnPeers(null);
      const state = this.getActualMediaState();
      this.cb.onMediaState(state);
      if (this.joined) this.broadcastMediaState();
      return state.cameraEnabled;
    }

    // Camera ON: re-acquire the device.
    const seq = ++this.toggleCameraSeq;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: buildVideoConstraints(this.selectedCameraId),
        audio: false,
      });
      // Abort if the session was torn down or a newer toggle superseded this one.
      if (this.destroyed || seq !== this.toggleCameraSeq) {
        stream.getTracks().forEach((t) => t.stop());
        if (this.destroyed) return false;
        return this.getActualMediaState().cameraEnabled;
      }
      const newVideoTrack = stream.getVideoTracks()[0];
      if (!newVideoTrack) {
        stream.getTracks().forEach((t) => t.stop());
        this.cb.onMediaError("No camera available.");
        return false;
      }
      stream.getTracks().forEach((t) => {
        if (t !== newVideoTrack) t.stop();
      });
      newVideoTrack.enabled = true;
      if (this.localStream) {
        this.localStream.addTrack(newVideoTrack);
      } else {
        this.localStream = stream;
      }
      this.replaceLocalVideoOnPeers(newVideoTrack);
      this.cb.onLocalStream(this.localStream);
      this.cb.onMediaState(this.getActualMediaState());
      this.bindTrackEnded(this.localStream);
      if (this.joined) this.broadcastMediaState();
      return true;
    } catch (err) {
      this.cb.onMediaError(friendlyMediaError(err));
      return false;
    }
  }

  // ===================== Cleanup =====================

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.deviceChangeHandler) {
      navigator.mediaDevices.removeEventListener("devicechange", this.deviceChangeHandler);
      this.deviceChangeHandler = null;
    }

    this.socket.off("connect");
    this.socket.off("connect_error");
    this.socket.off("disconnect");
    this.socket.off("existing-participants");
    this.socket.off("user-joined");
    this.socket.off("user-left");
    this.socket.off("webrtc-offer");
    this.socket.off("webrtc-answer");
    this.socket.off("webrtc-ice-candidate");
    this.socket.off("peer-media-toggle");
    this.socket.off("new-message");
    this.socket.off("sign-translation");
    this.socket.off("meeting-ended");

    for (const socketId of [...this.peerRuntimes.keys()]) {
      this.removePeer(socketId);
    }
    for (const socketId of [...this.statsTimers.keys()]) {
      this.stopPeerStats(socketId);
    }
    this.peerRuntimes.clear();
    this.participantNames.clear();
    this.remoteMediaStates.clear();
    this.activeRemoteByUserId.clear();
    this.userIdByRemoteSocket.clear();
    this.ignoredRemoteSockets.clear();
    this.joined = false;
    this.joinedSocketId = null;

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
      this.localStream = null;
    }

    disconnectSocket(this.socket);
  }
}
