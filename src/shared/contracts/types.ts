export type Outcome = 'held' | 'failed';

export interface VideoMetadata {
  source: 'bilibili'; bvid: string; cid: number; page: number; title: string;
  description: string; cover: string; duration: number;
}
export interface PlaybackData extends VideoMetadata { media: string[]; danmakuUrl?: string }
export interface ChallengePayload {
  v: 1; kind: 'challenge'; video: VideoMetadata; initiator: string; recipient?: string;
  message?: string; createdAt: number; expiresAt: number; nonce: string; mode: 'classic';
}
export interface ReportPayload {
  v: 1; kind: 'report'; video: VideoMetadata; outcome: Outcome; elapsedSeconds: number;
  issuedAt: number; expiresAt: number; nonce: string;
}
export interface AggregateStats {
  total: number; held: number; failed: number; failureRate: number; averageElapsedSeconds: number;
  buckets: Array<{ startSeconds: number; count: number }>;
}
export interface ManageResult {
  status: 'unopened' | 'opened' | 'started' | 'completed' | 'deleted' | 'expired';
  outcome?: Outcome; elapsedSeconds?: number; expiresAt?: number;
}
export interface ApiError { code: string; message: string }
export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };
