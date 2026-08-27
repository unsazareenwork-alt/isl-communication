import type { AuthUser } from "./types";

/**
 * The Socket.IO join-meeting payload requires a `userName` string used to label
 * participants in the call. Signup intentionally collects no name (backend
 * conflict), so we fall back to a display label derived from the email's local
 * part for in-call labelling only — never for the signup request.
 */
export function callerDisplayName(user: AuthUser | null): string {
  const name = user?.user_metadata?.name?.trim();
  if (name) return name;

  const email = user?.email?.trim();
  if (email) {
    const local = email.split("@")[0];
    if (local) return local;
  }
  return "Guest";
}
