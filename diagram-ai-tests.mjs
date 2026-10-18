import test from 'node:test';
import assert from 'node:assert/strict';
import * as ai from './dist/ai.js';
import { serializeDiagram, countableDiagramText } from './dist/diagrams.js';

const originalFetch = globalThis.fetch;
const fakeKey = 'test-only-diagram-not-a-real-key';
const table = { type: 'table', title: '자료 정리 방식', caption: '작업의 목적을 비교한다.', columns: ['방식', '목적'], rows: [['분류', '같은 주제로 묶기'], ['연결', '차이와 공통점 찾기']], labels: [], values: [], unit: '', evidence: [] };
const flow = { type: 'flow', title: '자료 정리 순서', caption: '', columns: [], rows: [], labels: ['읽기', '분류하기', '연결하기'], values: [], unit: '', evidence: [] };
const bar = { type: 'bar', title: '자료별 기록 수', caption: '제공된 자료의 수치이다.', columns: [], rows: [], labels: ['노트', '편지'], values: [12, 8], unit: '개', evidence: ['노트는 12개다.', '편지는 8개다.'] };
const raw = '노트는 12개다. 편지는 8개다.';
const digest = { id: 'source-1', summary: '자료의 기록 수를 비교한다.', facts: ['노트는 12개다.', '편지는 8개다.'], quotes: [], unknowns: [] };
const brief = { topic: '자료 정리', instructions: '독자가 필요한 작업 순서를 설명한다.', language: 'ko', targetChars: 6000, chapterCount: 2 };
const chapter = { id: 'chapter-1', title: '자료를 읽는 순서', purpose: '정리 방법을 설명한다.', outline: ['분류와 연결'], sourceRefs: ['source-1'] };
const prose = '자료를 읽고 비슷한 주제끼리 분류한다. 분류한 뒤에는 자료의 공통점과 차이를 살핀다.';
const section = (diagram = null, content = prose) => ({ content: content + (diagram ? `\n\n${serializeDiagram(diagram)}` : ''), notes: [], imagePrompt: '', sourceRefs: ['source-1'] });
const args = extra => ({ brief, chapter, targetChars: 1500, sourceSummary: [digest], sourceExcerpt: raw, ...extra });
const edited = content => ({ title: chapter.title, content, notes: ['문장의 흐름을 다듬었다.'], imagePrompt: '' });
const response = (value, provider = 'openai') => new Response(JSON.stringify(provider === 'google'
  ? { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(value) }] } }] }
  : { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } });
const payload = (options, provider = 'openai') => {
  const body = JSON.parse(options.body);
  return { body, data: JSON.parse(provider === 'google' ? body.contents[0].parts[0].text : body.messages[1].content), system: provider === 'google' ? body.systemInstruction.parts[0].text : body.messages[0].content };
};

test.beforeEach(() => ai.configureAI({ provider: 'openai', apiKey: fakeKey }));
test.afterEach(() => { globalThis.fetch = originalFetch; ai.clearAI(); });

for (const provider of ['google', 'openai']) {
  test(`${provider}: production emits contextual diagrams in one text request with bounded schema guidance`, async () => {
    ai.configureAI({ provider, apiKey: fakeKey });
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      const request = payload(options, provider);
      assert.equal(request.data.operation, 'production_section');
      assert.equal(request.data.brief.diagrams, 'auto');
      assert.equal(request.data.diagramCount, 0);
      assert.match(request.system, /장마다 도표를 강제하지 마세요/);
      assert.match(request.system, /folio-diagram/);
      assert.match(request.system, /정확한 숫자와 unit/);
      assert.match(request.system, /이번에 쓴 본문/);
      assert.equal(JSON.stringify(request.body).includes(fakeKey), false);
      return response(section(bar), provider);
    };
    assert.deepEqual(await ai.writeProductionSection(args()), section(bar));
    assert.equal(calls, 1);
  });

  test(`${provider}: explicit diagram suggestion returns a grounded diagram and exact paragraph without rewriting`, async () => {
    ai.configureAI({ provider, apiKey: fakeKey });
    const source = { title: '기록의 수', content: `${raw}\n\n${prose}` };
    const proposal = { needed: true, reason: '기록 수의 차이를 비교할 수 있다.', anchor: raw, diagram: bar };
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      const request = payload(options, provider);
      assert.equal(request.data.operation, 'chapter_diagram');
      assert.deepEqual(request.data.chapter, source);
      assert.equal(request.data.book.diagrams, 'none');
      const schema = provider === 'google' ? request.body.generationConfig.responseFormat.text.schema : request.body.response_format.json_schema.schema;
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ['needed', 'reason', 'anchor', 'diagram']);
      return response(proposal, provider);
    };
    assert.deepEqual(await ai.suggestChapterDiagram(source, { diagrams: 'none' }), { diagram: bar, reason: proposal.reason, anchor: raw });
    assert.equal(source.content, `${raw}\n\n${prose}`);
    assert.equal(calls, 1);
  });
}

test('qualitative table and flow require no fabricated numeric evidence or additional requests', async () => {
  for (const diagram of [table, flow, null]) {
    globalThis.fetch = async () => response({ ...section(diagram), sourceRefs: [] });
    const result = await ai.writeProductionSection(args({ sourceSummary: [], sourceExcerpt: '', chapter: { ...chapter, sourceRefs: [] } }));
    assert.equal(result.content, section(diagram).content);
  }
});

test('auto-off and chapter diagram limits prevent new diagrams while plain prose is accepted', async () => {
  for (const extra of [{ brief: { ...brief, diagrams: 'none' } }, { diagramCount: 12 }]) {
    globalThis.fetch = async () => response(section(table));
    await assert.rejects(ai.writeProductionSection(args(extra)), error => error.code === 'INVALID_RESPONSE');
    globalThis.fetch = async () => response(section());
    assert.deepEqual(await ai.writeProductionSection(args(extra)), section());
  }
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(section()); };
  for (const extra of [{ brief: { ...brief, diagrams: 'invalid' } }, { diagramCount: -1 }, { diagramCount: 13 }]) {
    await assert.rejects(ai.writeProductionSection(args(extra)), error => error.code === 'INVALID_INPUT');
  }
  assert.equal(calls, 0);
});

test('numeric charts reject fabricated values, units, quotes, own generated prose and previous context', async () => {
  for (const diagram of [
    { ...bar, values: [120, 8] }, { ...bar, unit: '%' },
    { ...bar, evidence: ['노트는 12개다!', '편지는 8개다.'] },
  ]) {
    globalThis.fetch = async () => response(section(diagram));
    await assert.rejects(ai.writeProductionSection(args()), error => error.code === 'INVALID_RESPONSE');
  }
  globalThis.fetch = async () => response({ ...section(bar, raw), sourceRefs: [] });
  await assert.rejects(ai.writeProductionSection(args({ sourceSummary: [], sourceExcerpt: '', previousContext: raw, chapter: { ...chapter, sourceRefs: [] } })), error => error.code === 'INVALID_RESPONSE');
});

test('numeric evidence can come from supplied source summary or user topic/instructions', async () => {
  globalThis.fetch = async () => response(section(bar));
  assert.deepEqual(await ai.writeProductionSection(args({ sourceExcerpt: '' })), section(bar));
  globalThis.fetch = async () => response({ ...section(bar), sourceRefs: [] });
  for (const value of [{ topic: raw }, { instructions: raw }]) {
    assert.equal((await ai.writeProductionSection(args({ brief: { ...brief, ...value }, sourceSummary: [], sourceExcerpt: '', chapter: { ...chapter, sourceRefs: [] } }))).content, section(bar).content);
  }
});

test('a quote cannot be manufactured by joining two separate evidence inputs', async () => {
  const invalid = { ...bar, evidence: ['노트는 12개다.\n\n편지는 8개다.', '편지는 8개다.'] };
  globalThis.fetch = async () => response(section(invalid));
  await assert.rejects(ai.writeProductionSection(args({ sourceExcerpt: '' })), error => error.code === 'INVALID_RESPONSE');
});

test('production rejects malformed blocks, extra fields, multiple diagrams and source-free evidence hidden inside a diagram', async () => {
  for (const content of [
    `${prose}\n\n\`\`\`folio-diagram\n{}\n\`\`\``,
    `${prose}\n\n\`\`\`folio-diagram\n${JSON.stringify({ ...table, url: 'https://invalid.example' })}\n\`\`\``,
    `${section(table).content}\n\n${serializeDiagram(flow)}`,
  ]) {
    globalThis.fetch = async () => response({ ...section(), content });
    await assert.rejects(ai.writeProductionSection(args()), error => error.code === 'INVALID_RESPONSE');
  }
  globalThis.fetch = async () => response({ ...section(bar), sourceRefs: [] });
  await assert.rejects(ai.writeProductionSection(args({ sourceSummary: [], sourceExcerpt: serializeDiagram(bar), chapter: { ...chapter, sourceRefs: [] } })), error => error.code === 'INVALID_RESPONSE');
});

test('revision measures visible diagram text and preserves a previously grounded diagram', async () => {
  const original = section(bar).content;
  const actualChars = Array.from(countableDiagramText(original).replace(/\s/gu, '')).length;
  globalThis.fetch = async (_url, options) => {
    const request = payload(options);
    assert.equal(request.data.operation, 'production_revision');
    assert.equal(request.data.actualChars, actualChars);
    return response(section(bar));
  };
  assert.equal((await ai.reviseProductionSection(args({ content: original, actualChars }))).content, original);
  globalThis.fetch = async () => response(section());
  await assert.rejects(ai.reviseProductionSection(args({ content: original, actualChars })), error => error.code === 'INVALID_RESPONSE');
});

test('revision cannot use its own unsupported draft or diagram evidence as numeric proof', async () => {
  const original = `${raw}\n\n${serializeDiagram(bar)}`;
  globalThis.fetch = async () => response({ ...section(bar, raw), sourceRefs: [] });
  await assert.rejects(ai.reviseProductionSection(args({ content: original, sourceSummary: [], sourceExcerpt: '', chapter: { ...chapter, sourceRefs: [] } })), error => error.code === 'INVALID_RESPONSE');
});

test('manual rewrite keeps existing diagrams when automatic insertion is off and ignores JSON in length guard', async () => {
  const readable = '문'.repeat(650);
  const original = { title: chapter.title, content: `${readable}\n\n${serializeDiagram(table)}` };
  globalThis.fetch = async () => response(edited(original.content));
  assert.equal((await ai.rewriteChapter(original, { diagrams: 'none' })).content, original.content);
  globalThis.fetch = async () => response(edited(readable));
  await assert.rejects(ai.rewriteChapter(original, {}), error => error.code === 'INVALID_RESPONSE');
  const longCaption = { ...table, caption: '설'.repeat(500) };
  const withoutDiagram = { title: chapter.title, content: '문'.repeat(500) };
  // 500 original + visible <500 new prose/diagram chars stays under 2x;
  // verbose JSON keys and syntax alone must not trigger unsafe expansion.
  const compact = { ...longCaption, caption: '' };
  globalThis.fetch = async () => response(edited(`${withoutDiagram.content}\n\n${serializeDiagram(compact)}`));
  assert.match((await ai.rewriteChapter(withoutDiagram, {})).content, /folio-diagram/);
});

test('manual new numeric diagrams require chapter prose rather than only book description or old diagram evidence', async () => {
  const source = { title: chapter.title, content: prose };
  globalThis.fetch = async () => response(edited(`${prose}\n\n${serializeDiagram(bar)}`));
  await assert.rejects(ai.rewriteChapter(source, { description: raw }), error => error.code === 'INVALID_RESPONSE');
  globalThis.fetch = async () => response(edited(`${raw}\n\n${serializeDiagram(bar)}`));
  assert.match((await ai.rewriteChapter({ ...source, content: raw }, {})).content, /folio-diagram/);
});

test('manual diagram review can decline without modifying a chapter', async () => {
  const source = { title: chapter.title, content: prose };
  globalThis.fetch = async () => response({ needed: false, reason: '짧은 설명만으로 순서가 충분히 드러난다.', anchor: '', diagram: null });
  assert.deepEqual(await ai.suggestChapterDiagram(source, {}), { reason: '짧은 설명만으로 순서가 충분히 드러난다.', anchor: '', diagram: null });
  assert.equal(source.content, prose);
});

test('manual suggestion rejects ambiguous, partial, invented or fenced-code anchors and invalid response schemas', async () => {
  const cases = [
    { content: `${prose}\n\n${prose}`, anchor: prose },
    { content: prose, anchor: '자료를 읽고 비슷한 주제끼리 분류한다.' },
    { content: prose, anchor: '새로 지어낸 문장' },
    { content: `${prose}\n\n\`\`\`text\n\n코드 안의 단락\n\n\`\`\``, anchor: '코드 안의 단락' },
    { content: `${prose}\n\n다른 문단에 ${prose}가 포함된다.`, anchor: prose },
  ];
  for (const item of cases) {
    globalThis.fetch = async () => response({ needed: true, reason: '비교가 필요하다.', anchor: item.anchor, diagram: table });
    await assert.rejects(ai.suggestChapterDiagram({ title: chapter.title, content: item.content }, {}), error => error.code === 'INVALID_RESPONSE');
  }
  for (const value of [
    { needed: false, reason: '없음', anchor: prose, diagram: null },
    { needed: false, reason: '없음', anchor: '', diagram: table },
    { needed: true, reason: '있음', anchor: prose, diagram: null },
    { needed: 'true', reason: '있음', anchor: prose, diagram: table },
    { needed: true, reason: '있음', anchor: prose, diagram: table, extra: true },
  ]) {
    globalThis.fetch = async () => response(value);
    await assert.rejects(ai.suggestChapterDiagram({ title: chapter.title, content: prose }, {}), error => error.code === 'INVALID_RESPONSE');
  }
});

test('manual suggestions reject unsupported numeric evidence and existing duplicates', async () => {
  for (const [content, diagram] of [[prose, bar], [`${prose}\n\n${serializeDiagram(table)}`, table]]) {
    globalThis.fetch = async () => response({ needed: true, reason: '비교', anchor: prose, diagram });
    await assert.rejects(ai.suggestChapterDiagram({ title: chapter.title, content }, {}), error => error.code === 'INVALID_RESPONSE');
  }
});

test('manual suggestions validate existing blocks and chapter limit before requesting and honor cancellation', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response({ needed: false, reason: '없음', anchor: '', diagram: null }); };
  for (const content of [
    '문'.repeat(12001),
    `${prose}\n\n\`\`\`folio-diagram\n{}\n\`\`\``,
    `${prose}\n\n${Array.from({ length: 12 }, (_, index) => serializeDiagram({ ...table, title: `비교 ${index}` })).join('\n\n')}`,
  ]) {
    await assert.rejects(ai.suggestChapterDiagram({ title: chapter.title, content }, {}), error => error.code === 'INVALID_INPUT');
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(ai.suggestChapterDiagram({ title: chapter.title, content: prose }, {}, { signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(calls, 0);
});

test('diagram equality is independent of JSON key order for preservation and duplicate prevention', async () => {
  const reordered = Object.fromEntries(Object.entries(table).reverse());
  const block = value => `\`\`\`folio-diagram\n${JSON.stringify(value)}\n\`\`\``;
  for (const [original, output] of [[table, reordered], [reordered, table]]) {
    const source = { title: chapter.title, content: `${prose}\n\n${block(original)}` };
    globalThis.fetch = async () => response(edited(`${prose}\n\n${block(output)}`));
    assert.equal((await ai.rewriteChapter(source, { diagrams: 'none' })).content, `${prose}\n\n${block(output)}`);
    globalThis.fetch = async () => response({ needed: true, reason: '같은 도표', anchor: prose, diagram: output });
    await assert.rejects(ai.suggestChapterDiagram(source, {}), error => error.code === 'INVALID_RESPONSE');
  }
});

test('diagram metadata cannot inflate a rewrite request beyond the supported output token budget', async () => {
  // Repeated evidence is invisible metadata, so readable length stays below
  // 12,000 while the exact retained JSON is considerably larger.
  const evidencePrefix = '근거 설명 '.repeat(70);
  const large = { ...bar, labels: ['노트', '편지', '장부', '메모'], values: [12, 8, 3, 5], evidence: [`${evidencePrefix}노트는 12개다.`, `${evidencePrefix}편지는 8개다.`, `${evidencePrefix}장부는 3개다.`, `${evidencePrefix}메모는 5개다.`] };
  const content = `${prose}\n\n${Array.from({ length: 12 }, (_, index) => serializeDiagram({ ...large, title: `기록 수 ${index}` })).join('\n\n')}`;
  assert.ok(content.length > 17000);
  assert.ok(countableDiagramText(content).length < 12000);
  globalThis.fetch = async (_url, options) => {
    assert.equal(payload(options).body.max_completion_tokens, 30000);
    return response(edited(content));
  };
  assert.equal((await ai.rewriteChapter({ title: chapter.title, content }, {})).content, content);
});
