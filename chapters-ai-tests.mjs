import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from './dist/ai.js';

const originalFetch = globalThis.fetch;
const fakeKey = 'test-only-300-chapters-not-a-real-key';
const brief = {
  topic: '자연을 관찰하며 남기는 기록', instructions: '매 장에서 서로 다른 관찰법을 다룬다.',
  title: '기록하는 계절', author: '편집자', language: 'ko', targetChars: 300000,
  chapterCount: 300, sourceMarkdown: '이 원시 자료는 API 연결 테스트로 전송되면 안 된다.',
};
const makeChapter = index => ({
  id: `chapter-${index + 1}`, title: `관찰 기록 ${index + 1}`,
  purpose: `관찰 ${index + 1}의 순서와 한계를 설명한다.`,
  outline: ['기록에 앞서 살필 조건', '기록을 비교하는 방법'], sourceRefs: [],
});
const makePlan = count => ({
  title: brief.title, subtitle: '천천히 바라보는 방법', description: '관찰과 기록의 구체적인 방법을 차례로 다룬다.',
  chapters: Array.from({ length: count }, (_, index) => makeChapter(index)),
});
const responsePlan = (startIndex, count) => ({
  ...makePlan(0), chapters: Array.from({ length: count }, (_, index) => {
    const { id, ...chapter } = makeChapter(startIndex + index);
    return chapter;
  }),
});
const section = { content: '눈앞의 작은 변화를 기록하고 다음 관찰과 비교한다.', notes: [], imagePrompt: '', sourceRefs: [] };

function response(value, provider = 'google', finish = provider === 'google' ? 'STOP' : 'stop') {
  return new Response(JSON.stringify(provider === 'google'
    ? { candidates: [{ finishReason: finish, content: { parts: [{ text: JSON.stringify(value) }] } }] }
    : { choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }] }),
  { headers: { 'Content-Type': 'application/json' } });
}
function requestData(options, provider) {
  const body = JSON.parse(options.body);
  return { body, data: JSON.parse(provider === 'google' ? body.contents[0].parts[0].text : body.messages[1].content) };
}

test.beforeEach(() => ai.configureAI({ provider: 'google', apiKey: fakeKey }));
test.afterEach(() => { globalThis.fetch = originalFetch; ai.clearAI(); });

for (const provider of ['google', 'openai']) {
  test(`${provider}: the 300th chapter is planned in a bounded final batch with stable metadata`, async () => {
    ai.configureAI({ provider, apiKey: fakeKey });
    const previousPlan = makePlan(280);
    for (const chapter of previousPlan.chapters) {
      chapter.purpose = `목적 ${chapter.id} ` + '설명'.repeat(300);
      chapter.outline = Array.from({ length: 8 }, (_, index) => `개요 ${index} ` + '항목'.repeat(240));
    }
    globalThis.fetch = async (_url, options) => {
      const { body, data } = requestData(options, provider);
      assert.equal(data.operation, 'production_book_plan_batch');
      assert.equal(data.brief.chapterCount, 300);
      assert.equal(data.brief.instructions, brief.instructions);
      assert.equal(data.startIndex, 280);
      assert.equal(data.batchSize, 20);
      assert.equal(data.priorPlan.chapterTitles.length, 280);
      assert.equal(data.priorPlan.recentChapters.length, 3);
      assert.deepEqual(data.priorPlan.chapterTitles[0], { id: 'chapter-1', title: '관찰 기록 1' });
      assert.equal(Object.hasOwn(data.priorPlan, 'chapters'), false);
      assert.equal(Object.hasOwn(data.brief, 'sourceMarkdown'), false);
      assert.ok(JSON.stringify(data).length < 40000, 'long prior outlines must not be repeated in every planning request');
      const schema = provider === 'google' ? body.generationConfig.responseFormat.text.schema : body.response_format.json_schema.schema;
      assert.equal(schema.additionalProperties, false);
      assert.equal(schema.properties.chapters.items.additionalProperties, false);
      return response({ ...responsePlan(280, 20), title: '이후 응답이 임의로 바꾼 제목' }, provider);
    };
    const result = await ai.planProductionBatch({ brief, startIndex: 280, batchSize: 20, previousPlan });
    assert.equal(result.title, previousPlan.title);
    assert.equal(result.subtitle, previousPlan.subtitle);
    assert.equal(result.chapters.length, 20);
    assert.equal(result.chapters[0].id, 'chapter-281');
    assert.equal(result.chapters.at(-1).id, 'chapter-300');
  });

  test(`${provider}: a section receives all 300 titles and only neighboring detailed outlines`, async () => {
    ai.configureAI({ provider, apiKey: fakeKey });
    const plan = makePlan(300);
    for (const chapter of plan.chapters) chapter.outline = Array.from({ length: 8 }, (_, index) => `고유 개요 ${chapter.id} ${index} ` + '설명'.repeat(220));
    globalThis.fetch = async (_url, options) => {
      const { data } = requestData(options, provider);
      assert.equal(data.plan.chapterCount, 300);
      assert.equal(data.plan.chapters.length, 300);
      assert.equal(data.plan.nearbyChapters.length, 5);
      assert.deepEqual(data.plan.nearbyChapters.map(chapter => chapter.id), ['chapter-149', 'chapter-150', 'chapter-151', 'chapter-152', 'chapter-153']);
      assert.equal(Object.hasOwn(data.plan.chapters[0], 'outline'), false);
      assert.deepEqual(data.chapter.outline, plan.chapters[150].outline);
      assert.ok(JSON.stringify(data).length < 45000, 'a section request must not carry 300 complete outlines');
      return response(section, provider);
    };
    assert.deepEqual(await ai.writeProductionSection({ brief, plan, chapter: plan.chapters[150], index: 150, targetChars: 1000 }), section);
  });

  test(`${provider}: explicit writing test makes one generation call with a synthetic prompt and safe metadata`, async () => {
    ai.configureAI({ provider, apiKey: fakeKey, textModel: 'custom-text-model' });
    let calls = 0;
    globalThis.fetch = async (url, options) => {
      calls++;
      const { body, data } = requestData(options, provider);
      assert.equal(data.operation, 'connection_text_test');
      assert.equal(options.method, 'POST');
      assert.equal(JSON.stringify(body).includes(fakeKey), false);
      assert.equal(JSON.stringify(body).includes(brief.sourceMarkdown), false);
      assert.deepEqual(Object.keys(data).sort(), ['operation', 'task']);
      if (provider === 'google') assert.match(url, /models\/custom-text-model:generateContent$/);
      else assert.equal(body.model, 'custom-text-model');
      const schema = provider === 'google' ? body.generationConfig.responseFormat.text.schema : body.response_format.json_schema.schema;
      assert.deepEqual(schema.required, ['text']);
      assert.equal(schema.additionalProperties, false);
      return response({ text: '문을 밀자 종이 낮게 울렸다. 주인은 젖은 우산을 문 옆에 기대었다.' }, provider);
    };
    assert.deepEqual(await ai.runAITextTest(), {
      text: '문을 밀자 종이 낮게 울렸다. 주인은 젖은 우산을 문 옆에 기대었다.', provider, model: 'custom-text-model',
    });
    assert.equal(calls, 1);
  });
}

test('first long-book batch establishes its metadata without a prior plan', async () => {
  globalThis.fetch = async (_url, options) => {
    const { data } = requestData(options, 'google');
    assert.equal(Object.hasOwn(data, 'priorPlan'), false);
    return response(responsePlan(0, 20));
  };
  const result = await ai.planProductionBatch({ brief, startIndex: 0, batchSize: 20 });
  assert.equal(result.chapters[0].id, 'chapter-1');
  assert.equal(result.chapters.at(-1).id, 'chapter-20');
  assert.equal(result.title, brief.title);
});

test('invalid long-book batch settings and partial-plan identities fail before billing', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(responsePlan(0, 20)); };
  const wrongIds = makePlan(20);
  wrongIds.chapters[3].id = 'chapter-99';
  const duplicateTitles = makePlan(20);
  duplicateTitles.chapters[3].title = '관 찰 기 록 1';
  for (const options of [
    { brief: { ...brief, chapterCount: 301 }, batchSize: 20 },
    { brief, batchSize: 21 },
    { brief, batchSize: 0 },
    { brief, startIndex: -1, batchSize: 20 },
    { brief, startIndex: 290, batchSize: 20, previousPlan: makePlan(290) },
    { brief, startIndex: 20, batchSize: 20 },
    { brief, startIndex: 20, batchSize: 20, previousPlan: makePlan(19) },
    { brief, startIndex: 20, batchSize: 20, previousPlan: wrongIds },
    { brief, startIndex: 20, batchSize: 20, previousPlan: duplicateTitles },
  ]) await assert.rejects(ai.planProductionBatch(options), error => error.code === 'INVALID_INPUT');
  await assert.rejects(ai.planProductionBook({ brief }), error => error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('batch responses reject duplicate prior titles, wrong size, forged references, and malformed metadata', async () => {
  const valid = responsePlan(20, 20);
  for (const invalid of [
    { ...valid, chapters: valid.chapters.slice(0, 19) },
    { ...valid, chapters: [{ ...valid.chapters[0], title: '관 찰 기 록 1' }, ...valid.chapters.slice(1)] },
    { ...valid, chapters: [{ ...valid.chapters[0], sourceRefs: ['source-1'] }, ...valid.chapters.slice(1)] },
    { ...valid, chapters: [{ ...valid.chapters[0], purpose: '가'.repeat(701) }, ...valid.chapters.slice(1)] },
    { ...valid, chapters: [{ ...valid.chapters[0], id: 'chapter-21' }, ...valid.chapters.slice(1)] },
    { ...valid, description: '' },
  ]) {
    globalThis.fetch = async () => response(invalid);
    await assert.rejects(ai.planProductionBatch({ brief, startIndex: 20, batchSize: 20, previousPlan: makePlan(20) }), error => error.code === 'INVALID_RESPONSE');
  }
});

test('300-chapter source analysis is accepted but an incorrect full-plan order is rejected', async () => {
  const digest = { id: 'source-1', summary: '관찰 기록을 설명한다.', facts: [], quotes: [], unknowns: [] };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(digest); };
  assert.deepEqual(await ai.summarizeProductionSource({ brief, chunk: '관찰 기록을 남긴다.' }), digest);
  const plan = makePlan(300);
  plan.chapters[299].id = 'chapter-100';
  await assert.rejects(ai.writeProductionSection({ brief, plan, chapter: plan.chapters[0], index: 0, targetChars: 1000 }), error => error.code === 'INVALID_INPUT');
  assert.equal(calls, 1);
});

test('legacy short-book resumes retain custom IDs and repeated titles in write and revision requests', async () => {
  const shortBrief = { ...brief, chapterCount: 2, targetChars: 6000 };
  const plan = makePlan(2);
  plan.chapters[0].id = 'saved-introduction';
  plan.chapters[1].id = 'saved-follow-up';
  plan.chapters[1].title = plan.chapters[0].title;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    const { data } = requestData(options, 'google');
    assert.equal(data.chapter.id, 'saved-follow-up');
    assert.equal(data.plan.chapters[0].title, data.plan.chapters[1].title);
    assert.deepEqual(data.plan.chapters.map(chapter => chapter.id), ['saved-introduction', 'saved-follow-up']);
    assert.deepEqual(data.plan.chapters[0].outline, plan.chapters[0].outline);
    return response(section);
  };
  const options = { brief: shortBrief, plan, chapter: plan.chapters[1], index: 1, targetChars: 1500 };
  assert.deepEqual(await ai.writeProductionSection(options), section);
  assert.deepEqual(await ai.reviseProductionSection({ ...options, content: section.content }), section);
  assert.equal(calls, 2);
});

test('legacy short-book compatibility still rejects duplicate IDs and wrong current chapter order before billing', async () => {
  const shortBrief = { ...brief, chapterCount: 2, targetChars: 6000 };
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(section); };
  const plan = makePlan(2);
  plan.chapters[0].id = 'saved-introduction';
  plan.chapters[1].id = 'saved-follow-up';
  const options = { brief: shortBrief, plan, chapter: plan.chapters[1], index: 0, targetChars: 1500 };
  await assert.rejects(ai.writeProductionSection(options), error => error.code === 'INVALID_INPUT');
  plan.chapters[1].id = plan.chapters[0].id;
  await assert.rejects(ai.writeProductionSection({ ...options, index: 1 }), error => error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('text test rejects malformed or excessive generated output and safe provider errors', async () => {
  for (const invalid of [{}, { text: '' }, { text: '가'.repeat(2001) }, { text: '문장', extra: '숨긴 내용' }]) {
    globalThis.fetch = async () => response(invalid);
    await assert.rejects(ai.runAITextTest(), error => error.code === 'INVALID_RESPONSE');
  }
  globalThis.fetch = async () => response({ text: '미완성' }, 'google', 'MAX_TOKENS');
  await assert.rejects(ai.runAITextTest(), error => error.code === 'INCOMPLETE_RESPONSE');
  globalThis.fetch = async () => new Response(`upstream secret ${fakeKey}`, { status: 401 });
  await assert.rejects(ai.runAITextTest(), error => error.code === 'HTTP_401' && !error.message.includes(fakeKey));
});

test('missing configuration and pre-cancelled text tests perform no network request', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ text: '문장' }); };
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(ai.runAITextTest({ signal: controller.signal }), error => error.name === 'AbortError');
  ai.clearAI();
  await assert.rejects(ai.runAITextTest(), error => error.code === 'MISSING_KEY');
  assert.equal(calls, 0);
});
