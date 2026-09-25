/**
 * Offline checks for the deterministic WebRTC robustness helpers.
 *
 * Run with the repository's own Node (no test framework, no new dependencies):
 *
 *   node scripts/webrtc-recovery-check.ts
 *
 * Every case below is synchronous and clock-free, so the result is identical on
 * every machine and on every run.
 */

import {
  DEFAULT_MAX_ICE_RESTARTS,
  PeerRecovery,
  PendingCandidateQueue,
  candidateMatchesUfrags,
  extractIceUfrags,
  type RecoveryAction,
} from "../src/lib/webrtcRecovery.ts";

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean): void {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${label}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${label}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** Drive a PeerRecovery through a state sequence and collect the decisions. */
function drive(sequence: Array<Parameters<PeerRecovery["observeConnectionState"]>[0]>) {
  const recovery = new PeerRecovery({ maxIceRestarts: 2, disconnectedGraceMs: 5000 });
  const actions: RecoveryAction[] = sequence.map((state) => recovery.observeConnectionState(state));
  return { recovery, actions };
}

section("PeerRecovery: transient disconnect is absorbed, not fatal");
{
  const { recovery, actions } = drive(["connecting", "connected", "disconnected"]);
  check("disconnected schedules a grace timer", actions[2]?.type === "await-grace");
  check("grace uses the configured timeout", actions[2]?.type === "await-grace" && actions[2].timeoutMs === 5000);
  check("no restart issued before the grace expires", actions[2]?.type === "await-grace" && actions[2].attempt === 0);
  check("link state is disconnected", recovery.state === "disconnected");

  const escalated = recovery.onGraceExpired();
  check("expired grace escalates to an ICE restart", escalated.type === "restart-ice");
  check("restart attempt is the first", escalated.type === "restart-ice" && escalated.attempt === 1);
  check("link state is restarting", recovery.state === "restarting");
}

section("PeerRecovery: recovery refunds the restart budget");
{
  const recovery = new PeerRecovery({ maxIceRestarts: 2, disconnectedGraceMs: 1000 });
  recovery.observeConnectionState("failed");
  recovery.observeConnectionState("connected");
  check("connected resets the restart counter", recovery.iceRestarts === 0);
  check("connected can still recover later", recovery.canRecover);
  check("state is connected", recovery.state === "connected");
}

section("PeerRecovery: restart attempts are bounded");
{
  const recovery = new PeerRecovery({ maxIceRestarts: 2, disconnectedGraceMs: 1000 });
  const first = recovery.observeConnectionState("failed");
  const second = recovery.observeConnectionState("disconnected");
  const third = recovery.onGraceExpired();
  const fourth = recovery.observeConnectionState("failed");
  check("first failure restarts", first.type === "restart-ice" && first.attempt === 1);
  check("second failure restarts", second.type === "await-grace" && second.attempt === 1);
  check("expired grace restarts again", third.type === "restart-ice" && third.attempt === 2);
  check("budget exhausted -> give up", fourth.type === "give-up");
  check("state is failed", recovery.state === "failed");
  check("cannot recover after giving up", !recovery.canRecover);
  const afterwards = recovery.observeConnectionState("failed");
  check("stay given up instead of looping", afterwards.type === "give-up" && recovery.iceRestarts === 2);
}

section("PeerRecovery: ICE failure cannot burn the budget in a burst");
{
  const recovery = new PeerRecovery({ maxIceRestarts: 3, disconnectedGraceMs: 1000 });
  recovery.observeConnectionState("disconnected");
  const first = recovery.onGraceExpired();
  const burst = [
    recovery.observeIceConnectionState("failed"),
    recovery.observeIceConnectionState("failed"),
    recovery.observeIceConnectionState("failed"),
  ];
  check("one grace expiry yields one restart", first.type === "restart-ice" && first.attempt === 1);
  check("no extra restarts while one is in flight", burst.every((a) => a.type === "none"));
  check("restart counter still 1", recovery.iceRestarts === 1);
  const hard = recovery.observeConnectionState("failed");
  check("a hard connection failure still escalates", hard.type === "restart-ice" && hard.attempt === 2);
}

section("PeerRecovery: a closed peer stays closed");
{
  const recovery = new PeerRecovery({ maxIceRestarts: 3, disconnectedGraceMs: 1000 });
  const closed = recovery.observeConnectionState("closed");
  const later = [
    recovery.observeConnectionState("failed"),
    recovery.observeIceConnectionState("failed"),
    recovery.onGraceExpired(),
  ];
  check("closed asks the owner to give up", closed.type === "give-up");
  check("later events are ignored", later.every((a) => a.type === "none"));
  check("state stays closed", recovery.state === "closed");
}

section("PeerRecovery: defaults are bounded");
{
  const recovery = new PeerRecovery();
  check("default restart budget is finite", recovery.maxAttempts === DEFAULT_MAX_ICE_RESTARTS);
  let actions: RecoveryAction[] = [];
  for (let i = 0; i < 12; i += 1) actions.push(recovery.observeConnectionState("failed"));
  check(
    "repeated failures terminate instead of looping",
    actions.filter((a) => a.type === "give-up").length === 12 - DEFAULT_MAX_ICE_RESTARTS,
  );
  check("no restart beyond the budget", actions.filter((a) => a.type === "restart-ice").length === DEFAULT_MAX_ICE_RESTARTS);
  check("last decision is give-up", actions[actions.length - 1]?.type === "give-up");
}

section("PendingCandidateQueue: FIFO drain");
{
  const queue = new PendingCandidateQueue<string>(8);
  queue.push("a");
  queue.push("b");
  queue.push("c");
  check("size tracks arrivals", queue.size === 3);
  const drained = queue.drain();
  check("drains in arrival order", drained.candidates.join(",") === "a,b,c");
  check("no end-of-candidates marker", drained.endOfCandidates === false);
  check("drain empties the queue", queue.size === 0);
  check("drain is repeatable", queue.drain().candidates.length === 0);
}

section("PendingCandidateQueue: bounded memory");
{
  const queue = new PendingCandidateQueue<string>(2);
  queue.push("a");
  queue.push("b");
  queue.push("c");
  check("size never exceeds the limit", queue.size === 2);
  check("overflow is counted", queue.dropped === 1);
  check("freshest candidates are kept", queue.drain().candidates.join(",") === "b,c");

  const tiny = new PendingCandidateQueue<string>(0);
  tiny.push("only");
  check("a zero limit still stores one candidate", tiny.size === 1 && tiny.limit === 1);
}

section("PendingCandidateQueue: end-of-candidates marker");
{
  const queue = new PendingCandidateQueue<{ candidate: string }>(4);
  check("null is end-of-candidates", queue.push(null) === "end-of-candidates");
  check("undefined is end-of-candidates", queue.push(undefined) === "end-of-candidates");
  check("empty candidate string is end-of-candidates", queue.push({ candidate: "" }) === "end-of-candidates");
  check("blank candidate string is end-of-candidates", queue.push({ candidate: "   " }) === "end-of-candidates");
  check("marker is remembered", queue.sawEndOfCandidates);
  check("markers are not buffered", queue.size === 0);
  const drained = queue.drain();
  check("drain reports the marker", drained.endOfCandidates === true);
  check("marker is consumed", queue.sawEndOfCandidates === false);

  queue.push({ candidate: "candidate:1 1 udp" });
  queue.push(null);
  check("marker arriving after candidates is kept", queue.drain().endOfCandidates === true);

  queue.push({ candidate: "candidate:1 1 udp" });
  queue.clear();
  check("clear drops candidates and marker", queue.size === 0 && !queue.sawEndOfCandidates);
}

section("ICE ufrag scoping across an ICE restart");
{
  const sdp = [
    "v=0",
    "a=ice-ufrag:9ZxQ",
    "m=video 9 UDP/TLS/RTP/SAVPF 96",
    "a=ice-ufrag:9ZxQ",
    "a=ice-pwd:abc",
    "m=audio 9 UDP/TLS/RTP/SAVPF 111",
    "a=ice-ufrag:9ZxQ",
    "a=ice-pwd:abc",
  ].join("\r\n");
  const ufrags = extractIceUfrags(sdp);
  check("one ufrag for a multi-m-line offer", ufrags.length === 1 && ufrags[0] === "9ZxQ");
  check("empty sdp yields no ufrags", extractIceUfrags("").length === 0);
  check("null sdp yields no ufrags", extractIceUfrags(null).length === 0);
  check("sdp without ice-ufrag yields no ufrags", extractIceUfrags("v=0\r\n").length === 0);

  const mixed = extractIceUfrags("a=ice-ufrag:one\r\na=ice-ufrag:two\r\n");
  check("differing ufrags are all kept", mixed.length === 2 && mixed.includes("one") && mixed.includes("two"));

  check("matching ufrag is accepted", candidateMatchesUfrags(ufrags, "9ZxQ"));
  check("stale ufrag is rejected", !candidateMatchesUfrags(ufrags, "OLD1"));
  check("candidate without ufrag is accepted", candidateMatchesUfrags(ufrags, undefined));
  check("unknown remote ufrag defers to the browser", candidateMatchesUfrags([], "9ZxQ"));
}

section("Candidate routing: queue before the description, add exactly once after");
{
  // Mirrors handleRemoteCandidate / addRemoteCandidate / flushPendingCandidates
  // with the same branch structure as the session, so the "queued but also
  // added" and "stale candidate stranded in the queue" defects cannot come back.
  interface Cand {
    candidate: string;
    usernameFragment?: string;
  }
  const queue = new PendingCandidateQueue<Cand>(8);
  const added: string[] = [];
  let hasRemoteDescription = false;
  let appliedUfrags: string[] = [];
  let endOfCandidatesApplied = 0;

  const tryAdd = (candidate: Cand | null): void => {
    if (candidate === null) {
      endOfCandidatesApplied += 1;
      return;
    }
    if (!candidateMatchesUfrags(appliedUfrags, candidate.usernameFragment)) return;
    added.push(candidate.candidate);
  };

  // handleRemoteCandidate: queue + return, or add once. Never both.
  const route = (candidate: Cand | null): void => {
    if (!hasRemoteDescription) {
      queue.push(candidate);
      return;
    }
    tryAdd(candidate);
  };

  // setRemoteDescription + flushPendingCandidates
  const applyRemoteDescription = (sdp: string): void => {
    hasRemoteDescription = true;
    appliedUfrags = extractIceUfrags(sdp);
    const { candidates, endOfCandidates } = queue.drain();
    for (const candidate of candidates) tryAdd(candidate);
    if (endOfCandidates) tryAdd(null);
  };

  // A: candidates before the description.
  route({ candidate: "a", usernameFragment: "gen1" });
  route({ candidate: "b", usernameFragment: "gen1" });
  route({ candidate: "c", usernameFragment: "gen1" });
  route(null);
  check("pre-SDP candidates are queued, not added", queue.size === 3 && added.length === 0);
  check("pre-SDP end-of-candidates is only a marker", queue.sawEndOfCandidates && endOfCandidatesApplied === 0);

  // B: the description lands and the queue is flushed in order, once each.
  applyRemoteDescription("a=ice-ufrag:gen1\r\n");
  check("queued candidates flush in FIFO order", added.join(",") === "a,b,c");
  check("each queued candidate is added exactly once", new Set(added).size === added.length);
  check("queue is emptied by the flush", queue.size === 0 && !queue.sawEndOfCandidates);
  check("end-of-candidates applied exactly once", endOfCandidatesApplied === 1);

  // C: candidate after the description is added immediately.
  route({ candidate: "d", usernameFragment: "gen1" });
  check("post-SDP candidate is added immediately", added.join(",") === "a,b,c,d");
  check("post-SDP candidate is not queued", queue.size === 0);

  // Stale generation: filtered, never buffered, never applied.
  route({ candidate: "stale", usernameFragment: "gen0" });
  check("stale candidate is not added", !added.includes("stale"));
  check("stale candidate is not stranded in the queue", queue.size === 0);

  // Restart: candidates buffered before the new description belong to a
  // superseded generation and must be dropped at flush time, not applied.
  const restartQueue = new PendingCandidateQueue<Cand>(8);
  restartQueue.push({ candidate: "old", usernameFragment: "gen1" });
  restartQueue.push({ candidate: "fresh", usernameFragment: "gen2" });
  appliedUfrags = extractIceUfrags("a=ice-ufrag:gen2\r\n");
  const restartDrain = restartQueue.drain();
  const restartApplied: string[] = [];
  for (const candidate of restartDrain.candidates) {
    if (candidateMatchesUfrags(appliedUfrags, candidate.usernameFragment)) restartApplied.push(candidate.candidate);
  }
  check("superseded candidate is dropped at flush", restartApplied.join(",") === "fresh");
  check("flush consumed the buffer either way", restartQueue.size === 0);
}

console.log(
  `\n${failures === 0 ? "PASS" : "FAIL"} - ${checks - failures}/${checks} checks passed`,
);
process.exit(failures === 0 ? 0 : 1);
