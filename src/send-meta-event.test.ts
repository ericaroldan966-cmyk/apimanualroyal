import { sendMetaEvent, type MetaEnv } from './shared.ts';

type Call = { url: string; body: Record<string, unknown> };

function pixelFromUrl(url: string): string {
  const match = url.match(/\/(\d+)\/events/);
  return match ? match[1] : '';
}

function tokenFromUrl(url: string): string {
  return new URL(url).searchParams.get('access_token') || '';
}

function eventFromCall(call: Call): Record<string, unknown> {
  const data = call.body.data as Array<Record<string, unknown>>;
  return data[0] || {};
}

function mockFetch(handler: (url: string) => { ok: boolean; status: number; json: unknown }): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: href, body });
    const result = handler(href);
    return {
      ok: result.ok,
      status: result.status,
      text: async () => JSON.stringify(result.json),
    } as Response;
  }) as typeof fetch;
  return calls;
}

const ENV: MetaEnv = {
  META_ACCESS_TOKEN: 'token-1',
  META_ACCESS_TOKEN_2: 'token-2',
  PIXEL_ID: '111111111111111',
  PIXEL_ID_2: '222222222222222',
};

const USER = { fbp: 'fb.1.aaa', fbc: 'fb.1.bbb', external_id: ['ext-1'], client_ip_address: '1.1.1.1', client_user_agent: 'test' };

async function send(name: string, eventId: string, custom: Record<string, unknown> = {}) {
  return sendMetaEvent(ENV, {
    event_name: name,
    event_id: eventId,
    event_source_url: 'https://example.com/',
    user_data: USER,
    custom_data: custom,
  });
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const okHandler = () => ({ ok: true, status: 200, json: { events_received: 1 } });

async function testDualSendAllEvents(): Promise<void> {
  const calls = mockFetch(okHandler);
  const events = [
    ['PageView', 'pv_REF-AAAAAA', {}],
    ['Lead', 'lead_REF-AAAAAA', {}],
    ['InitiateCheckout', 'ic_REF-AAAAAA', { currency: 'ARS', value: 10000 }],
    ['Purchase', 'purchase_REF-AAAAAA', { currency: 'ARS', value: 10000, order_id: 'REF-AAAAAA' }],
  ] as const;

  for (const [name, eventId, custom] of events) {
    await send(name, eventId, custom);
  }

  assert(calls.length === 8, 'esperaba 8 envíos, obtuve ' + calls.length);
  for (const [name, eventId, custom] of events) {
    const pair = calls.filter((call) => eventFromCall(call).event_name === name);
    assert(pair.length === 2, name + ' no fue a 2 pixels');
    const pixels = pair.map((call) => pixelFromUrl(call.url)).sort();
    assert(pixels[0] === '111111111111111' && pixels[1] === '222222222222222', name + ' pixels incorrectos');
    const tokens = pair.map((call) => tokenFromUrl(call.url));
    const tokenFor = (pixel: string) => tokenFromUrl(pair.find((call) => pixelFromUrl(call.url) === pixel)!.url);
    assert(tokenFor('111111111111111') === 'token-1', name + ' Pixel 1 no usó token 1');
    assert(tokenFor('222222222222222') === 'token-2', name + ' Pixel 2 no usó token 2');
    assert(tokenFor('111111111111111') !== tokenFor('222222222222222'), name + ' tokens mezclados');
    const a = eventFromCall(pair[0]);
    const b = eventFromCall(pair[1]);
    assert(a.event_id === eventId && b.event_id === eventId, name + ' event_id distinto');
    assert(a.event_name === b.event_name, name + ' event_name distinto');
    assert(a.action_source === 'website' && b.action_source === 'website', name + ' action_source');
    assert(a.event_source_url === b.event_source_url, name + ' event_source_url distinto');
    assert(JSON.stringify(a.user_data) === JSON.stringify(b.user_data), name + ' user_data distinto');
    assert(JSON.stringify(a.custom_data) === JSON.stringify(b.custom_data), name + ' custom_data distinto');
    if (name === 'Purchase') {
      const ca = a.custom_data as Record<string, unknown>;
      const cb = b.custom_data as Record<string, unknown>;
      assert(ca.value === 10000 && cb.value === 10000, 'Purchase value distinto');
      assert(ca.currency === 'ARS' && cb.currency === 'ARS', 'Purchase currency distinta');
      assert(custom.value === 10000, 'Purchase value de entrada');
    }
    void tokens;
  }
}

async function testPixel2ErrorKeepsPixel1(): Promise<void> {
  const calls = mockFetch((url) => {
    if (pixelFromUrl(url) === '222222222222222') {
      return { ok: false, status: 400, json: { error: { message: 'pixel 2 down' } } };
    }
    return { ok: true, status: 200, json: { events_received: 1 } };
  });
  const result = await send('Purchase', 'purchase_fail2', { currency: 'ARS', value: 5000 });
  assert(result.pixel1_ok === true, 'Pixel 1 debería quedar ok');
  assert(result.pixel2_ok === false, 'Pixel 2 debería quedar error');
  assert(result.ok === false, 'ok total no puede ser true si Pixel 2 falló');
  assert(calls.length === 2, 'Pixel 2 no se reintenta con TOKEN_1');
  assert(tokenFromUrl(calls.find((call) => pixelFromUrl(call.url) === '222222222222222')!.url) === 'token-2', 'Pixel 2 solo usa TOKEN_2');
}

async function testPixel1ErrorKeepsPixel2(): Promise<void> {
  const calls = mockFetch((url) => {
    if (pixelFromUrl(url) === '111111111111111') {
      return { ok: false, status: 500, json: { error: { message: 'pixel 1 down' } } };
    }
    return { ok: true, status: 200, json: { events_received: 1 } };
  });
  const result = await send('Lead', 'lead_fail1');
  assert(result.pixel1_ok === false, 'Pixel 1 falló');
  assert(result.pixel2_ok === true, 'Pixel 2 igual se envió');
  assert(result.ok === false, 'ok total no puede ser true si Pixel 1 falló');
  assert(calls.length === 2, 'Pixel 2 igual se intentó');
  const pixel2 = calls.find((call) => pixelFromUrl(call.url) === '222222222222222');
  assert(pixel2, 'faltó request a Pixel 2');
}

async function testBothPixelsFail(): Promise<void> {
  mockFetch(() => ({ ok: false, status: 500, json: { error: { message: 'both down' } } }));
  const result = await send('Purchase', 'purchase_both_fail', { currency: 'ARS', value: 1000 });
  assert(result.ok === false, 'si fallan los dos, ok debe ser false');
  assert(result.pixel1_ok === false && result.pixel2_ok === false, 'ambos pixels en error');
}

async function testMissingToken1StillSendsPixel2(): Promise<void> {
  const calls = mockFetch(okHandler);
  const result = await sendMetaEvent({
    META_ACCESS_TOKEN: '',
    META_ACCESS_TOKEN_2: 'token-2',
    PIXEL_ID: '111111111111111',
    PIXEL_ID_2: '222222222222222',
  }, {
    event_name: 'PageView',
    event_id: 'pv_only2',
    event_source_url: 'https://example.com/',
    user_data: USER,
    custom_data: {},
  });
  assert(calls.length === 1, 'solo Pixel 2');
  assert(pixelFromUrl(calls[0].url) === '222222222222222', 'debía ir a Pixel 2');
  assert(tokenFromUrl(calls[0].url) === 'token-2', 'debía usar token 2');
  assert(result.pixel1_ok === false, 'sin TOKEN_1 Pixel 1 no envía');
  assert(result.pixel2_ok === true, 'Pixel 2 igual envía');
}

async function testMissingToken2DoesNotUseToken1(): Promise<void> {
  const calls = mockFetch(okHandler);
  const result = await sendMetaEvent({
    META_ACCESS_TOKEN: 'token-1',
    META_ACCESS_TOKEN_2: '',
    PIXEL_ID: '111111111111111',
    PIXEL_ID_2: '222222222222222',
  }, {
    event_name: 'Purchase',
    event_id: 'purchase_no_t2',
    event_source_url: 'https://example.com/',
    user_data: USER,
    custom_data: { currency: 'ARS', value: 5000 },
  });
  assert(calls.length === 1, 'sin TOKEN_2 no se envía Pixel 2');
  assert(pixelFromUrl(calls[0].url) === '111111111111111', 'solo Pixel 1');
  assert(tokenFromUrl(calls[0].url) === 'token-1', 'Pixel 1 usa TOKEN_1');
  assert(result.pixel1_ok === true, 'Pixel 1 ok');
  assert(result.pixel2_ok === false, 'Pixel 2 omitido sin TOKEN_2');
  assert(result.ok === false, 'ok total false si falta TOKEN_2');
}

async function testToken2FailDoesNotFallbackToToken1(): Promise<void> {
  const calls = mockFetch((url) => {
    if (tokenFromUrl(url) === 'token-2') {
      return { ok: false, status: 400, json: { error: { message: 'bad token 2' } } };
    }
    return { ok: true, status: 200, json: { events_received: 1 } };
  });
  const result = await send('Purchase', 'purchase_fb', { currency: 'ARS', value: 5000 });
  assert(result.pixel1_ok === true, 'Pixel 1 ok');
  assert(result.pixel2_ok === false, 'Pixel 2 error queda visible');
  assert(result.ok === false, 'ok total false si TOKEN_2 falla');
  const pixel2 = calls.filter((call) => pixelFromUrl(call.url) === '222222222222222');
  assert(pixel2.length === 1, 'Pixel 2 se intenta una sola vez');
  assert(tokenFromUrl(pixel2[0].url) === 'token-2', 'Pixel 2 solo usa TOKEN_2');
  assert(!calls.some((call) => pixelFromUrl(call.url) === '222222222222222' && tokenFromUrl(call.url) === 'token-1'), 'TOKEN_1 no escribe en Pixel 2');
}

const tests = [
  ['dual send 4 eventos x 2 pixels', testDualSendAllEvents],
  ['Pixel 2 error no oculta el fallo', testPixel2ErrorKeepsPixel1],
  ['Pixel 1 error no cancela Pixel 2', testPixel1ErrorKeepsPixel2],
  ['sin token 1 igual envía Pixel 2', testMissingToken1StillSendsPixel2],
  ['sin token 2 no usa token 1 en Pixel 2', testMissingToken2DoesNotUseToken1],
  ['token 2 falla y no reintenta con token 1', testToken2FailDoesNotFallbackToToken1],
  ['si fallan los dos, ok es false', testBothPixelsFail],
] as const;

let failed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    console.log('ok  ' + name);
  } catch (error) {
    failed += 1;
    console.log('fail  ' + name + ': ' + (error instanceof Error ? error.message : error));
  }
}
if (failed) {
  process.exitCode = 1;
} else {
  console.log('todos los tests de doble envío pasaron');
}
