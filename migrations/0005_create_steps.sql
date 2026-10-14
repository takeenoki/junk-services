CREATE TABLE steps (
  local_date TEXT NOT NULL PRIMARY KEY,
  steps INTEGER NOT NULL CHECK (steps BETWEEN 0 AND 1000000),
  timezone TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
