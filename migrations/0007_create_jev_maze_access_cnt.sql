CREATE TABLE jev_maze_access_cnt (
  date TEXT PRIMARY KEY,
  count INTEGER NOT NULL CHECK (count BETWEEN 0 AND 2000)
);
