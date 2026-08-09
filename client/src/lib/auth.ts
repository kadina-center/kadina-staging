import {
  clearToken,
  getToken,
  setToken,
  type User,
} from "./api";

const USER_KEY = "kadina_user";

export { getToken, setToken, clearToken };

export function getStoredUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: User): void {
  setToken(token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  clearToken();
  localStorage.removeItem(USER_KEY);
}
