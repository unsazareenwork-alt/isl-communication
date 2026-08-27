import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { login as loginRequest, signup as signupRequest } from "../lib/auth";
import type { AuthUser } from "../lib/types";

const TOKEN_KEY = "isl.auth.token";
const USER_KEY = "isl.auth.user";

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => void;
  handleUnauthorized: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

function readStoredSession(): { token: string | null; user: AuthUser | null } {
  let token: string | null = null;
  let user: AuthUser | null = null;
  try {
    token = window.sessionStorage.getItem(TOKEN_KEY);
    const rawUser = window.sessionStorage.getItem(USER_KEY);
    user = rawUser ? (JSON.parse(rawUser) as AuthUser) : null;
  } catch {
    token = null;
    user = null;
  }
  return { token, user };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [{ token, user }, setSession] = useState(readStoredSession);

  const persist = useCallback((nextToken: string, nextUser: AuthUser) => {
    window.sessionStorage.setItem(TOKEN_KEY, nextToken);
    window.sessionStorage.setItem(USER_KEY, JSON.stringify(nextUser));
    setSession({ token: nextToken, user: nextUser });
  }, []);

  const logout = useCallback(() => {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(USER_KEY);
    setSession({ token: null, user: null });
  }, []);

  const handleUnauthorized = useCallback(() => {
    logout();
  }, [logout]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await loginRequest({ email, password }, handleUnauthorized);
      persist(res.session.access_token, res.user);
    },
    [persist, handleUnauthorized],
  );

  const signup = useCallback(
    async (email: string, password: string) => {
      // Email + password only; known backend conflict surfaces its own 400.
      const res = await signupRequest({ email, password }, handleUnauthorized);
      persist(res.session.access_token, res.user);
    },
    [persist, handleUnauthorized],
  );

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token && user),
      login,
      signup,
      logout,
      handleUnauthorized,
    }),
    [token, user, login, signup, logout, handleUnauthorized],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return ctx;
}
