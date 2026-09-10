import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations');

export function resolveDataDir(): string {
  return process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(ROOT, 'data');
}

export function resolveDbPath(): string {
  return path.join(resolveDataDir(), 'local.db');
}

export function tableColumns(db: DatabaseSync, name: string): string[] {
  return (db.prepare('PRAGMA table_info(' + name + ')').all() as Array<{ name: string }>).map((row) => row.name);
}

export function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

export function sqlStatements(sql: string): string[] {
  return sql
    .split(';')
    .map((part) =>
      part
        .split('\n')
        .map((line) => (line.trimStart().startsWith('--') ? '' : line))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

function skipIfColumn(sql: string): { table: string; column: string } | null {
  const match = sql.match(/^\s*--\s*@skip_if_column\s+(\w+)\.(\w+)/m);
  if (!match) return null;
  return { table: match[1], column: match[2] };
}

function appliedIds(db: DatabaseSync): string[] {
  return (db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as Array<{ id: string }>).map(
    (row) => row.id,
  );
}

function migrationFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    throw new Error('No está la carpeta migrations: ' + dir);
  }
  return fs
    .readdirSync(dir)
    .filter((name) => /^\d+.+\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

function applyStatement(db: DatabaseSync, stmt: string): void {
  const addCol = stmt.match(/^ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)\b/i);
  if (addCol) {
    const table = addCol[1];
    const column = addCol[2];
    if (!tableExists(db, table) || tableColumns(db, table).includes(column)) {
      console.log('[API] migrate skip column', table + '.' + column);
      return;
    }
  }
  db.exec(stmt);
}

function cleanupLeftovers(db: DatabaseSync): void {
  if (tableExists(db, 'leads_v2')) {
    if (!tableExists(db, 'leads')) db.exec('ALTER TABLE leads_v2 RENAME TO leads');
    else db.exec('DROP TABLE IF EXISTS leads_v2');
    console.log('[API] migrate dropped leftover leads_v2');
  }
  if (tableExists(db, 'ad_spend_mt')) {
    if (tableExists(db, 'ad_spend') && !tableColumns(db, 'ad_spend').includes('tenant')) {
      db.exec('DROP TABLE ad_spend');
      db.exec('ALTER TABLE ad_spend_mt RENAME TO ad_spend');
    } else {
      db.exec('DROP TABLE IF EXISTS ad_spend_mt');
    }
    console.log('[API] migrate cleaned leftover ad_spend_mt');
  }
}

export function runMigrations(db: DatabaseSync, dir = MIGRATIONS_DIR): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  cleanupLeftovers(db);

  const done = new Set(appliedIds(db));
  const files = migrationFiles(dir);
  if (!files.length) throw new Error('No hay archivos de migración en ' + dir);

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const skip = skipIfColumn(sql);
    if (skip && tableExists(db, skip.table) && tableColumns(db, skip.table).includes(skip.column)) {
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      console.log('[API] migrate already applied', file);
      continue;
    }
    console.log('[API] migrate', file);
    for (const stmt of sqlStatements(sql)) applyStatement(db, stmt);
    db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
    console.log('[API] migrate ok', file);
  }

  cleanupLeftovers(db);
  const applied = appliedIds(db);
  console.log('[API] migrations', applied.join(', '));
  return applied;
}

function launchedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

if (launchedDirectly()) {
  const dataDir = resolveDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = resolveDbPath();
  console.log('[API] migrate cli', dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA busy_timeout=5000;');
  db.exec('PRAGMA journal_mode=WAL;');
  db.exec('PRAGMA synchronous=NORMAL;');
  runMigrations(db);
  db.close();
}
