import { decodeNickname } from '../../shared/contracts';
import { readLocal, removeLocal, writeLocal } from './local';

const STORAGE_KEY = 'bengbeng:profile:v1';
const VERSION = 1;
const MAX_STORED_LENGTH = 256;

interface NicknameEnvelope {
  v: typeof VERSION;
  nickname: string;
}

export function readPreferredNickname(): string {
  const raw = readLocal(STORAGE_KEY);
  if (!raw) return '';
  if (raw.length > MAX_STORED_LENGTH) {
    removeLocal(STORAGE_KEY);
    return '';
  }
  try {
    const value = JSON.parse(raw) as Partial<NicknameEnvelope>;
    if (value.v !== VERSION) throw new Error('unsupported profile version');
    return decodeNickname(value.nickname);
  } catch {
    removeLocal(STORAGE_KEY);
    return '';
  }
}

export function rememberPreferredNickname(value: unknown): boolean {
  try {
    const nickname = decodeNickname(value);
    return writeLocal(STORAGE_KEY, JSON.stringify({ v: VERSION, nickname } satisfies NicknameEnvelope));
  } catch {
    return false;
  }
}

export function clearPreferredNickname(): void {
  removeLocal(STORAGE_KEY);
}
