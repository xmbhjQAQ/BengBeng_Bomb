function getSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function readSession(key: string): string | null {
  try {
    return getSessionStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeSession(key: string, value: string): boolean {
  try {
    const storage = getSessionStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeSession(key: string): void {
  try {
    getSessionStorage()?.removeItem(key);
  } catch {
    // Private browsing and embedded webviews can reject storage operations.
  }
}
