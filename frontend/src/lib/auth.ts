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

export interface SignupInput {
  name: string;
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
 * Create an account with name, email, and password.
 */
export async function signup(input: SignupInput, onUnauthorized?: () => void): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/signup", {
    method: "POST",
    body: input,
    onUnauthorized,
  });
}
