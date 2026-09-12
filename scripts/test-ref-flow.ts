import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { displayCode, isValidRef, pickPersonId, pickSearchRef, publicCode, PURCHASE_LEAD_JOIN } from '../src/shared.ts';

const failures: string[] = [];
function assert(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-flow-'));
const dbPath = path.join(dir, 'local.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL;');
db.exec(schema);

function getLeadById(id: number): { id: number; ref: string; tenant: string } | null {
  return (db.prepare('SELECT id, ref, tenant FROM leads WHERE id = ?').get(id) as { id: number; ref: string; tenant: string } | undefined) || null;
}

function getLeadByRef(ref: string): { id: number; ref: string; tenant: string } | null {
  return (db.prepare('SELECT id, ref, tenant FROM leads WHERE ref = ?').get(ref) as { id: number; ref: string; tenant: string } | undefined) || null;
}

function findLead(code: string, tenant?: string) {
  const raw = String(code || '').trim();
  const letter = pickSearchRef(raw);
  let row = /^\d{1,10}$/.test(raw) ? getLeadById(Number(raw)) : null;
  if (!row) row = getLeadByRef(raw);
  if (!row && letter) row = getLeadByRef(letter) || (db.prepare('SELECT id, ref, tenant FROM leads WHERE legacy_ref = ?').get(letter) as { id: number; ref: string; tenant: string } | undefined) || null;
  if (!row) return null;
  if (tenant && row.tenant !== tenant) return null;
  return row;
}

function insertLead(tenant = 'royal', ad: number | null = null) {
  const now = new Date().toISOString();
  const temp = 'TMP-' + randomBytes(8).toString('hex');
  const result = db.prepare(`
    INSERT INTO leads (ref, created_at, updated_at, status, tenant, ad)
    VALUES (?, ?, ?, 'VISIT', ?, ?)
  `).run(temp, now, now, tenant, ad);
  const id = Number(result.lastInsertRowid);
  db.prepare('UPDATE leads SET ref = ? WHERE id = ?').run(String(id), id);
  const row = getLeadById(id);
  if (!row) throw new Error('insert failed');
  return row;
}

function upsertVisit(requestedRef: unknown, tenant = 'royal', ad: number | null = null) {
  const personId = pickPersonId(String(requestedRef || ''));
  if (personId) {
    const existing = findLead(personId, tenant);
    if (existing) return existing;
  }
  const requested = pickSearchRef(String(requestedRef || ''));
  if (requested && /^REF-[A-Z0-9]{6,12}$/.test(requested)) {
    const existing = findLead(requested, tenant);
    if (existing) return existing;
    const row = insertLead(tenant, ad);
    db.prepare('UPDATE leads SET legacy_ref = ? WHERE id = ?').run(requested, row.id);
    return getLeadById(row.id) || row;
  }
  return insertLead(tenant, ad);
}

const first = upsertVisit('');
assert(isValidRef(first.ref), 'TEST1 issued valid numeric code');
assert(first.ref === String(first.id), 'TEST1 public code is the id');
assert(getLeadById(first.id), 'TEST1 id exists immediately');
assert(pickSearchRef(first.ref) === first.ref, 'TEST1 search exact');
assert(pickSearchRef(' ' + first.ref + ' ') === first.ref, 'TEST1 padded');

const second = upsertVisit('');
assert(second.id === first.id + 1, 'TEST1 sequential ids');
assert(second.ref !== first.ref, 'TEST1 two visits never share a number');

const ids = new Set<number>();
for (let i = 0; i < 20; i++) ids.add(upsertVisit('').id);
assert(ids.size === 20, 'TEST2 20 unique ids');

assert(pickSearchRef('REF-A8K92P') === 'REF-A8K92P', 'TEST3 exact legacy');
assert(pickSearchRef('ref-a8k92p') === 'REF-A8K92P', 'TEST3 lower');
assert(pickSearchRef('Hola, quiero más información. REF-A8K92P') === 'REF-A8K92P', 'TEST3 pasted REF');
assert(pickSearchRef('Hola, quiero más información. 47 quiero mi 100%!') === '47', 'TEST3 pasted number');
assert(pickSearchRef('Hola, quiero mas informacion. 47 quiero mi 100%!') === '47', 'TEST3 pasted number without accent');
assert(pickSearchRef('REF-47') === '47', 'TEST3 visual REF is only a wrapper');
assert(pickSearchRef('REF- 1536') === '1536', 'TEST3 space after hyphen');
assert(pickSearchRef('REF-\n1536') === '1536', 'TEST3 line break after hyphen');
assert(pickSearchRef('Hola, quiero más información. REF-47 quiero mi 100%!') === '47', 'TEST3 pasted visual REF');
assert(displayCode('47') === 'REF-47', 'TEST3 WhatsApp shows REF-47');
assert(isValidRef('REF-47'), 'TEST3 visual REF is valid');
assert(isValidRef('REF- 1536'), 'TEST3 spaced visual REF is valid');
assert(pickSearchRef('quiero mi 100%!') !== '100', 'TEST3 100 percent is not a person id');
assert(pickSearchRef('47') === '47', 'TEST3 person id');
assert(pickSearchRef('123456') === '123456', 'TEST3 digits are not REF-');
assert(pickSearchRef('A8K92P') === 'REF-A8K92P', 'TEST3 suffix');
assert(pickPersonId('REF-47') === '47', 'TEST3 visit only accepts person id');
assert(pickPersonId('REF-A8K92P') === '', 'TEST3 visit ignores letter REF');
assert(pickPersonId('J4GVF') === '', 'TEST3 visit ignores truncated letter REF');

assert(!pickSearchRef(''), 'TEST4 empty is not a code');
const failedSave = null as { ref?: string } | null;
assert(!(failedSave?.ref && isValidRef(failedSave.ref)), 'TEST4 failed save must not yield a code');

const once = upsertVisit('');
const again = upsertVisit(once.ref);
assert(once.id === again.id, 'TEST5 same action reuses id');
const counted = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE id = ?').get(once.id) as { n: number };
assert(counted.n === 1, 'TEST5 one row');

const royal = upsertVisit('', 'royal', 2);
const kova = upsertVisit(String(royal.id), 'kova', 1);
assert(kova.id !== royal.id, 'TEST6 tenants do not share a number');
assert(!findLead(String(royal.id), 'kova'), 'TEST6 kova cannot see royal id');
assert(royal.ref === String(royal.id), 'TEST6 royal public code');
assert(publicCode(royal) === String(royal.id), 'TEST6 publicCode');

const now = new Date().toISOString();
db.prepare(`
  INSERT INTO leads (ref, created_at, updated_at, status, tenant)
  VALUES (?, ?, ?, 'VISIT', 'royal')
`).run('REF-A8K92P', now, now);
const legacy = findLead('REF-A8K92P', 'royal');
assert(legacy?.ref === 'REF-A8K92P', 'TEST7 old REF still searchable');
const letterVisit = upsertVisit('REF-A8K92P', 'royal');
assert(letterVisit.id === legacy?.id, 'TEST7 visit reuses the old letter person');
const freshLetter = upsertVisit('REF-9AO8GR', 'royal');
assert(/^\d+$/.test(freshLetter.ref), 'TEST7 new letter visit still returns a number');
assert(freshLetter.ref !== 'REF-9AO8GR', 'TEST7 public code stays numeric');
assert(findLead('REF-9AO8GR', 'royal')?.id === freshLetter.id, 'TEST7 panel can search the letter and get the number');
if (legacy) {
  db.prepare('INSERT INTO purchases (ref, monto, event_id, created_at) VALUES (?, ?, ?, ?)').run(String(legacy.id), 1000, 'purchase_' + legacy.id + '_x', now);
  const joined = db.prepare('SELECT p.monto ' + PURCHASE_LEAD_JOIN + ' WHERE l.tenant = ? AND CAST(l.id AS TEXT) = ?').get('royal', String(legacy.id)) as { monto: number } | undefined;
  assert(joined?.monto === 1000, 'TEST7 purchase on old REF joins by numeric id');
  const missed = db.prepare('SELECT p.monto ' + PURCHASE_LEAD_JOIN + ' WHERE l.tenant = ?').get('kova') as { monto: number } | undefined;
  assert(!missed, 'TEST7 kova does not see royal purchase');
}

db.close();
const reopened = new DatabaseSync(dbPath);
const stillThere = reopened.prepare('SELECT id, ref FROM leads WHERE id = ?').get(first.id) as { id: number; ref: string } | undefined;
assert(stillThere?.ref === first.ref, 'TEST8 survives reopen');

reopened.close();
fs.rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('ref-flow ok');
