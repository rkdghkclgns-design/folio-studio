import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionProject, normalizeProductionBrief, getProductionProgress, runProduction, validateProductionData } from './dist/production.js';

const copy = value => JSON.parse(JSON.stringify(value));
const brief = { topic: '도시 정원의 일 년', instructions: '각 장을 독립적으로 읽을 수 있는 짧은 실용 글로 써 주세요.', chapterCount: 300, targetValue: 150000, illustrations: 'none' };
const chapter = (index, sources = []) => ({ id: `chapter-${index + 1}`, title: `${index + 1}일의 정원`, purpose: `${index + 1}번째 주제를 다룬다.`, outline: ['관찰과 실천'], sourceRefs: sources.map(source => source.id) });
function setup(value = brief) {
  const project = createProductionProject(value);
  const calls = { source: [], plan: [], batches: [], write: [] };
  const metadata = { title: '정원에서 보낸 날들', subtitle: '매일 한 가지 실천', description: '작은 정원을 돌보는 안내서' };
  const api = {
    summarizeSource: async request => { calls.source.push(request); return { id: request.chunk.id, summary: '원시 자료의 관찰 기록을 정리했다.', facts: [], quotes: [], unknowns: [] }; },
    planBook: async request => { calls.plan.push(request); return { ...metadata, chapters: Array.from({ length: request.brief.chapterCount }, (_, index) => chapter(index, request.sourceSummary)) }; },
    planBatch: async request => { calls.batches.push(request); return { ...metadata, chapters: Array.from({ length: request.batchSize }, (_, index) => chapter(request.startIndex + index, request.sourceSummary)) }; },
    writeSection: async request => { calls.write.push(request); return { content: '가'.repeat(request.targetChars), notes: [], sourceRefs: [], imagePrompt: '' }; },
  };
  return { project, api, calls };
}

test('manual chapter settings accept 300 with sufficient length while automatic allocation stays compatible', () => {
  assert.equal(normalizeProductionBrief(brief).chapterCount, 300);
  assert.equal(createProductionProject({ ...brief, chapterCount: 0, targetValue: 300000 }).production.chapterCount, 40);
  assert.throws(() => normalizeProductionBrief({ ...brief, chapterCount: 301 }), /300/);
  assert.throws(() => normalizeProductionBrief({ ...brief, chapterCount: 1 }), /2~300/);
  assert.throws(() => normalizeProductionBrief({ ...brief, targetValue: 149999 }), /최소 500자/);
  assert.equal(createProductionProject({ ...brief, targetUnit: 'pages', targetValue: 300 }).production.targetChars, 240000);
});

test('300 chapters are planned in 15 bounded requests and written to exactly the allocated length', async () => {
  const sourceMarkdown = '# 원문 메모\r\n창문 방향에 따라 햇빛이 드는 시간이 다르다.\r\n';
  const { project, api, calls } = setup({ ...brief, sourceMarkdown });
  const before = getProductionProgress(project);
  assert.equal(before.totalPlanningBatches, 15);
  assert.equal(before.minRequests, 316);
  assert.equal(before.maxRequests, 616);
  const savedBatches = new Set();
  await runProduction(project, { api, onSave(value) {
    if (value.production.planning) savedBatches.add(value.production.planning.chapters.length);
  } });
  assert.equal(calls.plan.length, 0);
  assert.equal(calls.source.length, 1);
  assert.equal(calls.source[0].chunk.text, sourceMarkdown);
  assert.equal(calls.batches.length, 15);
  assert.deepEqual(calls.batches.map(request => request.startIndex), Array.from({ length: 15 }, (_, index) => index * 20));
  assert(calls.batches.every(request => request.batchSize === 20 && request.brief.instructions === brief.instructions));
  assert(calls.batches.every(request => request.sourceSummary.length === 1 && request.sourceSummary[0].id === 'source-1'));
  assert.deepEqual([...savedBatches], Array.from({ length: 15 }, (_, index) => (index + 1) * 20));
  assert.equal(calls.batches[0].previousPlan, undefined);
  assert.equal(calls.batches[14].previousPlan.chapters.length, 280);
  assert.equal(calls.write.length, 300);
  assert(calls.write.every(request => request.targetChars === 500 && request.chapter.id === `chapter-${request.index + 1}`));
  assert(calls.write.every(request => request.sourceExcerpt === sourceMarkdown && request.sourceSummary[0].id === 'source-1'));
  assert.equal(project.chapters.length, 300);
  assert(project.chapters.every(value => value.content.length === 500));
  assert.equal(project.production.planning, null);
  assert.equal(project.production.status, 'complete');
  const progress = getProductionProgress(project);
  assert.equal(progress.actualChars, 150000);
  assert.equal(progress.percent, 100);
  assert.equal(progress.plannedChapters, 300);
  assert.equal(progress.completedPlanningBatches, 15);
  assert.equal(progress.requestsStarted, 316);
  assert.equal(validateProductionData(copy(project.production)).plan.chapters.length, 300);
  const corrupted = copy(project.production);
  corrupted.plan.chapters[299].id = 'chapter-1';
  assert.throws(() => validateProductionData(corrupted), /장 번호/);
});

test('a saved planning batch resumes after reload without repeating completed planning or applying a partial outline', async () => {
  const { project, api, calls } = setup();
  const controller = new AbortController();
  let stored;
  await assert.rejects(runProduction(project, { api, signal: controller.signal, onSave(value) {
    stored = copy(value);
    if (value.production.planning?.chapters.length === 40) controller.abort();
  } }), { name: 'AbortError' });
  assert.equal(calls.batches.length, 2);
  assert.equal(calls.write.length, 0);
  assert.equal(stored.chapters.length, 1);
  assert.equal(stored.production.plan, null);
  assert.equal(stored.production.planning.chapters.length, 40);
  const progress = getProductionProgress(stored);
  assert.equal(progress.plannedChapters, 40);
  assert.equal(progress.completedPlanningBatches, 2);
  stored.production = validateProductionData(stored.production);
  const resumed = new AbortController();
  await assert.rejects(runProduction(stored, { api, signal: resumed.signal, onSave(value) {
    if (value.production.plan?.chapters[0].sections[0].status === 'complete') resumed.abort();
  } }), { name: 'AbortError' });
  assert.equal(calls.batches.length, 15);
  assert.deepEqual(calls.batches.map(request => request.startIndex), Array.from({ length: 15 }, (_, index) => index * 20));
  assert.equal(calls.write.length, 1);
  assert.equal(stored.chapters.length, 300);
  assert.equal(stored.chapters[0].content.length, 500);
  assert.equal(getProductionProgress(stored).completedChapters, 1);
});

test('the final partial planning batch and an interrupted final checkpoint resume without new planning calls', async () => {
  const { project, api, calls } = setup({ ...brief, chapterCount: 41, targetValue: 20500 });
  const controller = new AbortController();
  await assert.rejects(runProduction(project, { api, signal: controller.signal, onSave(value) {
    if (value.production.planning?.chapters.length === 41) controller.abort();
  } }), { name: 'AbortError' });
  assert.deepEqual(calls.batches.map(request => request.batchSize), [20, 20, 1]);
  assert.equal(project.production.plan, null);
  project.production = validateProductionData(copy(project.production));
  await runProduction(project, { api });
  assert.equal(calls.batches.length, 3);
  assert.equal(calls.write.length, 41);
  assert.equal(getProductionProgress(project).percent, 100);
});

test('bad batch IDs, duplicate titles and wrong response counts cannot replace the last durable outline', async () => {
  for (const corrupt of [
    value => { value.chapters[0].id = 'chapter-1'; },
    value => { value.chapters[0].title = '  1일의 정원  '; },
    value => { value.chapters.pop(); },
  ]) {
    const { project, api, calls } = setup({ ...brief, chapterCount: 41, targetValue: 20500 });
    const planner = api.planBatch;
    api.planBatch = async request => {
      const result = await planner(request);
      if (request.startIndex === 20) corrupt(result);
      return result;
    };
    await assert.rejects(runProduction(project, { api }), { code: 'INVALID_RESPONSE' });
    assert.equal(project.production.planning.chapters.length, 20);
    assert.equal(project.production.plan, null);
    assert.equal(project.chapters.length, 1);
    assert.equal(calls.write.length, 0);
    assert.equal(validateProductionData(copy(project.production)).planning.chapters.length, 20);
  }
});

test('partial planning backups reject gaps, duplicate identities, missing source references and impossible state', async () => {
  const { project, api } = setup();
  const controller = new AbortController();
  await assert.rejects(runProduction(project, { api, signal: controller.signal, onSave(value) {
    if (value.production.planning?.chapters.length === 20) controller.abort();
  } }), { name: 'AbortError' });
  for (const mutate of [
    value => { value.planning.chapters.pop(); },
    value => { value.planning.chapters[1].id = 'chapter-1'; },
    value => { value.planning.chapters[1].title = value.planning.chapters[0].title; },
    value => { value.planning.chapters[0].title = 'Ａ B 정원'; value.planning.chapters[1].title = 'ab정원'; },
    value => { value.planning.chapters[1].sourceRefs = ['source-99']; },
    value => { value.stage = 'writing'; },
    value => { value.status = 'complete'; },
  ]) {
    const corrupted = copy(project.production);
    mutate(corrupted);
    assert.throws(() => validateProductionData(corrupted));
  }
});

test('failure to save a planning batch stops before the next paid request', async () => {
  const { project, api, calls } = setup();
  await assert.rejects(runProduction(project, { api, onSave(value) {
    if (value.production.planning?.chapters.length === 20) return false;
  } }), { code: 'SAVE_FAILED' });
  assert.equal(calls.batches.length, 1);
  assert.equal(calls.write.length, 0);
  assert.equal(project.production.planning.chapters.length, 20);
});

test('existing automatic v1 books use the original single plan path and resume saved sections', async () => {
  const { project, api, calls } = setup({ ...brief, chapterCount: 0, targetValue: 3000 });
  const controller = new AbortController();
  await assert.rejects(runProduction(project, { api, signal: controller.signal, onSave(value) {
    if (value.production.plan?.chapters[0].sections[0].status === 'complete') controller.abort();
  } }), { name: 'AbortError' });
  assert.equal(project.production.chapterCount, 2);
  assert.equal(Object.hasOwn(project.production, 'planning'), false);
  assert.equal(calls.plan.length, 1);
  assert.equal(calls.batches.length, 0);
  const restored = copy(project);
  restored.production = validateProductionData(restored.production);
  await runProduction(restored, { api });
  assert.equal(calls.plan.length, 1);
  assert.equal(calls.write.length, 2);
  assert.equal(restored.production.status, 'complete');
});
