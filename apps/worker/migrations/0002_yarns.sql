-- 내 실 보관함 (디자인 스튜디오의 실 라이브러리)
CREATE TABLE yarns (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  brand TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  weight TEXT NOT NULL DEFAULT 'dk',
  fiber TEXT NOT NULL DEFAULT '',
  hex TEXT NOT NULL,
  hex2 TEXT,
  heather REAL NOT NULL DEFAULT 0,
  photo_key TEXT,
  grams_owned REAL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_yarns_profile ON yarns(profile_id);
