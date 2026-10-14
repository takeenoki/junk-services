-- ローカル表示確認用の架空データ。本番には適用しない。
INSERT INTO steps (local_date, steps, timezone, recorded_at, updated_at) VALUES
  ('2026-10-01', 8432, 'Asia/Tokyo', '2026-10-01T14:58:12.000Z', '2026-10-01T15:01:03.000Z'),
  ('2026-10-02', 0, 'Asia/Tokyo', '2026-10-02T14:58:12.000Z', '2026-10-02T15:01:03.000Z'),
  ('2026-10-04', 12560, 'Asia/Tokyo', '2026-10-04T14:58:12.000Z', '2026-10-04T15:01:03.000Z')
ON CONFLICT(local_date) DO NOTHING;
