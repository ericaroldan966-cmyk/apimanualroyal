import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS_DIR, runMigrations, tableColumns } from './migrate.ts';

const failures: string[] = [];
function assert(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ganamos-migrate-'));
const dbPath = path.join(dir, 'local.db');

const old = new DatabaseSync(dbPath);
old.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, '0001_init.sql'), 'utf8'));
old.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, '0002_ad_spend.sql'), 'utf8'));
assert(!tableColumns(old, 'leads').includes('tenant'), 'fixture should start without tenant');
let schemaCrashed = false;
try {
  old.exec(fs.readFileSync(path.join(root, 'schema.sql'), 'utf8'));
} catch (error) {
  schemaCrashed = /no such column: tenant/i.test(String(error));
}
assert(schemaCrashed, 'schema.sql on an old leads table should fail the same way Railway did');
old.close();

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout=5000;');
const first = runMigrations(db);
assert(tableColumns(db, 'leads').includes('tenant'), 'pending 0004 should add leads.tenant');
assert(tableColumns(db, 'leads').includes('ad'), 'pending 0005 should add leads.ad');
assert(tableColumns(db, 'ad_spend').includes('tenant'), 'pending 0006 should add ad_spend.tenant');
assert(first.includes('0004_tenant.sql'), '0004 should be recorded');
assert(first.includes('0006_ad_spend_tenant.sql'), '0006 should be recorded');

const second = runMigrations(db);
assert(second.join(',') === first.join(','), 'a second boot should not re-run migrations');
db.close();

if (failures.length) {
  console.error(failures.map((item) => 'FAIL ' + item).join('\n'));
  process.exit(1);
}
console.log('migrate tests ok');
