import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionProject, getProductionProgress, runProduction, retryProductionSections, validateProductionData } from './dist/production.js';

const copy = value => JSON.parse(JSON.stringify(value));
const brief = { topic: '일상의 관찰 기록', targetValue: 3000, chapterCount: 2, illustrations: 'none' };
function setup(overrides = {}) {
  const project = createProductionProject({ ...brief, ...overrides });
  const calls = { write: [], revise: [] };
  const api = {
    planBook: async request => ({ title: '관찰하는 생활', chapters: Array.from({ length: request.brief.chapterCount }, (_, index) => ({ id: `chapter-${index + 1}`, title: `${index + 1}장`, purpose: '관찰 방법을 설명한다.', outline: ['주제 설명'] })) }),
    writeSection: async request => { calls.write.push(request.index); return { content: '가'.repeat(request.targetChars) }; },
    reviseSection: async request => { calls.revise.push(request.index); return { content: '나'.repeat(request.targetChars) }; },
  };
  return { project, api, calls };
}

test('correcting a flagged section cannot mark an interrupted book complete or invalidate its backup', async () => {
  const { project, api, calls } = setup();
  api.writeSection = async request => {
    calls.write.push(request.index);
    if (request.index === 1) throw new Error('연결 중단');
    return { content: '가'.repeat(500) };
  };
  api.reviseSection = async request => { calls.revise.push(request.index); return { content: '나'.repeat(700) }; };
  await assert.rejects(runProduction(project, { api }), /연결 중단/);
  assert.deepEqual(project.production.plan.chapters.map(chapter => chapter.sections[0].status), ['needs_review', 'pending']);
  assert.equal(project.production.status, 'failed');
  const before = project.chapters[0].content;
  api.reviseSection = async request => { calls.revise.push(request.index); return { content: '다'.repeat(request.targetChars) }; };
  const saved = [];
  await retryProductionSections(project, { api, onSave(value) { saved.push(copy(value)); } });
  assert.equal(project.production.status, 'paused');
  assert.equal(project.production.stage, 'writing');
  assert.equal(getProductionProgress(project).canResume, true);
  assert.notEqual(project.chapters[0].content, before);
  assert.equal(project.chapters[1].content, '');
  assert.equal(calls.write.length, 2, 'an explicit length correction must not initiate unrelated writing');
  for (const checkpoint of saved) assert.doesNotThrow(() => validateProductionData(checkpoint.production));
  const restored = copy(project);
  restored.production = validateProductionData(restored.production);
  api.writeSection = async request => { calls.write.push(request.index); return { content: '라'.repeat(request.targetChars) }; };
  await runProduction(restored, { api });
  assert.deepEqual(calls.write, [0, 1, 1]);
  assert.deepEqual(calls.revise, [0, 0]);
  assert.equal(restored.production.status, 'complete');
  assert.equal(getProductionProgress(restored).actualChars, 3000);
  assert.doesNotThrow(() => validateProductionData(restored.production));
});

test('canceling after a short draft is saved does not spend its unstarted correction attempt', async () => {
  const { project, api, calls } = setup();
  const controller = new AbortController();
  api.writeSection = async request => { calls.write.push(request.index); return { content: '가'.repeat(500) }; };
  await assert.rejects(runProduction(project, { api, signal: controller.signal, onSave(value) {
    if (value.production.plan?.chapters[0].sections[0].status === 'drafted') controller.abort();
  } }), { name: 'AbortError' });
  const first = project.production.plan.chapters[0].sections[0];
  assert.equal(first.status, 'drafted');
  assert.equal(first.revisionAttempts, 0);
  assert.deepEqual(calls.revise, []);
  const restored = copy(project);
  restored.production = validateProductionData(restored.production);
  await runProduction(restored, { api });
  assert.deepEqual(calls.write, [0, 1]);
  assert.deepEqual(calls.revise, [0, 1]);
  assert.equal(restored.production.status, 'complete');
  assert.doesNotThrow(() => validateProductionData(restored.production));
});

test('a stop during the saved correction marker rolls back only the request that never started', async () => {
  const { project, api, calls } = setup();
  const controller = new AbortController();
  let checkpoint;
  api.writeSection = async request => { calls.write.push(request.index); return { content: '가'.repeat(500) }; };
  await assert.rejects(runProduction(project, { api, signal: controller.signal, onSave(value) {
    checkpoint = copy(value);
    if (value.production.plan?.chapters[0].sections[0].revisionAttempts === 1) controller.abort();
  } }), { name: 'AbortError' });
  assert.deepEqual(calls.revise, []);
  assert.equal(checkpoint.production.plan.chapters[0].sections[0].revisionAttempts, 0);
  checkpoint.production = validateProductionData(checkpoint.production);
  await runProduction(checkpoint, { api });
  assert.deepEqual(calls.write, [0, 1]);
  assert.deepEqual(calls.revise, [0, 1]);
  assert.equal(checkpoint.production.status, 'complete');
});

test('renderable diagrams with CR line endings or stripped fence controls cannot bypass production checks', async () => {
  const flow = { type: 'flow', title: '진행 순서', caption: '', columns: [], rows: [], labels: ['기록', '검토'], values: [], unit: '', evidence: [] };
  const invented = { type: 'bar', title: '근거 없는 수치', caption: '', columns: [], rows: [], labels: ['봄', '여름'], values: [12, 20], unit: '만원', evidence: ['봄 매출 12만원', '여름 매출 20만원'] };
  for (const [newline, info] of [['\r', 'folio-diagram'], ['\n', 'folio-\u0000diagram'], ['\r\n', 'folio-diagram\u0000']]) {
    for (const [diagrams, diagram] of [['none', flow], ['auto', invented]]) {
      const { project, api, calls } = setup({ diagrams });
      api.writeSection = async () => ({ content: '가'.repeat(1500) + newline + '```' + info + newline + JSON.stringify(diagram) + newline + '```' });
      await assert.rejects(runProduction(project, { api }), { code: 'INVALID_RESPONSE' }, `${diagrams} ${JSON.stringify(newline)} ${JSON.stringify(info)}`);
      assert.equal(project.chapters[0].content, '');
      assert.equal(project.production.plan.chapters[0].sections[0].status, 'pending');
      assert.deepEqual(calls.revise, []);
      assert.doesNotThrow(() => validateProductionData(project.production));
    }
  }
});
