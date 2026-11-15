-- 뜨개옷장 초기 스키마 (기획서 3.1)

CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  avatar TEXT NOT NULL DEFAULT '🧶',
  color TEXT NOT NULL DEFAULT '#7A1F2B',
  skin_id TEXT NOT NULL DEFAULT 'antique',
  body_measurements TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE TABLE swatches (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  yarn_name TEXT NOT NULL DEFAULT '',
  yarn_weight TEXT NOT NULL DEFAULT 'dk',
  fiber TEXT NOT NULL DEFAULT '',
  needle_mm REAL NOT NULL,
  needle_material TEXT NOT NULL DEFAULT 'any',
  technique TEXT NOT NULL DEFAULT 'stockinette',
  sts_pre REAL,
  rows_pre REAL,
  sts_post REAL,
  rows_post REAL,
  photo_key TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_swatches_profile ON swatches(profile_id);

-- 기법·실 두께·바늘 재질별 "큰 작품 보정 계수" = 실제 작품 게이지 / 스와치 게이지
-- 1보다 크면 스와치보다 작품을 더 쫀쫀하게 뜨는 손. 완성 실측으로 학습 (기획서 4.4)
CREATE TABLE hand_coefficients (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  technique TEXT NOT NULL,
  yarn_weight TEXT NOT NULL,
  needle_material TEXT NOT NULL,
  k_st REAL NOT NULL,
  k_row REAL NOT NULL,
  sample_count REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, technique, yarn_weight, needle_material)
);

CREATE TABLE patterns (
  id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  designer TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'manual', -- pdf | ai | manual
  original_json TEXT NOT NULL,
  file_key TEXT,
  gauge_st REAL NOT NULL,
  gauge_row REAL NOT NULL,
  needle_mm REAL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  pattern_id TEXT NOT NULL REFERENCES patterns(id),
  name TEXT NOT NULL,
  size_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | archived | finished
  started_at INTEGER NOT NULL,
  last_worked_at INTEGER,
  finished_at INTEGER,
  hanger_order INTEGER NOT NULL DEFAULT 0,
  conversion_mode TEXT NOT NULL DEFAULT 'recalc', -- recalc | needle
  my_gauge_st REAL NOT NULL,
  my_gauge_row REAL NOT NULL,
  -- 게이지를 정한 근거 {"swatchSt":24,"swatchRow":32,"kSt":1.04,"kRow":1.03,"swatchId":"..."}
  gauge_basis TEXT NOT NULL DEFAULT '{}',
  needle_mm REAL,
  yarn TEXT NOT NULL DEFAULT '',
  ball_grams REAL,
  note TEXT NOT NULL DEFAULT '',
  converted_json TEXT NOT NULL,
  total_stitches INTEGER NOT NULL,
  cover_texture_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_projects_profile ON projects(profile_id, status);

CREATE TABLE pieces (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  piece_key TEXT NOT NULL,
  name TEXT NOT NULL,
  ord INTEGER NOT NULL,
  construction TEXT NOT NULL,
  direction TEXT NOT NULL,
  total_rows INTEGER NOT NULL,
  total_stitches INTEGER NOT NULL
);
CREATE INDEX idx_pieces_project ON pieces(project_id);

-- 현재 상태 스냅샷 (progress_events를 다시 재생해서 만든 값)
CREATE TABLE progress (
  piece_id TEXT PRIMARY KEY REFERENCES pieces(id) ON DELETE CASCADE,
  current_row INTEGER NOT NULL DEFAULT 0,
  current_stitch INTEGER NOT NULL DEFAULT 0,
  stitches_done INTEGER NOT NULL DEFAULT 0,
  frog_count INTEGER NOT NULL DEFAULT 0,
  frog_rows INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE progress_events (
  id TEXT PRIMARY KEY, -- client_event_id
  piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  from_row INTEGER NOT NULL,
  to_row INTEGER NOT NULL,
  at INTEGER NOT NULL,
  device TEXT,
  meta TEXT,
  received_at INTEGER NOT NULL
);
CREATE INDEX idx_events_piece ON progress_events(piece_id, at);

CREATE TABLE checkins (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  at_row INTEGER NOT NULL,
  dimension TEXT NOT NULL DEFAULT 'length', -- length | width
  measured_cm REAL NOT NULL,
  expected_cm REAL NOT NULL,
  deviation_pct REAL NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  piece_id TEXT NOT NULL REFERENCES pieces(id) ON DELETE CASCADE,
  row INTEGER NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notes_piece ON notes(piece_id, row);

-- 실 사용량 기록 (저울로 잰 값)
CREATE TABLE yarn_logs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  grams_used REAL NOT NULL,
  stitches_done INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE finished_records (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  measured TEXT NOT NULL, -- {"가슴둘레": 92}
  expected TEXT NOT NULL,
  k_actual_st REAL,
  finished_at INTEGER NOT NULL
);
