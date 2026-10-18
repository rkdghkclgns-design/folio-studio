import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductionProject, normalizeProductionBrief, getProductionProgress, runProduction, validateProductionData } from './dist/production.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const copy = value => JSON.parse(JSON.stringify(value));
const image = (index = 1) => ({ path: `자료/깊은 폴더/${index}.png`, src: PNG, mimeType: 'image/png', bytes: Buffer.from(PNG.split(',')[1], 'base64').length });
const brief = { topic: '', sourceMarkdown: '', sourceImages: [image()], targetValue: 3000, chapterCount: 2 };
const digest = id => ({ id, summary: '창가에 놓인 화분과 햇빛의 방향을 관찰한 이미지.', facts: ['화분이 창문 가까이에 있다.'], quotes: [], unknowns: ['정확한 촬영 시각은 확인할 수 없다.'] });
function mocks(overrides = {}) {
  const calls = [];
  const record = (kind, request) => calls.push({ kind, request });
  const chapter = (index, sources) => ({ id: `chapter-${index + 1}`, title: `${index + 1}장 관찰`, purpose: '자료를 바탕으로 관찰을 정리한다.', outline: ['확인된 내용과 한계'], sourceRefs: sources.map(source => source.id) });
  const api = {
    summarizeSource: async request => { record('text', request); return digest(request.chunk.id); },
    summarizeImage: async request => { record('image', request); return digest(request.image.id); },
    planBook: async request => { record('plan', request); return { title: '이미지에서 시작한 책', chapters: Array.from({ length: request.brief.chapterCount }, (_, index) => chapter(index, request.sourceSummary)) }; },
    planBatch: async request => { record('batch', request); return { title: '이미지에서 시작한 긴 책', chapters: Array.from({ length: request.batchSize }, (_, index) => chapter(request.startIndex + index, request.sourceSummary)) }; },
    writeSection: async request => { record('write', request); return { content: '관'.repeat(request.targetChars), notes: [], imagePrompt: '', sourceRefs: request.sourceSummary.map(source => source.id) }; },
    reviseSection: async request => { record('revise', request); return { content: '찰'.repeat(request.targetChars), notes: [], imagePrompt: '', sourceRefs: request.sourceSummary.map(source => source.id) }; },
    ...overrides,
  };
  return { api, calls };
}
function imageWithMetadata(contents) {
  const png = Buffer.from(PNG.split(',')[1], 'base64');
  const body = Buffer.concat([Buffer.from('tEXtnote\0'), Buffer.from(contents)]);
  let crc = 0xffffffff;
  for (const byte of body) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const chunk = Buffer.alloc(body.length + 8);
  chunk.writeUInt32BE(body.length - 4, 0);
  body.copy(chunk, 4);
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4);
  const bytes = Buffer.concat([png.subarray(0, 33), chunk, png.subarray(33)]);
  return { ...image(), src: 'data:image/png;base64,' + bytes.toString('base64'), bytes: bytes.length };
}

test('image-only briefs are accepted while absent image fields preserve legacy brief shape', () => {
  const input = copy(brief);
  const normalized = normalizeProductionBrief(input);
  assert.equal(normalized.topic, '');
  assert.deepEqual(normalized.sourceImages, brief.sourceImages);
  input.sourceImages[0].path = 'modified.png';
  assert.equal(normalized.sourceImages[0].path, image().path);
  const legacy = normalizeProductionBrief({ topic: '기존 주제', targetValue: 3000 });
  assert.equal(Object.hasOwn(legacy, 'sourceImages'), false);
  const empty = normalizeProductionBrief({ topic: '기존 주제', sourceImages: [], targetValue: 3000 });
  assert.deepEqual(empty.sourceImages, []);
  assert.throws(() => normalizeProductionBrief({ ...brief, sourceImages: [] }), /주제/);
});

test('mixed sources retain legacy text records and deterministic typed image records', () => {
  const project = createProductionProject({ ...brief, sourceMarkdown: '# 관찰 기록', sourceImages: [image(1), image(2)] });
  assert.deepEqual(project.production.sources, [
    { id: 'source-1', start: 0, end: 7, digest: null },
    { id: 'image-source-1', kind: 'image', imageIndex: 0, digest: null },
    { id: 'image-source-2', kind: 'image', imageIndex: 1, digest: null },
  ]);
  const progress = getProductionProgress(project);
  assert.equal(progress.totalImages, 2);
  assert.equal(progress.completedImages, 0);
  assert.equal(progress.totalSources, 3);
  assert.equal(progress.minRequests, 6);
});

test('image-only production analyzes all images once and keeps raw bytes out of later requests', async () => {
  const project = createProductionProject({ ...brief, sourceImages: [image(1), image(2)] });
  const { api, calls } = mocks();
  await runProduction(project, { api });
  assert.deepEqual(calls.map(call => call.kind), ['image', 'image', 'plan', 'write', 'write']);
  for (const [index, call] of calls.filter(call => call.kind === 'image').entries()) {
    assert.deepEqual(call.request.image, { ...image(index + 1), id: `image-source-${index + 1}` });
    assert.equal(call.request.index, index);
    assert.equal(call.request.total, 2);
  }
  for (const call of calls) {
    assert.equal(call.request.brief.sourceImages, undefined);
    assert.equal(call.request.brief.sourceMarkdown, undefined);
    assert.deepEqual(call.request.brief.sourceImageContext, [1, 2].map(index => ({ id: `image-source-${index}`, path: image(index).path })));
    if (call.kind !== 'image') {
      assert.equal(JSON.stringify(call.request).includes(PNG), false);
      assert.equal(call.request.sourceSummary.length, 2);
    }
  }
  assert.equal(getProductionProgress(project).completedImages, 2);
  assert.equal(getProductionProgress(project).percent, 100);
  assert.equal(getProductionProgress(project).requestsStarted, 5);
  const restored = copy(project);
  restored.production = validateProductionData(restored.production);
  assert.deepEqual(restored.production, project.production);
  await runProduction(restored, { api: {} });
  assert.equal(calls.length, 5);
});

test('mixed production reads text before images and merges all references for writing', async () => {
  const sourceMarkdown = '메모'.repeat(7000);
  const project = createProductionProject({ ...brief, sourceMarkdown, sourceImages: [image(1), image(2)] });
  const { api, calls } = mocks();
  await runProduction(project, { api });
  assert.deepEqual(calls.slice(0, 4).map(call => call.kind), ['text', 'text', 'image', 'image']);
  assert.equal(calls.filter(call => call.kind === 'text').map(call => call.request.chunk.text).join(''), sourceMarkdown);
  assert.ok(calls.filter(call => call.kind === 'text').every(call => call.request.total === 2));
  const refs = ['source-1', 'source-2', 'image-source-1', 'image-source-2'];
  assert.deepEqual(project.production.plan.chapters[0].sourceRefs, refs);
  for (const call of calls.filter(call => call.kind === 'write')) {
    assert.deepEqual(call.request.sourceSummary.map(source => source.id), refs);
    assert.equal(call.request.sourceExcerpt.includes('image-source'), false);
    assert.ok(call.request.sourceExcerpt.length <= 16000);
    assert.equal(JSON.stringify(call.request).includes(PNG), false);
  }
});

test('a chapter referencing only images receives no unrelated long raw Markdown excerpt', async () => {
  const project = createProductionProject({ ...brief, sourceMarkdown: '문'.repeat(12001) });
  const { api, calls } = mocks();
  const plan = api.planBook;
  api.planBook = async request => {
    const result = await plan(request);
    result.chapters.forEach(chapter => { chapter.sourceRefs = ['image-source-1']; });
    return result;
  };
  await runProduction(project, { api });
  assert.ok(calls.filter(call => call.kind === 'write').every(call => call.request.sourceExcerpt === ''));
});

test('cancellation after a saved image resumes from the next image after JSON restore', async () => {
  const project = createProductionProject({ ...brief, sourceImages: [image(1), image(2), image(3)] });
  const { api, calls } = mocks();
  const controller = new AbortController();
  let saved;
  await assert.rejects(runProduction(project, { api, signal: controller.signal, onSave(current) {
    saved = copy(current);
    if (current.production.sources[0].digest) controller.abort();
  } }), { name: 'AbortError' });
  assert.equal(project.production.status, 'paused');
  assert.equal(getProductionProgress(project).completedImages, 1);
  const restored = copy(saved);
  restored.production = validateProductionData(restored.production);
  await runProduction(restored, { api });
  assert.deepEqual(calls.filter(call => call.kind === 'image').map(call => call.request.image.id), ['image-source-1', 'image-source-2', 'image-source-3']);
  assert.equal(restored.production.status, 'complete');
});

test('cancelling an in-flight image discards its response and safely retries only that image', async () => {
  const project = createProductionProject({ ...brief, sourceImages: [image(1), image(2)] });
  const { api, calls } = mocks();
  const controller = new AbortController();
  const summarize = api.summarizeImage;
  api.summarizeImage = async request => {
    const response = await summarize(request);
    if (request.index === 1) controller.abort();
    return response;
  };
  await assert.rejects(runProduction(project, { api, signal: controller.signal }), { name: 'AbortError' });
  assert.ok(project.production.sources[0].digest);
  assert.equal(project.production.sources[1].digest, null);
  api.summarizeImage = summarize;
  await runProduction(project, { api });
  assert.deepEqual(calls.filter(call => call.kind === 'image').map(call => call.request.image.id), ['image-source-1', 'image-source-2', 'image-source-2']);
});

test('image analysis failures preserve earlier digests and never fall through to planning', async () => {
  const project = createProductionProject({ ...brief, sourceImages: [image(1), image(2)] });
  const { api, calls } = mocks();
  const summarize = api.summarizeImage;
  api.summarizeImage = async request => {
    if (request.index === 1) throw new Error('이미지 읽기 연결 실패');
    return summarize(request);
  };
  await assert.rejects(runProduction(project, { api }), /이미지 읽기 연결 실패/);
  assert.ok(project.production.sources[0].digest);
  assert.equal(project.production.sources[1].digest, null);
  assert.equal(calls.some(call => call.kind === 'plan'), false);
  api.summarizeImage = summarize;
  await runProduction(project, { api });
  assert.deepEqual(calls.filter(call => call.kind === 'image').map(call => call.request.image.id), ['image-source-1', 'image-source-2']);
});

test('image analyses reject invented quotations, oversized summaries, and wrong references', async () => {
  for (const invalid of [
    { quotes: ['화면에서 읽었다고 주장하는 인용'] }, { quotes: undefined },
    { summary: '상'.repeat(1501) }, { summary: '' }, { facts: Array(7).fill('사실') },
    { facts: ['사'.repeat(301)] }, { unknowns: Array(5).fill('불명') },
    { unknowns: ['미'.repeat(301)] }, { id: 'image-source-2' }, { id: undefined },
    { facts: undefined }, { unknowns: undefined },
  ]) {
    const project = createProductionProject(brief);
    const { api, calls } = mocks({ summarizeImage: async () => ({ ...digest('image-source-1'), ...invalid }) });
    await assert.rejects(runProduction(project, { api }));
    assert.equal(project.production.sources[0].digest, null);
    assert.equal(calls.length, 0);
  }
});

test('image backup validation rejects typed-record and digest tampering', async () => {
  const project = createProductionProject({ ...brief, sourceMarkdown: '# 원문' });
  const { api } = mocks();
  await runProduction(project, { api });
  for (const edit of [
    stored => { stored.sources[1].kind = 'text'; },
    stored => { stored.sources[1].imageIndex = 1; },
    stored => { stored.sources[1].start = 0; },
    stored => { stored.sources[1].id = 'image-source-2'; },
    stored => { stored.sources[0].kind = 'image'; },
    stored => { stored.sources[0].imageIndex = 0; },
    stored => { stored.sources[1].digest.quotes = ['검증되지 않은 인용']; },
    stored => { stored.sources[1].digest.summary = '상'.repeat(1501); },
    stored => { stored.sources[1].digest.id = 'source-1'; },
  ]) {
    const stored = copy(project.production);
    edit(stored);
    assert.throws(() => validateProductionData(stored));
  }
});

test('fifty images and all Markdown chunks can be referenced together without silent omission', async () => {
  const project = createProductionProject({ ...brief, sourceMarkdown: '원'.repeat(120000), sourceImages: Array.from({ length: 50 }, (_, index) => image(index + 1)) });
  const { api, calls } = mocks();
  await runProduction(project, { api });
  assert.equal(project.production.sources.length, 60);
  assert.equal(calls.filter(call => call.kind === 'image').length, 50);
  assert.ok(calls.filter(call => call.kind === 'text').every(call => call.request.total === 10));
  assert.equal(project.production.plan.chapters[0].sourceRefs.length, 60);
  assert.equal(project.production.plan.chapters[0].sections[0].sourceRefs.length, 60);
  assert.equal(getProductionProgress(project).completedImages, 50);
  assert.deepEqual(validateProductionData(copy(project.production)), project.production);
});

test('batched long-book planning receives image digests and paths without original image bytes', async () => {
  const project = createProductionProject({ ...brief, chapterCount: 42, targetValue: 21000 });
  const { api, calls } = mocks();
  await runProduction(project, { api });
  const batches = calls.filter(call => call.kind === 'batch');
  assert.equal(batches.length, 3);
  for (const { request } of batches) {
    assert.equal(request.sourceSummary[0].id, 'image-source-1');
    assert.equal(request.brief.sourceImageContext[0].path, image().path);
    assert.equal(JSON.stringify(request).includes(PNG), false);
  }
  assert.equal(getProductionProgress(project).completedChapters, 42);
});

test('missing image API support stops explicitly before paid requests or planning', async () => {
  const project = createProductionProject(brief);
  const { api, calls } = mocks();
  delete api.summarizeImage;
  await assert.rejects(runProduction(project, { api }), { code: 'MISSING_API' });
  assert.equal(calls.length, 0);
  assert.equal(getProductionProgress(project).requestsStarted, 0);
});

test('storage failure after image analysis stops further calls and retains its in-memory result', async () => {
  const project = createProductionProject({ ...brief, sourceImages: [image(1), image(2)] });
  const { api, calls } = mocks();
  await assert.rejects(runProduction(project, { api, onSave(current) {
    if (current.production.sources[0].digest) return false;
  } }), { code: 'SAVE_FAILED' });
  assert.deepEqual(calls.map(call => call.kind), ['image']);
  assert.ok(project.production.sources[0].digest);
  assert.equal(project.production.sources[1].digest, null);
});

test('cached image fingerprints detect original byte, metadata, array, and brief mutations', async () => {
  const original = imageWithMetadata('original');
  const changed = imageWithMetadata('modified');
  assert.equal(original.bytes, changed.bytes);
  for (const edit of [
    saved => { saved.sourceImages[0].src = changed.src; },
    saved => { saved.sourceImages[0].path = '다른폴더/같은이미지.png'; },
    saved => { saved.sourceImages[0].bytes++; },
    saved => { saved.sourceImages[0].mimeType = 'image/jpeg'; },
    saved => { saved.sourceImages.reverse(); },
    saved => { saved.sourceImages.pop(); },
    saved => { saved.sourceImages.push(image(3)); },
    saved => { saved.instructions = '바뀐 집필 지시'; },
  ]) {
    const project = createProductionProject({ ...brief, sourceImages: [original, image(2)] });
    assert.equal(getProductionProgress(project).integrityError, '');
    assert.equal(getProductionProgress(project).integrityError, '');
    edit(project.production.brief);
    assert.ok(getProductionProgress(project).integrityError);
    await assert.rejects(runProduction(project, { api: {} }));
  }
});

test('image fingerprint cache preserves valid JSON roundtrips and cannot hide an in-flight image edit', async () => {
  const original = imageWithMetadata('original');
  const changed = imageWithMetadata('modified');
  const project = createProductionProject({ ...brief, sourceImages: [original] });
  getProductionProgress(project);
  const restored = copy(project);
  restored.production = validateProductionData(restored.production);
  assert.equal(getProductionProgress(restored).integrityError, '');
  const { api } = mocks({ summarizeImage: async request => {
    restored.production.brief.sourceImages[0].src = changed.src;
    return digest(request.image.id);
  } });
  await assert.rejects(runProduction(restored, { api }), { code: 'BRIEF_CHANGED' });
  assert.equal(restored.production.sources[0].digest, null);
});
