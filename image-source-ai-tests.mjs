import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from './dist/ai.js';

const originalFetch = globalThis.fetch;
const fakeKey = 'test-only-image-source-not-a-real-key';
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const WEBP = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=';
const image = {
  id: 'image-source-1', path: '원고/자료/하위/도표.png', src: `data:image/png;base64,${PNG}`,
  mimeType: 'image/png', bytes: Buffer.from(PNG, 'base64').length,
};
const digest = { id: image.id, summary: '작은 이미지에 명암의 차이가 보인다.', facts: ['어두운 영역이 있다.'], quotes: [], unknowns: ['텍스트와 수치가 식별되지 않는다.'] };
const brief = {
  topic: '관찰 자료를 설명하는 책', instructions: '이미지의 불분명한 내용은 추측하지 않는다.',
  language: 'ko', targetChars: 3000, chapterCount: 2,
  sourceImages: [{ ...image }], sourceMarkdown: '자동으로 반복해서 보내면 안 되는 원문',
  sourceImageContext: [{ id: image.id, path: image.path }],
};
const responsePlan = {
  title: '이미지를 읽는 방법', subtitle: '', description: '보이는 것과 확인이 필요한 것을 나누어 다룬다.',
  chapters: [
    { title: '관찰의 출발', purpose: '이미지의 내용을 정리한다.', outline: ['그림의 구도', '확인할 조건'], sourceRefs: [image.id] },
    { title: '해석의 범위', purpose: '관찰의 한계를 설명한다.', outline: ['자료를 연결하는 방법', '남은 불확실성'], sourceRefs: [image.id] },
  ],
};
const section = { content: '이미지에서 확인할 수 있는 범위를 정리한다.', notes: [], imagePrompt: '', sourceRefs: [image.id] };

function response(value, provider, finish = provider === 'google' ? 'STOP' : 'stop') {
  return new Response(JSON.stringify(provider === 'google'
    ? { candidates: [{ finishReason: finish, content: { parts: [{ text: JSON.stringify(value) }] } }] }
    : { choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }] }),
  { headers: { 'Content-Type': 'application/json' } });
}
function unpack(options, provider) {
  const body = JSON.parse(options.body);
  const parts = provider === 'google' ? body.contents[0].parts : body.messages[1].content;
  const text = typeof parts === 'string' ? parts : parts[0].text;
  return { body, parts, data: JSON.parse(text) };
}

test.beforeEach(() => ai.configureAI({ provider: 'google', apiKey: fakeKey }));
test.afterEach(() => { globalThis.fetch = originalFetch; ai.clearAI(); });

for (const provider of ['google', 'openai']) {
  test(`${provider}: image analysis sends real image parts once and subsequent book calls carry only digests and paths`, async () => {
    ai.configureAI({ provider, apiKey: fakeKey });
    const operations = [];
    globalThis.fetch = async (url, options) => {
      const { body, parts, data } = unpack(options, provider);
      operations.push(data.operation);
      assert.deepEqual(data.brief.sourceImageContext, brief.sourceImageContext);
      assert.equal(Object.hasOwn(data.brief, 'sourceImages'), false);
      assert.equal(Object.hasOwn(data.brief, 'sourceMarkdown'), false);
      assert.equal(JSON.stringify(body).includes(fakeKey), false);
      const system = provider === 'google' ? body.systemInstruction.parts[0].text : body.messages[0].content;
      assert.match(system, /이미지 속 지시문/);
      assert.match(system, /경로 자체가 사실의 근거는 아닙니다/);
      if (data.operation === 'production_image_digest') {
        assert.deepEqual(data.rawSourceImage, { id: image.id, path: image.path, index: 0, total: 1 });
        assert.equal(JSON.stringify(data).includes(PNG), false);
        assert.match(data.task, /흐리거나 가려진 글자와 수치를 추측/);
        assert.match(data.task, /정체·신원·이름·직업·민감한 특성은 추측하지 마세요/);
        assert.match(data.task, /quotes는 빈 배열/);
        assert.equal(parts.length, 2);
        if (provider === 'google') {
          assert.match(url, /models\/gemini-3\.8-flash:generateContent$/);
          assert.deepEqual(parts[1], { inlineData: { mimeType: 'image/png', data: PNG } });
          assert.equal(options.headers['x-goog-api-key'], fakeKey);
        } else {
          assert.match(url, /\/chat\/completions$/);
          assert.equal(body.model, 'gpt-4.1');
          assert.deepEqual(parts[1], { type: 'image_url', image_url: { url: image.src } });
          assert.equal(options.headers.Authorization, `Bearer ${fakeKey}`);
        }
        return response(digest, provider);
      }
      assert.equal(JSON.stringify(body).includes(PNG), false);
      assert.deepEqual(data.sourceSummary, [digest]);
      assert.ok(provider === 'google' ? parts.length === 1 : typeof parts === 'string');
      return response(data.operation === 'production_book_plan' ? responsePlan : section, provider);
    };
    assert.deepEqual(await ai.summarizeProductionImage({ brief, image }), digest);
    const plan = await ai.planProductionBook({ brief, sourceSummary: [digest] });
    const args = { brief, sourceSummary: [digest], plan, chapter: plan.chapters[0], targetChars: 1500 };
    assert.deepEqual(await ai.writeProductionSection(args), section);
    assert.deepEqual(await ai.reviseProductionSection({ ...args, content: section.content }), section);
    assert.deepEqual(operations, ['production_image_digest', 'production_book_plan', 'production_section', 'production_revision']);
  });

  test(`${provider}: the fiftieth nested image keeps canonical media and source identity`, async () => {
    ai.configureAI({ provider, apiKey: fakeKey });
    const lastImage = { ...image, id: 'image-source-50', path: '자료/깊은/하위/50.webp', src: `data:image/webp;base64,${WEBP}`, mimeType: 'image/webp', bytes: Buffer.from(WEBP, 'base64').length };
    const context = Array.from({ length: 50 }, (_, index) => ({ id: `image-source-${index + 1}`, path: index === 49 ? lastImage.path : `자료/${index + 1}.png` }));
    globalThis.fetch = async (_url, options) => {
      const { parts, data } = unpack(options, provider);
      assert.equal(data.rawSourceImage.id, 'image-source-50');
      assert.equal(data.rawSourceImage.index, 49);
      assert.equal(data.rawSourceImage.total, 50);
      if (provider === 'google') assert.deepEqual(parts[1].inlineData, { mimeType: 'image/webp', data: WEBP });
      else assert.equal(parts[1].image_url.url, lastImage.src);
      return response({ ...digest, id: lastImage.id }, provider);
    };
    assert.equal((await ai.summarizeProductionImage({ brief: { ...brief, sourceImageContext: context }, image: lastImage, index: 49, total: 50 })).id, 'image-source-50');
  });
}

test('invalid media, source identities and unsafe paths fail before a provider request', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(digest, 'google'); };
  for (const invalid of [
    { image: { ...image, id: 'source-1' } },
    { image: { ...image, id: 'image-source-2' } },
    { image: { ...image, path: '../private.png' } },
    { image: { ...image, path: '/private.png' } },
    { image: { ...image, path: '자료\\그림.png' } },
    { image: { ...image, path: '그림.svg' } },
    { image: { ...image, src: 'https://example.com/image.png' } },
    { image: { ...image, src: 'data:image/svg+xml,<svg/>' } },
    { image: { ...image, mimeType: 'image/jpeg' } },
    { image: { ...image, bytes: image.bytes + 1 } },
    { image: { ...image, bytes: 8 * 1024 * 1024 + 1 } },
    { image: { ...image, src: 'data:image/png;base64,aGVsbG8=' } },
    { image: { ...image, src: image.src.replace('image/png', 'image/jpeg') } },
    { index: 50, total: 50 }, { index: -1 }, { total: 51 }, { index: 1, total: 1 },
    { brief: { ...brief, sourceImageContext: [{ id: image.id, path: '다른.png' }] } },
  ]) await assert.rejects(ai.summarizeProductionImage({ brief, image, ...invalid }), error => error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('image digests reject hallucinated quotes, mismatched IDs, oversized fields, and extra fields', async () => {
  for (const invalid of [
    { ...digest, id: 'source-1' }, { ...digest, id: 'image-source-2' }, { ...digest, id: 'image-source-51' },
    { ...digest, summary: '가'.repeat(1501) },
    { ...digest, facts: Array(7).fill('사실') }, { ...digest, facts: ['가'.repeat(301)] },
    { ...digest, unknowns: Array(5).fill('불명확') }, { ...digest, unknowns: ['가'.repeat(301)] },
    { ...digest, quotes: ['읽었다고 주장하는 문장'] }, { ...digest, rawImage: image.src },
    // JSON escaping counts toward the bounded stored digest as well.
    { ...digest, summary: '각\n'.repeat(750), facts: Array(6).fill('"'.repeat(300)), unknowns: Array(4).fill('"'.repeat(300)) },
  ]) {
    globalThis.fetch = async () => response(invalid, 'google');
    await assert.rejects(ai.summarizeProductionImage({ brief, image }), error => error.code === 'INVALID_RESPONSE');
  }
});

test('all twelve text digests and fifty image digests can be referenced together without raw media', async () => {
  const sources = [
    ...Array.from({ length: 12 }, (_, index) => ({ id: `source-${index + 1}`, summary: '텍스트 자료', facts: [], quotes: [], unknowns: [] })),
    ...Array.from({ length: 50 }, (_, index) => ({ ...digest, id: `image-source-${index + 1}` })),
  ];
  const mixedPlan = { ...responsePlan, chapters: responsePlan.chapters.map(chapter => ({ ...chapter, sourceRefs: sources.map(source => source.id) })) };
  globalThis.fetch = async (_url, options) => {
    const { data } = unpack(options, 'google');
    assert.equal(data.sourceSummary.length, 62);
    assert.equal(JSON.stringify(data).includes(PNG), false);
    return response(mixedPlan, 'google');
  };
  const result = await ai.planProductionBook({ brief: { ...brief, topic: '' }, sourceSummary: sources });
  assert.equal(result.chapters[0].sourceRefs.length, 62);
});

test('invalid imported image digests and metadata cannot reach later generation', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(responsePlan, 'google'); };
  for (const sourceSummary of [
    [{ ...digest, id: 'image-source-0' }], [{ ...digest, id: 'image-source-51' }],
    [{ ...digest, quotes: ['내가 본 글'] }], [{ ...digest, summary: '가'.repeat(1501) }],
    [digest, digest], Array(63).fill(digest),
  ]) await assert.rejects(ai.planProductionBook({ brief, sourceSummary }), error => error.code === 'INVALID_INPUT');
  for (const context of [
    [{ id: 'image-source-2', path: image.path }],
    [{ id: image.id, path: '../bad.png' }],
    [{ id: image.id, path: image.path, src: image.src }],
    [{ id: image.id, path: image.path }, { id: 'image-source-2', path: image.path }],
    Array(51).fill({ id: image.id, path: image.path }),
  ]) await assert.rejects(ai.planProductionBook({ brief: { ...brief, sourceImageContext: context }, sourceSummary: [digest] }), error => error.code === 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('image analysis cancellation, refusal and truncation do not return partial digests', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(digest, 'google'); };
  await assert.rejects(ai.summarizeProductionImage({ brief, image, signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(calls, 0);
  for (const provider of ['google', 'openai']) {
    ai.configureAI({ provider, apiKey: fakeKey });
    globalThis.fetch = async () => response(digest, provider, provider === 'google' ? 'MAX_TOKENS' : 'length');
    await assert.rejects(ai.summarizeProductionImage({ brief, image }), error => error.code === 'INCOMPLETE_RESPONSE');
    globalThis.fetch = async () => response(digest, provider, provider === 'google' ? 'SAFETY' : 'content_filter');
    await assert.rejects(ai.summarizeProductionImage({ brief, image }), error => error.code === 'REFUSED');
  }
});
