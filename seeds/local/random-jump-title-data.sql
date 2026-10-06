-- ローカル動作確認用。実データはスクレイピングツールで生成する。
DELETE FROM "jump-titles";
INSERT INTO "jump-titles" (title, title_url, author, author_url, start_issue, end_issue)
VALUES ('動作確認用作品A', NULL, 'サンプル作者A', NULL, '2000年1号', '2001年10号');
INSERT INTO "jump-titles" (title, title_url, author, author_url, start_issue, end_issue)
VALUES ('動作確認用作品B', 'https://ja.wikipedia.org/wiki/週刊少年ジャンプ', 'サンプル作者B', NULL, '2026年1号', '連載中');
