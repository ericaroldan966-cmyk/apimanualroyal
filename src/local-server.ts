import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  asText,
  attributionFromBody,
  buildStats,
  corsHeaders,
  parseStatsRange,
  spendWindow,
  summarizeSpend,
  isYmd,
  isLocalOrigin,
  leadTenant,
  mergeAttribution,
  normalizePhone,
  nowIso,
  pageViewEventId,
  checkoutEventId,
  firstForwardedIp,
  storedOrRequest,
  pickSearchRef,
  publicCode,
  publicLead,
  PURCHASE_LEAD_JOIN,
  isPersonId,
  resolveTenantId,
  sendMetaEvent,
  tenantConfig,
  metaFailureMessage,
  metaPixelPayload,
  type Attribution,
  type LeadRow,
  type TenantConfig,
  type TenantId,
} from './shared.ts';

const PORT = Number(process.env.PORT || process.env.LOCAL_API_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(ROOT, '..');

loadDotEnv(path.join(API_ROOT, '.dev.vars'));
loadDotEnv(path.join(API_ROOT, '.env'));

const ENV = {
  PURCHASE_SEND_KEY: process.env.PURCHASE_SEND_KEY || '',
};

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(API_ROOT, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, 'local.db');
console.log('[API] boot', HOST + ':' + PORT, dbPath);
const db = new DatabaseSync(dbPath);
console.log('[API] sqlite open');
db.exec('PRAGMA journal_mode=WAL;');
db.exec('PRAGMA busy_timeout=5000;');
db.exec('PRAGMA synchronous=NORMAL;');
db.exec(fs.readFileSync(path.join(API_ROOT, 'schema.sql'), 'utf8'));

function tableColumns(name: string): string[] {
  return (db.prepare('PRAGMA table_info(' + name + ')').all() as Array<{ name: string }>).map((row) => row.name);
}

for (const column of ['client_ip', 'user_agent', 'tenant']) {
  try {
    db.exec(
      column === 'tenant'
        ? "ALTER TABLE leads ADD COLUMN tenant TEXT NOT NULL DEFAULT 'royal'"
        : 'ALTER TABLE leads ADD COLUMN ' + column + ' TEXT',
    );
  } catch {
    /* already exists */
  }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_leads_tenant ON leads(tenant)');

function tableExists(name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name),
  );
}

if (tableExists('leads_v2')) {
  if (!tableExists('leads')) {
    db.exec('ALTER TABLE leads_v2 RENAME TO leads');
  } else {
    db.exec('DROP TABLE leads_v2');
  }
}

try {
  db.exec('ALTER TABLE leads ADD COLUMN ad INTEGER');
} catch {
  /* already exists */
}

if (tableColumns('ad_spend').length && !tableColumns('ad_spend').includes('tenant')) {
  db.exec(`
    CREATE TABLE ad_spend_mt (
      tenant TEXT NOT NULL DEFAULT 'royal',
      day TEXT NOT NULL,
      usd REAL NOT NULL,
      fx REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tenant, day)
    )
  `);
  db.exec("INSERT INTO ad_spend_mt (tenant, day, usd, fx, updated_at) SELECT 'royal', day, usd, fx, updated_at FROM ad_spend");
  db.exec('DROP TABLE ad_spend');
  db.exec('ALTER TABLE ad_spend_mt RENAME TO ad_spend');
  db.exec('CREATE INDEX IF NOT EXISTS idx_ad_spend_day ON ad_spend(day)');
}

function tenantOf(req: http.IncomingMessage, url: URL, body?: Record<string, unknown>): TenantConfig {
  const id = resolveTenantId({
    bodyTenant: body?.tenant,
    headerTenant: req.headers['x-tenant'],
    queryTenant: url.searchParams.get('tenant'),
    origin: String(req.headers.origin || ''),
    landingUrl: String(body?.landing_url || ''),
    env: process.env,
  });
  return tenantConfig(id, process.env);
}

function refLog(tenant: TenantId): string {
  return '[' + tenant.toUpperCase() + '][REF]';
}

console.log('[API]', 'storage', dbPath, process.env.RAILWAY_VOLUME_MOUNT_PATH ? 'persistent-volume' : 'local-data-dir');

function loadDotEnv(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, 'utf8').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const index = trimmed.indexOf('=');
    if (index < 1) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, '');
    process.env[key] = value;
  });
}

function allowedOrigin(req: http.IncomingMessage): string {
  const incoming = String(req.headers.origin || '');
  if (isLocalOrigin(incoming)) return incoming;
  return incoming || '*';
}

function send(res: http.ServerResponse, status: number, payload: unknown, origin: string): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...corsHeaders(origin),
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function makeToken(): string {
  return randomBytes(24).toString('hex');
}

function sha256(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

function asLead(row: unknown): LeadRow | null {
  if (!row || typeof row !== 'object') return null;
  const raw = row as LeadRow & { rowid?: number };
  const id = Number(raw.id || raw.rowid || 0);
  return { ...raw, id: id > 0 ? id : undefined, ad: Number(raw.ad) || 0 };
}

function getLeadById(id: number): LeadRow | null {
  return asLead(db.prepare('SELECT rowid, * FROM leads WHERE rowid = ?').get(id));
}

function getLeadByRef(ref: string): LeadRow | null {
  return asLead(db.prepare('SELECT rowid, * FROM leads WHERE ref = ?').get(ref));
}

function findLead(code: string, tenant?: TenantId): LeadRow | null {
  const raw = String(code || '').trim();
  if (!raw) return null;
  let row: LeadRow | null = null;
  if (isPersonId(raw)) row = getLeadById(Number(raw));
  if (!row) row = getLeadByRef(raw);
  if (!row && isPersonId(raw)) row = getLeadByRef(raw);
  if (!row) return null;
  if (tenant && leadTenant(row) !== tenant) return null;
  return row;
}

function insertLead(attr: Attribution, status: string, tenant: TenantId): LeadRow {
  const created = nowIso();
  const temp = 'TMP-' + randomBytes(8).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = db.prepare(`
      INSERT INTO leads (
        ref, created_at, updated_at, status, tenant, ad,
        fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name,
        landing_url, referrer, telefono
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      temp, created, created, status, tenant, attr.ad > 0 ? attr.ad : null,
      attr.fbclid, attr.fbp, attr.fbc, attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
      attr.campaign_id, attr.adset_id, attr.ad_id, attr.campaign_name, attr.adset_name, attr.ad_name,
      attr.landing_url, attr.referrer, attr.telefono,
    );
    const id = Number(result.lastInsertRowid);
    db.prepare('UPDATE leads SET ref = ? WHERE rowid = ?').run(String(id), id);
    const row = getLeadById(id);
    if (!row) throw new Error('No se pudo crear el lead.');
    db.exec('COMMIT');
    return row;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function updateAttribution(lead: LeadRow, attr: Attribution): LeadRow {
  db.prepare(`
    UPDATE leads SET
      updated_at = ?,
      ad = ?,
      fbclid = ?, fbp = ?, fbc = ?,
      utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_content = ?, utm_term = ?,
      campaign_id = ?, adset_id = ?, ad_id = ?,
      campaign_name = ?, adset_name = ?, ad_name = ?,
      landing_url = ?, referrer = ?, telefono = ?
    WHERE rowid = ?
  `).run(
    nowIso(),
    attr.ad > 0 ? attr.ad : (Number(lead.ad) > 0 ? Number(lead.ad) : null),
    attr.fbclid, attr.fbp, attr.fbc,
    attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
    attr.campaign_id, attr.adset_id, attr.ad_id,
    attr.campaign_name, attr.adset_name, attr.ad_name,
    attr.landing_url, attr.referrer, attr.telefono,
    lead.id,
  );
  const row = getLeadById(Number(lead.id));
  if (!row) throw new Error('No se pudo actualizar el lead.');
  return row;
}

function requestVisitorIp(req: http.IncomingMessage): string {
  return firstForwardedIp(
    String(req.headers['x-forwarded-for'] || ''),
    String(req.headers['x-real-ip'] || ''),
    String(req.headers['cf-connecting-ip'] || ''),
    req.socket.remoteAddress || '',
  );
}

function persistVisitorContext(lead: LeadRow, ip: string, userAgent: string): LeadRow {
  db.prepare(`
    UPDATE leads SET
      client_ip = CASE WHEN client_ip IS NULL OR client_ip = '' THEN ? ELSE client_ip END,
      user_agent = CASE WHEN user_agent IS NULL OR user_agent = '' THEN ? ELSE user_agent END,
      updated_at = ?
    WHERE rowid = ?
  `).run(ip, userAgent, nowIso(), lead.id);
  const row = getLeadById(Number(lead.id));
  if (!row) throw new Error('No se pudo guardar el contexto del visitante.');
  return row;
}

function upsertVisit(requestedRef: unknown, incoming: Attribution, tenant: TenantId): LeadRow {
  const requested = pickSearchRef(String(requestedRef || ''));
  if (requested) {
    const existing = findLead(requested, tenant);
    if (existing) {
      const updated = updateAttribution(existing, mergeAttribution(existing, incoming));
      console.log(refLog(tenant), 'persisted', publicCode(updated));
      return updated;
    }
  }
  const row = insertLead(incoming, 'VISIT', tenant);
  console.log(refLog(tenant), 'created', publicCode(row));
  return row;
}

function buildUserData(lead: LeadRow, extras: { client_ip_address?: string; client_user_agent?: string }): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.fbc) userData.fbc = lead.fbc;
  const phoneHash = sha256(lead.telefono);
  if (phoneHash) userData.ph = [phoneHash];
  const externalId = sha256(publicCode(lead));
  if (externalId) userData.external_id = [externalId];
  if (extras.client_ip_address) userData.client_ip_address = extras.client_ip_address;
  if (extras.client_user_agent) userData.client_user_agent = extras.client_user_agent;
  return userData;
}

const server = http.createServer(async (req, res) => {
  const origin = allowedOrigin(req);
  const url = new URL(req.url || '/', 'http://localhost');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      const royal = tenantConfig('royal', process.env);
      const kova = tenantConfig('kova', process.env);
      const fantastico = tenantConfig('fantastico', process.env);
      send(res, 200, {
        ok: true,
        tenants: {
          royal: { pixel_id: royal.meta.PIXEL_ID, token_configured: Boolean(royal.meta.META_ACCESS_TOKEN) },
          kova: { pixel_id: kova.meta.PIXEL_ID, token_configured: Boolean(kova.meta.META_ACCESS_TOKEN) },
          fantastico: { pixel_id: fantastico.meta.PIXEL_ID, token_configured: Boolean(fantastico.meta.META_ACCESS_TOKEN) },
        },
        send_key_configured: Boolean(ENV.PURCHASE_SEND_KEY),
        db: true,
      }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/visit') {
      const body = await readBody(req);
      if (!Object.keys(body).length) {
        send(res, 400, { error: 'Cuerpo inválido.' }, origin);
        return;
      }
      const tenant = tenantOf(req, url, body);
      const incoming = attributionFromBody({ ...body, a: body.a ?? body.ad ?? url.searchParams.get('a') });
      const lead = persistVisitorContext(
        upsertVisit(body.ref, incoming, tenant.id),
        requestVisitorIp(req),
        asText(req.headers['user-agent'], 400),
      );
      const code = publicCode(lead);
      console.log(refLog(tenant.id), 'returned to landing', code);
      void sendMetaEvent(tenant.meta, {
        event_name: 'PageView',
        event_id: pageViewEventId(code),
        event_source_url: lead.landing_url || tenant.landingUrl,
        user_data: buildUserData(lead, {
          client_ip_address: requestVisitorIp(req),
          client_user_agent: asText(req.headers['user-agent'], 400),
        }),
        custom_data: {},
      });
      console.log('[visit] Lead guardado ' + tenant.id);
      send(res, 200, { ok: true, ref: code, id: lead.id, a: Number(lead.ad) || 0, status: lead.status, tenant: tenant.id }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/lead') {
      const body = await readBody(req);
      if (!Object.keys(body).length) {
        send(res, 400, { error: 'Cuerpo inválido.' }, origin);
        return;
      }
      const tenant = tenantOf(req, url, body);
      const ip = requestVisitorIp(req);
      const userAgent = asText(req.headers['user-agent'], 400);
      const incoming = attributionFromBody({ ...body, a: body.a ?? body.ad ?? url.searchParams.get('a') });
      const lead = persistVisitorContext(upsertVisit(body.ref, incoming, tenant.id), ip, userAgent);
      const code = publicCode(lead);
      const eventId = asText(body.event_id, 80) || ('lead_' + code);
      const visitorData = buildUserData(lead, {
        client_ip_address: ip,
        client_user_agent: userAgent,
      });
      void sendMetaEvent(tenant.meta, {
        event_name: 'InitiateCheckout',
        event_id: checkoutEventId(code),
        event_source_url: lead.landing_url || tenant.landingUrl,
        user_data: visitorData,
        custom_data: {},
      });
      if (lead.lead_enviado) {
        console.log('[lead] Lead omitido, ya enviado');
        send(res, 200, { ok: true, ref: code, id: lead.id, a: Number(lead.ad) || 0, event_id: lead.lead_event_id || eventId, already_sent: true, tenant: tenant.id }, origin);
        return;
      }
      const meta = await sendMetaEvent(tenant.meta, {
        event_name: 'Lead',
        event_id: eventId,
        event_source_url: lead.landing_url || tenant.landingUrl,
        user_data: visitorData,
        custom_data: {},
      });
      db.prepare(`
        UPDATE leads SET
          updated_at = ?,
          status = CASE WHEN status = 'PURCHASE' THEN status ELSE 'LEAD' END,
          lead_enviado = ?,
          lead_event_id = ?,
          lead_sent_at = ?,
          lead_events_received = ?,
          lead_meta_error = ?
        WHERE ref = ?
      `).run(
        nowIso(),
        (meta.pixel1_ok || meta.pixel2_ok) ? 1 : 0,
        eventId,
        nowIso(),
        meta.events_received == null ? null : meta.events_received,
        meta.ok ? null : metaFailureMessage(meta),
        lead.ref,
      );
      console.log('[lead] Lead pixel1_ok=' + String(meta.pixel1_ok) + ' pixel2_ok=' + String(meta.pixel2_ok) + (meta.ok ? '' : ' :: ' + metaFailureMessage(meta)));
      send(res, 200, {
        ok: true,
        ref: code,
        id: lead.id,
        a: Number(lead.ad) || 0,
        event_id: eventId,
        events_received: meta.events_received,
        tenant: tenant.id,
        ...metaPixelPayload(meta),
      }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readBody(req);
      if (!ENV.PURCHASE_SEND_KEY) {
        send(res, 503, { error: 'Falta PURCHASE_SEND_KEY en .dev.vars' }, origin);
        return;
      }
      if (asText(body.key, 200) !== ENV.PURCHASE_SEND_KEY) {
        send(res, 401, { error: 'Clave inválida' }, origin);
        return;
      }
      const token = makeToken();
      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      db.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').run(token, nowIso(), expires);
      console.log('[auth] Sesión creada');
      send(res, 200, { ok: true, token, expires_at: expires }, origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/search') {
      const tenant = tenantOf(req, url);
      const q = asText(url.searchParams.get('q'), 300);
      if (!q) {
        send(res, 400, { error: 'Escribí el número de persona o un teléfono.' }, origin);
        return;
      }
      let row = null;
      const searchRef = pickSearchRef(q);
      console.log(refLog(tenant.id), 'search requested', searchRef || q);
      if (searchRef) row = findLead(searchRef, tenant.id);
      const phone = normalizePhone(q);
      if (!row && phone) {
        row = asLead(db.prepare('SELECT rowid, * FROM leads WHERE telefono = ? AND tenant = ? ORDER BY created_at DESC LIMIT 1').get(phone, tenant.id));
      }
      if (!row) row = findLead(q, tenant.id);
      if (!row) {
        console.log(refLog(tenant.id), 'not found', searchRef || q);
        send(res, 404, { error: 'Código no encontrado' }, origin);
        return;
      }
      console.log(refLog(tenant.id), 'found', row.ref);
      send(res, 200, { ok: true, lead: publicLead(row) }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/purchase') {
      const body = await readBody(req);
      const tenant = tenantOf(req, url, body);
      if (!tenant.meta.META_ACCESS_TOKEN && !tenant.meta.META_ACCESS_TOKEN_2) {
        send(res, 503, { error: 'Falta META_ACCESS_TOKEN o META_ACCESS_TOKEN_2.' }, origin);
        return;
      }
      const ref = pickSearchRef(asText(body.ref, 300)) || asText(body.ref, 20);
      const monto = Number(body.monto);
      const force = Boolean(body.force);
      const lead = findLead(ref, tenant.id);
      if (!lead) {
        console.log('[purchase] Código no encontrado');
        send(res, 404, { error: 'Código no encontrado' }, origin);
        return;
      }
      if (!(monto > 0)) {
        send(res, 400, { error: 'Monto inválido.' }, origin);
        return;
      }
      const alreadyHadPurchase = Boolean(lead.purchase_enviado);
      const code = publicCode(lead);
      const eventId = 'purchase_' + code + '_' + Date.now().toString(36);
      const purchaseUserData = buildUserData(lead, {
        client_ip_address: storedOrRequest(lead.client_ip, requestVisitorIp(req)),
        client_user_agent: storedOrRequest(lead.user_agent, asText(req.headers['user-agent'], 400)),
      });
      const purchaseCustom = { currency: 'ARS', value: Number(monto.toFixed(2)), order_id: code };
      const meta = await sendMetaEvent(tenant.meta, {
        event_name: 'Purchase',
        event_id: eventId,
        event_source_url: lead.landing_url || tenant.landingUrl,
        user_data: purchaseUserData,
        custom_data: purchaseCustom,
      });
      const created = nowIso();
      const saleSaved = meta.pixel1_ok || meta.pixel2_ok;
      const metaStatus = meta.ok ? 'ok' : (saleSaved ? 'partial' : 'error');
      const metaError = meta.ok ? null : metaFailureMessage(meta);
      db.prepare(`
        INSERT INTO purchases (
          ref, monto, event_id, created_at,
          campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
          events_received, meta_status, meta_error, forced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        code, monto, eventId, created,
        lead.campaign_id, lead.campaign_name, lead.adset_id, lead.adset_name, lead.ad_id, lead.ad_name,
        meta.events_received == null ? null : meta.events_received,
        metaStatus,
        metaError,
        (force || alreadyHadPurchase) ? 1 : 0,
      );
      if (!saleSaved) {
        db.prepare('UPDATE leads SET updated_at = ?, purchase_meta_error = ? WHERE ref = ?').run(created, metaError, lead.ref);
        console.log('[purchase] Purchase error pixel1_ok=false pixel2_ok=false :: ' + metaError);
        send(res, 502, {
          error: metaError || 'Error de Meta',
          saved: false,
          ...metaPixelPayload(meta),
        }, origin);
        return;
      }
      db.prepare(`
        UPDATE leads SET
          updated_at = ?, status = 'PURCHASE', purchase_enviado = 1,
          purchase_event_id = ?, monto_purchase = ?, fecha_purchase = ?,
          purchase_events_received = ?, purchase_meta_error = ?
        WHERE ref = ?
      `).run(created, eventId, monto, created, meta.events_received == null ? null : meta.events_received, metaError, lead.ref);
      console.log('[purchase] Purchase guardado pixel1_ok=' + String(meta.pixel1_ok) + ' pixel2_ok=' + String(meta.pixel2_ok) + (meta.ok ? '' : ' :: ' + metaError));
      send(res, 200, {
        ok: meta.ok,
        saved: true,
        ref: code,
        id: lead.id,
        a: Number(lead.ad) || 0,
        monto,
        event_id: eventId,
        fecha_purchase: created,
        events_received: meta.events_received,
        ...metaPixelPayload(meta),
        lead: publicLead(getLeadById(Number(lead.id))),
      }, origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/spend') {
      const tenant = tenantOf(req, url);
      const range = parseStatsRange(url.searchParams.get('range'));
      const window = spendWindow(range);
      const rows = window.from && window.to
        ? db.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE tenant = ? AND day >= ? AND day <= ? ORDER BY day').all(tenant.id, window.from, window.to)
        : db.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE tenant = ? ORDER BY day').all(tenant.id);
      const summary = summarizeSpend(rows as Array<{ day: string; usd: number; fx: number; updated_at: string }>);
      const current = summary.items.find((row) => row.day === window.editDay);
      send(res, 200, {
        ok: true,
        range,
        day: window.editDay,
        usd: summary.usd,
        ars: summary.ars,
        current_usd: current ? current.usd : 0,
        current_fx: current ? current.fx : 0,
        items: summary.items,
      }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/spend') {
      const body = await readBody(req);
      const tenant = tenantOf(req, url, body);
      const window = spendWindow(parseStatsRange(body.range));
      const day = isYmd(body.day) ? String(body.day) : window.editDay;
      const usd = Number(body.usd);
      const fx = Number(body.fx);
      if (!(usd >= 0) || !Number.isFinite(usd)) {
        send(res, 400, { error: 'Ingresá el gasto en dólares.' }, origin);
        return;
      }
      if (!(fx >= 0) || !Number.isFinite(fx)) {
        send(res, 400, { error: 'Ingresá la cotización.' }, origin);
        return;
      }
      db.prepare(`
        INSERT INTO ad_spend (tenant, day, usd, fx, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(tenant, day) DO UPDATE SET usd = excluded.usd, fx = excluded.fx, updated_at = excluded.updated_at
      `).run(tenant.id, day, Math.round(usd * 100) / 100, Math.round(fx * 100) / 100, nowIso());
      const row = db.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE tenant = ? AND day = ?').get(tenant.id, day) as { day: string; usd: number; fx: number; updated_at: string };
      send(res, 200, { ok: true, ...summarizeSpend([row]), day: row.day, current_usd: row.usd, current_fx: row.fx }, origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') {
      const tenant = tenantOf(req, url);
      const leads = db.prepare(
        'SELECT ref, lead_enviado, purchase_enviado, lead_sent_at, created_at FROM leads WHERE tenant = ?',
      ).all(tenant.id) as Array<{
        ref: string;
        lead_enviado: number;
        purchase_enviado: number;
        lead_sent_at: string | null;
        created_at: string;
      }>;
      const purchases = db.prepare(
        'SELECT p.ref, p.monto, p.created_at ' + PURCHASE_LEAD_JOIN + ' WHERE l.tenant = ?',
      ).all(tenant.id) as Array<{
        ref: string;
        monto: number;
        created_at: string;
      }>;
      send(res, 200, buildStats(parseStatsRange(url.searchParams.get('range')), leads, purchases), origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/purchases') {
      const tenant = tenantOf(req, url);
      const q = asText(url.searchParams.get('q'), 80);
      const rows = q
        ? db.prepare('SELECT p.* ' + PURCHASE_LEAD_JOIN + ' WHERE l.tenant = ? AND (p.ref LIKE ? OR CAST(l.rowid AS TEXT) = ?) ORDER BY p.created_at DESC LIMIT 200').all(tenant.id, '%' + q.toUpperCase() + '%', q.trim())
        : db.prepare('SELECT p.* ' + PURCHASE_LEAD_JOIN + ' WHERE l.tenant = ? ORDER BY p.created_at DESC LIMIT 200').all(tenant.id);
      send(res, 200, { ok: true, purchases: rows }, origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/leads') {
      const tenant = tenantOf(req, url);
      const q = asText(url.searchParams.get('q'), 80);
      let rows: LeadRow[];
      if (q) {
        const phone = normalizePhone(q);
        if (phone) {
          rows = db.prepare('SELECT rowid, * FROM leads WHERE tenant = ? AND (telefono = ? OR ref LIKE ? OR CAST(rowid AS TEXT) = ?) ORDER BY created_at DESC LIMIT 200').all(tenant.id, phone, '%' + q.toUpperCase() + '%', q) as LeadRow[];
        } else {
          rows = db.prepare('SELECT rowid, * FROM leads WHERE tenant = ? AND (ref LIKE ? OR CAST(rowid AS TEXT) = ?) ORDER BY created_at DESC LIMIT 200').all(tenant.id, '%' + q.toUpperCase() + '%', q) as LeadRow[];
        }
      } else {
        rows = db.prepare('SELECT rowid, * FROM leads WHERE tenant = ? ORDER BY created_at DESC LIMIT 200').all(tenant.id) as LeadRow[];
      }
      send(res, 200, { ok: true, leads: rows.map((row) => publicLead(asLead(row))) }, origin);
      return;
    }

    const leadMatch = url.pathname.match(/^\/api\/lead\/([^/]+)$/);
    if (req.method === 'GET' && leadMatch) {
      const tenant = tenantOf(req, url);
      const row = findLead(decodeURIComponent(leadMatch[1]), tenant.id);
      if (!row) {
        send(res, 404, { error: 'Código no encontrado' }, origin);
        return;
      }
      send(res, 200, { ok: true, lead: publicLead(row) }, origin);
      return;
    }

    send(res, 404, { error: 'Ruta no encontrada.' }, origin);
  } catch {
    console.log('[api] Error interno');
    send(res, 500, { error: 'Error interno.' }, origin);
  }
});

server.listen(PORT, HOST, () => {
  const royal = tenantConfig('royal', process.env);
  const kova = tenantConfig('kova', process.env);
  const fantastico = tenantConfig('fantastico', process.env);
  console.log('[API] http://' + HOST + ':' + PORT);
  console.log('[API] db ' + path.join(dataDir, 'local.db'));
  if (!ENV.PURCHASE_SEND_KEY) console.log('[API] Falta PURCHASE_SEND_KEY');
  if (!royal.meta.PIXEL_ID) console.log('[META][ROYAL] Falta PIXEL_ID');
  if (!royal.meta.META_ACCESS_TOKEN) console.log('[API][ROYAL] META_ACCESS_TOKEN pendiente');
  if (!kova.meta.META_ACCESS_TOKEN) console.log('[API][KOVA] KOVA_META_ACCESS_TOKEN pendiente');
  if (!fantastico.meta.PIXEL_ID) console.log('[META][FANTASTICO] FANTASTICO_PIXEL_ID pendiente');
  if (!fantastico.meta.META_ACCESS_TOKEN) console.log('[API][FANTASTICO] FANTASTICO_META_ACCESS_TOKEN pendiente');
});
