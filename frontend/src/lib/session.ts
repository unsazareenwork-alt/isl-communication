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
}

export interface MediaState {
  micEnabled: boolean;
  cameraEnabled: boolean;
}

export interface SessionCallbacks {
  onLocalSocketId: (socketId: string) => void;
  onLocalStream: (stream: MediaStream) => void;
  onMediaState: (state: MediaState) => void;
  onMediaError: (message: string | null) => void;
  onParticipantList: (tiles: RemoteTile[]) => void;
  onParticipantJoined: (p: { socketId: string; userName: string }) => void;
  onParticipantLeft: (socketId: string) => void;
  onRemoteStream: (socketId: string, stream: MediaStream | null) => void;
  onMessage: (message: Message) => void;
  onCaption: (message: Message) => void;
  onDisconnected: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:openrelay.metered.ca:80" },
    { urls: "turn:openrelay.metered.ca:80", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443", username: "openrelayproject", credential: "openrelayproject" },
    { urls: "turn:openrelay.metered.ca:443?transport=tcp", username: "openrelayproject", credential: "openrelayproject" },
  ],
};

const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: true,
};

function friendlyMediaError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Camera or microphone access was denied. Please allow permissions and try again.";
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

/**
 * Manages one meeting session: Socket.IO signaling + mesh WebRTC.
 *
 * This ports the signalling behavior from backend/webrtc-group-test.html:
 * one RTCPeerConnection per remote participant, the incoming participant
 * initiates calls to everyone already present, and ICE candidates are
 * relayed through the server. No SFU — plain peer-to-peer mesh.
 */
export class MeetingSession {
  private socket: Socket;
  private config: SessionConfig;
  private cb: SessionCallbacks;

  private localStream: MediaStream | null = null;
  private peers = new Map<string, RTCPeerConnection>();
  private participantNames = new Map<string, string>();
  private localSocketId: string | null = null;
  private micEnabled = true;
  private cameraEnabled = true;
  private destroyed = false;
  private hasJoined = false;

  constructor(config: SessionConfig, callbacks: SessionCallbacks) {
    this.config = config;
    this.cb = callbacks;
    // Each meeting session owns its own Socket.IO connection so that session
    // teardown (leave, unmount, StrictMode cleanup, 401 redirect) fully
    // disconnects it and never leaves a ghost in a meeting room.
    this.socket = createSocket();
    this.attachSocketHandlers();

    // The socket can already be connected when session logic starts (e.g. the
    // connect event fired while reconnecting). If so, initialize immediately
    // instead of waiting for a connect event that will not fire again.
    if (this.socket.connected) {
      void this.handleConnect();
    }
  }

  private attachSocketHandlers() {
    const s = this.socket;

    s.on("connect", () => this.handleConnect());
    s.on("connect_error", () => {
      // WebRTC can still function; surface a soft notice once connection succeeds.
    });
    s.on("disconnect", (reason) => {
      if (this.destroyed) return;
      if (reason === "io client disconnect") return;
      this.cb.onDisconnected();
    });

    s.on("existing-participants", (participants: { socketId: string; userName: string }[]) => {
      participants.forEach((p) => {
        this.participantNames.set(p.socketId, p.userName);
        this.cb.onParticipantJoined(p);
      });
      // The incoming participant initiates calls to everyone already here.
      participants.forEach((p) => this.callUser(p.socketId, p.userName));
      this.emitParticipantList();
    });

    s.on("user-joined", (data: { socketId: string; userName: string }) => {
      this.participantNames.set(data.socketId, data.userName);
      this.cb.onParticipantJoined(data);
      this.emitParticipantList();
    });

    s.on("user-left", (data: { socketId: string; userName: string }) => {
      this.removePeer(data.socketId);
      this.participantNames.delete(data.socketId);
      this.cb.onParticipantLeft(data.socketId);
      this.emitParticipantList();
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

    // Chat uses the persisted flow (POST /api/messages -> new-message). The
    // backend also has a "send-message"/"receive-message" socket relay, but we
    // intentionally rely on the persisted + broadcast path only.
    s.on("new-message", (message: Message) => {
      this.cb.onMessage(message);
    });

    s.on("sign-translation", (message: Message) => {
      this.cb.onCaption(message);
    });
  }

  private async handleConnect() {
    if (this.destroyed) return;
    this.localSocketId = this.socket.id ?? null;
    if (this.localSocketId) {
      this.cb.onLocalSocketId(this.localSocketId);
    }

    // Reconnect after an established session: we've already joined the room.
    if (this.hasJoined) return;

    // Try to start local media. If unavailable (denied/busy/no device), fall
    // back to joining without media rather than trapping the user before the
    // meeting: remote video/captions/chat still work, and they can retry.
    try {
      const stream = await navigator.mediaDevices.getUserMedia(DEFAULT_CONSTRAINTS);
      if (this.destroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      this.localStream = stream;
      this.cb.onLocalStream(stream);
    } catch (err) {
      this.cb.onMediaError(friendlyMediaError(err));
    }

    this.hasJoined = true;
    this.emitJoin();
  }

  /**
   * Re-attempt local camera/mic. Used when initial media acquisition failed so
   * the user can join the media after entering the meeting.
   */
  async retryMedia(): Promise<MediaStream | null> {
    if (this.destroyed) return null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(DEFAULT_CONSTRAINTS);
      if (this.destroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return null;
      }
      this.localStream = stream;
      this.cb.onLocalStream(stream);
      this.cb.onMediaError(null);
      return stream;
    } catch (err) {
      this.cb.onMediaError(friendlyMediaError(err));
      return null;
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

  private createPeerConnection(remoteSocketId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localStream!);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit("webrtc-ice-candidate", {
          candidate: event.candidate,
          to: remoteSocketId,
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) {
        this.cb.onRemoteStream(remoteSocketId, stream);
      }
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" || state === "closed") {
        this.removePeer(remoteSocketId);
        this.participantNames.delete(remoteSocketId);
        this.cb.onParticipantLeft(remoteSocketId);
        this.emitParticipantList();
      }
    };

    this.peers.set(remoteSocketId, pc);
    return pc;
  }

  private async callUser(remoteSocketId: string, remoteUserName: string) {
    if (this.peers.has(remoteSocketId)) return;
    this.participantNames.set(remoteSocketId, remoteUserName);
    this.cb.onParticipantJoined({ socketId: remoteSocketId, userName: remoteUserName });
    this.emitParticipantList();

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
    // Never answer our own offer.
    if (from === this.localSocketId) return;
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
    const pc = this.peers.get(socketId);
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
      this.peers.delete(socketId);
    }
  }

  private emitParticipantList() {
    const tiles: RemoteTile[] = [];
    const ownId = this.localSocketId;
    for (const [socketId, userName] of this.participantNames) {
      if (socketId === ownId) continue;
      tiles.push({ socketId, userName, stream: null });
    }
    this.cb.onParticipantList(tiles);
  }

  // ---- Controls ----

  toggleMic() {
    this.micEnabled = !this.micEnabled;
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach((t) => (t.enabled = this.micEnabled));
    }
    this.cb.onMediaState({ micEnabled: this.micEnabled, cameraEnabled: this.cameraEnabled });
    return this.micEnabled;
  }

  toggleCamera() {
    this.cameraEnabled = !this.cameraEnabled;
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach((t) => (t.enabled = this.cameraEnabled));
    }
    this.cb.onMediaState({ micEnabled: this.micEnabled, cameraEnabled: this.cameraEnabled });
    return this.cameraEnabled;
  }

  // ---- Cleanup ----

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    this.socket.off("connect");
    this.socket.off("connect_error");
    this.socket.off("disconnect");
    this.socket.off("existing-participants");
    this.socket.off("user-joined");
    this.socket.off("user-left");
    this.socket.off("webrtc-offer");
    this.socket.off("webrtc-answer");
    this.socket.off("webrtc-ice-candidate");
    this.socket.off("new-message");
    this.socket.off("sign-translation");

    for (const pc of this.peers.values()) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.close();
    }
    this.peers.clear();
    this.participantNames.clear();

    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }

    // Release the socket connection so no ghost remains subscribed to the
    // meeting room and no handler survives into a future session.
    disconnectSocket(this.socket);
  }
}
