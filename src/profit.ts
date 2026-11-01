import { statsTimezone, tenantConfig, type TenantId } from './shared.ts';

export const PROJECTS: TenantId[] = ['paraguay', 'royal', 'kova', 'fantastico'];

export const PROJECT_NAMES: Record<TenantId, string> = {
  paraguay: 'Paraguay',
  royal: 'Royal',
  kova: 'Kova',
  fantastico: 'Fantástico',
};

export function foreignRefMessage(owner: TenantId, current: TenantId): string {
  if (owner === current) return '';
  const name = PROJECT_NAMES[owner];
  return 'Ese REF pertenece a ' + name + '. Abrí el panel de ' + name + ' para cargarlo.';
}

export type ProfitLead = {
  ref: string;
  created_at: string;
  landing_url?: string | null;
};

export type ProfitPurchase = {
  ref: string;
  monto: number;
  created_at: string;
  meta_status?: string | null;
};

export type ProfitSpend = {
  day: string;
  usd: number;
  fx_ars: number;
  fx_kind?: string | null;
};

export type ProfitDay = {
  day: string;
  messages: null;
  messages_available: false;
  refs: number;
  customers: number;
  loads: number;
  loaded_amount: number;
  message_conversion: null;
  usd: number;
  ars: number | null;
  fx_ars: number;
  fx_kind: string;
  cost_per_message_usd: null;
  cost_per_message_ars: null;
  cost_per_customer_usd: number | null;
  cost_per_customer_ars: number | null;
};

export type ProfitReport = {
  id: TenantId;
  name: string;
  landing: string;
  currency: 'ARS' | 'PYG';
  timezone: string;
  from: string;
  to: string;
  messages_available: false;
  messages_note: string;
  days: ProfitDay[];
  totals: {
    messages: null;
    refs: number;
    customers: number;
    loads: number;
    loaded_amount: number;
    usd: number;
    ars: number | null;
    cost_per_message_usd: null;
    cost_per_message_ars: null;
    cost_per_customer_usd: number | null;
    cost_per_customer_ars: number | null;
    refs_that_loaded: number;
    ref_conversion: number | null;
  };
  origins: Array<{ landing: string; refs: number }>;
  purchase_meta: { ok: number; partial: number; error: number; pending: number };
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function landingOrigin(value: string): string {
  const raw = value.trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.origin + url.pathname.replace(/\/$/, '');
  } catch {
    return raw.slice(0, 180);
  }
}

export function calendarDay(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function calendarToday(timeZone: string, now = new Date()): string {
  return calendarDay(now.toISOString(), timeZone);
}

export function shiftCalendarDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
}

export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  let cursor = from;
  while (cursor <= to && days.length < 400) {
    days.push(cursor);
    cursor = shiftCalendarDay(cursor, 1);
  }
  return days;
}

export function metricsWindow(input: {
  range: string;
  from?: string;
  to?: string;
  timeZone: string;
  now?: Date;
}): { from: string; to: string } | { error: string } {
  const today = calendarToday(input.timeZone, input.now);
  if (input.range === 'today') return { from: today, to: today };
  if (input.range === 'yesterday') {
    const day = shiftCalendarDay(today, -1);
    return { from: day, to: day };
  }
  if (input.range === '7d') return { from: shiftCalendarDay(today, -6), to: today };
  if (input.range === '30d') return { from: shiftCalendarDay(today, -29), to: today };
  if (input.range === 'custom') {
    const from = String(input.from || '');
    const to = String(input.to || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return { error: 'Elegí las dos fechas.' };
    }
    if (from > to) return { error: 'La fecha inicial es posterior a la final.' };
    if (eachDay(from, to).length > 366) return { error: 'El período máximo es un año.' };
    return { from, to };
  }
  return { error: 'Período inválido.' };
}

function ratio(part: number, total: number): number | null {
  if (!(total > 0)) return null;
  return round2((part / total) * 100);
}

function perUnit(amount: number, units: number): number | null {
  if (!(units > 0) || !(amount > 0)) return amount === 0 && units > 0 ? 0 : null;
  return round2(amount / units);
}

export function buildProjectProfit(input: {
  tenant: TenantId;
  from: string;
  to: string;
  leads: ProfitLead[];
  purchases: ProfitPurchase[];
  spend: ProfitSpend[];
  env?: Record<string, string | undefined>;
}): ProfitReport {
  const config = tenantConfig(input.tenant, input.env || {});
  const timeZone = statsTimezone(input.tenant);
  const days = eachDay(input.from, input.to);
  const daySet = new Set(days);
  const spendByDay = new Map(input.spend.map((row) => [row.day, row]));
  const refsByDay = new Map<string, Set<string>>();
  const customersByDay = new Map<string, Set<string>>();
  const loadsByDay = new Map<string, number>();
  const amountByDay = new Map<string, number>();
  const periodCustomers = new Set<string>();
  const purchasedRefs = new Set<string>();
  const origins = new Map<string, number>();
  const meta = { ok: 0, partial: 0, error: 0, pending: 0 };

  for (const lead of input.leads) {
    const ref = String(lead.ref || '');
    if (!ref) continue;
    const day = calendarDay(lead.created_at, timeZone);
    if (!daySet.has(day)) continue;
    const bucket = refsByDay.get(day) || new Set<string>();
    bucket.add(ref);
    refsByDay.set(day, bucket);
    const landing = landingOrigin(String(lead.landing_url || ''));
    if (landing) origins.set(landing, (origins.get(landing) || 0) + 1);
  }

  for (const purchase of input.purchases) {
    const ref = String(purchase.ref || '');
    if (ref) purchasedRefs.add(ref);
    const day = calendarDay(purchase.created_at, timeZone);
    if (!daySet.has(day)) continue;
    loadsByDay.set(day, (loadsByDay.get(day) || 0) + 1);
    amountByDay.set(day, (amountByDay.get(day) || 0) + Number(purchase.monto || 0));
    if (ref) {
      const bucket = customersByDay.get(day) || new Set<string>();
      bucket.add(ref);
      customersByDay.set(day, bucket);
      periodCustomers.add(ref);
    }
    const status = String(purchase.meta_status || '');
    if (status === 'ok') meta.ok += 1;
    else if (status === 'partial') meta.partial += 1;
    else if (status === 'error') meta.error += 1;
    else meta.pending += 1;
  }

  const periodRefs = new Set<string>();
  let refsThatLoaded = 0;
  for (const bucket of refsByDay.values()) {
    for (const ref of bucket) {
      if (periodRefs.has(ref)) continue;
      periodRefs.add(ref);
      if (purchasedRefs.has(ref)) refsThatLoaded += 1;
    }
  }

  let usd = 0;
  let arsKnown = 0;
  let arsMissing = false;
  const rows: ProfitDay[] = days.map((day) => {
    const refs = refsByDay.get(day)?.size || 0;
    const customers = customersByDay.get(day)?.size || 0;
    const loads = loadsByDay.get(day) || 0;
    const saved = spendByDay.get(day);
    const dayUsd = round2(Number(saved?.usd || 0));
    const fx = round2(Number(saved?.fx_ars || 0));
    const hasArs = fx > 0;
    const dayArs = dayUsd === 0 ? 0 : (hasArs ? round2(dayUsd * fx) : null);
    usd += dayUsd;
    if (dayUsd > 0 && !hasArs) arsMissing = true;
    if (dayArs != null) arsKnown += dayArs;
    return {
      day,
      messages: null,
      messages_available: false,
      refs,
      customers,
      loads,
      loaded_amount: round2(amountByDay.get(day) || 0),
      message_conversion: null,
      usd: dayUsd,
      ars: dayArs,
      fx_ars: fx,
      fx_kind: String(saved?.fx_kind || ''),
      cost_per_message_usd: null,
      cost_per_message_ars: null,
      cost_per_customer_usd: perUnit(dayUsd, customers),
      cost_per_customer_ars: dayArs == null ? null : perUnit(dayArs, customers),
    };
  });

  return {
    id: input.tenant,
    name: PROJECT_NAMES[input.tenant],
    landing: config.landingUrl,
    currency: config.currency,
    timezone: timeZone,
    from: input.from,
    to: input.to,
    messages_available: false,
    messages_note: 'No hay integración de mensajes entrantes de WhatsApp. Los REF generados no son mensajes recibidos.',
    days: rows,
    totals: {
      messages: null,
      refs: periodRefs.size,
      customers: periodCustomers.size,
      loads: rows.reduce((sum, row) => sum + row.loads, 0),
      loaded_amount: round2(rows.reduce((sum, row) => sum + row.loaded_amount, 0)),
      usd: round2(usd),
      ars: arsMissing ? null : round2(arsKnown),
      cost_per_message_usd: null,
      cost_per_message_ars: null,
      cost_per_customer_usd: perUnit(usd, periodCustomers.size),
      cost_per_customer_ars: arsMissing ? null : perUnit(arsKnown, periodCustomers.size),
      refs_that_loaded: refsThatLoaded,
      ref_conversion: ratio(refsThatLoaded, periodRefs.size),
    },
    origins: [...origins.entries()]
      .map(([landing, refs]) => ({ landing, refs }))
      .sort((a, b) => b.refs - a.refs),
    purchase_meta: meta,
  };
}
