import type { Socket } from "socket.io-client";
import { createSocket, disconnectSocket } from "./socket";
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

// DEV-only WebRTC diagnostics master switch. Set to false to temporarily
// disable the getStats sampler for regression isolation, keeping all other
// WebRTC behavior unchanged.
const DEV_STATS_ENABLED = false;

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
  private peers = new Map<string, RTCPeerConnection>();
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

    s.on("user-left", (data: { socketId: string; userName: string }) => {
      // Guard: if this socket is no longer the active connection for its user,
      // a stale user-left (for a replaced old socket) must not remove the newer one.
      const userId = this.userIdByRemoteSocket.get(data.socketId);
      if (userId && this.activeRemoteByUserId.get(userId) !== data.socketId) return;
      this.takeDownRemote(data.socketId);
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

    s.on("webrtc-offer", async (data: { offer: RTCSessionDescriptionInit; from: string }) => {
      await this.handleOffer(data.from, data.offer);
    });

    s.on("webrtc-answer", async (data: { answer: RTCSessionDescriptionInit; from: string }) => {
      const pc = this.peers.get(data.from);
      if (pc && pc.signalingState !== "stable") {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        } catch (err) {
          console.error("Answer setRemoteDescription failed:", err);
        }
      }
    });

    s.on("webrtc-ice-candidate", async (data: { candidate: RTCIceCandidateInit; from: string }) => {
      const pc = this.peers.get(data.from);
      if (pc && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (err) {
          console.error("ICE candidate failed:", err);
        }
      }
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
   */
  private async handleConnect() {
    if (this.destroyed) return;
    this.localSocketId = this.socket.id ?? null;
    if (this.localSocketId) this.cb.onLocalSocketId(this.localSocketId);

    if (this.joined) return;

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
    for (const [, pc] of this.peers) {
      const senders = pc.getSenders();
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
    for (const [, pc] of this.peers) {
      for (const transceiver of pc.getTransceivers()) {
        if (transceiver.receiver?.track?.kind !== "video") continue;
        const dir = transceiver.direction;
        if (dir === "sendonly" || dir === "sendrecv") {
          void transceiver.sender.replaceTrack(track).catch(() => {});
        }
      }
    }
  }

  private emitJoin() {
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
    const pc = this.peers.get(remoteSocketId);
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

  private createPeerConnection(remoteSocketId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);

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
      if (event.candidate) {
        this.socket.emit("webrtc-ice-candidate", { candidate: event.candidate, to: remoteSocketId });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) this.cb.onRemoteStream(remoteSocketId, stream);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" || state === "closed") {
        this.takeDownRemote(remoteSocketId);
      }
    };

    this.peers.set(remoteSocketId, pc);
    this.startPeerStats(remoteSocketId);
    return pc;
  }

  /**
   * Establish the WebRTC offer toward an already-registered remote participant.
   * The participant tile/state is created by the user-joined/existing-participants
   * announcement (with full userId info); this method only sets up the connection.
   */
  private async callUser(remoteSocketId: string) {
    if (this.peers.has(remoteSocketId)) return;
    if (this.ignoredRemoteSockets.has(remoteSocketId)) return;

    const pc = this.createPeerConnection(remoteSocketId);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit("webrtc-offer", { offer, to: remoteSocketId });
    } catch (err) {
      console.error("Offer failed:", err);
    }
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    if (from === this.localSocketId) return;
    if (this.ignoredRemoteSockets.has(from)) return;
    if (this.peers.has(from)) return;

    const pc = this.createPeerConnection(from);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit("webrtc-answer", { answer, to: from });
    } catch (err) {
      console.error("Answer failed:", err);
    }
  }

  private removePeer(socketId: string) {
    this.stopPeerStats(socketId);
    const pc = this.peers.get(socketId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      this.peers.delete(socketId);
    }
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

    for (const pc of this.peers.values()) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
    }
    for (const socketId of [...this.statsTimers.keys()]) {
      this.stopPeerStats(socketId);
    }
    this.peers.clear();
    this.participantNames.clear();
    this.remoteMediaStates.clear();
    this.activeRemoteByUserId.clear();
    this.userIdByRemoteSocket.clear();
    this.ignoredRemoteSockets.clear();

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
