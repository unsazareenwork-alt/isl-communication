import { request } from "./api";
import type { AuthUser, Session } from "./types";

export interface AuthResponse {
  message: string;
  user: AuthUser;
  session: Session;
}

export interface LoginInput {
  email: string;
  password: string;
}

/**
 * Sign in with email + password.
 */
export async function login(input: LoginInput, onUnauthorized?: () => void): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: input,
    onUnauthorized,
  });
}

/**
 * Create an account with email + password ONLY.
 *
 * NOTE — Known integration conflict (unresolved):
 * The backend `POST /api/auth/signup` currently requires an `email`, `password`,
 * AND a `name` field (backend/routes/auth.js). The product spec for this frontend
 * deliberately exposes only email + password and does NOT derive, generate, hide,
 * or fabricate a name. We therefore submit only `{ email, password }`.
 *
 * As a result, signup will fail with a 400 from the backend while the `name`
 * requirement remains in place. That backend error is surfaced to the user as-is;
 * we intentionally do NOT paper over it with a fake name or workaround.
 */
export async function signup(input: LoginInput, onUnauthorized?: () => void): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: input,
    onUnauthorized,
  });
}
