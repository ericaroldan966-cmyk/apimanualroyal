export type ArsQuote = {
  venta: number;
  fecha: string;
  kind: 'oficial' | 'blue';
  requested_day: string;
};

export function readArsQuote(payload: unknown): { venta: number; fecha: string } | null {
  const row = Array.isArray(payload) ? payload[0] : payload;
  if (!row || typeof row !== 'object') return null;
  const record = row as { venta?: unknown; fecha?: unknown };
  const venta = Number(record.venta);
  const fecha = String(record.fecha || '').slice(0, 10);
  if (!(venta > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
  return { venta: Math.round(venta * 100) / 100, fecha };
}

export function shiftCalendarDay(day: string, delta: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + delta)).toISOString().slice(0, 10);
}

export async function fetchArsQuote(
  kind: 'oficial' | 'blue',
  day: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ArsQuote | null> {
  for (let back = 0; back < 6; back++) {
    const target = shiftCalendarDay(day, -back);
    const [year, month, date] = target.split('-');
    const url = 'https://api.argentinadatos.com/v1/cotizaciones/dolares/' + kind + '/' + year + '/' + month + '/' + date;
    let response: Response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
    } catch {
      return null;
    }
    if (response.status === 404) continue;
    if (!response.ok) return null;
    const quote = readArsQuote(await response.json().catch(() => null));
    if (!quote) continue;
    return { ...quote, kind, requested_day: day };
  }
  return null;
}
