import test from 'node:test';
import assert from 'node:assert/strict';
import { createComputerClient, validateComputerAction, validateComputerDecision, validateComputerFrame, validateComputerResearch, runComputerTask } from './dist/computer.js';

const token = 'f'.repeat(64);
const src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const frame = () => ({ sessionId: 'session-1', frameId: 'frame-1', window: { id: '123', title: '월드 에디터' }, image: { src, width: 1, height: 1 } });
const decision = (type, extra = {}) => ({ action: { type }, summary: '발판의 배치를 확인했습니다.', title: '첫 번째 발판', caption: '발판을 배치한 작업 화면.', extractedText: '발판', ...extra });
const record = () => ({ id: 'capture-1', capturedAt: '2026-10-18T12:00:00.000Z', windowTitle: '월드 에디터', title: '발판', caption: '배치 화면', extractedText: 'Level 1', src, steps: ['발판을 배치했습니다.'] });
const research = () => ({ version: 1, goal: '발판을 배치하는 예시', target: '월드 에디터', records: [record()] });
const json = value => Response.json(value);

function clientStub(overrides = {}) {
  const calls = [];
  const client = {
    async observe() { calls.push('observe'); return frame(); },
    async act(session, id, action) { calls.push(['act', session, id, action]); return { ok: true }; },
    async stop() { calls.push('stop'); return { ok: true }; },
    ...overrides,
  };
  return { client, calls };
}
function task(client, decide, extra = {}) {
  return runComputerTask({ client, sessionId: 'session-1', goal: '발판 예시 만들기', decide, onCapture: async () => {}, ...extra });
}
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function dimensions(width, height) {
  const bytes = Buffer.from(src.slice(22), 'base64');
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20); bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
function paddedPNG(size) {
  const bytes = Buffer.from(src.slice(22), 'base64');
  const chunk = Buffer.alloc(size + 12); chunk.writeUInt32BE(size); chunk.write('foLi', 4);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
  return `data:image/png;base64,${Buffer.concat([bytes.subarray(0, -12), chunk, bytes.subarray(-12)]).toString('base64')}`;
}

test('computer action canonicalization bounds clicks and scrolls to the selected viewport', () => {
  assert.deepEqual(validateComputerAction({ type: 'click', x: 125.5, y: 1000 }), { type: 'click', x: 125.5, y: 1000, text: '', key: '', amount: 0 });
  assert.deepEqual(validateComputerAction({ type: 'scroll', x: 650, y: 400, amount: 3 }), { type: 'scroll', x: 650, y: 400, amount: 3, text: '', key: '' });
  for (const action of [
    { type: 'click', x: -1, y: 0 }, { type: 'click', x: 0, y: Infinity }, { type: 'scroll', x: 1, y: 1, amount: 6 },
    { type: 'scroll', x: 1, y: 1, amount: 1.5 }, { type: 'scroll', amount: 1 }, { type: 'wait', text: 'hidden' },
    { type: 'click', x: 1, y: 1, script: 'unapproved' }, { type: new String('wait') },
  ]) assert.throws(() => validateComputerAction(action));
});

test('computer action allows bounded Unicode typing and a narrow keyboard allowlist', () => {
  assert.equal(validateComputerAction({ type: 'type_text', text: '안녕하세요\nlocal x = 1\t-- 예시' }).text, '안녕하세요\nlocal x = 1\t-- 예시');
  assert.equal(validateComputerAction({ type: 'press_key', key: 'CTRL+S' }).key, 'ctrl+s');
  for (const key of ['ctrl+v', 'alt+f4', 'win+r', 'ctrl+shift+esc', 'f12']) assert.throws(() => validateComputerAction({ type: 'press_key', key }));
  for (const text of ['', 'x'.repeat(4001), 'null\0byte', '\ud800']) assert.throws(() => validateComputerAction({ type: 'type_text', text }));
});

test('computer decision strictly validates schema and relevant action fields', () => {
  const clean = validateComputerDecision(decision('capture'));
  assert.equal(clean.action.type, 'capture'); assert.equal(clean.action.x, 0);
  assert.throws(() => validateComputerDecision({ ...decision('capture'), token }));
  assert.throws(() => validateComputerDecision({ ...decision('capture'), summary: 'x'.repeat(1001) }));
  assert.throws(() => validateComputerDecision({ ...decision('capture'), action: { type: 'finish', x: 22 } }));
});

test('computer frame uses actual PNG dimensions and rejects remote, mislabeled or oversized assets', () => {
  assert.deepEqual(validateComputerFrame(frame()), frame());
  for (const image of [
    { src: 'https://example.com/screenshot.png', width: 1, height: 1 }, { src: src.replace('image/png', 'image/jpeg'), width: 1, height: 1 },
    { src, width: 2, height: 1 }, { src: dimensions(8193, 1), width: 8193, height: 1 },
    { src: dimensions(8192, 8192), width: 8192, height: 8192 }, { src: src.slice(0, -8), width: 1, height: 1 },
  ]) assert.throws(() => validateComputerFrame({ ...frame(), image }));
  const cached = validateComputerFrame(frame()); cached.image.src = 'data:image/png;base64,AAAA';
  assert.throws(() => validateComputerFrame(cached));
});

test('computer research round trips only durable evidence and rejects hidden credentials and bad ids', () => {
  assert.equal(validateComputerResearch(undefined), undefined);
  assert.deepEqual(validateComputerResearch(research()), research());
  for (const invalid of [
    { ...research(), token }, { ...research(), records: [{ ...record(), action: { type: 'click' } }] },
    { ...research(), records: [{ ...record(), id: 'file.with.dots' }] }, { ...research(), records: [{ ...record(), id: 'namespace:id' }] },
    { ...research(), records: [{ ...record(), capturedAt: '2026-02-31T12:00:00.000Z' }] },
    { ...research(), records: [{ ...record(), steps: ['x'.repeat(1001)] }] }, { ...research(), records: [record(), record()] },
    { ...research(), records: Array.from({ length: 21 }, (_, n) => ({ ...record(), id: `record-${n}` })) },
  ]) assert.throws(() => validateComputerResearch(invalid));
  const cached = validateComputerResearch(research()); cached.records[0].caption = 'x'.repeat(1501);
  assert.throws(() => validateComputerResearch(cached));
  cached.records[0].caption = ''; cached.records[0].src = 'data:image/png;base64,AAAA';
  assert.throws(() => validateComputerResearch(cached));
});

test('computer research enforces the aggregate 32 MiB limit as well as individual screenshot limits', () => {
  const large = paddedPNG(7 * 1024 * 1024);
  const records = Array.from({ length: 5 }, (_, index) => ({ ...record(), id: `large-${index}`, src: large }));
  assert.equal(validateComputerResearch({ ...research(), records: records.slice(0, 4) }).records.length, 4);
  assert.throws(() => validateComputerResearch({ ...research(), records }), { code: 'COMPUTER_IMAGE_TOTAL_LIMIT' });
  assert.throws(() => validateComputerResearch({ ...research(), records: [{ ...record(), src: `data:image/png;base64,${'A'.repeat(12 * 1024 * 1024)}` }] }), { code: 'INVALID_COMPUTER_IMAGE' });
});

test('computer client cannot point its bearer token at another host, port, path or redirect', async () => {
  for (const baseURL of ['https://127.0.0.1:8765', 'http://localhost:8765', 'http://127.0.0.1:8766', 'http://127.0.0.1:8765/v1', 'http://user@127.0.0.1:8765', 'http://127.0.0.1:8765?x=1', 'http://127.0.0.1:8765#x', 'http://127.1:8765']) {
    assert.throws(() => createComputerClient({ token, baseURL }), { code: 'INVALID_COMPUTER_ORIGIN' });
  }
  assert.throws(() => createComputerClient({ token: 'short' }), { code: 'INVALID_COMPUTER_TOKEN' });
  const redirected = json({ version: 1, platform: 'windows' }); Object.defineProperty(redirected, 'redirected', { value: true });
  await assert.rejects(createComputerClient({ token, fetchImpl: async () => redirected }).status(), { code: 'INVALID_COMPUTER_RESPONSE' });
});

test('computer client uses authenticated fixed endpoints with no cookies, redirects, persistence or extra requests', async () => {
  const calls = [];
  const responses = [{ version: 1, platform: 'windows' }, { windows: [{ id: '123', title: '월드 에디터' }] }, { sessionId: 'session-1' }, frame(), { ok: true }, { ok: true }];
  const client = createComputerClient({ token, fetchImpl: async (url, options) => { calls.push({ url, options }); return json(responses.shift()); } });
  await client.status(); await client.windows(); await client.select('123'); await client.observe('session-1');
  await client.act('session-1', 'frame-1', { type: 'click', x: 10, y: 20 }); await client.stop();
  assert.deepEqual(calls.map(call => call.url), ['status', 'windows', 'select', 'observe', 'action', 'stop'].map(path => `http://127.0.0.1:8765/v1/${path}`));
  for (const { options } of calls) {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, `Bearer ${token}`); assert(!options.body?.includes(token));
  }
  assert.equal(JSON.stringify(client), '{}');
  assert.equal(JSON.parse(calls[4].options.body).action.type, 'click');
});

test('computer client validates session identity and never sends local-only actions', async () => {
  let requests = 0;
  const client = createComputerClient({ token, fetchImpl: async () => { requests++; return json({ ...frame(), sessionId: 'other-session' }); } });
  await assert.rejects(client.observe('session-1'));
  for (const type of ['capture', 'finish', 'ask_user']) await assert.rejects(client.act('session-1', 'frame-1', { type }));
  assert.equal(requests, 1);
});

test('computer client rejects malformed successful responses and oversized streamed bodies', async () => {
  for (const response of [
    json({ version: 1, platform: 'windows', token }), new Response('not json', { headers: { 'content-type': 'application/json' } }),
    new Response('{}', { headers: { 'content-type': 'text/html' } }),
    new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '262145' } }),
    new Response(new Uint8Array(262145), { headers: { 'content-type': 'application/json' } }),
  ]) await assert.rejects(createComputerClient({ token, fetchImpl: async () => response }).status());
});

test('computer client redacts bridge and network failures and never retries a failed request', async () => {
  for (const fetchImpl of [
    async () => json({ error: { code: 'FOCUS_CHANGED', message: token } }),
    async () => Response.json({ error: { code: 'FOCUS_CHANGED', message: token } }, { status: 409 }),
    async () => { throw new Error(`network ${token}`); },
    async () => { const error = new Error(token); error.name = 'AbortError'; throw error; },
  ]) {
    let count = 0;
    const client = createComputerClient({ token, fetchImpl: async (...args) => { count++; return fetchImpl(...args); } });
    await assert.rejects(client.status(), error => !String(error).includes(token)); assert.equal(count, 1);
  }
});

test('computer client aborts a stalled body without relying on the server to close it', async () => {
  const controller = new AbortController(); let fetched = false, cancelled = false;
  const client = createComputerClient({ token, fetchImpl: async () => {
    fetched = true;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-type': 'application/json' } });
  } });
  const pending = client.status(controller.signal);
  await Promise.resolve(); await Promise.resolve();
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
  assert(fetched); assert(cancelled);
});

test('computer client bounds a stalled fetch to 15 seconds without a retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const client = createComputerClient({ token, fetchImpl: () => { count++; return new Promise(() => {}); } });
  const pending = client.status(); const rejection = assert.rejects(pending, { code: 'COMPUTER_TIMEOUT' });
  t.mock.timers.tick(15000); await rejection; assert.equal(count, 1);
});

test('computer workflow observes before every action and captures only the real final frame', async () => {
  const { client, calls } = clientStub(); const captures = []; const histories = [];
  const choices = [decision('click', { action: { type: 'click', x: 500, y: 450 } }), decision('finish')];
  const result = await task(client, async input => { histories.push(input.history); assert(Object.isFrozen(input.frame)); return choices.shift(); }, { onCapture: async value => { captures.push(value); calls.push('save'); } });
  assert.equal(result.status, 'complete'); assert.equal(result.steps.length, 2);
  assert.deepEqual(calls.map(call => Array.isArray(call) ? call[0] : call), ['observe', 'act', 'observe', 'save', 'stop']);
  assert.equal(captures[0].src, src); assert.equal(captures[0].windowTitle, '월드 에디터'); assert.equal(captures[0].steps.length, 2);
  assert.equal(histories[1][0].action.type, 'click'); assert(!JSON.stringify(histories).includes(src));
});

test('computer workflow commits a capture before further observation or action', async () => {
  const { client, calls } = clientStub(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  const choices = [decision('capture'), decision('finish')];
  let captures = 0;
  const pending = task(client, async () => choices.shift(), { onCapture: async () => { captures++; if (captures === 1) await gate; } });
  while (captures === 0) await Promise.resolve();
  assert.deepEqual(calls, ['observe']); release();
  assert.equal((await pending).status, 'complete'); assert.equal(captures, 2);
});

test('computer workflow cannot report completion if capture persistence fails', async () => {
  const { client, calls } = clientStub();
  await assert.rejects(task(client, async () => decision('finish'), { onCapture: async () => { throw new Error('quota'); } }), /quota/);
  assert.deepEqual(calls, ['observe', 'stop']);
});

test('computer workflow asks for user intervention without issuing further actions', async () => {
  const { client, calls } = clientStub(); let captures = 0;
  const result = await task(client, async () => decision('ask_user', { summary: '로그인 후 작업 창을 다시 선택해 주세요.' }), { onCapture: async () => { captures++; } });
  assert.equal(result.status, 'needs_user'); assert.equal(captures, 0); assert.deepEqual(calls, ['observe', 'stop']);
});

test('computer workflow honors step bounds and stops after a failed action without replay', async () => {
  const first = clientStub();
  const limited = await task(first.client, async () => decision('wait'), { maxSteps: 2 });
  assert.equal(limited.status, 'limit'); assert.equal(first.calls.filter(Array.isArray).length, 2);
  const second = clientStub({ async act() { second.calls.push('act-failed'); throw new Error('stale frame'); } });
  await assert.rejects(task(second.client, async () => decision('wait')), /stale frame/);
  assert.deepEqual(second.calls, ['observe', 'act-failed', 'stop']);
  await assert.rejects(task(first.client, async () => decision('wait'), { maxSteps: 51 }));
});

test('computer workflow cancels after a pending decision and revokes the session once', async () => {
  const { client, calls } = clientStub(); const controller = new AbortController();
  await assert.rejects(task(client, async () => { controller.abort(); return decision('click', { action: { type: 'click', x: 1, y: 1 } }); }, { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(calls, ['observe', 'stop']);
});

test('computer workflow uses a captured default result even when finish has no title or caption', async () => {
  const { client } = clientStub(); let saved;
  assert.equal((await task(client, async () => decision('finish', { title: '', caption: '', extractedText: '' }), { onCapture: async value => { saved = value; } })).status, 'complete');
  assert.equal(saved.src, src); assert(saved.title); assert(saved.caption); assert.equal(saved.extractedText, '');
});

test('computer workflow does not accept another session or altered screenshot as evidence', async () => {
  const other = clientStub({ async observe() { return { ...frame(), sessionId: 'other' }; } });
  await assert.rejects(task(other.client, async () => decision('finish')));
  assert.deepEqual(other.calls, ['stop']);
  const immutable = clientStub();
  await assert.rejects(task(immutable.client, async ({ frame: current }) => { current.image.src = 'fabricated'; return decision('finish'); }), TypeError);
  assert.deepEqual(immutable.calls, ['observe', 'stop']);
});
