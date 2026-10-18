import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionProject, normalizeProductionBrief, countProductionChars, getProductionProgress, runProduction, retryProductionSections, validateProductionData } from './dist/production.js';
import { countableDiagramText, parseDiagramBlocks } from './dist/diagrams.js';

const copy = value => JSON.parse(JSON.stringify(value));
const rawSource = '봄 매출 12만원\n여름 매출 20만원';
const brief = { topic: '계절별 매출 변화', sourceMarkdown: rawSource, targetValue: 3000, chapterCount: 2 };
const chart = { type: 'bar', title: '계절별 매출', caption: '제공한 기록의 두 계절을 비교한다.', columns: [], rows: [], labels: ['봄', '여름'], values: [12, 20], unit: '만원', evidence: ['봄 매출 12만원', '여름 매출 20만원'] };
const block = diagram => `\`\`\`folio-diagram\n${JSON.stringify(diagram)}\n\`\`\``;
const diagramText = block(chart);
function contentWithDiagram(target, diagram = chart) {
  const encoded = block(diagram);
  return '가'.repeat(target - countProductionChars(encoded)) + '\n\n' + encoded;
}
function mocks(overrides = {}) {
  const calls = { source: [], plan: [], write: [], revise: [] };
  const api = {
    summarizeSource: async request => {
      calls.source.push(request);
      return { id: request.chunk.id, summary: '계절별 기록', facts: [], quotes: [], unknowns: [] };
    },
    planBook: async request => {
      calls.plan.push(request);
      return { title: '계절별 매출', subtitle: '', description: '', chapters: Array.from({ length: request.brief.chapterCount }, (_, i) => ({ id: `chapter-${i + 1}`, title: `${i + 1}장`, purpose: '변화를 설명한다.', outline: ['기록 비교'], sourceRefs: request.sourceSummary.map(source => source.id) })) };
    },
    writeSection: async request => {
      calls.write.push(request);
      return { content: contentWithDiagram(request.targetChars), sourceRefs: request.sourceSummary.map(source => source.id) };
    },
    reviseSection: async request => {
      calls.revise.push(request);
      return { content: contentWithDiagram(request.targetChars), sourceRefs: request.sourceSummary.map(source => source.id) };
    },
    ...overrides,
  };
  return { api, calls };
}

test('diagram mode validates optional auto/none while retaining the legacy brief fingerprint', () => {
  const legacy = { topic: '도표 없는 기존 요청', targetValue: 3000, chapterCount: 2, sourceMarkdown: '', instructions: '자연스럽게 써 주세요.' };
  const project = createProductionProject(legacy);
  assert.equal(Object.hasOwn(project.production.brief, 'diagrams'), false);
  assert.equal(project.production.briefFingerprint, 'fae612adddc64e9d');
  assert.equal(normalizeProductionBrief({ ...brief, diagrams: 'auto' }).diagrams, 'auto');
  assert.equal(normalizeProductionBrief({ ...brief, diagrams: 'none' }).diagrams, 'none');
  for (const diagrams of ['all', false, null, {}]) assert.throws(() => normalizeProductionBrief({ ...brief, diagrams }), /도표/);
  assert.equal(validateProductionData(copy(project.production)).briefFingerprint, project.production.briefFingerprint);
});

test('diagram character budgets count visible text and values rather than JSON or duplicate evidence', () => {
  const human = countableDiagramText(diagramText);
  assert.equal(countProductionChars(diagramText), Array.from(human.replace(/\s/gu, '')).length);
  assert(!human.includes('"evidence"'));
  assert(countProductionChars(diagramText) < Array.from(diagramText.replace(/\s/gu, '')).length);
  assert.equal(countProductionChars(contentWithDiagram(1500)), 1500);
  const legacy = '가 😀\n\t한\n```json\n{"value":12}\n```';
  assert.equal(countProductionChars(legacy), Array.from(legacy.replace(/\s/gu, '')).length);
});

test('source-grounded charts complete the exact writing budget without additional API requests', async () => {
  const project = createProductionProject({ ...brief, diagrams: 'auto' });
  const { api, calls } = mocks();
  await runProduction(project, { api });
  assert.equal(project.production.status, 'complete');
  assert.equal(getProductionProgress(project).actualChars, 3000);
  assert.equal(calls.source.length, 1);
  assert.equal(calls.plan.length, 1);
  assert.equal(calls.write.length, 2);
  assert.equal(calls.revise.length, 0);
  assert(calls.write.every(request => request.brief.diagrams === 'auto' && request.diagramCount === 0));
  assert(project.chapters.every(chapter => parseDiagramBlocks(chapter.content, { strict: true, evidenceText: rawSource }).length === 1));
});

test('a diagram with an invented numeric value is rejected before any manuscript mutation', async () => {
  const project = createProductionProject(brief);
  const invented = { ...chart, values: [99, 20], evidence: ['봄 매출 99만원', '여름 매출 20만원'] };
  const { api } = mocks({ writeSection: async () => ({ content: contentWithDiagram(1500, invented) }) });
  await assert.rejects(runProduction(project, { api }), { code: 'INVALID_RESPONSE' });
  assert.equal(project.production.plan.chapters[0].sections[0].status, 'pending');
  assert.equal(project.production.plan.chapters[0].sections[0].content, '');
  assert.equal(project.chapters[0].content, '');
  assert.equal(project.production.status, 'failed');
});

test('a newly generated paragraph cannot supply evidence for its own chart', async () => {
  const project = createProductionProject({ ...brief, sourceMarkdown: '', topic: '계절 변화' });
  const { api } = mocks({ writeSection: async () => ({ content: rawSource + '\n\n' + contentWithDiagram(1500) }) });
  await assert.rejects(runProduction(project, { api }), { code: 'INVALID_RESPONSE' });
  assert.equal(project.chapters[0].content, '');
});

test('earlier generated plain text cannot become independent numeric evidence for a later chart', async () => {
  const project = createProductionProject({ ...brief, sourceMarkdown: '', topic: '계절 변화' });
  const { api } = mocks({ writeSection: async request => ({ content: request.index === 0 ? rawSource + '가'.repeat(request.targetChars - countProductionChars(rawSource)) : contentWithDiagram(request.targetChars) }) });
  await assert.rejects(runProduction(project, { api }), { code: 'INVALID_RESPONSE' });
  assert.equal(project.production.plan.chapters[0].sections[0].status, 'complete');
  assert.equal(project.chapters[1].content, '');
  assert.equal(validateProductionData(copy(project.production)).plan.chapters[1].sections[0].status, 'pending');
});

test('numeric evidence cannot bridge separate input fields or cite an embedded source diagram', async () => {
  const split = { ...chart, evidence: ['봄\n\n매출 12만원', '여름 매출 20만원'] };
  for (const [input, diagram] of [
    [{ ...brief, sourceMarkdown: '여름 매출 20만원', topic: '봄', instructions: '매출 12만원' }, split],
    [{ ...brief, sourceMarkdown: diagramText, topic: '계절 변화' }, chart],
  ]) {
    const project = createProductionProject(input);
    const { api } = mocks({ writeSection: async () => ({ content: contentWithDiagram(1500, diagram) }) });
    await assert.rejects(runProduction(project, { api }), { code: 'INVALID_RESPONSE' });
    assert.equal(project.chapters[0].content, '');
  }
});

test('future chapters cannot retroactively ground a previous chart in a backup', async () => {
  const project = createProductionProject({ ...brief, sourceMarkdown: '', topic: '계절 변화' });
  const { api } = mocks({ writeSection: async request => ({ content: request.index === 1 ? rawSource + '가'.repeat(request.targetChars - countProductionChars(rawSource)) : '가'.repeat(request.targetChars) }) });
  await runProduction(project, { api });
  const corrupt = copy(project.production);
  corrupt.plan.chapters[0].sections[0].content = contentWithDiagram(1500);
  assert.throws(() => validateProductionData(corrupt), { code: 'INVALID_RESPONSE' });
});

test('diagram mode none accepts plain writing but rejects any diagram before storage', async () => {
  const project = createProductionProject({ ...brief, diagrams: 'none' });
  const { api } = mocks();
  await assert.rejects(runProduction(project, { api }), /도표를 사용하지/);
  assert.equal(project.chapters[0].content, '');
  api.writeSection = async request => {
    assert.equal(request.brief.diagrams, 'none');
    return { content: '가'.repeat(request.targetChars) };
  };
  await runProduction(project, { api });
  assert.equal(project.production.status, 'complete');
});

test('malformed or multiple diagrams in one section are rejected before mutation', async () => {
  for (const content of ['가'.repeat(1500) + '\n```folio-diagram\n{broken}\n```', '가'.repeat(1500) + '\n' + diagramText + '\n' + diagramText]) {
    const project = createProductionProject(brief);
    const { api } = mocks({ writeSection: async () => ({ content }) });
    await assert.rejects(runProduction(project, { api }), { code: 'INVALID_RESPONSE' });
    assert.equal(project.chapters[0].content, '');
  }
});

test('pause, independent backup validation and resume preserve a completed diagram without repeating it', async () => {
  const project = createProductionProject(brief);
  const controller = new AbortController();
  const { api, calls } = mocks();
  let backup;
  await assert.rejects(runProduction(project, { api, signal: controller.signal, onSave(current) {
    backup = copy(current);
    if (current.production.plan?.chapters[0].sections[0].status === 'complete') controller.abort();
  } }), { name: 'AbortError' });
  assert.equal(calls.write.length, 1);
  const before = backup.chapters[0].content;
  backup.production = validateProductionData(backup.production);
  await runProduction(backup, { api });
  assert.equal(calls.write.length, 2);
  assert.equal(backup.chapters[0].content, before);
  assert.equal(backup.production.status, 'complete');
});

test('backup validation rejects altered chart values and self-citing chart evidence', async () => {
  const project = createProductionProject(brief);
  const { api } = mocks();
  await runProduction(project, { api });
  for (const edited of [
    { ...chart, values: [21, 20] },
    { ...chart, values: [21, 20], evidence: ['봄 매출 21만원', '여름 매출 20만원'] },
    { ...chart, unit: '억원' },
  ]) {
    const corrupt = copy(project.production);
    corrupt.plan.chapters[0].sections[0].content = contentWithDiagram(1500, edited);
    assert.throws(() => validateProductionData(corrupt), { code: 'INVALID_RESPONSE' });
  }
});

test('revision cannot cite the same section original prose as independent numeric evidence', async () => {
  const project = createProductionProject({ ...brief, sourceMarkdown: '', topic: '계절 변화' });
  const original = rawSource + '가'.repeat(500);
  const { api } = mocks({ writeSection: async () => ({ content: original }), reviseSection: async () => ({ content: contentWithDiagram(1500) }) });
  await assert.rejects(runProduction(project, { api }), { code: 'INVALID_RESPONSE' });
  assert.equal(project.production.plan.chapters[0].sections[0].content, original);
  assert.equal(project.chapters[0].content, original);
});

test('automatic correction and explicit retry preserve diagrams with readable-text budgeting', async () => {
  const project = createProductionProject(brief);
  const { api } = mocks({ writeSection: async () => ({ content: contentWithDiagram(500) }), reviseSection: async () => ({ content: contentWithDiagram(700) }) });
  await runProduction(project, { api });
  assert.equal(project.production.status, 'needs_review');
  assert.equal(getProductionProgress(project).actualChars, 1400);
  api.reviseSection = async request => {
    assert.equal(countProductionChars(request.content), request.actualChars);
    assert.equal(request.diagramCount, 0);
    return { content: contentWithDiagram(request.targetChars) };
  };
  await retryProductionSections(project, { api });
  assert.equal(project.production.status, 'complete');
  assert.equal(getProductionProgress(project).actualChars, 3000);
  assert.equal(validateProductionData(copy(project.production)).status, 'complete');
});

test('a closer revision cannot silently delete or alter a previously accepted diagram', async () => {
  const original = contentWithDiagram(500);
  for (const replacement of [
    '가'.repeat(1500),
    contentWithDiagram(1500, { ...chart, title: '다른 제목' }),
    contentWithDiagram(1500, { ...chart, caption: '바뀐 설명' }),
  ]) {
    const project = createProductionProject(brief);
    const { api } = mocks({ writeSection: async () => ({ content: original }), reviseSection: async () => ({ content: replacement }) });
    await assert.rejects(runProduction(project, { api }), /기존 도표가 삭제되거나 변경/);
    assert.equal(project.chapters[0].content, original);
    assert.equal(project.production.plan.chapters[0].sections[0].content, original);
  }
});

test('revision accepts identical diagram data even when JSON object keys are reordered', async () => {
  const reordered = Object.fromEntries(Object.entries(chart).reverse());
  const project = createProductionProject(brief);
  const { api } = mocks({ writeSection: async () => ({ content: contentWithDiagram(500) }), reviseSection: async () => ({ content: contentWithDiagram(1500, reordered) }) });
  await runProduction(project, { api });
  assert.equal(project.production.status, 'complete');
  assert.deepEqual(parseDiagramBlocks(project.chapters[0].content)[0].diagram, chart);
});

test('chapter limit rejects the thirteenth diagram and exposes the count for a plain-text retry', async () => {
  const project = createProductionProject({ ...brief, targetValue: 65000 });
  const { api, calls } = mocks();
  await assert.rejects(runProduction(project, { api }), /최대 12개/);
  assert.deepEqual(calls.write.map(request => request.diagramCount), Array.from({ length: 13 }, (_, i) => i));
  assert.equal(project.production.plan.chapters[0].sections[12].status, 'pending');
  assert.equal(parseDiagramBlocks(project.chapters[0].content, { strict: true, evidenceText: rawSource }).length, 12);
  project.production = validateProductionData(copy(project.production));
  api.writeSection = async request => ({ content: request.diagramCount >= 12 ? '가'.repeat(request.targetChars) : contentWithDiagram(request.targetChars) });
  await runProduction(project, { api });
  assert.equal(project.production.status, 'complete');
  assert.equal(getProductionProgress(project).actualChars, 65000);
  assert(project.chapters.every(chapter => parseDiagramBlocks(chapter.content, { strict: true, evidenceText: rawSource }).length === 12));
});
