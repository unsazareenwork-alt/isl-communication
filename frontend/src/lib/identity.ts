import type { AuthUser } from "./types";

/**
 * The Socket.IO join-meeting payload requires a `userName` string used to label
 * participants in the call.
 *
 * Resolution order:
 *  1. A name present on the auth metadata (signup name).
 *  2. A display label derived from the email's local part — used only as a
 *     temporary in-call fallback label.
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
