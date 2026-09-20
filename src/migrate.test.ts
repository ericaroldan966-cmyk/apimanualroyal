import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS_DIR, runMigrations, tableColumns } from './migrate.ts';
import { normalizeWhatsAppLine } from './shared.ts';

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
assert(tableColumns(db, 'whatsapp_lines').includes('number'), 'pending 0008 should create whatsapp_lines');
assert(first.includes('0008_whatsapp_lines.sql'), '0008 should be recorded');
assert(first.includes('0009_fantastico_whatsapp_lines.sql'), '0009 should seed Fantastico live lines');
const royalLines = db.prepare("SELECT COUNT(*) AS n FROM whatsapp_lines WHERE tenant = 'royal'").get() as { n: number };
const kovaLines = db.prepare("SELECT COUNT(*) AS n FROM whatsapp_lines WHERE tenant = 'kova'").get() as { n: number };
const fantLines = db.prepare("SELECT number, active, label FROM whatsapp_lines WHERE tenant = 'fantastico' AND active = 1 ORDER BY id").all() as Array<{ number: string; active: number; label: string }>;
const oldFant = db.prepare("SELECT active FROM whatsapp_lines WHERE tenant = 'fantastico' AND number = '5491133449549'").get() as { active: number };
assert(royalLines.n === 4, 'royal seed should load live numbers');
assert(kovaLines.n === 4, 'kova seed should load live numbers');
assert(fantLines.length === 5, 'fantastico should have 5 active principal lines');
assert(fantLines.map((row) => row.number).join(',') === '5491178916874,5492235482370,5491178879763,5491176755150,5491176755153', 'fantastico active numbers match live principals');
assert(oldFant.active === 0, 'old 9549 should be off');

assert(normalizeWhatsAppLine('5491125689335') === '5491125689335', 'AR line stays digits');
assert(normalizeWhatsAppLine('91178916874') === '5491178916874', 'AR mobile without 54 gets country code');
assert(normalizeWhatsAppLine('+595 992 132731') === '595992132731', 'PY line keeps 595');
assert(!normalizeWhatsAppLine('12345'), 'short junk is not a WhatsApp line');

const second = runMigrations(db);
assert(second.join(',') === first.join(','), 'a second boot should not re-run migrations');
db.close();

if (failures.length) {
  console.error(failures.map((item) => 'FAIL ' + item).join('\n'));
  process.exit(1);
}
console.log('migrate tests ok');
