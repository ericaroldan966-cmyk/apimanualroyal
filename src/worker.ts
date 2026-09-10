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
  type TenantEnvSource,
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
  KOVA_PIXEL_ID?: string;
  KOVA_PIXEL_ID_2?: string;
  KOVA_META_ACCESS_TOKEN?: string;
  KOVA_META_ACCESS_TOKEN_2?: string;
  KOVA_LANDING_URL?: string;
  FANTASTICO_PIXEL_ID?: string;
  FANTASTICO_PIXEL_ID_2?: string;
  FANTASTICO_META_ACCESS_TOKEN?: string;
  FANTASTICO_META_ACCESS_TOKEN_2?: string;
  FANTASTICO_LANDING_URL?: string;
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
  return firstForwardedIp(
    request.headers.get('x-forwarded-for'),
    request.headers.get('x-real-ip'),
    request.headers.get('CF-Connecting-IP'),
    request.headers.get('cf-connecting-ip'),
  );
}

async function persistVisitorContext(db: D1Database, lead: LeadRow, ip: string, userAgent: string): Promise<LeadRow> {
  await db.prepare(`
    UPDATE leads SET
      client_ip = CASE WHEN client_ip IS NULL OR client_ip = '' THEN ? ELSE client_ip END,
      user_agent = CASE WHEN user_agent IS NULL OR user_agent = '' THEN ? ELSE user_agent END,
      updated_at = ?
    WHERE id = ?
  `).bind(ip, userAgent, nowIso(), lead.id).run();
  const row = await getLeadById(db, Number(lead.id));
  if (!row) throw new Error('No se pudo guardar el contexto del visitante.');
  return row;
}

function tenantOf(request: Request, env: Env, body?: Record<string, unknown>): TenantConfig {
  const url = new URL(request.url);
  return tenantConfig(resolveTenantId({
    bodyTenant: body?.tenant,
    headerTenant: request.headers.get('x-tenant'),
    queryTenant: url.searchParams.get('tenant'),
    origin: request.headers.get('Origin') || '',
    landingUrl: String(body?.landing_url || ''),
    env: env as TenantEnvSource,
  }), env as TenantEnvSource);
}

function refLog(tenant: TenantId): string {
  return '[' + tenant.toUpperCase() + '][REF]';
}

async function getLeadById(db: D1Database, id: number): Promise<LeadRow | null> {
  return (await db.prepare('SELECT * FROM leads WHERE id = ?').bind(id).first()) as LeadRow | null;
}

async function getLeadByRef(db: D1Database, ref: string): Promise<LeadRow | null> {
  return (await db.prepare('SELECT * FROM leads WHERE ref = ?').bind(ref).first()) as LeadRow | null;
}

async function findLead(db: D1Database, code: string, tenant?: TenantId): Promise<LeadRow | null> {
  const raw = String(code || '').trim();
  if (!raw) return null;
  let row: LeadRow | null = null;
  if (isPersonId(raw)) row = await getLeadById(db, Number(raw));
  if (!row) row = await getLeadByRef(db, raw);
  if (!row) return null;
  if (tenant && leadTenant(row) !== tenant) return null;
  return row;
}

async function insertLead(db: D1Database, attr: Attribution, status: string, tenant: TenantId): Promise<LeadRow> {
  const created = nowIso();
  const temp = 'TMP-' + makeToken().slice(0, 16);
  const result = await db.prepare(`
    INSERT INTO leads (
      ref, created_at, updated_at, status, tenant, ad,
      fbclid, fbp, fbc, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name,
      landing_url, referrer, telefono
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    temp, created, created, status, tenant, attr.ad > 0 ? attr.ad : null,
    attr.fbclid, attr.fbp, attr.fbc, attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
    attr.campaign_id, attr.adset_id, attr.ad_id, attr.campaign_name, attr.adset_name, attr.ad_name,
    attr.landing_url, attr.referrer, attr.telefono,
  ).run();
  const id = Number(result.meta.last_row_id);
  await db.prepare('UPDATE leads SET ref = ? WHERE id = ?').bind(String(id), id).run();
  const row = await getLeadById(db, id);
  if (!row) throw new Error('No se pudo crear el lead.');
  return row;
}

async function updateAttribution(db: D1Database, lead: LeadRow, attr: Attribution): Promise<LeadRow> {
  await db.prepare(`
    UPDATE leads SET
      updated_at = ?,
      ad = ?,
      fbclid = ?, fbp = ?, fbc = ?,
      utm_source = ?, utm_medium = ?, utm_campaign = ?, utm_content = ?, utm_term = ?,
      campaign_id = ?, adset_id = ?, ad_id = ?,
      campaign_name = ?, adset_name = ?, ad_name = ?,
      landing_url = ?, referrer = ?, telefono = ?
    WHERE id = ?
  `).bind(
    nowIso(),
    attr.ad > 0 ? attr.ad : (Number(lead.ad) > 0 ? Number(lead.ad) : null),
    attr.fbclid, attr.fbp, attr.fbc,
    attr.utm_source, attr.utm_medium, attr.utm_campaign, attr.utm_content, attr.utm_term,
    attr.campaign_id, attr.adset_id, attr.ad_id,
    attr.campaign_name, attr.adset_name, attr.ad_name,
    attr.landing_url, attr.referrer, attr.telefono,
    lead.id,
  ).run();
  const row = await getLeadById(db, Number(lead.id));
  if (!row) throw new Error('No se pudo actualizar el lead.');
  return row;
}

async function upsertVisit(db: D1Database, requestedRef: unknown, incoming: Attribution, tenant: TenantId): Promise<LeadRow> {
  const requested = pickSearchRef(String(requestedRef || ''));
  if (requested) {
    const existing = await findLead(db, requested, tenant);
    if (existing) {
      const updated = await updateAttribution(db, existing, mergeAttribution(existing, incoming));
      console.log(refLog(tenant), 'persisted', publicCode(updated));
      return updated;
    }
  }
  const row = await insertLead(db, incoming, 'VISIT', tenant);
  console.log(refLog(tenant), 'created', publicCode(row));
  return row;
}

async function buildUserData(lead: LeadRow, extras: { client_ip_address?: string; client_user_agent?: string }): Promise<Record<string, unknown>> {
  const userData: Record<string, unknown> = {};
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.fbc) userData.fbc = lead.fbc;
  const phoneHash = await sha256(lead.telefono);
  if (phoneHash) userData.ph = [phoneHash];
  const externalId = await sha256(publicCode(lead));
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
        const royal = tenantConfig('royal', env as TenantEnvSource);
        const kova = tenantConfig('kova', env as TenantEnvSource);
        const fantastico = tenantConfig('fantastico', env as TenantEnvSource);
        return json(200, {
          ok: true,
          tenants: {
            royal: { pixel_id: royal.meta.PIXEL_ID, token_configured: Boolean(royal.meta.META_ACCESS_TOKEN) },
            kova: { pixel_id: kova.meta.PIXEL_ID, token_configured: Boolean(kova.meta.META_ACCESS_TOKEN) },
            fantastico: { pixel_id: fantastico.meta.PIXEL_ID, token_configured: Boolean(fantastico.meta.META_ACCESS_TOKEN) },
          },
          send_key_configured: Boolean(env.PURCHASE_SEND_KEY),
          db: Boolean(env.DB),
        }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/visit') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        if (rateLimited(clientIp(request))) return json(429, { error: 'Demasiados intentos.' }, origin);
        const body = await readJson(request);
        if (!Object.keys(body).length) return json(400, { error: 'Cuerpo invÃ¡lido.' }, origin);
        const tenant = tenantOf(request, env, body);
        const ip = clientIp(request);
        const userAgent = asText(request.headers.get('User-Agent'), 400);
        const incoming = attributionFromBody({ ...body, a: body.a ?? body.ad ?? url.searchParams.get('a') });
        const lead = await persistVisitorContext(env.DB, await upsertVisit(env.DB, body.ref, incoming, tenant.id), ip, userAgent);
        const code = publicCode(lead);
        console.log(refLog(tenant.id), 'returned to landing', code);
        void sendMetaEvent(tenant.meta, {
          event_name: 'PageView',
          event_id: pageViewEventId(code),
          event_source_url: lead.landing_url || tenant.landingUrl,
          user_data: await buildUserData(lead, {
            client_ip_address: ip,
            client_user_agent: userAgent,
          }),
          custom_data: {},
        });
        console.log('[visit] Lead guardado ' + tenant.id);
        return json(200, { ok: true, ref: code, id: lead.id, a: Number(lead.ad) || 0, status: lead.status, tenant: tenant.id }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/lead') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        if (rateLimited(clientIp(request))) return json(429, { error: 'Demasiados intentos.' }, origin);
        const body = await readJson(request);
        if (!Object.keys(body).length) return json(400, { error: 'Cuerpo invÃ¡lido.' }, origin);
        const tenant = tenantOf(request, env, body);
        const ip = clientIp(request);
        const userAgent = asText(request.headers.get('User-Agent'), 400);
        const incoming = attributionFromBody({ ...body, a: body.a ?? body.ad ?? url.searchParams.get('a') });
        const lead = await persistVisitorContext(env.DB, await upsertVisit(env.DB, body.ref, incoming, tenant.id), ip, userAgent);
        const code = publicCode(lead);
        const eventId = asText(body.event_id, 80) || ('lead_' + code);
        const visitorData = await buildUserData(lead, {
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
          return json(200, { ok: true, ref: code, id: lead.id, a: Number(lead.ad) || 0, event_id: lead.lead_event_id || eventId, already_sent: true, tenant: tenant.id }, origin);
        }
        const meta = await sendMetaEvent(tenant.meta, {
          event_name: 'Lead',
          event_id: eventId,
          event_source_url: lead.landing_url || tenant.landingUrl,
          user_data: visitorData,
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
          (meta.pixel1_ok || meta.pixel2_ok) ? 1 : 0,
          eventId,
          nowIso(),
          meta.events_received == null ? null : meta.events_received,
          meta.ok ? null : metaFailureMessage(meta),
          lead.ref,
        ).run();
        console.log('[lead] Lead pixel1_ok=' + String(meta.pixel1_ok) + ' pixel2_ok=' + String(meta.pixel2_ok) + (meta.ok ? '' : ' :: ' + metaFailureMessage(meta)));
        return json(200, {
          ok: true,
          ref: code,
          id: lead.id,
          a: Number(lead.ad) || 0,
          event_id: eventId,
          events_received: meta.events_received,
          tenant: tenant.id,
          ...metaPixelPayload(meta),
        }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/login') {
        if (!env.PURCHASE_SEND_KEY) return json(503, { error: 'PURCHASE_SEND_KEY no estÃ¡ configurado en el servidor.' }, origin);
        const body = await readJson(request);
        if (asText(body.key, 200) !== env.PURCHASE_SEND_KEY) return json(401, { error: 'Clave invÃ¡lida.' }, origin);
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const token = makeToken();
        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare('INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)').bind(token, nowIso(), expires).run();
        console.log('[auth] SesiÃ³n creada');
        return json(200, { ok: true, token, expires_at: expires }, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/search') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const tenant = tenantOf(request, env);
        const q = asText(url.searchParams.get('q'), 300);
        if (!q) return json(400, { error: 'Escribí el número de persona o un teléfono.' }, origin);
        let row = null;
        const searchRef = pickSearchRef(q);
        console.log(refLog(tenant.id), 'search requested', searchRef || q);
        if (searchRef) row = await findLead(env.DB, searchRef, tenant.id);
        const phone = normalizePhone(q);
        if (!row && phone) {
          row = await env.DB.prepare('SELECT * FROM leads WHERE telefono = ? AND tenant = ? ORDER BY created_at DESC LIMIT 1').bind(phone, tenant.id).first() as LeadRow | null;
        }
        if (!row) row = await findLead(env.DB, q, tenant.id);
        if (!row) {
          console.log(refLog(tenant.id), 'not found', searchRef || q);
          return json(404, { error: 'No encontramos ese cliente.' }, origin);
        }
        console.log(refLog(tenant.id), 'found', row.ref);
        return json(200, { ok: true, lead: publicLead(row) }, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/purchase') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const body = await readJson(request);
        const tenant = tenantOf(request, env, body);
        if (!tenant.meta.META_ACCESS_TOKEN && !tenant.meta.META_ACCESS_TOKEN_2) {
          return json(503, { error: 'Falta META_ACCESS_TOKEN o META_ACCESS_TOKEN_2.' }, origin);
        }
        const ref = pickSearchRef(asText(body.ref, 300)) || asText(body.ref, 20);
        const monto = Number(body.monto);
        const force = Boolean(body.force);
        if (!ref) return json(400, { error: 'Falta el código.' }, origin);
        if (!Number.isFinite(monto) || monto <= 0) return json(400, { error: 'Monto inválido.' }, origin);
        const lead = await findLead(env.DB, ref, tenant.id);
        if (!lead) {
          console.log('[purchase] Código no encontrado');
          return json(404, { error: 'Código no encontrado.' }, origin);
        }
        const alreadyHadPurchase = Boolean(lead.purchase_enviado);
        const code = publicCode(lead);
        const eventId = 'purchase_' + code + '_' + Date.now().toString(36);
        const purchaseUserData = await buildUserData(lead, {
          client_ip_address: storedOrRequest(lead.client_ip, clientIp(request)),
          client_user_agent: storedOrRequest(lead.user_agent, asText(request.headers.get('User-Agent'), 400)),
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
        await env.DB.prepare(`
          INSERT INTO purchases (
            ref, monto, event_id, created_at,
            campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
            events_received, meta_status, meta_error, forced
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          code, monto, eventId, created,
          lead.campaign_id, lead.campaign_name, lead.adset_id, lead.adset_name, lead.ad_id, lead.ad_name,
          meta.events_received == null ? null : meta.events_received,
          metaStatus,
          metaError,
          (force || alreadyHadPurchase) ? 1 : 0,
        ).run();
        if (!saleSaved) {
          await env.DB.prepare('UPDATE leads SET updated_at = ?, purchase_meta_error = ? WHERE ref = ?').bind(created, metaError, lead.ref).run();
          console.log('[purchase] Purchase error pixel1_ok=false pixel2_ok=false :: ' + metaError);
          return json(502, {
            error: metaError || 'Meta rechazÃ³ el evento.',
            saved: false,
            ...metaPixelPayload(meta),
          }, origin);
        }
        await env.DB.prepare(`
          UPDATE leads SET
            updated_at = ?, status = 'PURCHASE', purchase_enviado = 1,
            purchase_event_id = ?, monto_purchase = ?, fecha_purchase = ?,
            purchase_events_received = ?, purchase_meta_error = ?
          WHERE ref = ?
        `).bind(created, eventId, monto, created, meta.events_received == null ? null : meta.events_received, metaError, lead.ref).run();
        console.log('[purchase] Purchase guardado pixel1_ok=' + String(meta.pixel1_ok) + ' pixel2_ok=' + String(meta.pixel2_ok) + (meta.ok ? '' : ' :: ' + metaError));
        const updated = await getLeadById(env.DB, Number(lead.id));
        return json(200, {
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
          lead: publicLead(updated),
        }, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/spend') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const tenant = tenantOf(request, env);
        const range = parseStatsRange(url.searchParams.get('range'));
        const window = spendWindow(range);
        const spendResult = window.from && window.to
          ? await env.DB.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE tenant = ? AND day >= ? AND day <= ? ORDER BY day').bind(tenant.id, window.from, window.to).all()
          : await env.DB.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE tenant = ? ORDER BY day').bind(tenant.id).all();
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
        const tenant = tenantOf(request, env, body);
        const window = spendWindow(parseStatsRange(body.range));
        const day = isYmd(body.day) ? String(body.day) : window.editDay;
        const usd = Number(body.usd);
        const fx = Number(body.fx);
        if (!(usd >= 0) || !Number.isFinite(usd)) return json(400, { error: 'IngresÃ¡ el gasto en dÃ³lares.' }, origin);
        if (!(fx >= 0) || !Number.isFinite(fx)) return json(400, { error: 'IngresÃ¡ la cotizaciÃ³n.' }, origin);
        await env.DB.prepare(`
          INSERT INTO ad_spend (tenant, day, usd, fx, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(tenant, day) DO UPDATE SET usd = excluded.usd, fx = excluded.fx, updated_at = excluded.updated_at
        `).bind(tenant.id, day, Math.round(usd * 100) / 100, Math.round(fx * 100) / 100, nowIso()).run();
        const row = await env.DB.prepare('SELECT day, usd, fx, updated_at FROM ad_spend WHERE tenant = ? AND day = ?').bind(tenant.id, day).first() as { day: string; usd: number; fx: number; updated_at: string };
        return json(200, { ok: true, ...summarizeSpend([row]), day: row.day, current_usd: row.usd, current_fx: row.fx }, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/stats') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const tenant = tenantOf(request, env);
        const leadResult = await env.DB.prepare(
          'SELECT ref, lead_enviado, purchase_enviado, lead_sent_at, created_at FROM leads WHERE tenant = ?',
        ).bind(tenant.id).all();
        const purchaseResult = await env.DB.prepare(
          'SELECT p.ref, p.monto, p.created_at ' + PURCHASE_LEAD_JOIN + ' WHERE l.tenant = ?',
        ).bind(tenant.id).all();
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
        const tenant = tenantOf(request, env);
        const q = asText(url.searchParams.get('q'), 80);
        const sql = q
          ? 'SELECT p.* ' + PURCHASE_LEAD_JOIN + ' WHERE l.tenant = ? AND (p.ref LIKE ? OR CAST(l.id AS TEXT) = ?) ORDER BY p.created_at DESC LIMIT 200'
          : 'SELECT p.* ' + PURCHASE_LEAD_JOIN + ' WHERE l.tenant = ? ORDER BY p.created_at DESC LIMIT 200';
        const values = q ? [tenant.id, '%' + q.toUpperCase() + '%', q.trim()] : [tenant.id];
        const result = await env.DB.prepare(sql).bind(...values).all();
        return json(200, { ok: true, purchases: result.results || [] }, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/leads') {
        if (!env.DB) return json(503, { error: 'Base D1 no conectada.' }, origin);
        const tenant = tenantOf(request, env);
        const q = asText(url.searchParams.get('q'), 80);
        let sql = 'SELECT * FROM leads WHERE tenant = ?';
        const values: string[] = [tenant.id];
        if (q) {
          const phone = normalizePhone(q);
          const ref = q.toUpperCase();
          if (phone) {
            sql += ' AND (telefono = ? OR ref LIKE ? OR CAST(id AS TEXT) = ?)';
            values.push(phone, '%' + ref + '%', q);
          } else {
            sql += ' AND (ref LIKE ? OR CAST(id AS TEXT) = ?)';
            values.push('%' + ref + '%', q);
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
        const tenant = tenantOf(request, env);
        const row = await findLead(env.DB, decodeURIComponent(leadMatch[1]), tenant.id);
        if (!row) return json(404, { error: 'Código no encontrado.' }, origin);
        return json(200, { ok: true, lead: publicLead(row) }, origin);
      }

      return json(404, { error: 'Ruta no encontrada.' }, origin);
    } catch {
      console.log('[api] Error interno');
      return json(500, { error: 'Error interno.' }, origin);
    }
  },
};

