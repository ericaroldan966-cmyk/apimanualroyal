import { fetchArsQuote, readArsQuote, shiftCalendarDay } from './fx-ars.ts';
import { buildProjectProfit, foreignRefMessage, metricsWindow } from './profit.ts';

const failures: string[] = [];
function assert(condition: unknown, message: string): void {
  if (!condition) failures.push(message);
}

const quote = readArsQuote({ casa: 'blue', compra: 1545, venta: 1565.126, fecha: '2026-10-30T00:00:00' });
assert(quote?.venta === 1565.13 && quote.fecha === '2026-10-30', 'quote uses venta rounded to cents');
assert(readArsQuote({ venta: 0, fecha: '2026-10-30' }) === null, 'a zero quote is ignored');

const calls: string[] = [];
const fetched = await fetchArsQuote('blue', '2026-10-31', (async (url: string | URL | Request) => {
  const text = String(url);
  calls.push(text);
  if (text.endsWith('/2026/10/31')) return new Response('no', { status: 404 });
  return Response.json({ venta: 1500, fecha: '2026-10-30' });
}) as typeof fetch);
assert(fetched?.venta === 1500 && fetched.fecha === '2026-10-30' && fetched.requested_day === '2026-10-31', 'weekend falls back to the previous quote');
assert(calls.length === 2 && calls[0].includes('/blue/2026/10/31'), 'the requested day is asked first');
assert(shiftCalendarDay('2026-03-01', -1) === '2026-02-28', 'calendar shift crosses months');

const now = new Date('2026-10-31T15:00:00.000Z');
const today = metricsWindow({ range: 'today', timeZone: 'America/Asuncion', now });
const month = metricsWindow({ range: '30d', timeZone: 'America/Asuncion', now });
assert('from' in today && today.from === '2026-10-31', 'today follows the project timezone');
assert('from' in month && month.from === '2026-10-02' && month.to === '2026-10-31', '30 days includes today');
const bad = metricsWindow({ range: 'custom', from: '2026-11-02', to: '2026-11-01', timeZone: 'America/Asuncion' });
assert('error' in bad, 'an inverted custom range is rejected');

const report = buildProjectProfit({
  tenant: 'paraguay',
  from: '2026-10-30',
  to: '2026-10-31',
  leads: [
    { ref: '10', created_at: '2026-10-30T15:00:00.000Z', landing_url: 'https://bigwinpy.vercel.app/?utm=a' },
    { ref: '11', created_at: '2026-10-30T18:00:00.000Z', landing_url: 'https://bigwinpy.vercel.app/?utm=b' },
    { ref: '12', created_at: '2026-10-29T18:00:00.000Z', landing_url: 'https://otra.example/' },
  ],
  purchases: [
    { ref: '10', monto: 100000, created_at: '2026-10-30T16:00:00.000Z', meta_status: 'ok' },
    { ref: '10', monto: 50000, created_at: '2026-10-30T20:00:00.000Z', meta_status: 'ok' },
    { ref: '12', monto: 20000, created_at: '2026-10-31T12:00:00.000Z', meta_status: 'error' },
  ],
  spend: [
    { day: '2026-10-30', usd: 100, fx_ars: 1500, fx_kind: 'blue' },
    { day: '2026-10-31', usd: 40, fx_ars: 0, fx_kind: '' },
  ],
});

const first = report.days[0];
const second = report.days[1];
assert(report.messages_available === false && report.totals.messages === null, 'messages stay empty without WhatsApp');
assert(first.refs === 2 && first.customers === 1 && first.loads === 2, 'one REF with two loads is one customer and two loads');
assert(first.loaded_amount === 150000, 'loads keep their amounts');
assert(first.usd === 100 && first.ars === 150000, 'stored blue rate converts that day to ARS');
assert(first.cost_per_customer_usd === 100 && first.cost_per_customer_ars === 150000, 'cost uses unique customers');
assert(first.cost_per_message_usd === null, 'message cost is not invented from REFs');
assert(second.customers === 1 && second.refs === 0 && second.loads === 1, 'a previous REF can load on another day');
assert(second.ars === null && second.usd === 40, 'a day without a peso quote does not pretend to be zero pesos');
assert(report.totals.customers === 2 && report.totals.loads === 3 && report.totals.refs === 2, 'period customers are unique across days');
assert(report.totals.refs_that_loaded === 1 && report.totals.ref_conversion === 50, 'cohort conversion counts REFs created in the period');
assert(report.totals.ars === null, 'missing quote blocks the period peso total');
assert(report.purchase_meta.ok === 2 && report.purchase_meta.error === 1, 'Meta status is counted per load in the period');
assert(report.origins.length === 1 && report.origins[0].landing === 'https://bigwinpy.vercel.app' && report.origins[0].refs === 2, 'origins stay on the landing stored with the REF');
assert(report.landing === 'https://bigwinpy.vercel.app' && report.currency === 'PYG', 'Paraguay keeps its landing and currency');

const royal = buildProjectProfit({
  tenant: 'royal',
  from: '2026-10-30',
  to: '2026-10-30',
  leads: [],
  purchases: [{ ref: '10', monto: 1, created_at: '2026-10-30T12:00:00.000Z', meta_status: 'ok' }],
  spend: [],
});
assert(foreignRefMessage('kova', 'royal') === 'Ese REF pertenece a Kova. Abrí el panel de Kova para cargarlo.', 'a foreign REF names its project');
assert(foreignRefMessage('royal', 'royal') === '', 'the same project is not foreign');
assert(royal.totals.customers === 1 && royal.currency === 'ARS' && royal.id === 'royal', 'Royal stays a separate project');
assert(report.totals.customers === 2, 'Paraguay customers were not mixed with Royal');

if (failures.length) {
  console.error(failures.map((item) => 'FAIL ' + item).join('\n'));
  process.exit(1);
}
console.log('profit tests ok');
