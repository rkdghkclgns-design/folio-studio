import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionProject, normalizeProductionBrief, countProductionChars, getProductionProgress, runProduction, retryProductionSections, validateProductionData } from './dist/production.js';

const brief = { topic: '도시에서 키우는 작은 정원', targetValue: 3000, chapterCount: 2, sourceMarkdown: '# 메모\r\n햇빛은 창문 방향에 따라 다르다.\r\n', instructions: '경험을 지어내지 말고 실용적으로 써 주세요.' };
const copy = value => JSON.parse(JSON.stringify(value));
function mocks(overrides = {}) {
  const calls = { source: [], plan: [], write: [], revise: [] };
  const api = {
    summarizeSource: async request => {
      calls.source.push(request);
      return { id: request.chunk.id, summary: '제공 자료에 있는 식물 관리 기록.', facts: [], quotes: [], unknowns: [] };
    },
    planBook: async request => {
      calls.plan.push(request);
      return { title: '창가의 작은 정원', subtitle: '일상에서 시작하는 식물 돌봄', description: '제공된 자료를 바탕으로 한 안내서.', chapters: Array.from({ length: request.brief.chapterCount }, (_, i) => ({ id: `chapter-${i + 1}`, title: `${i + 1}장`, purpose: '주제 설명', outline: ['핵심 이야기'], sourceRefs: request.sourceSummary.map(source => source.id) })) };
    },
    writeSection: async request => {
      calls.write.push(request);
      return { content: '가'.repeat(request.targetChars), notes: [], imagePrompt: '', sourceRefs: request.sourceSummary.map(source => source.id) };
    },
    reviseSection: async request => {
      calls.revise.push(request);
      return { content: '나'.repeat(request.targetChars), notes: [], imagePrompt: '', sourceRefs: request.sourceSummary.map(source => source.id) };
    },
    ...overrides,
  };
  return { api, calls };
}

test('normalization preserves raw Markdown including BOM, CRLF, tabs and trailing whitespace', () => {
  const sourceMarkdown = '\ufeff# 원문\r\n\t코드  \r\n\r\n';
  const normalized = normalizeProductionBrief({ ...brief, sourceMarkdown });
  assert.equal(normalized.sourceMarkdown, sourceMarkdown);
  assert.equal(normalized.instructions, brief.instructions);
  assert.throws(() => normalizeProductionBrief({ ...brief, sourceMarkdown: '가'.repeat(120001) }), /120,000/);
  assert.throws(() => normalizeProductionBrief({ ...brief, instructions: '가'.repeat(12001) }), /12,000/);
});

test('target validation rejects impossible chapter budgets and converts pages as an estimate', () => {
  assert.throws(() => normalizeProductionBrief({ ...brief, chapterCount: 40 }), /최소 500자/);
  assert.throws(() => normalizeProductionBrief({ ...brief, targetValue: 2999 }), /3,000/);
  assert.throws(() => normalizeProductionBrief({ ...brief, targetValue: 300001 }), /300,000/);
  assert.throws(() => normalizeProductionBrief({ ...brief, chapterCount: 1 }), /2~300/);
  const p = createProductionProject({ ...brief, targetUnit: 'pages', targetValue: 10, chapterCount: 0 });
  assert.equal(p.production.targetChars, 8000);
  assert.equal(getProductionProgress(p).targetPages, 10);
  assert.equal(p.production.chapterCount, 2);
});

test('character accounting counts Unicode code points and excludes whitespace', () => {
  assert.equal(countProductionChars('가 😀\n한\t글\r\n '), 4);
  assert.equal(countProductionChars('a\u0301'), 2);
});

test('creates an independent project and deterministically allocates all characters', async () => {
  const p = createProductionProject({ ...brief, targetValue: 10003, chapterCount: 3 });
  const { api } = mocks();
  await runProduction(p, { api });
  assert.equal(p.production.plan.chapters.reduce((sum, c) => sum + c.targetChars, 0), 10003);
  const sections = p.production.plan.chapters.flatMap(c => c.sections);
  assert.equal(sections.reduce((sum, s) => sum + s.targetChars, 0), 10003);
  assert(sections.every(s => s.targetChars >= 500 && s.targetChars <= 2500));
  assert.equal(getProductionProgress(p).actualChars, 10003);
  assert.equal(getProductionProgress(p).status, 'complete');
  assert.equal(getProductionProgress(p).percent, 100);
});

test('all long-source chunks are summarized without loss or split surrogate pairs', async () => {
  const sourceMarkdown = '\ufeff' + ('a'.repeat(11997) + '😀\r\n').repeat(9) + '\n尾章  \r\n';
  const p = createProductionProject({ ...brief, sourceMarkdown });
  const { api, calls } = mocks();
  await runProduction(p, { api });
  assert.equal(calls.source.map(c => c.chunk.text).join(''), sourceMarkdown);
  assert(calls.source.every(c => c.chunk.text.length <= 12000));
  assert(calls.source.every(c => !/[\uD800-\uDBFF]$/.test(c.chunk.text)));
  assert(calls.source.every(c => !/^[\uDC00-\uDFFF]/.test(c.chunk.text)));
  assert.equal(calls.plan[0].sourceSummary.length, calls.source.length);
  for (const call of calls.write) {
    assert.equal(call.sourceSummary.length, calls.source.length);
    assert(call.sourceExcerpt.length <= 16000);
    assert.equal(call.brief.instructions, brief.instructions);
    assert.equal(call.brief.sourceMarkdown, undefined);
    assert.equal(call.plan.chapters.length, 2);
    assert.equal(call.chapter.id, call.plan.chapters[call.index].id);
  }
  assert.equal(p.production.brief.sourceMarkdown, sourceMarkdown);
  assert(p.production.sources.every(source => source.text === undefined));
  assert(p.production.plan.chapters.every(chapter => chapter.sections.every(section => section.sourceMarkdown === undefined))); // The retained raw source appears only in the brief.
});

test('no-source topic books skip source requests', async () => {
  const p = createProductionProject({ ...brief, sourceMarkdown: '' });
  const { api, calls } = mocks();
  await runProduction(p, { api });
  assert.equal(calls.source.length, 0);
  assert.equal(calls.write.length, 2);
  assert.equal(getProductionProgress(p).requestsStarted, 3);
});

test('completed production resumes with zero additional API calls', async () => {
  const p = createProductionProject(brief);
  const { api, calls } = mocks();
  await runProduction(p, { api });
  const before = copy(calls);
  await runProduction(p, { api: {} });
  assert.deepEqual(copy(calls), before);
});

test('cancel after durable chapter completion resumes without duplicating the completed section', async () => {
  const p = createProductionProject(brief);
  const controller = new AbortController();
  const { api, calls } = mocks();
  let stored;
  await assert.rejects(runProduction(p, {
    api, signal: controller.signal,
    onSave(project) {
      stored = copy(project);
      if (project.production.plan?.chapters[0].sections[0].status === 'complete') controller.abort();
    },
  }), { name: 'AbortError' });
  assert.equal(p.production.status, 'paused');
  assert.equal(calls.write.length, 1);
  const restored = copy(stored);
  restored.production = validateProductionData(restored.production);
  await runProduction(restored, { api });
  assert.equal(calls.write.length, 2);
  assert.equal(restored.chapters[0].content, '가'.repeat(1500));
  assert.equal(getProductionProgress(restored).actualChars, 3000);
});

test('a partial network failure preserves completed work for resume', async () => {
  const p = createProductionProject(brief);
  const { api, calls } = mocks();
  const writer = api.writeSection;
  api.writeSection = async req => {
    if (req.index === 1) throw new Error('연결이 끊겼습니다.');
    return writer(req);
  };
  await assert.rejects(runProduction(p, { api }), /연결이 끊겼습니다/);
  assert.equal(p.production.status, 'failed');
  assert.equal(p.chapters[0].content.length, 1500);
  api.writeSection = writer;
  await runProduction(p, { api });
  assert.equal(calls.write.length, 2);
});

test('save false or exception stops before the first paid request', async () => {
  for (const onSave of [async () => false, async () => { throw new Error('quota'); }]) {
    const p = createProductionProject(brief);
    const { api, calls } = mocks();
    await assert.rejects(runProduction(p, { api, onSave }), { code: 'SAVE_FAILED' });
    assert.equal(calls.source.length + calls.plan.length + calls.write.length + calls.revise.length, 0);
    assert.equal(p.production.status, 'failed');
  }
});

test('save failure after a generated section stops the pipeline and retains in-memory output', async () => {
  const p = createProductionProject(brief);
  const { api, calls } = mocks();
  await assert.rejects(runProduction(p, { api, onSave(project) {
    if (project.production.plan?.chapters[0].sections[0].status === 'complete') return false;
  } }), { code: 'SAVE_FAILED' });
  assert.equal(calls.write.length, 1);
  assert.equal(p.chapters[0].content.length, 1500);
  assert.equal(p.chapters[1].content, '');
});

test('one automatic correction chooses the closer text and reports unmet targets honestly', async () => {
  const p = createProductionProject(brief);
  const { api, calls } = mocks();
  api.writeSection = async req => { calls.write.push(req); return { content: '원'.repeat(500) }; };
  api.reviseSection = async req => { calls.revise.push(req); return { content: '수'.repeat(700) }; };
  await runProduction(p, { api });
  assert.equal(calls.revise.length, 2);
  assert.equal(p.production.status, 'needs_review');
  assert.equal(getProductionProgress(p).needsReviewSections, 2);
  assert.equal(getProductionProgress(p).actualChars, 1400);
  assert.equal(p.chapters[0].content, '수'.repeat(700));
  await runProduction(p, { api });
  assert.equal(calls.revise.length, 2);
  api.reviseSection = async req => { calls.revise.push(req); return { content: '완'.repeat(req.targetChars) }; };
  await retryProductionSections(p, { api });
  assert.equal(calls.revise.length, 4);
  assert.equal(p.production.status, 'complete');
  assert.equal(getProductionProgress(p).actualChars, 3000);
});

test('a worse correction never replaces the better generated manuscript', async () => {
  const p = createProductionProject(brief);
  const { api } = mocks({ writeSection: async () => ({ content: '원'.repeat(1000) }), reviseSection: async () => ({ content: '수'.repeat(100) }) });
  await runProduction(p, { api });
  assert.equal(p.chapters[0].content, '원'.repeat(1000));
  assert.equal(p.production.status, 'needs_review');
});

test('an interrupted correction is never retried automatically', async () => {
  const p = createProductionProject(brief);
  const controller = new AbortController();
  let revisions = 0;
  const { api } = mocks({ writeSection: async () => ({ content: '초'.repeat(800) }), reviseSection: async () => { revisions++; controller.abort(); return { content: '수'.repeat(1500) }; } });
  await assert.rejects(runProduction(p, { api, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(p.production.plan.chapters[0].sections[0].revisionAttempts, 1);
  api.reviseSection = async () => { revisions++; return { content: '수'.repeat(1500) }; };
  await runProduction(p, { api });
  assert.equal(revisions, 2); // one attempt in each chapter; first was not repeated.
  assert.equal(p.production.plan.chapters[0].sections[0].status, 'needs_review');
  assert.equal(p.production.plan.chapters[0].sections[0].content, '초'.repeat(800));
});

test('manual manuscript or instruction edits prevent all further generation', async () => {
  const p = createProductionProject(brief);
  const { api } = mocks({ writeSection: async () => { throw new Error('pause'); } });
  await assert.rejects(runProduction(p, { api }), /pause/);
  const edited = copy(p);
  edited.chapters[0].content = '사용자가 직접 쓴 원고';
  await assert.rejects(runProduction(edited, { api: {} }), { code: 'MANUAL_CHANGES' });
  assert.equal(edited.chapters[0].content, '사용자가 직접 쓴 원고');
  assert.equal(getProductionProgress(edited).canResume, false);
  p.production.brief.instructions += ' 바뀐 지시';
  await assert.rejects(runProduction(p, { api: {} }), { code: 'BRIEF_CHANGED' });
});

test('manual edit during an in-flight API call is never overwritten', async () => {
  const p = createProductionProject(brief);
  const { api } = mocks({ writeSection: async () => { p.chapters[0].content = '직접 쓴 문장'; return { content: '가'.repeat(1500) }; } });
  await assert.rejects(runProduction(p, { api }), { code: 'MANUAL_CHANGES' });
  assert.equal(p.chapters[0].content, '직접 쓴 문장');
});

test('JSON roundtrip preserves source and durable sections independently of chapter IDs', async () => {
  const p = createProductionProject(brief);
  const { api } = mocks();
  await runProduction(p, { api });
  p.production.artwork = { status: 'complete', completed: ['cover', 'chapter:0'], error: '' };
  const restored = copy(p);
  restored.chapters.forEach((c, i) => { c.id = `imported-${i}`; });
  restored.production = validateProductionData(restored.production);
  assert.equal(restored.production.brief.sourceMarkdown, brief.sourceMarkdown);
  assert.equal(restored.production.plan.chapters[0].id, 'chapter-1');
  assert.notEqual(restored.production.brief, p.production.brief);
  await runProduction(restored, { api: {} });
  assert.equal(restored.production.status, 'complete');
});

test('backup validation rejects corrupt ranges, references, budgets and false complete status', async () => {
  const p = createProductionProject(brief);
  const { api } = mocks();
  await runProduction(p, { api });
  for (const mutate of [
    v => { v.sources[0].end++; },
    v => { v.sources[0].digest.quotes = ['원문에 없는 인용']; },
    v => { v.plan.chapters[0].sections[0].targetChars++; },
    v => { v.plan.chapters[0].sections[0].sourceRefs = ['source-99']; },
    v => { v.plan.chapters[0].sections[0].content = '짧음'; },
  ]) {
    const corrupt = copy(p.production); mutate(corrupt);
    assert.throws(() => validateProductionData(corrupt));
  }
});

test('simultaneous production runs are rejected without duplicate requests', async () => {
  const p = createProductionProject(brief);
  let resolveSource;
  const { api } = mocks({ summarizeSource: () => new Promise(resolve => { resolveSource = resolve; }) });
  const first = runProduction(p, { api });
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(runProduction(p, { api }), { code: 'ALREADY_RUNNING' });
  resolveSource({ id: 'source-1', summary: '자료 정리' });
  await first;
});


test('whitespace-only source chunks remain in the source map without a paid request', async () => {
  const sourceMarkdown = ' '.repeat(12000) + '# 자료\r\n씨앗의 발아 기록\r\n' + '\t'.repeat(12000);
  const p = createProductionProject({ ...brief, sourceMarkdown });
  const { api, calls } = mocks();
  await runProduction(p, { api });
  assert.equal(calls.source.length, 1);
  assert.equal(calls.source[0].chunk.id, 'source-2');
  assert.equal(calls.source[0].index, 1);
  assert.equal(calls.source[0].total, 3);
  assert.equal(p.production.sources.length, 3);
  assert(p.production.sources.every(source => source.digest));
  assert.equal(calls.plan[0].sourceSummary.length, 3);
  assert.equal(getProductionProgress(p).minRequests, 4);
  assert.equal(getProductionProgress(p).requestsStarted, 4);
  assert.equal(validateProductionData(p.production).brief.sourceMarkdown, sourceMarkdown);
});

test('the largest allowed book keeps every section within the request budget', async () => {
  const p = createProductionProject({ ...brief, targetValue: 300000, chapterCount: 40, sourceMarkdown: '' });
  let plan;
  const { api } = mocks({ writeSection: async () => { throw new Error('stop before large output'); } });
  await assert.rejects(runProduction(p, { api, onSave(project) { plan = project.production.plan; } }), /stop before large output/);
  const sections = plan.chapters.flatMap(chapter => chapter.sections);
  assert.equal(plan.chapters.length, 40);
  assert.equal(sections.length, 120);
  assert(sections.every(section => section.targetChars === 2500));
  assert.equal(sections.reduce((sum, section) => sum + section.targetChars, 0), 300000);
});
