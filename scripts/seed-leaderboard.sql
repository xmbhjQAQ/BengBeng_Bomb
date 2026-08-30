-- Local-only leaderboard fixtures for visual and interaction testing.
-- The rows use stable Bilibili metadata and anonymous aggregate values only.

PRAGMA foreign_keys = ON;

INSERT INTO video_catalog (
  video_key, bvid, cid, page, title, cover, duration_seconds, updated_at
) VALUES
  ('BV1v64y1275B:333216059', 'BV1v64y1275B', 333216059, 1, '《经典永不过时》', 'https://i1.hdslb.com/bfs/archive/210ace809df971e019718ba95520b967807b64d3.jpg', 262, strftime('%s', 'now')),
  ('BV1i6DHYXEE4:26613845186', 'BV1i6DHYXEE4', 26613845186, 1, '搞笑视频', 'https://i1.hdslb.com/bfs/archive/16e0c61c604df16c668eed4a1928fd233456ee64.jpg', 152, strftime('%s', 'now')),
  ('BV1a5ASetE4y:28535621542', 'BV1a5ASetE4y', 28535621542, 1, '#搞笑视频', 'https://i1.hdslb.com/bfs/archive/3f78d07d05ea662799df1400f37893a6428e6834.jpg', 192, strftime('%s', 'now')),
  ('BV1HgzJBRE5f:35532574170', 'BV1HgzJBRE5f', 35532574170, 1, '每一帧都是爆笑！四个人聚一起什么都不做都想笑了根本憋不住', 'https://i0.hdslb.com/bfs/archive/084162a1e90be1205a05d29460a4d9a06a0cc008.jpg', 943, strftime('%s', 'now'))
ON CONFLICT(video_key) DO UPDATE SET
  bvid = excluded.bvid,
  cid = excluded.cid,
  page = excluded.page,
  title = excluded.title,
  cover = excluded.cover,
  duration_seconds = excluded.duration_seconds,
  updated_at = excluded.updated_at;

INSERT INTO video_stats (
  video_key, total, held, failed, cumulative_elapsed_seconds, last_completed_at
) VALUES
  ('BV1v64y1275B:333216059', 18, 5, 13, 3391, strftime('%s', 'now')),
  ('BV1i6DHYXEE4:26613845186', 12, 8, 4, 1420, strftime('%s', 'now')),
  ('BV1a5ASetE4y:28535621542', 9, 2, 7, 880, strftime('%s', 'now')),
  ('BV1HgzJBRE5f:35532574170', 7, 6, 1, 5742, strftime('%s', 'now'))
ON CONFLICT(video_key) DO UPDATE SET
  total = excluded.total,
  held = excluded.held,
  failed = excluded.failed,
  cumulative_elapsed_seconds = excluded.cumulative_elapsed_seconds,
  last_completed_at = excluded.last_completed_at;

DELETE FROM video_fail_buckets
WHERE video_key IN (
  'BV1v64y1275B:333216059',
  'BV1i6DHYXEE4:26613845186',
  'BV1a5ASetE4y:28535621542',
  'BV1HgzJBRE5f:35532574170'
);

INSERT INTO video_fail_buckets (video_key, bucket_start_seconds, count) VALUES
  ('BV1v64y1275B:333216059', 10, 1),
  ('BV1v64y1275B:333216059', 40, 1),
  ('BV1v64y1275B:333216059', 60, 1),
  ('BV1v64y1275B:333216059', 90, 1),
  ('BV1v64y1275B:333216059', 120, 1),
  ('BV1v64y1275B:333216059', 140, 1),
  ('BV1v64y1275B:333216059', 170, 1),
  ('BV1v64y1275B:333216059', 200, 1),
  ('BV1v64y1275B:333216059', 220, 1),
  ('BV1v64y1275B:333216059', 230, 1),
  ('BV1v64y1275B:333216059', 240, 1),
  ('BV1v64y1275B:333216059', 250, 1),
  ('BV1v64y1275B:333216059', 260, 1),
  ('BV1i6DHYXEE4:26613845186', 10, 1),
  ('BV1i6DHYXEE4:26613845186', 30, 1),
  ('BV1i6DHYXEE4:26613845186', 50, 1),
  ('BV1i6DHYXEE4:26613845186', 100, 1),
  ('BV1a5ASetE4y:28535621542', 0, 1),
  ('BV1a5ASetE4y:28535621542', 10, 1),
  ('BV1a5ASetE4y:28535621542', 30, 1),
  ('BV1a5ASetE4y:28535621542', 50, 1),
  ('BV1a5ASetE4y:28535621542', 80, 1),
  ('BV1a5ASetE4y:28535621542', 120, 1),
  ('BV1a5ASetE4y:28535621542', 170, 1),
  ('BV1HgzJBRE5f:35532574170', 80, 1);
