import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, useState } from "react";
import { login as loginRequest, signup as signupRequest } from "../lib/auth";
import type { AuthUser } from "../lib/types";

const TOKEN_KEY = "isl.auth.token";
const USER_KEY = "isl.auth.user";
const PERSIST_KEY = "isl.auth.persist";

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (email: string, password: string, remember?: boolean) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  handleUnauthorized: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const mountStore = {
  mounted: false,
  listeners: new Set<() => void>(),
};

function subscribeMount(cb: () => void) {
  mountStore.listeners.add(cb);
  return () => {
    mountStore.listeners.delete(cb);
  };
}

function getMountSnapshot() {
  return mountStore.mounted;
}

function getServerMountSnapshot() {
  return false;
}

interface StoredSession {
  token: string | null;
  user: AuthUser | null;
}

function readSessionFromStorage(getItem: (key: string) => string | null): StoredSession {
  try {
    const token = getItem(TOKEN_KEY);
    const rawUser = getItem(USER_KEY);
    const user = rawUser ? (JSON.parse(rawUser) as AuthUser) : null;
    return { token: token ?? null, user };
  } catch {
    return { token: null, user: null };
  }
}

function readPersistent(): StoredSession {
  try {
    const raw = window.localStorage.getItem(PERSIST_KEY);
    if (!raw) return { token: null, user: null };
    const parsed = JSON.parse(raw) as StoredSession;
    if (typeof parsed.token !== "string" || !parsed.user || typeof parsed.user.id !== "string") {
      window.localStorage.removeItem(PERSIST_KEY);
      return { token: null, user: null };
    }
    return { token: parsed.token, user: parsed.user };
  } catch {
    window.localStorage.removeItem(PERSIST_KEY);
    return { token: null, user: null };
  }
}

function readStoredSession(): StoredSession {
  const persistent = readPersistent();
  if (persistent.token && persistent.user) return persistent;
  return readSessionFromStorage(window.sessionStorage.getItem.bind(window.sessionStorage));
}

function writeSessionStorage(token: string, user: AuthUser) {
  window.sessionStorage.setItem(TOKEN_KEY, token);
  window.sessionStorage.setItem(USER_KEY, JSON.stringify(user));
}

function writePersistent(token: string, user: AuthUser) {
  window.localStorage.setItem(PERSIST_KEY, JSON.stringify({ token, user }));
}

function clearSessionStorage() {
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(USER_KEY);
}

function clearPersistent() {
  window.localStorage.removeItem(PERSIST_KEY);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [{ token, user }, setSession] = useState(readStoredSession);
  const mounted = useSyncExternalStore(subscribeMount, getMountSnapshot, getServerMountSnapshot);

  useEffect(() => {
    mountStore.mounted = true;
    mountStore.listeners.forEach((fn) => fn());
  }, []);

  const persist = useCallback(
    (nextToken: string, nextUser: AuthUser, remember = false) => {
      writeSessionStorage(nextToken, nextUser);
      if (remember) writePersistent(nextToken, nextUser);
      else clearPersistent();
      setSession({ token: nextToken, user: nextUser });
    },
    [],
  );

  const logout = useCallback(() => {
    clearSessionStorage();
    clearPersistent();
    setSession({ token: null, user: null });
  }, []);

  const handleUnauthorized = useCallback(() => {
    logout();
  }, [logout]);

  const login = useCallback(
    async (email: string, password: string, remember = false) => {
      const res = await loginRequest({ email, password }, handleUnauthorized);
      persist(res.session.access_token, res.user, remember);
    },
    [persist, handleUnauthorized],
  );

  const signup = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await signupRequest({ name, email, password }, handleUnauthorized);
      persist(res.session.access_token, res.user, true);
    },
    [persist, handleUnauthorized],
  );

  const loading = !mounted;

  const value = useMemo<AuthState>(
    () => ({
      token,
      user,
      isAuthenticated: Boolean(token && user),
      loading,
      login,
      signup,
      logout,
      handleUnauthorized,
    }),
    [token, user, loading, login, signup, logout, handleUnauthorized],
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
