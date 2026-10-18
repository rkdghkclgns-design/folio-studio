import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from './dist/ai.js';
import { serializeDiagram } from './dist/diagrams.js';

// Model.outputTokenLimit is the maximum available output budget according to
// Google's public v1beta discovery, checked independently on 2026-10-18:
// https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta
// These are contract simulations; they do not use real keys or paid requests.
const originalFetch = globalThis.fetch;
const fakeKey = 'audit-api-not-a-real-secret';
const selectedModel = 'custom-small-output-model';
const prose = '비가 그친 뒤 주인은 서점 문을 열고 젖은 간판을 닦았다.';
const metadata = (limit, model = selectedModel) => ({
  name: `models/${model}`, supportedGenerationMethods: ['generateContent'],
  ...(limit === undefined ? {} : { outputTokenLimit: limit }),
});
const googleText = value => Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] });

function connect(model = selectedModel) {
  ai.configureAI({ provider: 'google', apiKey: fakeKey, textModel: model });
}

function transport(limit, { value = { text: prose } } = {}) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return Response.json(metadata(limit));
    const body = JSON.parse(options.body);
    if (body.generationConfig.maxOutputTokens > limit) {
      return Response.json({ error: { message: 'maxOutputTokens exceeds the model outputTokenLimit' } }, { status: 400 });
    }
    return googleText(value);
  };
  return calls;
}

function postedBudget(call) {
  return JSON.parse(call.options.body).generationConfig.maxOutputTokens;
}

test.beforeEach(() => { ai.clearAI(); connect(); });
test.afterEach(() => { globalThis.fetch = originalFetch; ai.clearAI(); });

test('audit API: a valid 8192-token Google model can pass connection and actual short generation', async () => {
  const calls = transport(8192);
  assert.equal(await ai.validateAI(), true);
  assert.equal((await ai.runAITextTest()).text, prose);
  assert.equal(calls.length, 2, 'metadata check and one generation only, without a retry');
  assert.equal(postedBudget(calls[1]), 8192);
  assert.ok(calls.every(call => call.options.headers['x-goog-api-key'] === fakeKey));
});

test('audit API: output limits cap long rewrite requests without enlarging the requested budget', async () => {
  const chapter = { title: '오래된 서점', content: '가'.repeat(12000) };
  const value = { ...chapter, notes: ['문장 호흡을 살폈습니다.'], imagePrompt: '' };
  for (const [limit, expected] of [[8192, 8192], [20000, 20000], [65536, 21900]]) {
    connect();
    const calls = transport(limit, { value });
    await ai.validateAI();
    assert.equal((await ai.rewriteChapter(chapter, {})).content, chapter.content);
    assert.equal(postedBudget(calls[1]), expected);
  }
});

test('audit API: capped output that is actually truncated remains rejected, preserving the manuscript', async () => {
  const calls = transport(8192);
  await ai.validateAI();
  const chapter = { title: '원고', content: '원고는 그대로 보존한다. '.repeat(100) };
  const before = structuredClone(chapter);
  globalThis.fetch = async (_url, options) => {
    assert.equal(postedBudget({ options }), 8192);
    return Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"title":"원고"' }] } }] });
  };
  await assert.rejects(ai.rewriteChapter(chapter, {}), error => error.code === 'INCOMPLETE_RESPONSE');
  assert.deepEqual(chapter, before);
  assert.equal(calls.length, 1);
});

test('audit API: clearing or reconnecting never reuses an earlier model limit', async () => {
  for (const reset of [() => connect(), () => { ai.clearAI(); connect(); }, () => connect('different-model')]) {
    connect();
    transport(8192);
    await ai.validateAI();
    reset();
    let budget;
    globalThis.fetch = async (_url, options) => {
      budget = postedBudget({ options });
      return googleText({ text: prose });
    };
    await ai.runAITextTest();
    assert.equal(budget, 16384, 'an unvalidated configuration retains the existing default budget');
  }
});

test('audit API: stale metadata cannot lower a newer connection limit, even for the same model and key', async () => {
  let finishOld;
  let metadataCalls = 0;
  const budgets = [];
  globalThis.fetch = async (_url, options) => {
    if (options.method === 'GET') {
      if (++metadataCalls === 1) return new Promise(resolve => { finishOld = resolve; });
      return Response.json(metadata(32768));
    }
    budgets.push(postedBudget({ options }));
    return googleText({ text: prose });
  };
  const older = ai.validateAI();
  connect();
  await ai.validateAI();
  finishOld(Response.json(metadata(8192)));
  assert.equal(await older, true);
  await ai.runAITextTest();
  assert.deepEqual(budgets, [16384]);
});

test('audit API: metadata without optional output limits preserves compatibility', async () => {
  const calls = transport(undefined);
  await ai.validateAI();
  await ai.runAITextTest();
  assert.equal(postedBudget(calls[1]), 16384);
});

test('audit API: malformed declared model limits fail connection before any generation', async () => {
  for (const limit of [0, -1, 12.5, '8192', null, {}, 2147483648]) {
    connect();
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      assert.equal(options.method, 'GET');
      return Response.json(metadata(limit));
    };
    await assert.rejects(ai.validateAI(), error => error.code === 'INVALID_RESPONSE');
    assert.equal(calls, 1);
  }
});

test('audit API: Google capability cache does not change OpenAI generation or expose keys', async () => {
  transport(8192);
  await ai.validateAI();
  ai.configureAI({ provider: 'openai', apiKey: 'openai-audit-not-a-real-secret' });
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(body.max_completion_tokens, 1200);
    assert.equal(options.headers['x-goog-api-key'], undefined);
    assert.equal(options.headers.Authorization, 'Bearer openai-audit-not-a-real-secret');
    assert.equal(options.body.includes(fakeKey), false);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ text: prose }) } }] });
  };
  assert.equal((await ai.runAITextTest()).provider, 'openai');
  assert.equal(JSON.stringify(ai.getAIConfig()).includes('secret'), false);
});

const chart = {
  type: 'bar', title: '자료 수 비교', caption: '', columns: [], rows: [],
  labels: ['노트', '편지'], values: [12, 8], unit: '개',
  evidence: ['노트는 12개다.', '편지는 8개다.'],
};
const evidence = '노트는 12개다. 편지는 8개다.';
const productionArgs = (diagrams, sourceExcerpt = '') => ({
  brief: { topic: '자료 정리', language: 'ko', chapterCount: 2, targetChars: 6000, diagrams },
  chapter: { id: 'chapter-1', title: '자료의 분류', purpose: '자료를 비교한다.', outline: ['자료 분류'], sourceRefs: [] },
  targetChars: 1500, sourceSummary: [], sourceExcerpt,
});

for (const provider of ['google', 'openai']) {
  test(`audit API: ${provider} cannot bypass chart grounding or diagrams=none with alternate line endings or fence controls`, async () => {
    ai.configureAI({ provider, apiKey: fakeKey });
    const blocks = [
      serializeDiagram(chart).replaceAll('\n', '\r'),
      serializeDiagram(chart).replace('folio-diagram', 'folio-diagram\u0000'),
    ];
    let calls = 0;
    for (const block of blocks) {
      const value = { content: `자료를 서로 비교한다.\n\n${block}`, notes: [], imagePrompt: '', sourceRefs: [] };
      globalThis.fetch = async () => {
        calls++;
        return provider === 'google' ? googleText(value)
          : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
      };
      await assert.rejects(ai.writeProductionSection(productionArgs('auto')), error => error.code === 'INVALID_RESPONSE');
      await assert.rejects(ai.writeProductionSection(productionArgs('none', evidence)), error => error.code === 'INVALID_RESPONSE');
      assert.equal((await ai.writeProductionSection(productionArgs('auto', evidence))).content, value.content);
    }
    assert.equal(calls, blocks.length * 3, 'one request per explicit attempt, with no hidden retry or image call');
  });
}
