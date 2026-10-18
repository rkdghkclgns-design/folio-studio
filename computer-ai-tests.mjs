import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from './dist/ai.js';

// Contract simulations only: no live credentials, paid calls or device control.
const originalFetch = globalThis.fetch;
const fakeKey = 'computer-adapter-test-not-a-real-key';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const frame = () => ({
  sessionId: 'session-computer-test', frameId: 'frame-computer-test',
  window: { id: 'window-computer-test', title: 'MapleStory Worlds Editor' },
  image: { src: `data:image/png;base64,${png}`, width: 1, height: 1 },
});
const action = (type = 'capture', overrides = {}) => ({ type, x: 0, y: 0, text: '', key: '', amount: 0, ...overrides });
const decision = (type = 'capture', overrides = {}) => ({
  action: action(type), summary: '현재 화면을 자료로 저장합니다.',
  title: ['capture', 'finish'].includes(type) ? '편집기 화면' : '',
  caption: ['capture', 'finish'].includes(type) ? '화면에서 확인한 실습 단계입니다.' : '',
  extractedText: '', ...overrides,
});
const options = overrides => ({ goal: '책의 예시에 쓸 편집기 화면을 기록해 주세요.', frame: frame(), ...overrides });
function connect(provider = 'google') {
  ai.configureAI({ provider, apiKey: fakeKey, textModel: 'chosen-vision-model' });
}
function respond(provider, value) {
  return provider === 'google'
    ? Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] })
    : Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] });
}

test.beforeEach(() => { ai.clearAI(); connect(); });
test.afterEach(() => { globalThis.fetch = originalFetch; ai.clearAI(); });

for (const provider of ['google', 'openai']) {
  test(`computer AI ${provider}: uses existing model and one image part, with bounded selected context only`, async () => {
    connect(provider);
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init, body: JSON.parse(init.body) });
      return respond(provider, decision());
    };
    const result = await ai.nextComputerAction(options({ context: {
      bookTitle: '월드 만들기', chapterTitle: '처음 여는 편집기', excerpt: '선택한 장의 짧은 문맥',
      apiKey: 'unrelated-private-context-key', otherChapter: 'unrelated-private-chapter',
    }, history: [{ action: action('click', { x: 250, y: 400 }), summary: '보이는 버튼을 클릭하도록 요청함', token: 'private-history-token' }] }));
    assert.deepEqual(result, decision());
    assert.equal(calls.length, 1);
    const { url, init, body } = calls[0];
    const user = provider === 'google' ? body.contents[0].parts[0].text : body.messages[1].content[0].text;
    const data = JSON.parse(user);
    const schema = provider === 'google' ? body.generationConfig.responseFormat.text.schema : body.response_format.json_schema.schema;
    const system = provider === 'google' ? body.systemInstruction.parts[0].text : body.messages[0].content;
    assert.deepEqual(data.context, { bookTitle: '월드 만들기', chapterTitle: '처음 여는 편집기', excerpt: '선택한 장의 짧은 문맥' });
    assert.deepEqual(data.frame, { windowTitle: 'MapleStory Worlds Editor', width: 1, height: 1 });
    assert.equal(data.history.length, 1);
    assert.deepEqual(Object.keys(data.history[0]).sort(), ['action', 'summary']);
    for (const secret of [fakeKey, png, 'unrelated-private-context-key', 'unrelated-private-chapter', 'private-history-token', 'session-computer-test', 'frame-computer-test', 'window-computer-test']) assert.ok(!user.includes(secret));
    assert.ok(!init.body.includes(fakeKey));
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.properties.action.required, ['type', 'x', 'y', 'text', 'key', 'amount']);
    assert.ok(!schema.properties.action.properties.key.enum.includes('ctrl+v'));
    assert.match(system, /goal뿐/);
    assert.match(system, /신뢰할 수 없는 관찰 자료/);
    assert.match(system, /보이는 결과 없이 실행되었다고/);
    assert.match(system, /ask_user/);
    if (provider === 'google') {
      assert.match(url, /\/models\/chosen-vision-model:generateContent$/);
      assert.equal(init.headers['x-goog-api-key'], fakeKey);
      assert.deepEqual(body.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: png } });
      assert.equal(body.contents[0].parts.length, 2);
      assert.equal(body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
    } else {
      assert.equal(body.model, 'chosen-vision-model');
      assert.equal(init.headers.Authorization, `Bearer ${fakeKey}`);
      assert.deepEqual(body.messages[1].content[1], { type: 'image_url', image_url: { url: frame().image.src } });
      assert.equal(body.messages[1].content.length, 2);
      assert.equal(body.response_format.json_schema.strict, true);
    }
  });

  test(`computer AI ${provider}: capture-only mode cannot emit control or finish actions`, async () => {
    connect(provider);
    let value = decision();
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      const schema = provider === 'google' ? body.generationConfig.responseFormat.text.schema : body.response_format.json_schema.schema;
      assert.deepEqual(schema.properties.action.properties.type.enum, ['capture', 'ask_user']);
      return respond(provider, value);
    };
    assert.equal((await ai.nextComputerAction(options({ mode: 'capture' }))).action.type, 'capture');
    value = decision('ask_user', { summary: '필요한 창을 직접 선택해 주세요.' });
    assert.equal((await ai.nextComputerAction(options({ mode: 'capture' }))).action.type, 'ask_user');
    for (const type of ['click', 'finish']) {
      value = decision(type);
      await assert.rejects(ai.nextComputerAction(options({ mode: 'capture' })), { code: 'INVALID_RESPONSE' });
    }
  });
}

test('computer AI rejects malformed or enlarged inputs before any provider request', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return respond('google', decision()); };
  const invalid = [
    { goal: '' }, { goal: '가'.repeat(4001) }, { goal: {} }, { mode: 'execute' },
    { context: [] }, { context: { excerpt: '가'.repeat(6001) } }, { context: { bookTitle: '가'.repeat(201) } },
    { history: {} }, { history: Array.from({ length: 21 }, () => ({ action: action(), summary: '' })) },
    { history: [null] }, { history: [{ action: action('press_key', { key: 'ctrl+v' }), summary: '' }] },
    { history: [{ action: action(), summary: '가'.repeat(1001) }] },
    { frame: { ...frame(), image: { ...frame().image, src: 'https://example.org/private.png' } } },
    { frame: { ...frame(), image: { ...frame().image, src: 'data:image/png;base64,bm90IGEgcG5n' } } },
    { frame: { ...frame(), image: { ...frame().image, width: 2 } } },
  ];
  for (const value of invalid) await assert.rejects(ai.nextComputerAction(options(value)), { code: 'INVALID_INPUT' });
  assert.equal(calls, 0);
});

test('computer AI rejects malformed decisions and never exposes raw model output in errors', async () => {
  const marker = 'private-model-output-do-not-display';
  const missing = decision(); delete missing.action.amount;
  const invalid = [
    missing, { ...decision(), unexpected: marker }, { ...decision(), action: action('shell', { text: marker }) },
    decision('press_key', { action: action('press_key', { key: 'ctrl+v' }) }),
    decision('click', { action: action('click', { x: 1001 }) }),
    decision('click', { action: action('click', { y: -1 }) }),
    decision('scroll', { action: action('scroll', { amount: 1.5 }) }),
    decision('wait', { action: action('wait', { text: marker }) }),
    decision('type_text', { action: action('type_text', { text: '가'.repeat(4001) }) }),
    decision('capture', { summary: '가'.repeat(1001) }),
    decision('capture', { title: '가'.repeat(151) }),
    decision('capture', { caption: '가'.repeat(1501) }),
    decision('capture', { extractedText: '가'.repeat(12001) }),
    decision('click', { extractedText: marker }),
  ];
  for (const value of invalid) {
    globalThis.fetch = async () => respond('google', value);
    await assert.rejects(ai.nextComputerAction(options()), error => error.code === 'INVALID_RESPONSE' && !error.message.includes(marker));
  }
});

test('computer AI preserves allowed click, type, key and finish decisions exactly', async () => {
  for (const value of [
    decision('click', { action: action('click', { x: 1000, y: 1.25 }) }),
    decision('type_text', { action: action('type_text', { text: 'local speed = 2\n-- 실습 코드' }) }),
    decision('press_key', { action: action('press_key', { key: 'ctrl+s' }) }),
    decision('scroll', { action: action('scroll', { x: 650, y: 400, amount: -2 }) }),
    decision('finish', { extractedText: '현재 화면에 보이는 최종 내용' }),
  ]) {
    globalThis.fetch = async () => respond('google', value);
    assert.deepEqual(await ai.nextComputerAction(options()), value);
  }
});

test('computer AI cancellation before fetch prevents a paid request', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  globalThis.fetch = async () => { calls++; return respond('google', decision()); };
  await assert.rejects(ai.nextComputerAction(options({ signal: controller.signal })), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('computer AI aborts an in-flight request without returning an actionable decision', async () => {
  const controller = new AbortController();
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    started();
  });
  const pending = ai.nextComputerAction(options({ signal: controller.signal }));
  await waiting;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('computer AI forwards selected-provider failure through existing safe diagnostics', async () => {
  globalThis.fetch = async () => Response.json({ error: { message: 'private-response' } }, { status: 403 });
  await assert.rejects(ai.nextComputerAction(options()), error => error.code === 'HTTP_403' && !error.message.includes('private-response'));
});

test('computer references survive rewriting and drafting; dropped, changed or duplicated captures are rejected', async () => {
  const first = '![첫 화면](folio-asset:capture-1)';
  const second = '![결과 화면](folio-asset:capture-2)';
  const chapter = { title: '실습', content: `처음 화면입니다.\n\n${first}\n\n${second}\n\n${first}`, figures: [
    { id: 'capture-1', src: frame().image.src, alt: '첫 화면', caption: '' },
    { id: 'capture-2', src: frame().image.src, alt: '결과 화면', caption: '' },
  ] };
  const original = structuredClone(chapter);
  for (const operation of [ai.rewriteChapter, ai.draftChapter]) {
    let content = `첫 화면을 살펴봅니다.\n\n${first}\n\n${second}\n\n${first}`;
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      assert.ok(!JSON.stringify(body.contents).includes(png), 'text editing does not upload stored screenshots');
      assert.match(body.systemInstruction.parts[0].text, /folio-asset/);
      return respond('google', { title: chapter.title, content, notes: ['문장을 다듬었습니다.'], imagePrompt: '' });
    };
    assert.equal((await operation(chapter, {})).content, content);
    for (const changed of [
      `첫 화면입니다.\n\n${first}\n\n${second}`,
      `${chapter.content}\n\n${second}`,
      chapter.content.replace('capture-2', 'made-up-figure'),
      chapter.content.replace('결과 화면', '확인하지 않은 설명'),
      chapter.content.replace(second, `\`\`\`text\n${second}\n\`\`\``),
      chapter.content.replace(second, `~~~text\r${second}\r~~~`),
      chapter.content.replace(second, `설명: ${second}`),
      chapter.content.replace(second, `> ${second}`),
    ]) {
      content = changed;
      await assert.rejects(operation(chapter, {}), { code: 'UNSAFE_REWRITE' });
    }
    assert.deepEqual(chapter, original, 'rejected result does not mutate the manuscript or saved images');
  }
});
