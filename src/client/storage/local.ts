const LOCAL_CHANGE_EVENT = 'bengbeng:local-storage-change';

function getLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function notifyLocalChange(key: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(LOCAL_CHANGE_EVENT, { detail: key }));
}

export function readLocal(key: string): string | null {
  try {
    return getLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeLocal(key: string, value: string): boolean {
  try {
    const storage = getLocalStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    notifyLocalChange(key);
    return true;
  } catch {
    return false;
  }
}

export function removeLocal(key: string): void {
  try {
    const storage = getLocalStorage();
    if (!storage) return;
    storage.removeItem(key);
    notifyLocalChange(key);
  } catch {
    // Private browsing and embedded webviews can reject storage operations.
  }
}

export function subscribeLocal(key: string, listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const onLocalChange = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === key) listener();
  };
  const onStorage = (event: StorageEvent) => {
    // `localStorage.clear()` emits a storage event whose key is null. Treat it
    // as a change to every subscribed key so another tab cannot keep stale
    // history or an already-cleared attempt bearer in memory.
    if (event.key === key || event.key === null) listener();
  };

  window.addEventListener(LOCAL_CHANGE_EVENT, onLocalChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(LOCAL_CHANGE_EVENT, onLocalChange);
    window.removeEventListener('storage', onStorage);
  };
}
