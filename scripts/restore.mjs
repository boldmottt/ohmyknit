#!/usr/bin/env node
/**
 * 백업 되돌리기: node scripts/restore.mjs <백업.tar.gz>
 * 먼저 서버(wrangler dev)를 멈춘 뒤 실행하세요. 지금 데이터는 data.before-restore-<시각>으로 옮겨 둡니다.
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, renameSync, statSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(ROOT, 'data'));
const archive = process.argv[2];
if (!archive || !existsSync(archive)) {
  console.error('사용법: node scripts/restore.mjs <knitcloset-YYYYMMDD-HHMMSS.tar.gz>');
  process.exit(1);
}
const d1Dir = join(DATA_DIR, 'v3', 'd1', 'miniflare-D1DatabaseObject');
const current = existsSync(d1Dir)
  ? readdirSync(d1Dir).filter((f) => f.endsWith('.sqlite') && f !== 'metadata.sqlite').sort((a, b) => statSync(join(d1Dir, b)).size - statSync(join(d1Dir, a)).size)[0]
  : undefined;
if (!current) {
  console.error('지금 데이터 폴더에 D1 파일이 없어요. 먼저 `pnpm migrate`와 서버를 한 번 실행해 DB 파일을 만든 뒤 다시 해 주세요.');
  process.exit(1);
}
const work = mkdtempSync(join(tmpdir(), 'knitcloset-restore-'));
execFileSync('tar', ['-xzf', archive, '-C', work]);
const inner = join(work, readdirSync(work)[0]);
const keep = `${DATA_DIR}.before-restore-${Date.now()}`;
cpSync(DATA_DIR, keep, { recursive: true });
for (const ext of ['', '-wal', '-shm']) {
  const f = join(d1Dir, current + ext);
  if (ext && existsSync(f)) renameSync(f, `${f}.old`);
}
copyFileSync(join(inner, 'd1.sqlite'), join(d1Dir, current));
if (existsSync(join(inner, 'r2'))) {
  mkdirSync(join(DATA_DIR, 'v3'), { recursive: true });
  cpSync(join(inner, 'r2'), join(DATA_DIR, 'v3', 'r2'), { recursive: true });
}
console.log(`되돌렸어요. 이전 데이터는 ${keep}에 있어요. 이제 서버를 다시 켜 주세요.`);
