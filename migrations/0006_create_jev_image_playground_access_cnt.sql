CREATE TABLE "jev-image-playground-access-cnt" (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count BETWEEN 0 AND 200)
);
