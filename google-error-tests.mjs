/** Adversarial Google error responses and durable retry behavior; no real API calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from './dist/ai.js';
import { createProductionProject, getProductionProgress, runProduction, validateProductionData } from './dist/production.js';

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const key = 'AIza-redteam-google-error-not-a-real-key';
const secret = 'PRIVATE_MANUSCRIPT_AND_CREDENTIAL_ECHO';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const errorBody = (message, reason) => ({ error: {
  code: 400, status: 'INVALID_ARGUMENT', message: `${message} ${secret} ${key} <script>alert(1)</script>`,
  ...(reason ? { details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, domain: 'googleapis.com', metadata: { consumer: secret, apiKey: key } }] } : {}),
} });

test.beforeEach(() => ai.configureAI({ provider: 'google', apiKey: key }));
test.afterEach(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalSetTimeout; ai.clearAI(); });

function assertSafe400(error, reason) {
  assert.equal(error.code, 'HTTP_400');
  assert.equal(error.status, 400);
  assert.equal(error.reason, reason);
  assert.match(error.message, /[가-힣]/);
  for (const text of [error.message, JSON.stringify(error), String(error.stack)]) {
    assert.equal(text.includes(key), false);
    assert.equal(text.includes(secret), false);
    assert.doesNotMatch(text, /<script>|alert\(1\)|googleapis\.com\/|REMOTE/);
  }
  return true;
}

for (const [reason, message, infoReason] of [
  ['API_KEY_INVALID', 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID'],
  ['API_KEY_EXPIRED', 'API key expired. Please renew the API key.', 'API_KEY_EXPIRED'],
  ['API_KEY_EXPIRED', 'Expired API key. Please renew the credential.'],
  ['REQUEST_FORMAT', 'Invalid value at generation_config.response_format.text.mime_type: application/json'],
  ['REQUEST_FORMAT', 'Invalid JSON payload received. Unknown name "unexpected_field" at generation_config: Cannot find field.'],
  ['OUTPUT_LIMIT', 'The max_output_tokens value must be less than or equal to 8192.'],
  ['SCHEMA_LIMIT', 'The response schema is too complex. Reduce schema complexity.'],
  ['BILLING_REQUIRED', 'Gemini API free tier is not available in your country. Please enable billing on your project in Google AI Studio.'],
  ['REGION_UNSUPPORTED', 'User location is not supported for the API use.'],
]) {
  test(`Google 400 safely distinguishes ${reason}: ${message.slice(0, 45)}`, async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return json(errorBody(message, infoReason), 400); };
    await assert.rejects(ai.runAITextTest(), error => assertSafe400(error, reason));
    assert.equal(calls, 1, 'A rejected request must not trigger an automatic billable retry.');
  });
}

test('unknown or malformed Google 400 details never leak or become an attacker-chosen reason', async () => {
  for (const body of [
    errorBody('REMOTE private details', `API_KEY_INVALID ${secret}`),
    { error: { code: 400, status: secret, message: { reason: 'API_KEY_INVALID', secret }, details: secret } },
    { error: { code: 400, details: [{ reason: secret, metadata: { apiKey: key } }] } },
    null, [], { message: 'API_KEY_INVALID', private: secret },
  ]) {
    globalThis.fetch = async () => json(body, 400);
    await assert.rejects(ai.runAITextTest(), error => assertSafe400(error));
  }
  for (const raw of [`API_KEY_INVALID ${secret} ${key}`, '{broken', '']) {
    globalThis.fetch = async () => new Response(raw, { status: 400 });
    await assert.rejects(ai.runAITextTest(), error => assertSafe400(error));
  }
  globalThis.fetch = async () => new Response(new Uint8Array([0xc0, 0xaf]), { status: 400 });
  await assert.rejects(ai.runAITextTest(), error => assertSafe400(error));
});

test('declared oversized Google error bodies are cancelled before reading and retain HTTP 400', async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream({ pull() { pulls++; return new Promise(() => {}); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  globalThis.fetch = async () => new Response(body, { status: 400, headers: { 'Content-Length': '65537' } });
  await assert.rejects(ai.runAITextTest(), error => assertSafe400(error));
  assert.equal(pulls, 0);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('streamed Google error bodies stop at the diagnostic byte bound instead of reading arbitrarily large content', async () => {
  let pulls = 0, cancelled = false;
  const body = new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(40000).fill(32)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  globalThis.fetch = async () => new Response(body, { status: 400 });
  await assert.rejects(ai.runAITextTest(), error => assertSafe400(error));
  assert.ok(pulls <= 2, `Read ${pulls} 40 KB chunks of a failed response.`);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('Google error diagnostics time out quickly without changing the original HTTP failure into a generation timeout', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  globalThis.fetch = async () => new Response(body, { status: 400 });
  // Preserve the request's real deadline; accelerate only the diagnostic timeout.
  globalThis.setTimeout = (callback, milliseconds, ...args) => originalSetTimeout(callback, milliseconds <= 2000 ? 10 : milliseconds, ...args);
  await assert.rejects(ai.runAITextTest(), error => assertSafe400(error));
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('user cancellation releases a stalled Google error body and remains AbortError', async () => {
  let cancelled = false, started;
  const ready = new Promise(resolve => { started = resolve; });
  const body = new ReadableStream({ pull() { started(); return new Promise(() => {}); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  globalThis.fetch = async () => new Response(body, { status: 400 });
  const controller = new AbortController();
  const pending = ai.runAITextTest({ signal: controller.signal });
  await ready;
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError' && !error.message.includes(key));
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('non-400 Google errors and OpenAI errors remain unread and cancel their response bodies', async () => {
  for (const [provider, status] of [['google', 403], ['google', 429], ['openai', 400]]) {
    ai.configureAI({ provider, apiKey: key });
    let pulls = 0, cancelled = false;
    const body = new ReadableStream({ pull() { pulls++; return new Promise(() => {}); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
    globalThis.fetch = async () => new Response(body, { status });
    await assert.rejects(ai.runAITextTest(), error => error.code === `HTTP_${status}` && error.reason === undefined);
    assert.equal(pulls, 0);
    assert.equal(cancelled, true);
  }
});

test('switching provider during Google 400 diagnostics keeps its credential and error provider isolated', async () => {
  let respond, captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, headers: options.headers };
    return new Promise(resolve => { respond = resolve; });
  };
  const pending = ai.runAITextTest();
  ai.configureAI({ provider: 'openai', apiKey: 'sk-separate-redteam-not-a-real-secret' });
  respond(json(errorBody('API key expired.', 'API_KEY_EXPIRED'), 400));
  await assert.rejects(pending, error => {
    assertSafe400(error, 'API_KEY_EXPIRED');
    assert.match(error.message, /Google/);
    assert.doesNotMatch(error.message, /OpenAI/);
    return true;
  });
  assert.match(captured.url, /generativelanguage\.googleapis\.com/);
  assert.equal(captured.headers['x-goog-api-key'], key);
  assert.equal(captured.headers.Authorization, undefined);
  assert.equal(ai.getAIConfig().provider, 'openai');
});

test('planning failure is saved once per explicit attempt, preserves the book, and never retries automatically', async () => {
  const project = createProductionProject({ topic: '기록의 순서', targetValue: 30000, chapterCount: 40, illustrations: 'none' });
  const originalChapters = structuredClone(project.chapters);
  let calls = 0, writes = 0, saves = 0;
  globalThis.fetch = async () => { calls++; return json(errorBody('API key not valid.', 'API_KEY_INVALID'), 400); };
  const options = {
    api: { planBook: ai.planProductionBook, writeSection: async () => { writes++; throw new Error('Writing must not start after planning fails.'); } },
    onSave: async () => { saves++; },
  };
  for (let attempt = 1; attempt <= 2; attempt++) {
    await assert.rejects(runProduction(project, options), error => assertSafe400(error, 'API_KEY_INVALID'));
    assert.equal(calls, attempt);
    assert.equal(writes, 0);
    assert.equal(project.production.requestsStarted, attempt);
    assert.equal(project.production.status, 'failed');
    assert.equal(project.production.stage, 'plan');
    assert.equal(project.production.plan, null);
    assert.equal(getProductionProgress(project).canResume, true);
    assert.deepEqual(project.chapters, originalChapters);
    assert.equal(JSON.stringify(project).includes(key), false);
    assert.equal(JSON.stringify(project).includes(secret), false);
    assert.doesNotThrow(() => validateProductionData(structuredClone(project.production)));
  }
  assert.ok(saves >= 2, 'The failure and resumable state must be persisted.');
});
