export const PIXEL_ID = '1767312904299608';
export const PIXEL_ID_2 = '1075060428238436';
export const GRAPH_VERSION = 'v21.0';
export const DEFAULT_LANDING_URL = 'https://ericaroldan966-cmyk.github.io/landingappganamos/';
export const DEFAULT_KOVA_LANDING_URL = 'https://landing-kovaagency.vercel.app';
export const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TENANTS = ['royal', 'kova', 'fantastico'] as const;
export type TenantId = (typeof TENANTS)[number];

export type Attribution = {
  fbclid: string;
  fbp: string;
  fbc: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  campaign_id: string;
  adset_id: string;
  ad_id: string;
  campaign_name: string;
  adset_name: string;
  ad_name: string;
  landing_url: string;
  referrer: string;
  telefono: string;
  ad: number;
};

export type LeadRow = Attribution & {
  id?: number;
  ref: string;
  tenant?: string;
  created_at: string;
  updated_at: string;
  status: string;
  client_ip?: string | null;
  user_agent?: string | null;
  lead_enviado: number;
  lead_event_id: string | null;
  lead_sent_at: string | null;
  lead_events_received: number | null;
  lead_meta_error: string | null;
  purchase_enviado: number;
  purchase_event_id: string | null;
  monto_purchase: number | null;
  fecha_purchase: string | null;
  purchase_events_received: number | null;
  purchase_meta_error: string | null;
};

export type PublicLead = {
  ref: string;
  id: number | null;
  a: number;
  status: string;
  created_at: string;
  lead_sent_at: string | null;
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  utm_source: string;
  utm_campaign: string;
  utm_content: string;
  utm_term: string;
  lead_enviado: boolean;
  purchase_enviado: boolean;
  monto_purchase: number | null;
  fecha_purchase: string | null;
  purchase_event_id: string | null;
  has_fbp: boolean;
  has_fbc: boolean;
};

export type MetaEnv = {
  META_ACCESS_TOKEN: string;
  META_ACCESS_TOKEN_2?: string;
  META_TEST_EVENT_CODE?: string;
  PIXEL_ID?: string;
  PIXEL_ID_2?: string;
  META_BRAND?: string;
};

export type TenantEnvSource = Record<string, string | undefined>;

export type TenantConfig = {
  id: TenantId;
  landingUrl: string;
  meta: MetaEnv;
};

export function parseTenant(value: unknown): TenantId | '' {
  const raw = String(value || '').trim().toLowerCase();
  return TENANTS.includes(raw as TenantId) ? (raw as TenantId) : '';
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return String(value || '').replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
  }
}

export function resolveTenantId(input: {
  bodyTenant?: unknown;
  headerTenant?: unknown;
  queryTenant?: unknown;
  origin?: string;
  landingUrl?: string;
  env?: TenantEnvSource;
}): TenantId {
  const fromBody = parseTenant(input.bodyTenant);
  if (fromBody) return fromBody;
  const fromHeader = parseTenant(input.headerTenant);
  if (fromHeader) return fromHeader;
  const fromQuery = parseTenant(input.queryTenant);
  if (fromQuery) return fromQuery;

  const env = input.env || {};
  const kovaHost = hostOf(env.KOVA_LANDING_URL || DEFAULT_KOVA_LANDING_URL);
  const fantHost = hostOf(env.FANTASTICO_LANDING_URL || '');
  const royalHost = hostOf(env.LANDING_URL || env.ROYAL_LANDING_URL || DEFAULT_LANDING_URL);
  for (const host of [hostOf(input.origin || ''), hostOf(input.landingUrl || '')]) {
    if (!host) continue;
    if (kovaHost && host === kovaHost) return 'kova';
    if (fantHost && host === fantHost) return 'fantastico';
    if (royalHost && host === royalHost) return 'royal';
  }
  return 'royal';
}

export function tenantConfig(id: TenantId, env: TenantEnvSource = {}): TenantConfig {
  const testCode = env.META_TEST_EVENT_CODE || '';
  if (id === 'kova') {
    return {
      id,
      landingUrl: (env.KOVA_LANDING_URL || DEFAULT_KOVA_LANDING_URL).replace(/\/$/, ''),
      meta: {
        META_BRAND: 'KOVA',
        PIXEL_ID: env.KOVA_PIXEL_ID || '1612969067103162',
        PIXEL_ID_2: env.KOVA_PIXEL_ID_2 || '936629336158894',
        META_ACCESS_TOKEN: env.KOVA_META_ACCESS_TOKEN || '',
        META_ACCESS_TOKEN_2: env.KOVA_META_ACCESS_TOKEN_2 || '',
        META_TEST_EVENT_CODE: testCode,
      },
    };
  }
  if (id === 'fantastico') {
    return {
      id,
      landingUrl: String(env.FANTASTICO_LANDING_URL || '').replace(/\/$/, ''),
      meta: {
        META_BRAND: 'FANTASTICO',
        PIXEL_ID: env.FANTASTICO_PIXEL_ID || '',
        PIXEL_ID_2: env.FANTASTICO_PIXEL_ID_2 || '',
        META_ACCESS_TOKEN: env.FANTASTICO_META_ACCESS_TOKEN || '',
        META_ACCESS_TOKEN_2: env.FANTASTICO_META_ACCESS_TOKEN_2 || '',
        META_TEST_EVENT_CODE: testCode,
      },
    };
  }
  return {
    id: 'royal',
    landingUrl: (env.LANDING_URL || env.ROYAL_LANDING_URL || DEFAULT_LANDING_URL).replace(/\/$/, ''),
    meta: {
      META_BRAND: 'ROYAL',
      PIXEL_ID: env.PIXEL_ID || env.ROYAL_PIXEL_ID || PIXEL_ID,
      PIXEL_ID_2: env.PIXEL_ID_2 || env.ROYAL_PIXEL_ID_2 || PIXEL_ID_2,
      META_ACCESS_TOKEN: env.META_ACCESS_TOKEN || env.ROYAL_META_ACCESS_TOKEN || '',
      META_ACCESS_TOKEN_2: env.META_ACCESS_TOKEN_2 || env.ROYAL_META_ACCESS_TOKEN_2 || '',
      META_TEST_EVENT_CODE: testCode,
    },
  };
}

export function leadTenant(row: { tenant?: string | null } | null | undefined): TenantId {
  return parseTenant(row?.tenant) || 'royal';
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function asText(value: unknown, max: number): string {
  return String(value == null ? '' : value).trim().slice(0, max);
}

export function fill(current: unknown, incoming: unknown): string {
  return String(current || incoming || '');
}

export function isLocalOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Purchase-Key, X-Tenant',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
}

export function normalizePhone(value: unknown): string {
  let digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('11')) digits = '54' + digits;
  if (digits.length === 11 && digits.startsWith('15')) digits = '549' + digits.slice(2);
  if (!digits.startsWith('54') && digits.length >= 8 && digits.length <= 11) {
    digits = '54' + digits.replace(/^0/, '');
  }
  return digits;
}

export function publicCode(row: { id?: number | null; ref?: string } | null | undefined): string {
  if (!row) return '';
  if (row.id && Number(row.id) > 0) return String(row.id);
  return String(row.ref || '');
}

export function parseAd(value: unknown): number {
  const n = Number(value);
  if (Number.isInteger(n) && n >= 1 && n <= 999999) return n;
  return 0;
}

export function isPersonId(value: string): boolean {
  return /^\d{1,10}$/.test(String(value || '').trim());
}

export function isLegacyRef(value: string): boolean {
  return /^REF-[A-Z0-9]{6,12}$/.test(String(value || '').trim().toUpperCase());
}

export function publicLead(row: LeadRow | null): PublicLead | null {
  if (!row) return null;
  const code = publicCode(row);
  return {
    ref: code,
    id: row.id && row.id > 0 ? Number(row.id) : (isPersonId(row.ref) ? Number(row.ref) : null),
    a: Number(row.ad) > 0 ? Number(row.ad) : 0,
    status: row.status,
    created_at: row.created_at,
    lead_sent_at: row.lead_sent_at,
    campaign_id: row.campaign_id,
    campaign_name: row.campaign_name,
    adset_id: row.adset_id,
    adset_name: row.adset_name,
    ad_id: row.ad_id,
    ad_name: row.ad_name,
    utm_source: row.utm_source,
    utm_campaign: row.utm_campaign,
    utm_content: row.utm_content,
    utm_term: row.utm_term,
    lead_enviado: Boolean(row.lead_enviado),
    purchase_enviado: Boolean(row.purchase_enviado),
    monto_purchase: row.monto_purchase,
    fecha_purchase: row.fecha_purchase,
    purchase_event_id: row.purchase_event_id,
    has_fbp: Boolean(row.fbp),
    has_fbc: Boolean(row.fbc),
  };
}

export function attributionFromBody(body: Record<string, unknown>): Attribution {
  return {
    fbclid: asText(body.fbclid, 200),
    fbp: asText(body.fbp, 200),
    fbc: asText(body.fbc, 300),
    utm_source: asText(body.utm_source, 120),
    utm_medium: asText(body.utm_medium, 120),
    utm_campaign: asText(body.utm_campaign, 180),
    utm_content: asText(body.utm_content, 180),
    utm_term: asText(body.utm_term, 180),
    campaign_id: asText(body.campaign_id, 80),
    adset_id: asText(body.adset_id, 80),
    ad_id: asText(body.ad_id, 80),
    campaign_name: asText(body.campaign_name, 180),
    adset_name: asText(body.adset_name, 180),
    ad_name: asText(body.ad_name, 180),
    landing_url: asText(body.landing_url, 2000),
    referrer: asText(body.referrer, 1000),
    telefono: normalizePhone(body.telefono || body.phone),
    ad: parseAd(body.a ?? body.ad),
  };
}

export function mergeAttribution(row: LeadRow, incoming: Attribution): Attribution {
  return {
    fbclid: fill(row.fbclid, incoming.fbclid),
    fbp: fill(row.fbp, incoming.fbp),
    fbc: fill(row.fbc, incoming.fbc),
    utm_source: fill(row.utm_source, incoming.utm_source),
    utm_medium: fill(row.utm_medium, incoming.utm_medium),
    utm_campaign: fill(row.utm_campaign, incoming.utm_campaign),
    utm_content: fill(row.utm_content, incoming.utm_content),
    utm_term: fill(row.utm_term, incoming.utm_term),
    campaign_id: fill(row.campaign_id, incoming.campaign_id),
    adset_id: fill(row.adset_id, incoming.adset_id),
    ad_id: fill(row.ad_id, incoming.ad_id),
    campaign_name: fill(row.campaign_name, incoming.campaign_name),
    adset_name: fill(row.adset_name, incoming.adset_name),
    ad_name: fill(row.ad_name, incoming.ad_name),
    landing_url: fill(row.landing_url, incoming.landing_url),
    referrer: fill(row.referrer, incoming.referrer),
    telefono: fill(row.telefono, incoming.telefono),
    ad: incoming.ad > 0 ? incoming.ad : (Number(row.ad) > 0 ? Number(row.ad) : 0),
  };
}

export function normalizeRefQuery(q: string): string {
  return asText(q, 20).toUpperCase();
}

export function isValidRef(ref: string): boolean {
  const raw = String(ref || '').trim();
  return isPersonId(raw) || isLegacyRef(raw);
}

export function pickSearchRef(q: string): string {
  const raw = String(q || '').trim();
  const upper = raw.toUpperCase();
  const matches = upper.match(/REF[\s\-]*[A-Z0-9]{6,12}/g);
  if (matches && matches.length) {
    const last = matches[matches.length - 1].replace(/[^A-Z0-9]/g, '');
    const next = 'REF-' + last.slice(3);
    if (isLegacyRef(next)) return next;
  }
  if (isPersonId(raw)) return raw;
  const fromMessage = raw.match(/(?:informaci[oó]n\.\s*)(\d{1,10})(?:\s+quiero)/i) || raw.match(/\s(\d{1,10})\s+quiero mi/i);
  if (fromMessage && isPersonId(fromMessage[1])) return fromMessage[1];
  const compact = upper.replace(/[^A-Z0-9]/g, '');
  if (compact.startsWith('REF') && compact.length >= 9 && compact.length <= 15) {
    const next = 'REF-' + compact.slice(3);
    return isLegacyRef(next) ? next : '';
  }
  if (/^[A-Z0-9]{6,12}$/.test(compact) && /[A-Z]/.test(compact)) return 'REF-' + compact;
  return '';
}

export function normalizeRef(q: string): string {
  return pickSearchRef(q);
}

export const AR_TZ = 'America/Argentina/Buenos_Aires';

export type StatsRange = 'today' | 'yesterday' | '7d' | 'all';

export type LeadStatRow = {
  ref: string;
  lead_enviado: number | boolean;
  purchase_enviado: number | boolean;
  lead_sent_at: string | null;
  created_at: string;
};

export type PurchaseStatRow = {
  ref: string;
  monto: number;
  created_at: string;
};

export type StatsBucket = {
  key: string;
  label: string;
  arrived: number;
  loaded: number;
  conversion: number;
};

function arDateParts(date: Date): { y: number; m: number; d: number; h: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AR_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { y: read('year'), m: read('month'), d: read('day'), h: read('hour') };
}

function arMidnight(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

function ymd(y: number, m: number, d: number): string {
  return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

export function parseStatsRange(value: unknown): StatsRange {
  const text = String(value || 'today');
  if (text === 'yesterday' || text === '7d' || text === 'all') return text;
  return 'today';
}

export type SpendRow = {
  day: string;
  usd: number;
  fx: number;
  updated_at?: string;
};

export function spendWindow(range: StatsRange): { from: string | null; to: string | null; editDay: string } {
  const today = arDateParts(new Date());
  const todayStart = arMidnight(today.y, today.m, today.d);
  const todayYmd = ymd(today.y, today.m, today.d);
  const yest = arDateParts(addDays(todayStart, -1));
  const yestYmd = ymd(yest.y, yest.m, yest.d);

  if (range === 'today') return { from: todayYmd, to: todayYmd, editDay: todayYmd };
  if (range === 'yesterday') return { from: yestYmd, to: yestYmd, editDay: yestYmd };
  if (range === '7d') {
    const from = arDateParts(addDays(todayStart, -6));
    return { from: ymd(from.y, from.m, from.d), to: todayYmd, editDay: todayYmd };
  }
  return { from: null, to: null, editDay: todayYmd };
}

export function isYmd(value: unknown): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function summarizeSpend(rows: SpendRow[]) {
  const items = rows.map((row) => {
    const usd = Math.round(Number(row.usd || 0) * 100) / 100;
    const fx = Math.round(Number(row.fx || 0) * 100) / 100;
    return {
      day: row.day,
      usd,
      fx,
      ars: Math.round(usd * fx * 100) / 100,
      updated_at: row.updated_at || '',
    };
  });
  return {
    usd: Math.round(items.reduce((sum, row) => sum + row.usd, 0) * 100) / 100,
    ars: Math.round(items.reduce((sum, row) => sum + row.ars, 0) * 100) / 100,
    items,
  };
}

function inWindow(iso: string, from: Date | null, to: Date | null): boolean {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  if (from && time < from.getTime()) return false;
  if (to && time >= to.getTime()) return false;
  return true;
}

export function buildStats(range: StatsRange, leads: LeadStatRow[], purchases: PurchaseStatRow[]) {
  const now = new Date();
  const today = arDateParts(now);
  const todayStart = arMidnight(today.y, today.m, today.d);
  let from: Date | null = todayStart;
  let to: Date | null = addDays(todayStart, 1);
  let bucketMode: 'hour' | 'day' = 'hour';

  if (range === 'yesterday') {
    from = addDays(todayStart, -1);
    to = todayStart;
  } else if (range === '7d') {
    from = addDays(todayStart, -6);
    to = addDays(todayStart, 1);
    bucketMode = 'day';
  } else if (range === 'all') {
    from = null;
    to = null;
    bucketMode = 'day';
  }

  const arrived = leads.filter((row) => {
    if (!row.lead_enviado) return false;
    return inWindow(row.lead_sent_at || row.created_at, from, to);
  });
  const loadedCount = arrived.filter((row) => row.purchase_enviado).length;
  const pending = arrived.length - loadedCount;
  const periodPurchases = purchases.filter((row) => inWindow(row.created_at, from, to));
  const totalMonto = periodPurchases.reduce((sum, row) => sum + Number(row.monto || 0), 0);
  const average = periodPurchases.length ? totalMonto / periodPurchases.length : 0;
  const conversion = arrived.length ? Math.round((loadedCount / arrived.length) * 1000) / 10 : 0;

  const counts = new Map<string, { arrived: number; loaded: number }>();
  const touch = (key: string, field: 'arrived' | 'loaded') => {
    const current = counts.get(key) || { arrived: 0, loaded: 0 };
    current[field] += 1;
    counts.set(key, current);
  };

  for (const row of arrived) {
    const when = new Date(row.lead_sent_at || row.created_at);
    const parts = arDateParts(when);
    const key = bucketMode === 'hour' ? String(parts.h).padStart(2, '0') : ymd(parts.y, parts.m, parts.d);
    touch(key, 'arrived');
    if (row.purchase_enviado) touch(key, 'loaded');
  }

  const buckets: StatsBucket[] = [];
  if (bucketMode === 'hour' && from && to) {
    for (let hour = 0; hour < 24; hour++) {
      const key = String(hour).padStart(2, '0');
      const current = counts.get(key) || { arrived: 0, loaded: 0 };
      buckets.push({
        key,
        label: key + ':00',
        arrived: current.arrived,
        loaded: current.loaded,
        conversion: current.arrived ? Math.round((current.loaded / current.arrived) * 1000) / 10 : 0,
      });
    }
  } else {
    const keys = [...counts.keys()].sort();
    for (const key of keys) {
      const current = counts.get(key) || { arrived: 0, loaded: 0 };
      buckets.push({
        key,
        label: key,
        arrived: current.arrived,
        loaded: current.loaded,
        conversion: current.arrived ? Math.round((current.loaded / current.arrived) * 1000) / 10 : 0,
      });
    }
  }

  return {
    ok: true,
    range,
    timezone: AR_TZ,
    arrived: arrived.length,
    loaded: loadedCount,
    pending,
    conversion,
    average: Math.round(average * 100) / 100,
    charges: periodPurchases.length,
    total: Math.round(totalMonto * 100) / 100,
    buckets,
  };
}

function metaBrand(env: MetaEnv): string {
  return String(env.META_BRAND || 'ROYAL').toUpperCase();
}

export const PURCHASE_LEAD_JOIN =
  'FROM purchases p INNER JOIN leads l ON (l.ref = p.ref OR CAST(l.rowid AS TEXT) = p.ref)';

export function pageViewEventId(ref: string): string {
  return 'pv_' + ref;
}

export function checkoutEventId(ref: string): string {
  return 'ic_' + ref;
}

export function firstForwardedIp(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const ip = String(value || '').split(',')[0].trim().replace(/^::ffff:/i, '');
    if (ip) return ip;
  }
  return '';
}

export function storedOrRequest(stored: unknown, fallback: string): string {
  const value = String(stored || '').trim();
  return value || fallback;
}

export type MetaSendResult = {
  ok: boolean;
  pixel1_ok: boolean;
  pixel2_ok: boolean;
  pixel1_error?: string;
  pixel2_error?: string;
  events_received?: number;
  fbtrace_id?: string;
  error?: string;
};

export async function sendMetaEvent(
  env: MetaEnv,
  input: {
    event_name: string;
    event_id: string;
    event_source_url: string;
    user_data: Record<string, unknown>;
    custom_data: Record<string, unknown>;
  },
): Promise<MetaSendResult> {
  const brand = metaBrand(env);
  const token1 = String(env.META_ACCESS_TOKEN || '').trim();
  const token2 = String(env.META_ACCESS_TOKEN_2 || '').trim();
  const pixel1 = String(env.PIXEL_ID || '').trim();
  const pixel2 = String(env.PIXEL_ID_2 || '').trim();
  const pixel2Enabled = /^\d{5,20}$/.test(pixel2) && pixel2 !== pixel1;

  const payload: Record<string, unknown> = {
    data: [
      {
        event_name: input.event_name,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.event_id,
        action_source: 'website',
        event_source_url: input.event_source_url,
        user_data: input.user_data || {},
        custom_data: input.custom_data || {},
      },
    ],
  };
  if (env.META_TEST_EVENT_CODE) payload.test_event_code = env.META_TEST_EVENT_CODE;

  const extra = input.event_name === 'Purchase' || input.event_name === 'InitiateCheckout'
    ? ' value=' + String((input.custom_data || {}).value ?? '') + ' currency=' + String((input.custom_data || {}).currency ?? '')
    : '';

  const sendToPixel = async (pixelId: string, token: string, label: string) => {
    const graphUrl =
      'https://graph.facebook.com/' +
      GRAPH_VERSION +
      '/' +
      pixelId +
      '/events?access_token=' +
      encodeURIComponent(token);
    try {
      const response = await fetch(graphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await response.text();
      let data: {
        error?: { message?: string };
        events_received?: number;
        fbtrace_id?: string;
        messages?: Array<{ message?: string; type?: string }>;
      } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: { message: 'Respuesta inválida de Meta.' } };
      }
      const hint = (data.messages || []).map((item) => item.message || item.type || '').filter(Boolean).join(' | ');
      if (!response.ok || (data.error && data.error.message) || Number(data.events_received || 0) < 1) {
        const message = (data.error && data.error.message)
          || hint
          || ('Error de Meta HTTP ' + response.status + ' events_received=' + String(data.events_received ?? 0));
        console.log('[META][' + brand + '] ' + input.event_name + ' error → ' + label + ' ' + pixelId + extra + ' :: ' + message);
        return { ok: false, error: message };
      }
      console.log('[META][' + brand + '] ' + input.event_name + ' enviado → ' + label + ' ' + pixelId + extra + ' events_received=' + String(data.events_received) + (hint ? ' :: ' + hint : ''));
      return { ok: true, events_received: data.events_received, fbtrace_id: data.fbtrace_id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Error de Meta';
      console.log('[META][' + brand + '] ' + input.event_name + ' error → ' + label + ' ' + pixelId + extra + ' :: ' + message);
      return { ok: false, error: message };
    }
  };

  let pixel1Result: { ok: boolean; error?: string; events_received?: number; fbtrace_id?: string } = { ok: false, error: 'PIXEL_ID omitido' };
  let pixel2Result: { ok: boolean; error?: string; events_received?: number; fbtrace_id?: string } = { ok: false, error: 'PIXEL_ID_2 omitido' };

  if (token1 && /^\d{5,20}$/.test(pixel1)) {
    pixel1Result = await sendToPixel(pixel1, token1, 'PIXEL_ID');
  } else {
    console.log('[META][' + brand + '] ' + input.event_name + ' omitido → PIXEL_ID');
    pixel1Result = { ok: false, error: 'Falta PIXEL_ID o META_ACCESS_TOKEN' };
  }

  if (pixel2Enabled) {
    if (token2) {
      pixel2Result = await sendToPixel(pixel2, token2, 'PIXEL_ID_2');
    } else {
      console.log('[META][' + brand + '] ' + input.event_name + ' omitido → PIXEL_ID_2 (falta META_ACCESS_TOKEN_2)');
      pixel2Result = { ok: false, error: 'Falta META_ACCESS_TOKEN_2 para PIXEL_ID_2' };
    }
  } else {
    pixel2Result = { ok: true };
  }

  const bothOk = pixel1Result.ok && pixel2Result.ok;
  const pixel1Ok = pixel1Result.ok;
  const pixel2Ok = pixel2Enabled ? pixel2Result.ok : true;
  const pixel1Error = pixel1Ok ? undefined : pixel1Result.error;
  const pixel2Error = pixel2Ok ? undefined : pixel2Result.error;
  return {
    ok: bothOk,
    pixel1_ok: pixel1Ok,
    pixel2_ok: pixel2Ok,
    pixel1_error: pixel1Error,
    pixel2_error: pixel2Error,
    events_received: (pixel1Result.events_received || 0) + (pixel2Enabled ? (pixel2Result.events_received || 0) : 0) || undefined,
    fbtrace_id: pixel1Result.fbtrace_id || pixel2Result.fbtrace_id,
    error: bothOk ? undefined : metaFailureMessage({
      pixel1_ok: pixel1Ok,
      pixel2_ok: pixel2Ok,
      pixel1_error: pixel1Error,
      pixel2_error: pixel2Error,
    }),
  };
}

export function metaFailureMessage(meta: Pick<MetaSendResult, 'pixel1_ok' | 'pixel2_ok' | 'pixel1_error' | 'pixel2_error' | 'error'>): string {
  const parts: string[] = [];
  if (!meta.pixel1_ok) parts.push('PIXEL_ID: ' + (meta.pixel1_error || 'error'));
  if (!meta.pixel2_ok) parts.push('PIXEL_ID_2: ' + (meta.pixel2_error || 'error'));
  return parts.join(' | ') || meta.error || 'Error de Meta';
}

export function metaPixelPayload(meta: MetaSendResult) {
  return {
    pixel1_ok: meta.pixel1_ok,
    pixel2_ok: meta.pixel2_ok,
    pixel1_error: meta.pixel1_error || null,
    pixel2_error: meta.pixel2_error || null,
    meta_ok: meta.ok,
  };
}
