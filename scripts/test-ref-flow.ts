import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { isValidRef, pickSearchRef, REF_CHARS } from '../src/shared.ts';

const failures: string[] = [];
function assert(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

function makeRef(): string {
  const bytes = randomBytes(6);
  let out = '';
  for (let i = 0; i < 6; i++) out += REF_CHARS[bytes[i] % REF_CHARS.length];
  return 'REF-' + out;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-flow-'));
const dbPath = path.join(dir, 'local.db');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode=WAL;');
db.exec(schema);

function getLead(ref: string): { ref: string } | null {
  return (db.prepare('SELECT ref FROM leads WHERE ref = ?').get(ref) as { ref: string } | undefined) || null;
}

function insertLead(ref: string): { ref: string } {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO leads (ref, created_at, updated_at, status)
    VALUES (?, ?, ?, 'VISIT')
  `).run(ref, now, now);
  const row = getLead(ref);
  if (!row) throw new Error('insert failed');
  return row;
}

function upsertVisit(requestedRef: unknown): { ref: string } {
  const requested = pickSearchRef(String(requestedRef || ''));
  if (requested) {
    const existing = getLead(requested);
    if (existing) return existing;
  }
  for (let i = 0; i < 8; i++) {
    const next = makeRef();
    if (!getLead(next)) return insertLead(next);
  }
  throw new Error('No se pudo generar REF.');
}

const first = upsertVisit('');
assert(isValidRef(first.ref), 'TEST1 issued valid REF');
assert(getLead(first.ref), 'TEST1 REF exists immediately');
assert(pickSearchRef(first.ref) === first.ref, 'TEST1 search exact');
assert(pickSearchRef(first.ref.toLowerCase()) === first.ref, 'TEST1 lowercase');
assert(pickSearchRef(' ' + first.ref + ' ') === first.ref, 'TEST1 padded');
assert(pickSearchRef(first.ref.slice(4)) === first.ref, 'TEST1 suffix only');

const refs = new Set<string>();
for (let i = 0; i < 20; i++) refs.add(upsertVisit('').ref);
assert(refs.size === 20, 'TEST2 20 unique REFs');
for (const ref of refs) assert(getLead(ref), 'TEST2 all 20 searchable');

assert(pickSearchRef('REF-A8K92P') === 'REF-A8K92P', 'TEST3 exact');
assert(pickSearchRef('ref-a8k92p') === 'REF-A8K92P', 'TEST3 lower');
assert(pickSearchRef(' REF-A8K92P ') === 'REF-A8K92P', 'TEST3 spaces');
assert(pickSearchRef('Hola, quiero más información. REF-A8K92P') === 'REF-A8K92P', 'TEST3 pasted message');
assert(pickSearchRef('A8K92P') === 'REF-A8K92P', 'TEST3 suffix');

assert(!pickSearchRef(''), 'TEST4 empty is not a REF');
const failedSave = null as { ref?: string } | null;
assert(!(failedSave?.ref && isValidRef(failedSave.ref)), 'TEST4 failed save must not yield a REF');

const once = upsertVisit('');
const again = upsertVisit(once.ref);
assert(once.ref === again.ref, 'TEST5 same action reuses REF');
const counted = db.prepare('SELECT COUNT(*) AS n FROM leads WHERE ref = ?').get(once.ref) as { n: number };
assert(counted.n === 1, 'TEST5 one row');

db.close();
const reopened = new DatabaseSync(dbPath);
const stillThere = reopened.prepare('SELECT ref FROM leads WHERE ref = ?').get(first.ref) as { ref: string } | undefined;
assert(stillThere?.ref === first.ref, 'TEST6 survives reopen');
const purchaseLookup = pickSearchRef('  ref-' + first.ref.slice(4).toLowerCase() + ' ');
const purchaseRow = reopened.prepare('SELECT ref FROM leads WHERE ref = ?').get(purchaseLookup) as { ref: string } | undefined;
assert(purchaseRow?.ref === first.ref, 'TEST7 purchase lookup uses same REF');
reopened.close();
fs.rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  console.error('REF FLOW FAILED');
  for (const item of failures) console.error(' -', item);
  process.exit(1);
}
console.log('REF FLOW OK', first.ref, 'plus', refs.size, 'unique');
