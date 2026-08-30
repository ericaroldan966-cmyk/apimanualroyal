export const PIXEL_ID = '1767312904299608';
export const GRAPH_VERSION = 'v21.0';
export const DEFAULT_LANDING_URL = 'https://ericaroldan966-cmyk.github.io/landingappganamos/';
export const REF_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

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
};

export type LeadRow = Attribution & {
  ref: string;
  created_at: string;
  updated_at: string;
  status: string;
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
  META_TEST_EVENT_CODE?: string;
  PIXEL_ID?: string;
};

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
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Purchase-Key',
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

export function publicLead(row: LeadRow | null): PublicLead | null {
  if (!row) return null;
  return {
    ref: row.ref,
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
  };
}

export function normalizeRefQuery(q: string): string {
  return asText(q, 20).toUpperCase();
}

export function isValidRef(ref: string): boolean {
  return /^REF-[A-Z0-9]{6,12}$/.test(ref);
}

export function pickSearchRef(q: string): string {
  const upper = q.toUpperCase();
  if (upper.startsWith('REF-')) return upper;
  if (/^[A-Z0-9]{6,12}$/.test(upper)) return 'REF-' + upper;
  return '';
}

export async function sendMetaEvent(
  env: MetaEnv,
  input: {
    event_name: string;
    event_id: string;
    event_source_url: string;
    user_data: Record<string, unknown>;
    custom_data: Record<string, unknown>;
  },
): Promise<{ ok: boolean; error?: string; events_received?: number; fbtrace_id?: string }> {
  if (!env.META_ACCESS_TOKEN) {
    return { ok: false, error: 'Falta el Access Token. Pegalo en .dev.vars y reiniciá.' };
  }

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

  const graphUrl =
    'https://graph.facebook.com/' +
    GRAPH_VERSION +
    '/' +
    (env.PIXEL_ID || PIXEL_ID) +
    '/events?access_token=' +
    encodeURIComponent(env.META_ACCESS_TOKEN);

  try {
    const response = await fetch(graphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let data: { error?: { message?: string }; events_received?: number; fbtrace_id?: string } = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { error: { message: 'Respuesta inválida de Meta.' } };
    }
    if (!response.ok || (data.error && data.error.message)) {
      console.log('[meta] Error Meta API');
      return { ok: false, error: (data.error && data.error.message) || 'Error de Meta' };
    }
    return { ok: true, events_received: data.events_received, fbtrace_id: data.fbtrace_id };
  } catch {
    console.log('[meta] Error Meta API');
    return { ok: false, error: 'Error de Meta' };
  }
}
