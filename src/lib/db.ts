import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const dir = path.join(process.cwd(), "data");
fs.mkdirSync(dir, { recursive: true });

const g = globalThis as unknown as { _db?: DatabaseSync; _dbStartupCleaned?: boolean };

function init(): DatabaseSync {
  const db = new DatabaseSync(path.join(dir, "app.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      platform TEXT NOT NULL,
      url TEXT NOT NULL UNIQUE,
      title TEXT,
      views INTEGER DEFAULT 0,
      duration_sec INTEGER,
      keyword TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      source_path TEXT,
      style TEXT,
      language TEXT DEFAULT 'ko',
      script TEXT,
      status TEXT DEFAULT 'draft', -- draft | scripting | script_ready | rendering | done | failed | canceled
      output_path TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

// 마이그레이션: 컬럼 존재 체크 후 추가 (HMR로 모듈이 재평가돼도 안전)
function migrate(db: DatabaseSync) {
  const cols = new Set(
    (db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name),
  );
  const add: [string, string][] = [
    ["duration_sec", "INTEGER DEFAULT 58"],
    ["error", "TEXT"],
    ["headline1", "TEXT"],
    ["headline2", "TEXT"],
    ["yt_title", "TEXT"],
    ["original_duration", "REAL"],
    ["job_pid", "INTEGER"], // 백그라운드 작업을 소유한 서버 프로세스 pid
  ];
  for (const [name, type] of add) {
    if (!cols.has(name)) db.exec(`ALTER TABLE projects ADD COLUMN ${name} ${type}`);
  }
}

export const db = (g._db ??= init());
migrate(db);

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

// 프로세스 시작 시 1회: 소유 프로세스가 죽은 백그라운드 작업만 정리
// (next build·스크립트 등 다른 프로세스가 db.ts를 로드해도 살아있는 서버의 작업은 건드리지 않음)
if (!g._dbStartupCleaned) {
  g._dbStartupCleaned = true;
  const stuck = db
    .prepare("SELECT id, job_pid FROM projects WHERE status IN ('scripting', 'rendering')")
    .all() as { id: number; job_pid: number | null }[];
  const mark = db.prepare(
    "UPDATE projects SET status = 'failed', error = '서버 재시작으로 작업이 중단됨' WHERE id = ? AND status IN ('scripting', 'rendering')",
  );
  for (const r of stuck) {
    if (r.job_pid === process.pid) continue;
    if (!r.job_pid || !pidAlive(r.job_pid)) mark.run(r.id);
  }
}
