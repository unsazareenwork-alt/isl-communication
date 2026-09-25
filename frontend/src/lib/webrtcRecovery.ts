/**
 * Deterministic, framework-free WebRTC robustness helpers.
 *
 * Everything in this module is pure: no timers, no sockets, no `RTC*` objects
 * and no browser globals are touched. The owner (MeetingSession) owns the clock
 * and performs the side effects, which keeps the tricky parts of the peer
 * lifecycle - candidate buffering and failure recovery - verifiable without a
 * browser or two real machines.
 *
 * See `scripts/webrtc-recovery-check.ts` for the offline checks.
 */

export const DEFAULT_MAX_ICE_RESTARTS = 3;
export const DEFAULT_DISCONNECTED_GRACE_MS = 8000;
export const DEFAULT_MAX_PENDING_CANDIDATES = 64;

/** Mirrors RTCPeerConnection.connectionState. */
export type PeerLinkState =
  | "new"
  | "connecting"
  | "connected"
  | "disconnected"
  | "restarting"
  | "failed"
  | "closed";

/** Mirrors RTCPeerConnection.iceConnectionState. */
export type PeerIceState =
  | "new"
  | "checking"
  | "connected"
  | "completed"
  | "disconnected"
  | "failed"
  | "closed";

/**
 * What the owner must do next. The state machine never performs the action
 * itself, so the same input sequence always yields the same decision sequence
 * and nothing can recurse behind the owner's back.
 */
export type RecoveryAction =
  | { readonly type: "none" }
  | { readonly type: "await-grace"; readonly timeoutMs: number; readonly attempt: number }
  | { readonly type: "restart-ice"; readonly attempt: number }
  | { readonly type: "give-up" };

export interface PeerRecoveryOptions {
  /** Maximum number of ICE restarts before the peer is abandoned. */
  maxIceRestarts?: number;
  /** How long a transient `disconnected` may last before escalating. */
  disconnectedGraceMs?: number;
}

const NO_ACTION: RecoveryAction = { type: "none" };
const GIVE_UP: RecoveryAction = { type: "give-up" };

/**
 * Bounded recovery for a single peer connection.
 *
 * A peer is only abandoned after `maxIceRestarts` exhausted attempts, so a
 * transient network blip is absorbed (grace period + ICE restart) while a peer
 * that is genuinely gone - or whose NAT can never be traversed - stops retrying
 * instead of looping forever.
 */
export class PeerRecovery {
  state: PeerLinkState = "new";
  /** How many ICE restarts have been issued for the current link. */
  iceRestarts = 0;

  private readonly maxIceRestarts: number;
  private readonly disconnectedGraceMs: number;

  constructor(options: PeerRecoveryOptions = {}) {
    const maxRestarts = options.maxIceRestarts ?? DEFAULT_MAX_ICE_RESTARTS;
    const grace = options.disconnectedGraceMs ?? DEFAULT_DISCONNECTED_GRACE_MS;
    this.maxIceRestarts = Math.max(0, Math.floor(maxRestarts));
    this.disconnectedGraceMs = Math.max(0, Math.floor(grace));
  }

  get canRecover(): boolean {
    return this.iceRestarts < this.maxIceRestarts;
  }

  get maxAttempts(): number {
    return this.maxIceRestarts;
  }

  get graceMs(): number {
    return this.disconnectedGraceMs;
  }

  /** Feed an observed RTCPeerConnection.connectionState. */
  observeConnectionState(state: PeerLinkState): RecoveryAction {
    if (this.state === "closed") return NO_ACTION;

    switch (state) {
      case "closed":
        this.state = "closed";
        return GIVE_UP;
      case "connected":
        // A recovered link earns a fresh restart budget; otherwise a long call
        // would eventually be abandoned by a single later hiccup.
        this.state = "connected";
        this.iceRestarts = 0;
        return NO_ACTION;
      case "new":
      case "connecting":
        if (this.state !== "restarting") this.state = "connecting";
        return NO_ACTION;
      case "disconnected":
        this.state = "disconnected";
        return this.awaitGraceOrGiveUp();
      case "restarting":
        this.state = "restarting";
        return NO_ACTION;
      case "failed":
        return this.beginRestart();
    }
  }

  /**
   * Feed an observed RTCPeerConnection.iceConnectionState. Only a hard ICE
   * failure escalates; it is ignored while a restart is already in flight so a
   * burst of ICE events cannot burn the whole restart budget at once.
   */
  observeIceConnectionState(state: PeerIceState): RecoveryAction {
    if (state !== "failed") return NO_ACTION;
    if (this.state === "closed" || this.state === "failed" || this.state === "restarting") {
      return NO_ACTION;
    }
    return this.beginRestart();
  }

  /** Called by the owner when the disconnected grace timer expires. */
  onGraceExpired(): RecoveryAction {
    if (this.state !== "disconnected") return NO_ACTION;
    return this.beginRestart();
  }

  /** Called by the owner when the peer is removed: no further recovery. */
  close(): void {
    this.state = "closed";
  }

  private beginRestart(): RecoveryAction {
    if (!this.canRecover) {
      this.state = "failed";
      return GIVE_UP;
    }
    this.iceRestarts += 1;
    this.state = "restarting";
    return { type: "restart-ice", attempt: this.iceRestarts };
  }

  private awaitGraceOrGiveUp(): RecoveryAction {
    if (!this.canRecover) {
      this.state = "failed";
      return GIVE_UP;
    }
    return { type: "await-grace", timeoutMs: this.disconnectedGraceMs, attempt: this.iceRestarts };
  }
}

export type CandidateQueueResult = "queued" | "end-of-candidates" | "dropped";

export interface CandidateDrain<T> {
  candidates: T[];
  endOfCandidates: boolean;
}

/**
 * FIFO buffer for remote ICE candidates that arrive before their peer's remote
 * description.
 *
 * `addIceCandidate()` rejects candidates received before `setRemoteDescription()`
 * completes, so dropping them loses connectivity on slow/turbulent networks.
 * The buffer is bounded: a peer that never completes negotiation cannot make the
 * tab grow without limit.
 */
export class PendingCandidateQueue<T = RTCIceCandidateInit> {
  private items: T[] = [];
  private endOfCandidates = false;
  private droppedCount = 0;
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_PENDING_CANDIDATES) {
    this.maxSize = Math.max(1, Math.floor(maxSize));
  }

  get size(): number {
    return this.items.length;
  }

  /** How many candidates were discarded because the buffer was full. */
  get dropped(): number {
    return this.droppedCount;
  }

  get sawEndOfCandidates(): boolean {
    return this.endOfCandidates;
  }

  get limit(): number {
    return this.maxSize;
  }

  /**
   * Buffer one candidate. `null`/`undefined`/an empty `candidate` string is the
   * end-of-candidates marker and is remembered rather than buffered.
   */
  push(candidate: T | null | undefined): CandidateQueueResult {
    if (candidate === null || candidate === undefined || isEmptyCandidate(candidate)) {
      this.endOfCandidates = true;
      return "end-of-candidates";
    }
    if (this.items.length >= this.maxSize) {
      // Keep the freshest candidates: an early one is the least likely to pair.
      this.items.shift();
      this.droppedCount += 1;
    }
    this.items.push(candidate);
    return "queued";
  }

  /** Take everything buffered, in arrival order, and reset the buffer. */
  drain(): CandidateDrain<T> {
    const candidates = this.items;
    const endOfCandidates = this.endOfCandidates;
    this.items = [];
    this.endOfCandidates = false;
    return { candidates, endOfCandidates };
  }

  clear(): void {
    this.items = [];
    this.endOfCandidates = false;
  }
}

function isEmptyCandidate(candidate: unknown): boolean {
  if (typeof candidate !== "object" || candidate === null) return false;
  const raw = (candidate as { candidate?: unknown }).candidate;
  return typeof raw === "string" && raw.trim() === "";
}

/**
 * Collect the `a=ice-ufrag` values of a remote SDP.
 *
 * ICE candidates are scoped to the ufrag of the description they belong to, so
 * after an ICE restart the ufrag changes and candidates from the previous
 * generation must not be added to the new description.
 */
export function extractIceUfrags(sdp: string | null | undefined): string[] {
  if (!sdp) return [];
  const ufrags: string[] = [];
  const pattern = /^a=ice-ufrag:(.+)$/gm;
  let match: RegExpExecArray | null = pattern.exec(sdp);
  while (match !== null) {
    const value = match[1].trim();
    if (value && !ufrags.includes(value)) ufrags.push(value);
    match = pattern.exec(sdp);
  }
  return ufrags;
}

/**
 * Whether a candidate may be added to a remote description carrying
 * `remoteUfrags`. Unknown ufrags on either side are allowed through so the
 * browser remains the final authority.
 */
export function candidateMatchesUfrags(
  remoteUfrags: readonly string[],
  candidateUfrag: string | null | undefined,
): boolean {
  if (typeof candidateUfrag !== "string" || candidateUfrag === "") return true;
  if (remoteUfrags.length === 0) return true;
  return remoteUfrags.includes(candidateUfrag);
}
