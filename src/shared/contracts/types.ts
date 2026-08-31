export type Outcome = 'held' | 'failed';
export type ChallengeMode = 'classic' | 'self' | 'group';
export type SingleChallengeMode = Exclude<ChallengeMode, 'group'>;
export const SCORE_TRACE_MAX_POINTS = 600;
export const GROUP_RESULTS_DEFAULT_LIMIT = 20;
export const GROUP_RESULTS_MAX_LIMIT = 100;

export interface ScorePoint {
  timeSeconds: number;
  score: number;
}

export interface VideoMetadata {
  source: 'bilibili'; bvid: string; cid: number; page: number; title: string;
  description: string; cover: string; duration: number;
}
export interface PlaybackData extends VideoMetadata { media: string[]; danmakuUrl?: string }
export interface ChallengePayload {
  v: 1; kind: 'challenge'; video: VideoMetadata; initiator?: string; recipient?: string;
  message?: string; createdAt: number; expiresAt: number; nonce: string; mode: SingleChallengeMode;
}
export interface GroupInvitationPayload {
  v: 1; kind: 'group-invitation'; groupId: string; video: VideoMetadata;
  createdAt: number; expiresAt: number; resultExpiresAt: number; nonce: string; mode: 'group';
  initiator?: string; message?: string;
}
/**
 * A public, stateless group landing capability.  It deliberately contains
 * only the signed group window and display copy; it is not accepted by the
 * participation or management endpoints.
 */
export interface GroupEntryPayload {
  v: 1; kind: 'group-entry'; groupId: string; video: VideoMetadata;
  createdAt: number; expiresAt: number; resultExpiresAt: number; nonce: string; mode: 'group';
  initiator?: string; message?: string;
}
export interface GroupResultPayload {
  v: 1; kind: 'group-result'; groupId: string; video: VideoMetadata;
  createdAt: number; expiresAt: number; resultExpiresAt: number; nonce: string;
}
export interface GroupManagePayload {
  v: 1; kind: 'group-manage'; groupId: string; video: VideoMetadata;
  createdAt: number; expiresAt: number; resultExpiresAt: number; nonce: string;
}
export interface ReportPayload {
  v: 1; kind: 'report'; video: VideoMetadata; outcome: Outcome; elapsedSeconds: number;
  issuedAt: number; expiresAt: number; nonce: string; resultRef?: string; mode?: SingleChallengeMode;
}
export interface AggregateStats {
  total: number; held: number; failed: number; failureRate: number; averageElapsedSeconds: number;
  buckets: Array<{ startSeconds: number; count: number }>;
}
export interface ManageResult {
  status: 'unopened' | 'opened' | 'started' | 'completed' | 'deleted' | 'expired';
  outcome?: Outcome; elapsedSeconds?: number; expiresAt?: number;
  /**
   * Completed private results include only stable video metadata plus the
   * bounded, quantized result projections.  They deliberately omit the
   * challenge payload (initiator, recipient and message).
   */
  video?: VideoMetadata;
  stats?: AggregateStats;
  scoreTrace?: ScorePoint[];
}
export interface LeaderboardEntry {
  rank: number;
  video: VideoMetadata;
  total: number;
  held: number;
  failed: number;
  failureRate: number;
  averageElapsedRatio: number;
  difficultyScore: number;
}
export interface GroupParticipantResult {
  nickname: string;
  outcome: Outcome;
  elapsedSeconds: number;
  failedAtSeconds?: number;
  completedAt: number;
}
export interface GroupResultSummary {
  total: number;
  held: number;
  failed: number;
}
export interface GroupResultsPage {
  state: 'unopened' | 'active' | 'ended' | 'expired';
  video: VideoMetadata;
  createdAt: number;
  expiresAt: number;
  resultExpiresAt: number;
  summary: GroupResultSummary;
  results: GroupParticipantResult[];
  nextCursor?: string;
}
export interface GroupManageResult {
  status: 'unopened' | 'active' | 'ended' | 'expired';
  video?: VideoMetadata;
  expiresAt?: number;
  resultExpiresAt?: number;
  endedAt?: number;
  summary: GroupResultSummary;
}
export interface GroupEntryResult {
  entry: {
    state: GroupResultsPage['state'];
    video: VideoMetadata;
    createdAt: number;
    expiresAt: number;
    resultExpiresAt: number;
    canParticipate: boolean;
    initiator?: string;
    message?: string;
  };
  invitationUrl?: string;
  resultToken: string;
  resultUrl: string;
  resultPage: GroupResultsPage;
  stats: AggregateStats;
  videoStats: AggregateStats;
}
export interface ApiError { code: string; message: string }
export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };
