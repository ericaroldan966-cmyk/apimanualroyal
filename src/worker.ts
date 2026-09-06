import {
  DEFAULT_LANDING_URL,
  PIXEL_ID,
  PIXEL_ID_2,
  REF_CHARS,
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

type Env = {
  DB: D1Database;
  META_ACCESS_TOKEN?: string;
  META_ACCESS_TOKEN_2?: string;
  PURCHASE_SEND_KEY?: string;
  META_TEST_EVENT_CODE?: string;
  PIXEL_ID?: string;
  PIXEL_ID_2?: string;
  LANDING_URL?: string;
  ALLOWED_ORIGIN?: string;
};

const hits = new Map<string, number[]>();

function allowedOrigin(request: Request, env: Env): string {
  const incoming = request.headers.get('Origin') || '';
  if (isLocalOrigin(incoming)) return incoming;
  if (env.ALLOWED_ORIGIN && env.ALLOWED_ORIGIN !== '*') {
    return incoming === env.ALLOWED_ORIGIN ? incoming : env.ALLOWED_ORIGIN;
  }
  return incoming || '*';
}

function json(status: number, payload: unknown, origin: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin),
    },
  });
}

function makeRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = '';
  for (let i = 0; i < 6; i++) out += REF_CHARS[bytes[i] % REF_CHARS.length];
  return 'REF-' + out;
}

function makeToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: unknown): Promise<string | null> {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function rateLimited(ip: string): boolean {
  if (!ip) return false;
  const now = Date.now();
  const current = (hits.get(ip) || []).filter((time) => now - time < 15 * 60 * 1000);
  current.push(now);
  hits.set(ip, current);
  return current.length > 200;
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for') || '';
  const first = forwarded.split(',')[0].trim();
  return first || request.headers.get('x-real-ip') || request.headers.get('CF-Connecting-IP') || '';
}

function landingUrl(env: Env): string {
  return env.LANDING_URL || DEFAULT_LANDING_URL;
}

async function getLead(db: D1Database, ref: string): Promise<LeadRow | null> {
  return (await db.prepare('SELECT * FROM leads WHERE ref = ?').bind(ref).first()) as LeadRow | null;
}

async function insertLead(db: D1Database, ref: string, attr: Attribution, status: string): Promise<LeadRow> {
  const created = nowIso();
  await db.prepare(`
    INSERT INTO leads (
      ref, created_at, updated_at, status,
      fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name,
      landing_url, referrer, telefono
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    ref, created, created, status,
    attr.fbclid, attr.fbp, attr.fbc, attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
    attr.campaign_id, attr.adset_id, attr.ad_id, attr.campaign_name, attr.adset_name, attr.ad_name,
    attr.landing_url, attr.referrer, attr.telefono,
  ).run();
  const row = await getLead(db, ref);
  if (!row) throw new Error('No se pudo crear el lead.');
  return row;
}

async function updateAttribution(db: D1Database, ref: string, attr: Attribution): Promise<LeadRow> {
  await db.prepare(`
    UPDATE leads SET
      updated_at = ?,
      fbclid = ?, fbp = ?, fbc = ?,
      utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_content = ?, utm_term = ?,
      campaign_id = ?, adset_id = ?, ad_id = ?,
      campaign_name = ?, adset_name = ?, ad_name = ?,
      landing_url = ?, referrer = ?, telefono = ?
    WHERE ref = ?
  `).bind(
    nowIso(),
    attr.fbclid, attr.fbp, attr.fbc,
    attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
    attr.campaign_id, attr.adset_id, attr.ad_id,
    attr.campaign_name, attr.adset_name, attr.ad_name,
    attr.landing_url, attr.referrer, attr.telefono,
    ref,
  ).run();
  const row = await getLead(db, ref);
  if (!row) throw new Error('No se pudo actualizar el lead.');
  return row;
}

async function upsertVisit(db: D1Database, requestedRef: unknown, incoming: Attribution): Promise<LeadRow> {
  let ref = asText(requestedRef, 20).toUpperCase();
  if (ref && !isValidRef(ref)) ref = '';
  if (ref) {
    const existing = await getLead(db, ref);
    if (existing) return updateAttribution(db, ref, mergeAttribution(existing, incoming));
    return insertLead(db, ref, incoming, 'VISIT');
  }
  for (let i = 0; i < 5; i++) {
    const next = makeRef();
    const exists = await getLead(db, next);
    if (!exists) return insertLead(db, next, incoming, 'VISIT');
  }
  throw new Error('No se pudo generar REF.');
}

async function buildUserData(lead: LeadRow, extras: { client_ip_address?: string; client_user_agent?: string }): Promise<Record<string, unknown>> {
  const userData: Record<string, unknown> = {};
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.fbc) userData.fbc = lead.fbc;
  const phoneHash = await sha256(lead.telefono);
  if (phoneHash) userData.ph = [phoneHash];
  const externalId = await sha256(lead.ref);
  if (externalId) userData.external_id = [externalId];
  if (extras.client_ip_address) userData.client_ip_address = extras.client_ip_address;
  if (extras.client_user_agent) userData.client_user_agent = extras.client_user_agent;
  return userData;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text) return {};
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = allowedOrigin(request, env);
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      if (request.method === 'GET' && url.pathname === '/api/health') {
        return json(200, {
          ok: true,
          pixel_id: env.PIXEL_ID || PIXEL_ID,
          token_configured: Boolean(env.META_ACCESS_TOKEN),
          token_2_configured: Boolean(env.META_ACCESS_TOKEN_2),
          send_key_configured: Boolean(env.PURCHASE_SEND_KEY),
          db: Boolean(env.DB),
        }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/visit') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        if (rateLimited(clientIp(request))) return json(429, { error: 'Demasiados intentos.' }, origin);
        const body = await readJson(request);
        if (!Object.keys(body).length) return json(400, { error: 'Cuerpo inválido.' }, origin);
        const lead = await upsertVisit(env.DB, body.ref, attributionFromBody(body));
        console.log('[visit] Lead guardado');
        return json(200, { ok: true, ref: lead.ref, status: lead.status }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/lead') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        if (rateLimited(clientIp(request))) return json(429, { error: 'Demasiados intentos.' }, origin);
        const body = await readJson(request);
        if (!Object.keys(body).length) return json(400, { error: 'Cuerpo inválido.' }, origin);
        const lead = await upsertVisit(env.DB, body.ref, attributionFromBody(body));
        const eventId = asText(body.event_id, 80) || ('lead_' + lead.ref);
        if (lead.lead_enviado) {
          console.log('[lead] Lead omitido, ya enviado');
          return json(200, { ok: true, ref: lead.ref, event_id: lead.lead_event_id || eventId, already_sent: true }, origin);
        }
        const meta = await sendMetaEvent({
          META_ACCESS_TOKEN: env.META_ACCESS_TOKEN || '',
          META_ACCESS_TOKEN_2: env.META_ACCESS_TOKEN_2 || '',
          META_TEST_EVENT_CODE: env.META_TEST_EVENT_CODE,
          PIXEL_ID: env.PIXEL_ID,
          PIXEL_ID_2: env.PIXEL_ID_2 || PIXEL_ID_2,
        }, {
          event_name: 'Lead',
          event_id: eventId,
          event_source_url: lead.landing_url || landingUrl(env),
          user_data: await buildUserData(lead, {
            client_ip_address: clientIp(request),
            client_user_agent: asText(request.headers.get('User-Agent'), 400),
          }),
          custom_data: {},
        });
        await env.DB.prepare(`
          UPDATE leads SET
            updated_at = ?,
            status = CASE WHEN status = 'PURCHASE' THEN status ELSE 'LEAD' END,
            lead_enviado = ?,
            lead_event_id = ?,
            lead_sent_at = ?,
            lead_events_received = ?,
            lead_meta_error = ?
          WHERE ref = ?
        `).bind(
          nowIso(),
          meta.ok ? 1 : 0,
          eventId,
          nowIso(),
          meta.events_received == null ? null : meta.events_received,
          meta.ok ? null : (meta.error || 'Error Meta API'),
          lead.ref,
        ).run();
        if (meta.ok) console.log('[lead] Lead enviado a Meta');
        else console.log('[meta] Error Meta API');
        return json(200, { ok: true, ref: lead.ref, event_id: eventId, events_received: meta.events_received, meta_ok: meta.ok }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/login') {
        if (!env.PURCHASE_SEND_KEY) return json(503, { error: 'PURCHASE_SEND_KEY no está configurado en el servidor.' }, origin);
        const body = await readJson(request);
        if (asText(body.key, 200) !== env.PURCHASE_SEND_KEY) return json(401, { error: 'Clave inválida.' }, origin);
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const token = makeToken();
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').bind(token, nowIso(), expires).run();
        console.log('[auth] Sesión creada');
        return json(200, { ok: true, token, expires_at: expires }, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/search') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const q = asText(url.searchParams.get('q'), 300);
        if (!q) return json(400, { error: 'Escribí un REF o un teléfono.' }, origin);
        let row = null;
        const searchRef = pickSearchRef(q);
        if (searchRef) row = await getLead(env.DB, searchRef);
        const phone = normalizePhone(q);
        if (!row && phone) {
          row = await env.DB.prepare('SELECT * FROM leads WHERE telefono = ? ORDER BY created_at DESC LIMIT 1').bind(phone).first() as LeadRow | null;
        }
        if (!row) row = await getLead(env.DB, q.toUpperCase());
        if (!row) {
          console.log('[search] REF no encontrado');
          return json(404, { error: 'No encontramos ese cliente.' }, origin);
        }
        return json(200, { ok: true, lead: publicLead(row) }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/purchase') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        if (!env.META_ACCESS_TOKEN) return json(503, { error: 'Falta el Access Token. Pegalo en .dev.vars y reiniciá.' }, origin);
        const body = await readJson(request);
        const ref = pickSearchRef(asText(body.ref, 300)) || asText(body.ref, 20).toUpperCase();
        const monto = Number(body.monto);
        const force = Boolean(body.force);
        if (!ref) return json(400, { error: 'Falta el REF.' }, origin);
        if (!Number.isFinite(monto) || monto <= 0) return json(400, { error: 'Monto inválido.' }, origin);
        const lead = await getLead(env.DB, ref);
        if (!lead) {
          console.log('[purchase] REF no encontrado');
          return json(404, { error: 'REF no encontrado.' }, origin);
        }
        const alreadyHadPurchase = Boolean(lead.purchase_enviado);
        const eventId = 'purchase_' + lead.ref + '_' + Date.now().toString(36);
        const purchaseUserData = await buildUserData(lead, {
          client_ip_address: clientIp(request),
          client_user_agent: asText(request.headers.get('User-Agent'), 400),
        });
        const purchaseCustom = { currency: 'ARS', value: Number(monto.toFixed(2)), order_id: lead.ref };
        const metaEnv = {
          META_ACCESS_TOKEN: env.META_ACCESS_TOKEN,
          META_ACCESS_TOKEN_2: env.META_ACCESS_TOKEN_2 || '',
          META_TEST_EVENT_CODE: env.META_TEST_EVENT_CODE,
          PIXEL_ID: env.PIXEL_ID,
          PIXEL_ID_2: env.PIXEL_ID_2 || PIXEL_ID_2,
        };
        const meta = await sendMetaEvent(metaEnv, {
          event_name: 'Purchase',
          event_id: eventId,
          event_source_url: landingUrl(env),
          user_data: purchaseUserData,
          custom_data: purchaseCustom,
        });
        if (meta.ok) {
          await sendMetaEvent(metaEnv, {
            event_name: 'InitiateCheckout',
            event_id: 'ic_' + lead.ref + '_' + Date.now().toString(36),
            event_source_url: landingUrl(env),
            user_data: purchaseUserData,
            custom_data: purchaseCustom,
          });
        }
        const created = nowIso();
        await env.DB.prepare(`
          INSERT INTO purchases (
            ref, monto, event_id, created_at,
            campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
            events_received, meta_status, meta_error, forced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          lead.ref, monto, eventId, created,
          lead.campaign_id, lead.campaign_name, lead.adset_id, lead.adset_name, lead.ad_id, lead.ad_name,
          meta.events_received == null ? null : meta.events_received,
          meta.ok ? 'ok' : 'error',
          meta.ok ? null : (meta.error || 'Error Meta API'),
          (force || alreadyHadPurchase) ? 1 : 0,
        ).run();
        if (!meta.ok) {
          await env.DB.prepare('UPDATE leads SET updated_at = ?, purchase_meta_error = ? WHERE ref = ?').bind(created, meta.error || 'Error Meta API', lead.ref).run();
          console.log('[meta] Error Meta API');
          return json(502, { error: meta.error || 'Meta rechazó el evento.' }, origin);
        }
        await env.DB.prepare(`
          UPDATE leads SET
            updated_at = ?, status = 'PURCHASE', purchase_enviado = 1,
            purchase_event_id = ?, monto_purchase = ?, fecha_purchase = ?,
            purchase_events_received = ?, purchase_meta_error = NULL
          WHERE ref = ?
        `).bind(created, eventId, monto, created, meta.events_received == null ? null : meta.events_received, lead.ref).run();
        console.log('[purchase] Purchase enviado');
        const updated = await getLead(env.DB, lead.ref);
        return json(200, {
          ok: true,
          ref: lead.ref,
          monto,
          event_id: eventId,
          fecha_purchase: created,
          events_received: meta.events_received,
          lead: publicLead(updated),
        }, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/spend') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const range = parseStatsRange(url.searchParams.get('range'));
        const window = spendWindow(range);
        const spendResult = window.from && window.to
          ? await env.DB.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE day >= ? AND day <= ? ORDER BY day').bind(window.from, window.to).all()
          : await env.DB.prepare('SELECT day, usd, fx, updated_at FROM ad_spend ORDER BY day').all();
        const summary = summarizeSpend((spendResult.results || []) as Array<{ day: string; usd: number; fx: number; updated_at: string }>);
        const current = summary.items.find((row) => row.day === window.editDay);
        return json(200, {
          ok: true,
          range,
          day: window.editDay,
          usd: summary.usd,
          ars: summary.ars,
          current_usd: current ? current.usd : 0,
          current_fx: current ? current.fx : 0,
          items: summary.items,
        }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/spend') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const body = await request.json().catch(() => ({})) as Record<string, unknown>;
        const window = spendWindow(parseStatsRange(body.range));
        const day = isYmd(body.day) ? String(body.day) : window.editDay;
        const usd = Number(body.usd);
        const fx = Number(body.fx);
        if (!(usd >= 0) || !Number.isFinite(usd)) return json(400, { error: 'Ingresá el gasto en dólares.' }, origin);
        if (!(fx >= 0) || !Number.isFinite(fx)) return json(400, { error: 'Ingresá la cotización.' }, origin);
        await env.DB.prepare(`
          INSERT INTO ad_spend (day, usd, fx, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(day) DO UPDATE SET usd = excluded.usd, fx = excluded.fx, updated_at = excluded.updated_at
        `).bind(day, Math.round(usd * 100) / 100, Math.round(fx * 100) / 100, nowIso()).run();
        const row = await env.DB.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE day = ?').bind(day).first() as { day: string; usd: number; fx: number; updated_at: string };
        return json(200, { ok: true, ...summarizeSpend([row]), day: row.day, current_usd: row.usd, current_fx: row.fx }, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/stats') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const leadResult = await env.DB.prepare(
          'SELECT ref, lead_enviado, purchase_enviado, lead_sent_at, created_at FROM leads',
        ).all();
        const purchaseResult = await env.DB.prepare('SELECT ref, monto, created_at FROM purchases').all();
        return json(
          200,
          buildStats(
            parseStatsRange(url.searchParams.get('range')),
            (leadResult.results || []) as LeadRow[],
            (purchaseResult.results || []) as Array<{ ref: string; monto: number; created_at: string }>,
          ),
          origin,
        );
      }

      if (request.method === 'GET' && url.pathname === '/api/purchases') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const q = asText(url.searchParams.get('q'), 80);
        let sql = 'SELECT * FROM purchases';
        const values: string[] = [];
        if (q) {
          const phone = normalizePhone(q);
          const ref = q.toUpperCase();
          if (phone) {
            sql += ' WHERE ref IN (SELECT ref FROM leads WHERE telefono = ?) OR ref LIKE ?';
            values.push(phone, '%' + ref + '%');
          } else {
            sql += ' WHERE ref LIKE ?';
            values.push('%' + ref + '%');
          }
        }
        sql += ' ORDER BY created_at DESC LIMIT 200';
        const result = await env.DB.prepare(sql).bind(...values).all();
        return json(200, { ok: true, purchases: result.results || [] }, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/leads') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const q = asText(url.searchParams.get('q'), 80);
        let sql = 'SELECT * FROM leads';
        const values: string[] = [];
        if (q) {
          const phone = normalizePhone(q);
          const ref = q.toUpperCase();
          if (phone) {
            sql += ' WHERE telefono = ? OR ref LIKE ?';
            values.push(phone, '%' + ref + '%');
          } else {
            sql += ' WHERE ref LIKE ?';
            values.push('%' + ref + '%');
          }
        }
        sql += ' ORDER BY created_at DESC LIMIT 200';
        const result = await env.DB.prepare(sql).bind(...values).all();
        const leads = ((result.results || []) as LeadRow[]).map(publicLead);
        return json(200, { ok: true, leads }, origin);
      }

      const leadMatch = url.pathname.match(/^\/api\/lead\/([^/]+)$/);
      if (request.method === 'GET' && leadMatch) {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const row = await getLead(env.DB, decodeURIComponent(leadMatch[1]).toUpperCase());
        if (!row) return json(404, { error: 'REF no encontrado.' }, origin);
        return json(200, { ok: true, lead: publicLead(row) }, origin);
      }

      return json(404, { error: 'Ruta no encontrada.' }, origin);
    } catch {
      console.log('[api] Error interno');
      return json(500, { error: 'Error interno.' }, origin);
    }
  },
};
