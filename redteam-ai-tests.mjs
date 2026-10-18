import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from './dist/ai.js';

const OPENAI_KEY = 'sk-redteam-test-not-a-real-secret';
const GOOGLE_KEY = 'AIza-redteam-test-not-a-real-secret';
const originalFetch = globalThis.fetch;
const source = { title: '작업실의 하루', content: '서랍을 열어 기록을 확인했다. '.repeat(60).trim() };
const edited = { ...source, notes: ['문장 호흡을 정리했습니다.'], imagePrompt: '' };
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const response = (provider, value) => json(provider === 'google'
  ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }
  : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });

test.beforeEach(() => ai.configureAI({ provider: 'openai', apiKey: OPENAI_KEY }));
test.afterEach(() => { globalThis.fetch = originalFetch; ai.clearAI(); });

test('red team: malformed model metadata cannot produce a successful connection', async () => {
  for (const metadata of [null, {}, [], { id: '' }, { id: 42 }, { id: 'a-different-model' }]) {
    globalThis.fetch = async () => json(metadata);
    await assert.rejects(ai.validateAI(), error => error.code === 'INVALID_RESPONSE');
  }
  ai.configureAI({ provider: 'google', apiKey: GOOGLE_KEY });
  for (const metadata of [
    { supportedGenerationMethods: ['generateContent'] },
    { name: 'models/a-different-model', supportedGenerationMethods: ['generateContent'] },
  ]) {
    globalThis.fetch = async () => json(metadata);
    await assert.rejects(ai.validateAI(), error => error.code === 'INVALID_RESPONSE');
  }
});

test('red team: oversized declared content is rejected and cancelled before consumption', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"id":"gpt-4.1"}')); },
    cancel() { cancelled = true; },
  });
  globalThis.fetch = async () => new Response(body, { headers: { 'Content-Length': '31000000', 'Content-Type': 'application/json' } });
  const controller = new AbortController();
  // Keep an old, unbounded implementation from hanging the regression suite.
  const guard = setTimeout(() => controller.abort(), 1000);
  try {
    await assert.rejects(ai.validateAI(controller.signal), error => error.code === 'INVALID_RESPONSE');
    assert.equal(cancelled, true);
  } finally {
    clearTimeout(guard);
    await body.cancel().catch(() => {});
  }
});

test('red team: text stream byte limits cancel before reading the whole response', async () => {
  let chunks = 0;
  let cancelled = false;
  const body = new ReadableStream({
    pull(controller) {
      chunks++;
      if (chunks > 12) controller.close();
      else controller.enqueue(new Uint8Array(250000).fill(32));
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  globalThis.fetch = async () => new Response(body);
  await assert.rejects(ai.rewriteChapter(source, {}), error => error.code === 'INVALID_RESPONSE');
  assert.equal(cancelled, true);
  assert.ok(chunks < 12, `read ${chunks} chunks before rejecting`);
});

test('red team: cancelling during a stalled response body releases the reader', async () => {
  let cancelled = false;
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const body = new ReadableStream({
    pull(controller) {
      controller.enqueue(new TextEncoder().encode('{"id":'));
      started();
      return new Promise(() => {});
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  globalThis.fetch = async () => new Response(body);
  const controller = new AbortController();
  const pending = ai.validateAI(controller.signal);
  await ready;
  controller.abort();
  const timed = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('response body remained blocked after cancellation')), 1000);
    pending.finally(() => clearTimeout(timer)).catch(() => {});
  });
  await assert.rejects(Promise.race([pending, timed]), error => error.name === 'AbortError');
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

for (const provider of ['google', 'openai']) {
  test(`red team: ${provider} refuses completed rewrites that discard most of the manuscript`, async () => {
    ai.configureAI({ provider, apiKey: provider === 'google' ? GOOGLE_KEY : OPENAI_KEY });
    for (const content of ['전체 내용을 세 문장으로 요약했습니다.', source.content.repeat(3)]) {
      globalThis.fetch = async () => response(provider, { ...edited, content });
      await assert.rejects(ai.rewriteChapter(source, {}), error => error.code === 'UNSAFE_REWRITE');
    }
    globalThis.fetch = async () => response(provider, { ...edited, content: source.content.replaceAll('서랍', '책상') });
    assert.equal((await ai.rewriteChapter(source, {})).content.length, source.content.length);
  });

  test(`red team: ${provider} returns a review note for changed quantities without claiming fact-checking`, async () => {
    ai.configureAI({ provider, apiKey: provider === 'google' ? GOOGLE_KEY : OPENAI_KEY });
    const chapter = { title: '측정', content: '2025년 3월에 측정한 길이는 10.5 cm다.' };
    globalThis.fetch = async () => response(provider, { ...edited, content: '2025년 3월에 측정한 길이는 15.5 cm다.' });
    const result = await ai.rewriteChapter(chapter, {});
    assert.ok(result.notes.some(note => /수치/.test(note) && /원문/.test(note)));
    assert.ok(result.notes.length <= 5);
  });
}

test('red team: overlong rewrites fail before billing, while supported long rewrites receive a sufficient output budget', async () => {
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.ok(request.max_completion_tokens > 12000);
    assert.ok(request.max_completion_tokens <= 32768);
    return response('openai', { ...edited, content: '가'.repeat(12000) });
  };
  await assert.rejects(ai.rewriteChapter({ title: '긴 장', content: '가'.repeat(12001) }, {}), error => error.code === 'INVALID_INPUT' && /12,000/.test(error.message));
  assert.equal(calls, 0);
  assert.equal((await ai.rewriteChapter({ title: '긴 장', content: '가'.repeat(12000) }, {})).content.length, 12000);
  assert.equal(calls, 1);
});

test('red team: split UTF-8 chunks round-trip Korean without replacement characters', async () => {
  const serialized = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(edited) } }] });
  const bytes = new TextEncoder().encode(serialized);
  let offset = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) { controller.close(); return; }
      controller.enqueue(bytes.slice(offset, offset + 5));
      offset = Math.min(offset + 5, bytes.length);
    },
  }));
  assert.equal((await ai.rewriteChapter(source, {})).content, source.content);
});

test('red team: malformed UTF-8 never silently replaces manuscript text', async () => {
  const prefix = new TextEncoder().encode('{"choices":[{"finish_reason":"stop","message":{"content":"');
  const suffix = new TextEncoder().encode('"}}]}');
  globalThis.fetch = async () => new Response(new Uint8Array([...prefix, 0xc0, 0xaf, ...suffix]));
  await assert.rejects(ai.rewriteChapter(source, {}), error => error.code === 'INVALID_RESPONSE');
});

test('red team: HTTP failure cancels unread response bodies and does not expose remote errors', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`SECRET ${OPENAI_KEY}`)); },
    cancel() { cancelled = true; },
  });
  globalThis.fetch = async () => new Response(body, { status: 429 });
  await assert.rejects(ai.validateAI(), error => error.code === 'HTTP_429' && !error.message.includes(OPENAI_KEY));
  assert.equal(cancelled, true);
});

test('red team: timeout also cancels a stalled successful response body', async () => {
  let cancelled = false;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, _milliseconds, ...args) => realSetTimeout(callback, 0, ...args);
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull() { return new Promise(() => {}); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }));
  try {
    await assert.rejects(ai.validateAI(), error => error.code === 'TIMEOUT');
    assert.equal(cancelled, true);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('red team: changed direct quotations are flagged but equivalent number and quote formatting is retained', async () => {
  const source = { title: '측정 기록', content: '“비용은 10,000원입니다.”라고 말했다.' };
  for (const [content, shouldWarn] of [
    ['“비용은 10,000원입니다.”라고 답했다.', false],
    ['"비용은 10,000원입니다."라고 답했다.', false],
    ['“비용은 10,000원뿐입니다.”라고 답했다.', true],
  ]) {
    globalThis.fetch = async () => response('openai', { ...edited, content, notes: ['1', '2', '3', '4', '5'] });
    const result = await ai.rewriteChapter(source, {});
    assert.equal(result.notes.some(note => note.includes('인용부호')), shouldWarn);
    assert.equal(result.notes.length, 5);
  }
  globalThis.fetch = async () => response('openai', { ...edited, content: '비용은 10000원이다.' });
  const result = await ai.rewriteChapter({ title: '비용', content: '비용은 10,000원이다.' }, {});
  assert.equal(result.notes.some(note => note.includes('수치')), false);
});

test('red team: signature-only and corrupt images are rejected before reaching project storage', async () => {
  const corruptPNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=';
  const stubJPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0xff, 0xd9]).toString('base64');
  const stubWebP = Buffer.alloc(24);
  stubWebP.write('RIFF'); stubWebP.writeUInt32LE(16, 4); stubWebP.write('WEBPVP8 ', 8);
  ai.configureAI({ provider: 'google', apiKey: GOOGLE_KEY });
  for (const [mimeType, data] of [['image/png', corruptPNG], ['image/jpeg', stubJPEG], ['image/webp', stubWebP.toString('base64')]]) {
    globalThis.fetch = async () => json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ inlineData: { mimeType, data } }] } }] });
    await assert.rejects(ai.generateImage('작업실 삽화'), error => error.code === 'INVALID_RESPONSE');
  }
});
