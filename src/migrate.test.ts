import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATIONS_DIR, runMigrations, tableColumns } from './migrate.ts';
import { absoluteSiteUrl, normalizeWhatsAppLine, pickSearchRef, tenantConfig, unwrapDisplayCode } from './shared.ts';

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
assert(first.includes('0010_drop_old_fantastico_line.sql'), '0010 should drop the old Fantastico 9549 line');
assert(first.includes('0011_paraguay_bigwin_line.sql'), '0011 should keep Paraguay on the BigWin R1 line');
assert(first.includes('0012_route_4064.sql'), '0012 should route Royal, Kova and Paraguay to 4064');
assert(first.includes('0013_paraguay_lines.sql'), '0013 should leave Paraguay on the five lines');
assert(first.includes('0014_ad_spend_fx_ars.sql'), '0014 should add the ARS quote columns');
assert(tableColumns(db, 'ad_spend').includes('fx_ars') && tableColumns(db, 'ad_spend').includes('fx_kind'), 'ad spend keeps an ARS quote beside the existing fx');
db.prepare('INSERT INTO ad_spend (tenant, day, usd, fx, updated_at) VALUES (?, ?, ?, ?, ?)').run('paraguay', '2026-10-31', 25, 7300, '2026-10-31T00:00:00.000Z');
const kept = db.prepare('SELECT usd, fx, fx_ars, fx_kind FROM ad_spend WHERE tenant = ? AND day = ?').get('paraguay', '2026-10-31') as { usd: number; fx: number; fx_ars: number; fx_kind: string };
assert(kept.usd === 25 && kept.fx === 7300 && kept.fx_ars === 0 && kept.fx_kind === '', 'old spend rows keep their fx and start without an ARS quote');
const fantLines = db.prepare("SELECT number, active, label FROM whatsapp_lines WHERE tenant = 'fantastico' ORDER BY id").all() as Array<{ number: string; active: number; label: string }>;
const oldFant = db.prepare("SELECT COUNT(*) AS n FROM whatsapp_lines WHERE tenant = 'fantastico' AND number = '5491133449549'").get() as { n: number };
assert(fantLines.length === 5, 'fantastico should only keep the 5 principal lines');
assert(fantLines.map((row) => row.number).join(',') === '5491178916874,5492235482370,5491178879763,5491176755150,5491176755153', 'fantastico numbers match live principals');
assert(oldFant.n === 0, 'old 9549 should be removed from Fantastico');
for (const tenant of ['royal', 'kova'] as const) {
  const active = db.prepare('SELECT number FROM whatsapp_lines WHERE tenant = ? AND active = 1').all(tenant) as Array<{ number: string }>;
  assert(active.length === 1 && active[0]?.number === '5491134264064', tenant + ' should route only to 4064');
}
const pyLines = db.prepare("SELECT number FROM whatsapp_lines WHERE tenant = 'paraguay' AND active = 1 ORDER BY id").all() as Array<{ number: string }>;
const pyOld = db.prepare("SELECT COUNT(*) AS n FROM whatsapp_lines WHERE tenant = 'paraguay' AND number NOT IN ('5491168571780','5491125193334','5491168572036','5491168716683','5491125584915')").get() as { n: number };
assert(pyLines.map((row) => row.number).join(',') === '5491168571780,5491125193334,5491168572036,5491168716683,5491125584915', 'paraguay should only keep the five lines');
assert(pyOld.n === 0, 'paraguay should drop 4064 and older lines');

const py = tenantConfig('paraguay', {
  META_ACCESS_TOKEN: 'royal-token',
  META_ACCESS_TOKEN_2: 'royal-token-2',
  PIXEL_ID_2: '1075060428238436',
  PARAGUAY_META_ACCESS_TOKEN: 'py-token',
  PARAGUAY_PIXEL_ID: '1461742502530875',
  PARAGUAY_PIXEL_ID_2: '1075060428238436',
  PARAGUAY_LANDING_URL: 'bigwinpy.vercel.app',
});
assert(py.meta.PIXEL_ID === '1461742502530875', 'paraguay uses the BigWin pixel');
assert(py.meta.PIXEL_ID_2 === '', 'paraguay does not send a second pixel');
assert(py.meta.META_ACCESS_TOKEN === 'py-token', 'paraguay uses its own Meta token');
assert(py.meta.META_ACCESS_TOKEN_2 === '', 'paraguay does not reuse the Royal token');
assert(py.landingUrl === 'https://bigwinpy.vercel.app', 'paraguay landing url gets https');
assert(absoluteSiteUrl('', 'https://bigwinpy.vercel.app/') === 'https://bigwinpy.vercel.app', 'absolute url drops the trailing slash');
const pyDefault = tenantConfig('paraguay', {});
assert(pyDefault.meta.PIXEL_ID === '1461742502530875', 'paraguay pixel defaults to the BigWin pixel');
assert(pyDefault.meta.PIXEL_ID_2 === '', 'empty paraguay config still has one pixel');

assert(normalizeWhatsAppLine('5491125689335') === '5491125689335', 'AR line stays digits');
assert(normalizeWhatsAppLine('91178916874') === '5491178916874', 'AR mobile without 54 gets country code');
assert(normalizeWhatsAppLine('+595 992 132731') === '595992132731', 'PY line keeps 595');
assert(!normalizeWhatsAppLine('12345'), 'short junk is not a WhatsApp line');
assert(pickSearchRef('REF-47') === '47', 'REF-47 is the person id');
assert(pickSearchRef('Hola, quiero más información. REF-\u206047 quiero mi beneficio') === '47', 'WhatsApp word-joiner REF still searches');
assert(unwrapDisplayCode('REF-\u206047') === '47', 'unwrap drops the WhatsApp word joiner');

const second = runMigrations(db);
assert(second.join(',') === first.join(','), 'a second boot should not re-run migrations');
db.close();

if (failures.length) {
  console.error(failures.map((item) => 'FAIL ' + item).join('\n'));
  process.exit(1);
}
console.log('migrate tests ok');
