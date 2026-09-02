import { decodeNickname, isRecord } from '../../shared/contracts';
import { readLocal, removeLocal, subscribeLocal, writeLocal } from './local';

const STORAGE_KEY = 'bengbeng:active-attempts:v1';
const VERSION = 1;
const MAX_RECORDS = 20;
const MAX_STORED_LENGTH = 256_000;
const MAX_SECRET_LENGTH = 8_192;

interface ActiveAttemptBase {
  challengeToken: string;
  attemptToken: string;
  startedAt: number;
  expiresAt: number;
}

export interface SingleActiveAttemptRecord extends ActiveAttemptBase {
  kind: 'single';
}

export interface GroupActiveAttemptRecord extends ActiveAttemptBase {
  kind: 'group';
  attemptId: string;
  /** Missing only for legacy sessionStorage records created before nickname migration. */
  nickname?: string;
}

export type ActiveAttemptRecord = SingleActiveAttemptRecord | GroupActiveAttemptRecord;
export type ActiveAttemptKind = ActiveAttemptRecord['kind'];

interface AttemptsEnvelope {
  v: typeof VERSION;
  items: ActiveAttemptRecord[];
}

function secret(value: unknown): string {
  if (typeof value !== 'string') throw new Error('invalid credential');
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SECRET_LENGTH) throw new Error('invalid credential');
  return normalized;
}

function timestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('invalid timestamp');
  return value;
}

function decodeRecord(value: unknown): ActiveAttemptRecord {
  if (!isRecord(value) || (value.kind !== 'single' && value.kind !== 'group')) throw new Error('invalid attempt record');
  const common = {
    challengeToken: secret(value.challengeToken),
    attemptToken: secret(value.attemptToken),
    startedAt: timestamp(value.startedAt),
    expiresAt: timestamp(value.expiresAt),
  };
  if (common.expiresAt <= common.startedAt) throw new Error('invalid attempt window');
  if (value.kind === 'single') return { kind: 'single', ...common };
  const nickname = value.nickname === undefined ? undefined : decodeNickname(value.nickname);
  return {
    kind: 'group',
    ...common,
    attemptId: secret(value.attemptId),
    ...(nickname === undefined ? {} : { nickname }),
  };
}

function identity(record: Pick<ActiveAttemptRecord, 'kind' | 'challengeToken'>): string {
  return `${record.kind}:${record.challengeToken}`;
}

function persist(items: ActiveAttemptRecord[]): boolean {
  return writeLocal(STORAGE_KEY, JSON.stringify({ v: VERSION, items } satisfies AttemptsEnvelope));
}

function readAll(nowSeconds: number): ActiveAttemptRecord[] {
  const raw = readLocal(STORAGE_KEY);
  if (!raw) return [];
  if (raw.length > MAX_STORED_LENGTH) {
    removeLocal(STORAGE_KEY);
    return [];
  }
  try {
    const envelope = JSON.parse(raw) as unknown;
    if (!isRecord(envelope) || envelope.v !== VERSION || !Array.isArray(envelope.items)) throw new Error('invalid attempts envelope');
    const byId = new Map<string, ActiveAttemptRecord>();
    for (const item of envelope.items) {
      try {
        const decoded = decodeRecord(item);
        if (decoded.expiresAt <= nowSeconds) continue;
        const id = identity(decoded);
        const existing = byId.get(id);
        if (!existing || decoded.startedAt >= existing.startedAt) byId.set(id, decoded);
      } catch {
        // Isolate damaged credentials instead of exposing or reusing them.
      }
    }
    const items = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, MAX_RECORDS);
    if (items.length !== envelope.items.length) {
      if (items.length === 0) removeLocal(STORAGE_KEY);
      else persist(items);
    }
    return items;
  } catch {
    removeLocal(STORAGE_KEY);
    return [];
  }
}

export function readActiveAttempt(kind: ActiveAttemptKind, challengeToken: string, nowSeconds = Math.floor(Date.now() / 1000)): ActiveAttemptRecord | null {
  const normalizedToken = challengeToken.trim();
  if (!normalizedToken) return null;
  return readAll(nowSeconds).find((item) => item.kind === kind && item.challengeToken === normalizedToken) ?? null;
}

export function writeActiveAttempt(record: ActiveAttemptRecord): boolean {
  try {
    const decoded = decodeRecord(record);
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (decoded.expiresAt <= nowSeconds) return false;
    const items = readAll(nowSeconds).filter((item) => identity(item) !== identity(decoded));
    items.push(decoded);
    items.sort((a, b) => b.startedAt - a.startedAt);
    return persist(items.slice(0, MAX_RECORDS));
  } catch {
    return false;
  }
}

export function removeActiveAttempt(kind: ActiveAttemptKind, challengeToken: string, expectedAttemptToken?: string): void {
  const normalizedToken = challengeToken.trim();
  if (!normalizedToken) return;
  const normalizedAttempt = expectedAttemptToken?.trim();
  const items = readAll(Math.floor(Date.now() / 1000)).filter((item) => {
    if (item.kind !== kind || item.challengeToken !== normalizedToken) return true;
    // A second group participant can start in another tab and replace this
    // route's recovery record. A stale tab must never delete that newer
    // participant's credential when it later finishes or receives an error.
    return Boolean(normalizedAttempt && item.attemptToken !== normalizedAttempt);
  });
  if (items.length === 0) removeLocal(STORAGE_KEY);
  else persist(items);
}

export function subscribeActiveAttempts(listener: () => void): () => void {
  return subscribeLocal(STORAGE_KEY, listener);
}
