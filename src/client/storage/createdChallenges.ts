import { decodeNickname, decodeVideoMetadata, isRecord, type VideoMetadata } from '../../shared/contracts';
import { readLocal, removeLocal, subscribeLocal, writeLocal } from './local';

const STORAGE_KEY = 'bengbeng:created-challenges:v1';
const VERSION = 1;
const MAX_RECORDS = 50;
const MAX_STORED_LENGTH = 512_000;
const MAX_URL_LENGTH = 8_192;

export type CreatedChallengeKind = 'classic' | 'self' | 'group';

export interface CreatedChallengeRecord {
  id: string;
  kind: CreatedChallengeKind;
  video: VideoMetadata;
  createdAt: number;
  expiresAt: number;
  challengeUrl: string;
  manageUrl: string;
  entryUrl?: string;
  resultUrl?: string;
  resultExpiresAt?: number;
  initiator?: string;
}

export type CreatedChallengeInput = Omit<CreatedChallengeRecord, 'id'>;

interface HistoryEnvelope {
  v: typeof VERSION;
  items: CreatedChallengeRecord[];
}

function positiveTimestamp(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('invalid timestamp');
  return value;
}

function urlField(value: unknown, required = true): string | undefined {
  if (typeof value !== 'string') {
    if (!required && value === undefined) return undefined;
    throw new Error('invalid url');
  }
  const normalized = value.trim();
  if ((!normalized && required) || normalized.length > MAX_URL_LENGTH) throw new Error('invalid url');
  if (!normalized) return undefined;
  const parsed = new URL(normalized, 'https://local.invalid');
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('invalid url');
  return normalized;
}

function decodeKind(value: unknown): CreatedChallengeKind {
  if (value !== 'classic' && value !== 'self' && value !== 'group') throw new Error('invalid challenge kind');
  return value;
}

function decodeRecord(value: unknown): CreatedChallengeRecord {
  if (!isRecord(value)) throw new Error('invalid challenge record');
  const kind = decodeKind(value.kind);
  const createdAt = positiveTimestamp(value.createdAt);
  const expiresAt = positiveTimestamp(value.expiresAt);
  if (expiresAt <= createdAt) throw new Error('invalid challenge window');
  const challengeUrl = urlField(value.challengeUrl) as string;
  const expectedId = `${kind}:${challengeUrl}`;
  if (value.id !== expectedId) throw new Error('invalid challenge id');
  const resultExpiresAt = value.resultExpiresAt === undefined ? undefined : positiveTimestamp(value.resultExpiresAt);
  if (resultExpiresAt !== undefined && resultExpiresAt <= expiresAt) throw new Error('invalid result window');
  const initiator = value.initiator === undefined ? undefined : decodeNickname(value.initiator);
  return {
    id: expectedId,
    kind,
    video: decodeVideoMetadata(value.video),
    createdAt,
    expiresAt,
    challengeUrl,
    manageUrl: urlField(value.manageUrl) as string,
    ...(value.entryUrl === undefined ? {} : { entryUrl: urlField(value.entryUrl) }),
    ...(value.resultUrl === undefined ? {} : { resultUrl: urlField(value.resultUrl) }),
    ...(resultExpiresAt === undefined ? {} : { resultExpiresAt }),
    ...(initiator === undefined ? {} : { initiator }),
  };
}

function toRecord(input: CreatedChallengeInput): CreatedChallengeRecord {
  return decodeRecord({ ...input, id: `${input.kind}:${input.challengeUrl.trim()}` });
}

function persist(items: CreatedChallengeRecord[]): boolean {
  return writeLocal(STORAGE_KEY, JSON.stringify({ v: VERSION, items } satisfies HistoryEnvelope));
}

export function readCreatedChallenges(): CreatedChallengeRecord[] {
  const raw = readLocal(STORAGE_KEY);
  if (!raw) return [];
  if (raw.length > MAX_STORED_LENGTH) {
    removeLocal(STORAGE_KEY);
    return [];
  }
  try {
    const envelope = JSON.parse(raw) as unknown;
    if (!isRecord(envelope) || envelope.v !== VERSION || !Array.isArray(envelope.items)) throw new Error('invalid history envelope');
    const byId = new Map<string, CreatedChallengeRecord>();
    for (const item of envelope.items) {
      try {
        const decoded = decodeRecord(item);
        const existing = byId.get(decoded.id);
        if (!existing || decoded.createdAt >= existing.createdAt) byId.set(decoded.id, decoded);
      } catch {
        // A damaged entry must not hide the rest of the local history.
      }
    }
    const items = [...byId.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RECORDS);
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

export function upsertCreatedChallenge(input: CreatedChallengeInput): boolean {
  try {
    const record = toRecord(input);
    const items = readCreatedChallenges().filter((item) => item.id !== record.id);
    items.push(record);
    items.sort((a, b) => b.createdAt - a.createdAt);
    return persist(items.slice(0, MAX_RECORDS));
  } catch {
    return false;
  }
}

export function removeCreatedChallenge(id: string): void {
  const items = readCreatedChallenges().filter((item) => item.id !== id);
  if (items.length === 0) removeLocal(STORAGE_KEY);
  else persist(items);
}

export function clearCreatedChallenges(): void {
  removeLocal(STORAGE_KEY);
}

export function subscribeCreatedChallenges(listener: () => void): () => void {
  return subscribeLocal(STORAGE_KEY, listener);
}
