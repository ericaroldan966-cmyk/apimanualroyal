import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_LANDING_URL,
  PIXEL_ID,
  PIXEL_ID_2,
  asText,
  attributionFromBody,
  buildStats,
  corsHeaders,
  parseStatsRange,
  spendWindow,
  summarizeSpend,
  isYmd,
  isLocalOrigin,
  isValidRef,
  mergeAttribution,
  normalizePhone,
  nowIso,
  pickSearchRef,
  publicLead,
  sendMetaEvent,
  type Attribution,
  type LeadRow,
} from './shared.ts';

const PORT = Number(process.env.PORT || process.env.LOCAL_API_PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(ROOT, '..');

loadDotEnv(path.join(API_ROOT, '.dev.vars'));
loadDotEnv(path.join(API_ROOT, '.env'));

const ENV = {
  META_ACCESS_TOKEN: process.env.META_ACCESS_TOKEN || '',
  PURCHASE_SEND_KEY: process.env.PURCHASE_SEND_KEY || '',
  META_TEST_EVENT_CODE: process.env.META_TEST_EVENT_CODE || '',
  PIXEL_ID: process.env.PIXEL_ID || PIXEL_ID,
  PIXEL_ID_2: process.env.PIXEL_ID_2 || PIXEL_ID_2,
};

const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.env.DATA_DIR || path.join(API_ROOT, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, 'local.db'));
db.exec(fs.readFileSync(path.join(API_ROOT, 'schema.sql'), 'utf8'));

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

function makeRef(): string {
  const bytes = randomBytes(6);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i++) out += chars[bytes[i] % chars.length];
  return 'REF-' + out;
}

function makeToken(): string {
  return randomBytes(24).toString('hex');
}

function sha256(value: unknown): string | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

function getLead(ref: string): LeadRow | null {
  return (db.prepare('SELECT * FROM leads WHERE ref = ?').get(ref) as LeadRow | undefined) || null;
}

function insertLead(ref: string, attr: Attribution, status: string): LeadRow {
  const created = nowIso();
  db.prepare(`
    INSERT INTO leads (
      ref, created_at, updated_at, status,
      fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name,
      landing_url, referrer, telefono
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ref, created, created, status,
    attr.fbclid, attr.fbp, attr.fbc, attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
    attr.campaign_id, attr.adset_id, attr.ad_id, attr.campaign_name, attr.adset_name, attr.ad_name,
    attr.landing_url, attr.referrer, attr.telefono,
  );
  const row = getLead(ref);
  if (!row) throw new Error('No se pudo crear el lead.');
  return row;
}

function updateAttribution(ref: string, attr: Attribution): LeadRow {
  db.prepare(`
    UPDATE leads SET
      updated_at = ?,
      fbclid = ?, fbp = ?, fbc = ?,
      utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_content = ?, utm_term = ?,
      campaign_id = ?, adset_id = ?, ad_id = ?,
      campaign_name = ?, adset_name = ?, ad_name = ?,
      landing_url = ?, referrer = ?, telefono = ?
    WHERE ref = ?
  `).run(
    nowIso(),
    attr.fbclid, attr.fbp, attr.fbc,
    attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
    attr.campaign_id, attr.adset_id, attr.ad_id,
    attr.campaign_name, attr.adset_name, attr.ad_name,
    attr.landing_url, attr.referrer, attr.telefono,
    ref,
  );
  const row = getLead(ref);
  if (!row) throw new Error('No se pudo actualizar el lead.');
  return row;
}

function upsertVisit(requestedRef: unknown, incoming: Attribution): LeadRow {
  let ref = asText(requestedRef, 20).toUpperCase();
  if (ref && !isValidRef(ref)) ref = '';
  if (ref) {
    const existing = getLead(ref);
    if (existing) return updateAttribution(ref, mergeAttribution(existing, incoming));
    return insertLead(ref, incoming, 'VISIT');
  }
  for (let i = 0; i < 5; i++) {
    const next = makeRef();
    if (!getLead(next)) return insertLead(next, incoming, 'VISIT');
  }
  throw new Error('No se pudo generar REF.');
}

function buildUserData(lead: LeadRow, extras: { client_ip_address?: string; client_user_agent?: string }): Record<string, unknown> {
  const userData: Record<string, unknown> = {};
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.fbc) userData.fbc = lead.fbc;
  const phoneHash = sha256(lead.telefono);
  if (phoneHash) userData.ph = [phoneHash];
  const externalId = sha256(lead.ref);
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
      send(res, 200, {
        ok: true,
        pixel_id: ENV.PIXEL_ID,
        token_configured: Boolean(ENV.META_ACCESS_TOKEN),
        send_key_configured: Boolean(ENV.PURCHASE_SEND_KEY),
        db: true,
      }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/visit') {
      const body = await readBody(req);
      const lead = upsertVisit(body.ref, attributionFromBody(body));
      console.log('[visit] Lead guardado');
      send(res, 200, { ok: true, ref: lead.ref, status: lead.status }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/lead') {
      const body = await readBody(req);
      const lead = upsertVisit(body.ref, attributionFromBody(body));
      const eventId = asText(body.event_id, 80) || ('lead_' + lead.ref);
      if (lead.lead_enviado) {
        console.log('[lead] Lead omitido, ya enviado');
        send(res, 200, { ok: true, ref: lead.ref, event_id: lead.lead_event_id || eventId, already_sent: true }, origin);
        return;
      }
      const meta = await sendMetaEvent(ENV, {
        event_name: 'Lead',
        event_id: eventId,
        event_source_url: lead.landing_url || DEFAULT_LANDING_URL,
        user_data: buildUserData(lead, {
          client_ip_address: req.socket.remoteAddress || '',
          client_user_agent: asText(req.headers['user-agent'], 400),
        }),
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
        meta.ok ? 1 : 0,
        eventId,
        nowIso(),
        meta.events_received == null ? null : meta.events_received,
        meta.ok ? null : (meta.error || 'Error Meta API'),
        lead.ref,
      );
      if (meta.ok) console.log('[lead] Lead enviado a Meta');
      else console.log('[meta] Error Meta API');
      send(res, 200, { ok: true, ref: lead.ref, event_id: eventId, events_received: meta.events_received, meta_ok: meta.ok }, origin);
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
      const q = asText(url.searchParams.get('q'), 80);
      if (!q) {
        send(res, 400, { error: 'Escribí un REF o un teléfono.' }, origin);
        return;
      }
      let row = null;
      const searchRef = pickSearchRef(q);
      if (searchRef) row = getLead(searchRef);
      const phone = normalizePhone(q);
      if (!row && phone) {
        row = db.prepare('SELECT * FROM leads WHERE telefono = ? ORDER BY created_at DESC LIMIT 1').get(phone) as LeadRow | undefined || null;
      }
      if (!row) row = getLead(q.toUpperCase());
      if (!row) {
        console.log('[search] REF no encontrado');
        send(res, 404, { error: 'REF no encontrado' }, origin);
        return;
      }
      send(res, 200, { ok: true, lead: publicLead(row) }, origin);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/purchase') {
      if (!ENV.META_ACCESS_TOKEN) {
        send(res, 503, { error: 'Falta el Access Token. Pegalo en .dev.vars y reiniciá.' }, origin);
        return;
      }
      const body = await readBody(req);
      const ref = asText(body.ref, 20).toUpperCase();
      const monto = Number(body.monto);
      const force = Boolean(body.force);
      const lead = getLead(ref);
      if (!lead) {
        console.log('[purchase] REF no encontrado');
        send(res, 404, { error: 'REF no encontrado' }, origin);
        return;
      }
      if (!(monto > 0)) {
        send(res, 400, { error: 'Monto inválido.' }, origin);
        return;
      }
      const alreadyHadPurchase = Boolean(lead.purchase_enviado);
      const eventId = 'purchase_' + lead.ref + '_' + Date.now().toString(36);
      const purchaseUserData = buildUserData(lead, {
        client_ip_address: req.socket.remoteAddress || '',
        client_user_agent: asText(req.headers['user-agent'], 400),
      });
      const purchaseCustom = { currency: 'ARS', value: Number(monto.toFixed(2)), order_id: lead.ref };
      const meta = await sendMetaEvent(ENV, {
        event_name: 'Purchase',
        event_id: eventId,
        event_source_url: DEFAULT_LANDING_URL,
        user_data: purchaseUserData,
        custom_data: purchaseCustom,
      });
      if (meta.ok) {
        await sendMetaEvent(ENV, {
          event_name: 'InitiateCheckout',
          event_id: 'ic_' + lead.ref + '_' + Date.now().toString(36),
          event_source_url: DEFAULT_LANDING_URL,
          user_data: purchaseUserData,
          custom_data: purchaseCustom,
        });
      }
      const created = nowIso();
      db.prepare(`
        INSERT INTO purchases (
          ref, monto, event_id, created_at,
          campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
          events_received, meta_status, meta_error, forced
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        lead.ref, monto, eventId, created,
        lead.campaign_id, lead.campaign_name, lead.adset_id, lead.adset_name, lead.ad_id, lead.ad_name,
        meta.events_received == null ? null : meta.events_received,
        meta.ok ? 'ok' : 'error',
        meta.ok ? null : (meta.error || 'Error Meta API'),
        (force || alreadyHadPurchase) ? 1 : 0,
      );
      if (!meta.ok) {
        db.prepare('UPDATE leads SET updated_at = ?, purchase_meta_error = ? WHERE ref = ?').run(created, meta.error, lead.ref);
        console.log('[meta] Error Meta API');
        send(res, 502, { error: meta.error || 'Error de Meta' }, origin);
        return;
      }
      db.prepare(`
        UPDATE leads SET
          updated_at = ?, status = 'PURCHASE', purchase_enviado = 1,
          purchase_event_id = ?, monto_purchase = ?, fecha_purchase = ?,
          purchase_events_received = ?, purchase_meta_error = NULL
        WHERE ref = ?
      `).run(created, eventId, monto, created, meta.events_received == null ? null : meta.events_received, lead.ref);
      console.log('[purchase] Purchase enviado');
      send(res, 200, {
        ok: true,
        ref: lead.ref,
        monto,
        event_id: eventId,
        fecha_purchase: created,
        events_received: meta.events_received,
        lead: publicLead(getLead(lead.ref)),
      }, origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/spend') {
      const range = parseStatsRange(url.searchParams.get('range'));
      const window = spendWindow(range);
      const rows = window.from && window.to
        ? db.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE day >= ? AND day <= ? ORDER BY day').all(window.from, window.to)
        : db.prepare('SELECT day, usd, fx, updated_at FROM ad_spend ORDER BY day').all();
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
        INSERT INTO ad_spend (day, usd, fx, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET usd = excluded.usd, fx = excluded.fx, updated_at = excluded.updated_at
      `).run(day, Math.round(usd * 100) / 100, Math.round(fx * 100) / 100, nowIso());
      const row = db.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE day = ?').get(day) as { day: string; usd: number; fx: number; updated_at: string };
      send(res, 200, { ok: true, ...summarizeSpend([row]), day: row.day, current_usd: row.usd, current_fx: row.fx }, origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/stats') {
      const leads = db.prepare(
        'SELECT ref, lead_enviado, purchase_enviado, lead_sent_at, created_at FROM leads',
      ).all() as Array<{
        ref: string;
        lead_enviado: number;
        purchase_enviado: number;
        lead_sent_at: string | null;
        created_at: string;
      }>;
      const purchases = db.prepare('SELECT ref, monto, created_at FROM purchases').all() as Array<{
        ref: string;
        monto: number;
        created_at: string;
      }>;
      send(res, 200, buildStats(parseStatsRange(url.searchParams.get('range')), leads, purchases), origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/purchases') {
      const q = asText(url.searchParams.get('q'), 80);
      const rows = q
        ? db.prepare('SELECT * FROM purchases WHERE ref LIKE ? ORDER BY created_at DESC LIMIT 200').all('%' + q.toUpperCase() + '%')
        : db.prepare('SELECT * FROM purchases ORDER BY created_at DESC LIMIT 200').all();
      send(res, 200, { ok: true, purchases: rows }, origin);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/leads') {
      const q = asText(url.searchParams.get('q'), 80);
      let rows: LeadRow[];
      if (q) {
        const phone = normalizePhone(q);
        if (phone) {
          rows = db.prepare('SELECT * FROM leads WHERE telefono = ? OR ref LIKE ? ORDER BY created_at DESC LIMIT 200').all(phone, '%' + q.toUpperCase() + '%') as LeadRow[];
        } else {
          rows = db.prepare('SELECT * FROM leads WHERE ref LIKE ? ORDER BY created_at DESC LIMIT 200').all('%' + q.toUpperCase() + '%') as LeadRow[];
        }
      } else {
        rows = db.prepare('SELECT * FROM leads ORDER BY created_at DESC LIMIT 200').all() as LeadRow[];
      }
      send(res, 200, { ok: true, leads: rows.map(publicLead) }, origin);
      return;
    }

    const leadMatch = url.pathname.match(/^\/api\/lead\/([^/]+)$/);
    if (req.method === 'GET' && leadMatch) {
      const row = getLead(decodeURIComponent(leadMatch[1]).toUpperCase());
      if (!row) {
        send(res, 404, { error: 'REF no encontrado' }, origin);
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
  console.log('[API] http://' + HOST + ':' + PORT);
  console.log('[API] db ' + path.join(dataDir, 'local.db'));
  if (!ENV.PURCHASE_SEND_KEY) console.log('[API] Falta PURCHASE_SEND_KEY');
  if (!ENV.META_ACCESS_TOKEN) console.log('[API] META_ACCESS_TOKEN pendiente');
});
