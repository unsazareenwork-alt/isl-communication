import { io, type Socket } from "socket.io-client";
import { socketUrl } from "./api";

/**
 * Create a fresh Socket.IO connection to the backend.
 *
 * A meeting session owns its own connection (see MeetingSession). We deliberately
 * do NOT keep a module-level singleton that survives meeting teardown: doing so
 * meant a destroyed session's socket stayed connected to the backend room, and
 * React StrictMode remounts could reuse it and miss the `connect` event.
 *
 * Each session creates (and disconnects) its own socket, so mount → cleanup →
 * remount and "leave then rejoin" always start from a clean, non-connected
 * socket whose `connect` handler will reliably fire.
 */
export function createSocket(): Socket {
  return io(socketUrl(), {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
  });
}

/** Disconnect a socket owned by a meeting session. Safe to call on null. */
export function disconnectSocket(socket: Socket | null | undefined): void {
  socket?.disconnect();
}
