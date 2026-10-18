import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as ai from './dist/ai.js';

// Retained from Google's public REST discovery, independently of application
// constants. No network, real credentials, or generated content is needed here.
const contract = JSON.parse(readFileSync(new URL('./test-fixtures/google-response-format-contract.json', import.meta.url), 'utf8'));
const originalFetch = globalThis.fetch;
const fakeKey = 'contract-test-only-not-a-real-key';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';

function googleResponse(parts) {
  return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts } }] }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function captureRequest(value, { image = false } = {}) {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return googleResponse(image
      ? [{ inlineData: { mimeType: 'image/png', data: png } }]
      : [{ text: JSON.stringify(value) }]);
  };
  return requests;
}

function assertJSONContract(config) {
  const format = config.responseFormat.text;
  assert.ok(contract.schemas.TextResponseFormat.mimeType.includes(format.mimeType),
    `Unknown REST TextResponseFormat.MimeType: ${format.mimeType}`);
  assert.equal(format.mimeType, 'APPLICATION_JSON');
  assert.equal(format.schema.type, 'object');
  assert.equal(format.schema.additionalProperties, false);
  assert.equal(Object.hasOwn(config, 'responseSchema'), false);
  assert.equal(Object.hasOwn(config, 'responseJsonSchema'), false);
}

test.beforeEach(() => {
  ai.clearAI();
  ai.configureAI({ provider: 'google', apiKey: fakeKey });
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  ai.clearAI();
});

test('Google connection generation uses the official REST JSON enum on the wire', async () => {
  const requests = captureRequest({ text: '비가 그치자 서점 주인이 문을 열었다. 젖은 우산은 문 옆 바구니에 놓았다.' });
  const result = await ai.runAITextTest();
  assert.equal(requests.length, 1);
  const { url, body } = requests[0];
  assert.match(url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/[^/]+:generateContent$/);
  assertJSONContract(body.generationConfig);
  assert.equal(JSON.parse(body.contents[0].parts[0].text).operation, 'connection_text_test');
  assert.equal(result.provider, 'google');
});

test('Google 40-chapter production planning sends the official JSON enum with its complete schema', async () => {
  const chapters = Array.from({ length: 40 }, (_, index) => ({
    title: `자료 읽기 ${index + 1}`, purpose: `${index + 1}번째 자료 묶음의 맥락을 살핀다.`,
    outline: ['자료의 범위를 확인한다.', '확인할 질문을 남긴다.'], sourceRefs: [],
  }));
  const requests = captureRequest({ title: '자료를 읽는 시간', subtitle: '', description: '자료를 읽고 기록하는 과정을 설명한다.', chapters });
  const result = await ai.planProductionBook({ brief: {
    topic: '초보자를 위한 자료 읽기', targetChars: 30000, chapterCount: 40, language: 'ko',
  } });
  assert.equal(requests.length, 1);
  const { body } = requests[0];
  assertJSONContract(body.generationConfig);
  const data = JSON.parse(body.contents[0].parts[0].text);
  assert.equal(data.operation, 'production_book_plan');
  assert.equal(data.brief.chapterCount, 40);
  assert.equal(body.generationConfig.responseFormat.text.schema.properties.chapters.items.type, 'object');
  assert.equal(result.chapters.length, 40);
});

test('Google image generation uses the official portrait aspect-ratio enum on the wire', async () => {
  const requests = captureRequest(null, { image: true });
  const result = await ai.generateImage('작은 서점의 열린 문과 낮은 책장');
  assert.equal(requests.length, 1);
  const config = requests[0].body.generationConfig;
  const aspectRatio = config.responseFormat.image.aspectRatio;
  assert.ok(contract.schemas.ImageResponseFormat.aspectRatio.includes(aspectRatio),
    `Unknown REST ImageResponseFormat.AspectRatio: ${aspectRatio}`);
  assert.equal(aspectRatio, 'ASPECT_RATIO_TWO_BY_THREE');
  assert.deepEqual(config.responseModalities, ['TEXT', 'IMAGE']);
  assert.equal(result.src, `data:image/png;base64,${png}`);
});
