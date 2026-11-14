#!/usr/bin/env node
/**
 * 뜨개옷장 백업 (기획서 2.3)
 * - D1(SQLite)을 VACUUM INTO로 일관된 스냅숏 복사 → SQL 덤프도 함께
 * - R2(사진·PDF) 폴더 복사
 * - 서버가 켜져 있으면 /api/export JSON도 저장
 * - tar.gz 하나로 묶어 BACKUP_DIR에 저장, KEEP_DAYS(기본 30)일 지난 것은 삭제
 *
 * 사용: node scripts/backup.mjs
 * 환경 변수: DATA_DIR(기본 ./data), BACKUP_DIR, KEEP_DAYS, SERVER_URL(기본 http://127.0.0.1:8787)
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'));
const ICLOUD = join(homedir(), 'Library/Mobile Documents/com~apple~CloudDocs');
const BACKUP_DIR = resolve(
  process.env.BACKUP_DIR ?? (existsSync(ICLOUD) ? join(ICLOUD, 'KnitCloset-backups') : join(homedir(), 'KnitCloset-backups')),
);
const KEEP_DAYS = Number(process.env.KEEP_DAYS ?? 30);
const SERVER_URL = process.env.SERVER_URL ?? 'http://127.0.0.1:8787';

const log = (...a) => console.log(new Date().toISOString(), ...a);

function findD1() {
  const dir = join(DATA_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject');
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite')
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).size - statSync(a).size);
  return files[0] ?? null;
}

function sqlDump(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const out = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
  const tables = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY rowid")
    .all();
  const q = (v) =>
    v === null ? 'NULL' : typeof v === 'number' || typeof v === 'bigint' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
  for (const t of tables) {
    out.push(`${t.sql};`);
    for (const row of db.prepare(`SELECT * FROM "${t.name}"`).all()) {
      const cols = Object.keys(row);
      out.push(`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map((c) => q(row[c])).join(',')});`);
    }
  }
  for (const i of db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all()) out.push(`${i.sql};`);
  out.push('COMMIT;');
  db.close();
  return out.join('\n');
}

async function main() {
  const d1 = findD1();
  if (!d1) {
    log(`D1 데이터베이스를 찾을 수 없어요: ${DATA_DIR}`);
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const work = mkdtempSync(join(tmpdir(), 'knitcloset-backup-'));
  const name = `knitcloset-${stamp}`;
  const dir = join(work, name);
  mkdirSync(dir);

  // 1) 일관된 스냅숏 (서버가 쓰는 중이어도 안전)
  const snap = join(dir, 'd1.sqlite');
  const src = new DatabaseSync(d1);
  src.exec(`VACUUM INTO '${snap.replaceAll("'", "''")}'`);
  src.close();
  writeFileSync(join(dir, 'd1.sql'), sqlDump(snap));
  log('D1 스냅숏 완료');

  // 2) R2 파일
  const r2 = join(DATA_DIR, 'v3', 'r2');
  if (existsSync(r2)) {
    cpSync(r2, join(dir, 'r2'), { recursive: true });
    log('R2 파일 복사 완료');
  }

  // 3) JSON 내보내기 (서버가 꺼져 있으면 건너뜀)
  try {
    const res = await fetch(`${SERVER_URL}/api/export`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      writeFileSync(join(dir, 'export.json'), await res.text());
      log('JSON 내보내기 완료');
    }
  } catch {
    log('서버가 꺼져 있어서 JSON 내보내기는 건너뛰었어요');
  }

  // 4) 묶어서 저장
  mkdirSync(BACKUP_DIR, { recursive: true });
  const archive = join(BACKUP_DIR, `${name}.tar.gz`);
  execFileSync('tar', ['-czf', archive, '-C', work, name]);
  rmSync(work, { recursive: true, force: true });
  log(`백업 저장: ${archive}`);

  // 5) 오래된 백업 정리
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  for (const f of readdirSync(BACKUP_DIR)) {
    if (!/^knitcloset-\d{8}-\d{6}\.tar\.gz$/.test(f)) continue;
    const p = join(BACKUP_DIR, f);
    if (statSync(p).mtimeMs < cutoff) {
      rmSync(p);
      log(`오래된 백업 삭제: ${f}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
