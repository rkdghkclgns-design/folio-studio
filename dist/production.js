/** Durable, source-aware book production. No network or credential storage lives here. */
import {validateSourceManifest} from './source-files.js';
import {validateSourceImages} from './source-images.js';
import {parseDiagramBlocks, countableDiagramText, stripDiagramBlocks} from './diagrams.js';
import {assertProductionApproval, consumeProductionApproval} from './production-estimate.js';
const MAX_SOURCE = 120000;
const SOURCE_CHUNK = 12000;
const SECTION_MAX = 2500;
const SECTION_MIN = 500;
const PAGE_CHARS = 800;
const MAX_CHAPTERS = 300;
const SINGLE_PLAN_MAX = 40;
const PLAN_BATCH = 20;
const activeRuns = new WeakSet();
const imageContentFingerprints = new WeakMap();
const TERMINAL_SECTION = new Set(['complete', 'needs_review']);
const statuses = new Set(['ready', 'running', 'paused', 'failed', 'complete', 'needs_review']);
const stages = new Set(['source', 'plan', 'writing', 'complete']);

export class ProductionError extends Error {
  constructor(message, code = 'INVALID_PRODUCTION') {
    super(message);
    this.name = 'ProductionError';
    this.code = code;
  }
}
const fail = (message, code) => { throw new ProductionError(message, code); };
const now = () => new Date().toISOString();
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto?.randomUUID?.() || `book-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const ownObject = value => value && typeof value === 'object' && !Array.isArray(value);

function text(value, max, label, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string' || value.length > max) fail(`${label}은 ${max.toLocaleString('ko-KR')}자 이내의 텍스트로 입력해 주세요.`);
  return value;
}
function integer(value, min, max, label, fallback) {
  if (value === undefined || value === null || value === '') value = fallback;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) value = Number(value.trim());
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}은 ${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')} 사이의 정수로 입력해 주세요.`);
  return value;
}
function stringList(value, maxItems, maxChars, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} 형식을 확인해 주세요.`);
  return value.map(item => text(item, maxChars, label));
}

/** A character is one Unicode code point; whitespace is excluded. */
export function countProductionChars(value) {
  if (typeof value !== 'string') return 0;
  return Array.from(countableDiagramText(value).replace(/\s/gu, '')).length;
}

export function normalizeProductionBrief(value = {}) {
  if (!ownObject(value)) fail('제작 요청 형식을 확인해 주세요.');
  const targetUnit = value.targetUnit ?? 'chars';
  if (!['chars', 'pages'].includes(targetUnit)) fail('목표 분량 단위를 확인해 주세요.');
  const targetValue = targetUnit === 'pages'
    ? integer(value.targetValue, 4, 375, '예상 쪽수', 40)
    : integer(value.targetValue, 3000, 300000, '목표 글자 수', 30000);
  const chapterCount = integer(value.chapterCount, 0, MAX_CHAPTERS, '장 수', 0);
  if (chapterCount === 1) fail('장 수는 자동 또는 2~300장으로 정해 주세요.');
  const targetChars = targetUnit === 'pages' ? targetValue * PAGE_CHARS : targetValue;
  if (chapterCount && Math.floor(targetChars / chapterCount) < SECTION_MIN) fail('장마다 최소 500자가 필요합니다. 목표 분량을 늘리거나 장 수를 줄여 주세요.');
  const language = value.language ?? 'ko';
  if (!['ko', 'en', 'ja'].includes(language)) fail('지원하는 책 언어를 선택해 주세요.');
  const illustrations = value.illustrations ?? 'design';
  if (!['hybrid', 'design', 'ai', 'none'].includes(illustrations)) fail('삽화 방식을 확인해 주세요.');
  const brief = {
    topic: text(value.topic, 4000, '주제'),
    title: text(value.title, 200, '책 제목'),
    author: text(value.author, 120, '저자'),
    audience: text(value.audience, 2000, '독자'),
    instructions: text(value.instructions, 12000, '제작 지시'),
    sourceMarkdown: text(value.sourceMarkdown, MAX_SOURCE, '원시 Markdown'),
    sourceName: text(value.sourceName, 255, '원본 파일 이름'),
    language,
    tone: text(value.tone, 2000, '문체'),
    voiceSample: text(value.voiceSample, 4000, '문체 예문'),
    genre: text(value.genre, 80, '장르'),
    targetUnit,
    targetValue,
    chapterCount,
    illustrations,
  };
  // Preserve the exact shape/fingerprint of older saved briefs when absent.
  if (value.diagrams !== undefined) {
    if (!['auto', 'none'].includes(value.diagrams)) fail('도표 생성 방식을 확인해 주세요.');
    brief.diagrams = value.diagrams;
  }
  if (value.sourceImages !== undefined) brief.sourceImages = validateSourceImages(value.sourceImages);
  if (value.sourceManifest !== undefined) brief.sourceManifest = validateSourceManifest(value.sourceManifest, brief.sourceMarkdown, { allowEmpty: !!brief.sourceImages?.length });
  if (!brief.topic.trim() && !brief.sourceMarkdown.trim() && !brief.sourceImages?.length) fail('주제, 원시 Markdown 또는 원본 이미지를 추가해 주세요.');
  return brief;
}

// These hashes detect accidental edits, not malicious modification. Content is
// also compared exactly against the durable section records before any request.
function fingerprint(value) {
  const input = JSON.stringify(value);
  let left = 2166136261, right = 2246822519;
  for (let i = 0; i < input.length; i++) {
    const unit = input.charCodeAt(i);
    left = Math.imul(left ^ unit, 16777619);
    right = Math.imul(right ^ unit, 3266489917);
  }
  return `${(left >>> 0).toString(16).padStart(8, '0')}${(right >>> 0).toString(16).padStart(8, '0')}`;
}
function briefFingerprint(brief, originalImages = brief.sourceImages) {
  // Legacy fingerprints stay byte-for-byte unchanged. For new image briefs,
  // immutable image strings are hashed once per live source object; every
  // mutable metadata field and the complete array order remain in the hash.
  if (!brief.sourceImages?.length) return fingerprint(brief);
  const sourceImages = brief.sourceImages.map((image, index) => {
    const original = originalImages[index];
    let cached = imageContentFingerprints.get(original);
    if (!cached || cached.src !== image.src) {
      cached = { src: image.src, fingerprint: fingerprint(image.src) };
      imageContentFingerprints.set(original, cached);
    }
    return { path: image.path, srcFingerprint: cached.fingerprint, mimeType: image.mimeType, bytes: image.bytes };
  });
  return fingerprint({ ...brief, sourceImages });
}
function manuscriptFingerprint(project) {
  return fingerprint({ title: project.title, subtitle: project.subtitle || '', description: project.description || '', chapters: project.chapters.map(chapter => ({ title: chapter.title, content: chapter.content })) });
}
function splitSource(source) {
  const chunks = [];
  for (let start = 0; start < source.length;) {
    let end = Math.min(start + SOURCE_CHUNK, source.length);
    if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1]) && /[\uDC00-\uDFFF]/.test(source[end])) end--;
    chunks.push({ id: `source-${chunks.length + 1}`, start, end, digest: null });
    start = end;
  }
  return chunks;
}
function buildSources(brief) {
  return [...splitSource(brief.sourceMarkdown), ...(brief.sourceImages || []).map((_, imageIndex) => ({ id: `image-source-${imageIndex + 1}`, kind: 'image', imageIndex, digest: null }))];
}
function allocate(total, count) {
  const floor = Math.floor(total / count), remainder = total % count;
  return Array.from({ length: count }, (_, index) => floor + (index < remainder ? 1 : 0));
}
function derive(brief) {
  const targetChars = brief.targetUnit === 'pages' ? brief.targetValue * PAGE_CHARS : brief.targetValue;
  // Keep the automatic allocation stable so saved v1 books can resume unchanged.
  const chapterCount = brief.chapterCount || Math.min(SINGLE_PLAN_MAX, Math.max(2, Math.ceil(targetChars / 6000)));
  const chapterBudgets = allocate(targetChars, chapterCount);
  const sectionBudgets = chapterBudgets.map(budget => allocate(budget, Math.ceil(budget / SECTION_MAX)));
  return { targetChars, chapterCount, chapterBudgets, sectionBudgets };
}

export function createProductionProject(value) {
  const brief = normalizeProductionBrief(value);
  const { targetChars, chapterCount } = derive(brief);
  const timestamp = now();
  const project = {
    id: uid(), title: brief.title.trim() || '새로 집필하는 책', subtitle: '', author: brief.author,
    description: '', audience: brief.audience, tone: brief.tone, voiceSample: brief.voiceSample,
    genre: brief.genre, language: brief.language, theme: 'sage', updatedAt: timestamp,
    chapters: [{ id: uid(), title: '집필 준비', content: '' }],
    production: {
      version: 1, brief, targetChars, chapterCount, briefFingerprint: briefFingerprint(brief),
      manuscriptFingerprint: '', stage: 'source', status: 'ready',
      sources: buildSources(brief), plan: null, requestsStarted: 0,
      artwork: { status: 'pending', completed: [], error: '' },
      createdAt: timestamp, updatedAt: timestamp, error: '',
    },
  };
  project.production.manuscriptFingerprint = manuscriptFingerprint(project);
  return project;
}

function validateDigest(value, id, rawChunk) {
  if (!ownObject(value) || (value.id !== undefined && value.id !== id)) fail('원문 정리 응답의 출처가 일치하지 않습니다.', 'INVALID_RESPONSE');
  const digest = { id, summary: text(value.summary, 3000, '원문 요약'), facts: stringList(value.facts, 8, 500, '원문 사실'), quotes: stringList(value.quotes, 4, 700, '원문 인용'), unknowns: stringList(value.unknowns, 6, 400, '확인할 사항') };
  if (!digest.summary.trim() || JSON.stringify(digest).length > 10000) fail('원문 정리 응답을 확인해 주세요.', 'INVALID_RESPONSE');
  if (rawChunk !== undefined && digest.quotes.some(quote => !rawChunk.includes(quote))) fail('원문에 없는 인용이 반환되어 제작을 멈췄습니다.', 'INVALID_RESPONSE');
  return digest;
}
function validateImageDigest(value, id) {
  if (!ownObject(value) || value.id !== id) fail('이미지 분석 응답의 출처가 일치하지 않습니다.', 'INVALID_RESPONSE');
  // A visual model cannot verify a verbatim quotation against the original text.
  if (!Array.isArray(value.quotes) || value.quotes.length) fail('이미지 분석은 직접 인용을 포함할 수 없습니다.', 'INVALID_RESPONSE');
  if (!Array.isArray(value.facts) || !Array.isArray(value.unknowns)) fail('이미지 분석 응답의 항목 형식을 확인해 주세요.', 'INVALID_RESPONSE');
  const digest = { id, summary: text(value.summary, 1500, '이미지 요약'), facts: stringList(value.facts, 6, 300, '이미지에서 확인한 사실'), quotes: [], unknowns: stringList(value.unknowns, 4, 300, '이미지에서 확인할 사항') };
  if (!digest.summary.trim() || JSON.stringify(digest).length > 5000) fail('이미지 분석 응답을 확인해 주세요.', 'INVALID_RESPONSE');
  return digest;
}
function validateRefs(value, sources) {
  const refs = stringList(value, 62, 80, '원문 참조');
  const known = new Set(sources.map(source => source.id));
  if (refs.some(ref => !known.has(ref))) fail('알 수 없는 원문 참조가 있습니다.', 'INVALID_RESPONSE');
  return [...new Set(refs)];
}
function diagramEvidence(production) {
  const { brief, sources } = production;
  const inputs = [brief.sourceMarkdown, brief.topic, brief.instructions];
  for (const source of sources) if (source.digest) {
    inputs.push(source.digest.summary, ...source.digest.facts, ...source.digest.quotes);
  }
  // Generated prose and diagram-embedded evidence are not independent sources.
  return inputs.filter(Boolean).map(input => stripDiagramBlocks(input));
}
function chapterDiagramCount(production, chapterIndex, excludeSectionIndex) {
  return (production.plan?.chapters[chapterIndex]?.sections || []).reduce((total, section, index) => index === excludeSectionIndex ? total : total + parseDiagramBlocks(section.content).length, 0);
}
function validateSectionResult(value, production, chapterIndex, sectionIndex) {
  if (!ownObject(value)) fail('집필 응답 형식을 확인해 주세요.', 'INVALID_RESPONSE');
  const content = text(value.content, 12000, '생성된 원고');
  if (!content.trim()) fail('생성된 원고가 비어 있습니다.', 'INVALID_RESPONSE');
  let diagrams;
  const evidence = diagramEvidence(production);
  try {
    diagrams = parseDiagramBlocks(content, { strict: true, evidenceText: evidence.join('\n\n'), maxDiagrams: 1 });
  } catch (error) {
    fail(error.message || '도표의 형식과 원문 근거를 확인해 주세요.', 'INVALID_RESPONSE');
  }
  if (diagrams.some(block => block.diagram.evidence.some(quote => !evidence.some(input => input.includes(quote))))) fail('도표의 수치 근거는 하나의 원문 항목에서 그대로 확인할 수 있어야 합니다.', 'INVALID_RESPONSE');
  if (diagrams.length && production.brief.diagrams === 'none') fail('도표를 사용하지 않는 제작 요청에 도표가 포함되었습니다.', 'INVALID_RESPONSE');
  if (diagrams.length + chapterDiagramCount(production, chapterIndex, sectionIndex) > 12) fail('한 장에는 도표를 최대 12개까지 넣을 수 있습니다.', 'INVALID_RESPONSE');
  return { content, notes: stringList(value.notes, 8, 1000, '집필 메모'), imagePrompt: text(value.imagePrompt, 4000, '삽화 지시'), sourceRefs: validateRefs(value.sourceRefs, production.sources) };
}
function preserveSectionDiagrams(original, revised) {
  const before = parseDiagramBlocks(original), after = parseDiagramBlocks(revised);
  if (before.some(block => block.diagram && !after.some(candidate => candidate.diagram && Object.keys(block.diagram).every(key => JSON.stringify(block.diagram[key]) === JSON.stringify(candidate.diagram[key]))))) {
    fail('분량을 보정하는 동안 기존 도표가 삭제되거나 변경되었습니다. 저장한 원고를 보존했습니다.', 'INVALID_RESPONSE');
  }
}
function planMetadata(value, production) {
  return {
    title: text(value.title, 200, '책 제목') || production.brief.title || '새로 집필하는 책',
    subtitle: text(value.subtitle, 500, '부제'), description: text(value.description, 4000, '책 소개'),
  };
}
function validateChapterOutline(chapter, index, production, strictId = false) {
  if (!ownObject(chapter) || typeof chapter.title !== 'string' || !chapter.title.trim()) fail('목차의 장 제목이 비어 있습니다.', 'INVALID_RESPONSE');
  if (strictId && chapter.id !== `chapter-${index + 1}`) fail('목차의 장 번호가 순서와 일치하지 않습니다.', 'INVALID_RESPONSE');
  if (typeof chapter.purpose !== 'string' || !chapter.purpose.trim() || !Array.isArray(chapter.outline) || chapter.outline.length < 1 || chapter.outline.some(item => typeof item !== 'string' || !item.trim())) fail('목차의 집필 개요가 비어 있습니다.', 'INVALID_RESPONSE');
  return {
    id: `chapter-${index + 1}`, title: text(chapter.title, 200, '장 제목'), purpose: text(chapter.purpose, 700, '장 구성'),
    outline: stringList(chapter.outline, 8, 500, '장 개요'), sourceRefs: validateRefs(chapter.sourceRefs, production.sources),
  };
}
function assertUniqueTitles(chapters) {
  const titles = chapters.map(chapter => chapter.title.normalize('NFKC').replace(/\s+/gu, '').toLocaleLowerCase());
  if (new Set(titles).size !== titles.length) fail('같은 장 제목이 반복된 목차입니다. 저장된 목차 다음부터 다시 시도해 주세요.', 'INVALID_RESPONSE');
}
function validatePlanning(value, production) {
  if (!ownObject(value) || !Array.isArray(value.chapters) || value.chapters.length < 1 || value.chapters.length > production.chapterCount || (value.chapters.length % PLAN_BATCH !== 0 && value.chapters.length !== production.chapterCount)) fail('목차의 중간 저장 기록을 확인해 주세요.', 'INVALID_RESPONSE');
  const chapters = value.chapters.map((chapter, index) => validateChapterOutline(chapter, index, production, true));
  assertUniqueTitles(chapters);
  return { ...planMetadata(value, production), chapters };
}
function mergePlanningBatch(value, production, startIndex, batchSize) {
  if (!ownObject(value) || !Array.isArray(value.chapters) || value.chapters.length !== batchSize) fail(`이번 목차에는 정확히 ${batchSize}장이 필요합니다. 저장된 목차 다음부터 다시 시도해 주세요.`, 'INVALID_RESPONSE');
  const metadata = planMetadata(value, production);
  const chapters = value.chapters.map((chapter, index) => validateChapterOutline(chapter, startIndex + index, production, true));
  return validatePlanning({
    ...(production.planning ? planMetadata(production.planning, production) : metadata),
    chapters: [...(production.planning?.chapters || []), ...chapters],
  }, production);
}
function validatePlan(value, production) {
  if (!ownObject(value) || !Array.isArray(value.chapters) || value.chapters.length !== production.chapterCount) fail(`목차는 정확히 ${production.chapterCount}장이어야 합니다. 다시 시도해 주세요.`, 'INVALID_RESPONSE');
  const budgets = derive(production.brief);
  if (production.chapterCount > SINGLE_PLAN_MAX) {
    // Validate IDs before turning them into the canonical stored chapter records.
    value.chapters.forEach((chapter, index) => validateChapterOutline(chapter, index, production, true));
    assertUniqueTitles(value.chapters);
  }
  return {
    ...planMetadata(value, production),
    chapters: value.chapters.map((chapter, index) => {
      return {
        ...validateChapterOutline(chapter, index, production),
        targetChars: budgets.chapterBudgets[index],
        sections: budgets.sectionBudgets[index].map(targetChars => ({ targetChars, content: '', status: 'pending', revisionAttempts: 0, notes: [], imagePrompt: '', sourceRefs: [] })),
      };
    }),
  };
}

/** Validates a JSON-backup payload and returns an independent, sanitized copy. */
export function validateProductionData(value) {
  if (!ownObject(value) || value.version !== 1) fail('지원하지 않는 책 제작 기록입니다.');
  const brief = normalizeProductionBrief(value.brief);
  const derived = derive(brief);
  if (value.briefFingerprint !== briefFingerprint(brief, value.brief.sourceImages)) fail('제작 요청이 변경되었습니다. 새 책으로 제작해 주세요.', 'BRIEF_CHANGED');
  if (value.targetChars !== derived.targetChars || value.chapterCount !== derived.chapterCount) fail('제작 목표와 진행 기록이 일치하지 않습니다.');
  if (!statuses.has(value.status) || !stages.has(value.stage)) fail('제작 진행 상태를 확인해 주세요.');
  if (typeof value.manuscriptFingerprint !== 'string' || !/^[a-f0-9]{16}$/.test(value.manuscriptFingerprint)) fail('원고 보호 기록을 확인해 주세요.');
  const expectedSources = buildSources(brief);
  if (!Array.isArray(value.sources) || value.sources.length !== expectedSources.length) fail('원문 분할 기록이 일치하지 않습니다.');
  const sources = value.sources.map((source, index) => {
    const expected = expectedSources[index];
    if (!ownObject(source) || source.id !== expected.id) fail('원문 분할 기록이 일치하지 않습니다.');
    if (expected.kind === 'image') {
      if (source.kind !== 'image' || source.imageIndex !== expected.imageIndex || source.start !== undefined || source.end !== undefined) fail('이미지 원본 기록이 일치하지 않습니다.');
      return { ...expected, digest: source.digest === null ? null : validateImageDigest(source.digest, expected.id) };
    }
    if (source.kind !== undefined || source.imageIndex !== undefined || source.start !== expected.start || source.end !== expected.end) fail('원문 분할 기록이 일치하지 않습니다.');
    return { ...expected, digest: source.digest === null ? null : validateDigest(source.digest, expected.id, brief.sourceMarkdown.slice(source.start, source.end)) };
  });
  const production = {
    version: 1, brief, targetChars: derived.targetChars, chapterCount: derived.chapterCount,
    briefFingerprint: value.briefFingerprint, manuscriptFingerprint: value.manuscriptFingerprint,
    stage: value.stage, status: value.status, sources, plan: null,
    requestsStarted: integer(value.requestsStarted, 0, 1000000, '제작 요청 횟수', 0),
    artwork: { status: 'pending', completed: [], error: '' },
    createdAt: text(value.createdAt, 80, '제작 시작 시각'), updatedAt: text(value.updatedAt, 80, '제작 저장 시각'),
    error: text(value.error, 1000, '제작 안내'),
  };
  if (value.artwork !== undefined) {
    if (!ownObject(value.artwork) || !['pending', 'running', 'complete', 'failed', 'paused'].includes(value.artwork.status)) fail('삽화 제작 기록을 확인해 주세요.');
    production.artwork = { status: value.artwork.status, completed: stringList(value.artwork.completed, 100, 120, '완료된 삽화'), error: text(value.artwork.error, 1000, '삽화 안내') };
  }
  if (value.planning !== undefined && value.planning !== null) {
    if (derived.chapterCount <= SINGLE_PLAN_MAX || value.plan !== null || sources.some(source => !source.digest)) fail('목차의 중간 저장 상태가 제작 기록과 일치하지 않습니다.');
    production.planning = validatePlanning(value.planning, production);
  } else if (value.planning === null) production.planning = null;
  if (value.plan !== null) {
    if (sources.some(source => !source.digest)) fail('원문 검토가 완료되기 전의 목차 기록입니다.');
    production.plan = validatePlan(value.plan, production);
    for (let ci = 0; ci < production.plan.chapters.length; ci++) {
      const storedChapter = value.plan.chapters[ci], chapter = production.plan.chapters[ci];
      if (storedChapter.targetChars !== chapter.targetChars || !Array.isArray(storedChapter.sections) || storedChapter.sections.length !== chapter.sections.length) fail('장별 분량 기록을 확인해 주세요.');
      const expectedSections = chapter.sections;
      chapter.sections = [];
      for (let si = 0; si < expectedSections.length; si++) {
        const expected = expectedSections[si];
        const stored = storedChapter.sections[si];
        if (!ownObject(stored) || stored.targetChars !== expected.targetChars || !['pending', 'drafted', 'complete', 'needs_review'].includes(stored.status)) fail('집필 구간 기록을 확인해 주세요.');
        const revisionAttempts = integer(stored.revisionAttempts, 0, 10000, '보정 횟수', 0);
        if (stored.status === 'pending') {
          if (stored.content !== '' || revisionAttempts) fail('미작성 구간의 기록이 일치하지 않습니다.');
          chapter.sections.push({ ...expected });
          continue;
        }
        const result = validateSectionResult(stored, production, ci, si);
        if (stored.status === 'complete' && !withinTarget(result.content, expected.targetChars)) fail('완료 구간의 분량 기록이 일치하지 않습니다.');
        chapter.sections.push({ targetChars: expected.targetChars, ...result, status: stored.status, revisionAttempts });
      }
    }
  }
  if ((production.stage === 'writing' || production.stage === 'complete') && !production.plan) fail('목차 기록이 없는 제작 상태입니다.');
  if (['complete', 'needs_review'].includes(production.status)) {
    if (!production.plan || production.plan.chapters.some(chapter => chapter.sections.some(section => !TERMINAL_SECTION.has(section.status)))) fail('완료되지 않은 집필 구간이 있습니다.');
    const needsReview = production.plan.chapters.some(chapter => chapter.sections.some(section => section.status === 'needs_review'));
    if (production.status === 'complete' && needsReview) fail('분량 확인이 필요한 구간이 있습니다.');
  }
  return production;
}

function withinTarget(content, target) {
  const actual = countProductionChars(content);
  return actual >= Math.ceil(target * 0.9) && actual <= Math.floor(target * 1.1);
}
function distance(content, target) { return Math.abs(countProductionChars(content) - target); }
function chapterContent(chapter) { return chapter.sections.filter(section => section.content).map(section => section.content).join('\n\n'); }
function assertUnchanged(project) {
  const production = project.production;
  if (briefFingerprint(normalizeProductionBrief(production.brief), production.brief.sourceImages) !== production.briefFingerprint) fail('제작 지시가 변경되었습니다. 현재 원고를 보존하고 새 책으로 제작해 주세요.', 'BRIEF_CHANGED');
  if (!Array.isArray(project.chapters) || manuscriptFingerprint(project) !== production.manuscriptFingerprint) fail('원고를 직접 수정한 내용이 있습니다. 덮어쓰지 않도록 제작을 멈췄습니다. 수정한 원고는 그대로 두고 새 책으로 제작해 주세요.', 'MANUAL_CHANGES');
  if (production.plan && (project.chapters.length !== production.plan.chapters.length || project.chapters.some((chapter, index) => chapter.title !== production.plan.chapters[index].title || chapter.content !== chapterContent(production.plan.chapters[index])))) fail('직접 수정한 원고가 있어 제작을 이어갈 수 없습니다. 새 책으로 제작해 주세요.', 'MANUAL_CHANGES');
}
function synchronizeChapter(project, index) {
  const source = project.production.plan.chapters[index], chapter = project.chapters[index];
  chapter.content = chapterContent(source);
  chapter.editorialNotes = [...new Set(source.sections.flatMap(section => section.notes))].slice(0, 5);
  chapter.imagePrompt = source.sections.find(section => section.imagePrompt)?.imagePrompt || '';
  project.production.manuscriptFingerprint = manuscriptFingerprint(project);
}
function cancellation(signal) {
  if (!signal?.aborted) return;
  const error = new Error('책 제작을 일시 정지했습니다. 저장된 구간부터 이어갈 수 있습니다.');
  error.name = 'AbortError';
  throw error;
}
function requestBrief(production) {
  const { sourceMarkdown, sourceImages, sourceManifest, ...brief } = production.brief;
  return { ...brief, targetChars: production.targetChars, chapterCount: production.chapterCount,
    ...(sourceImages?.length ? { sourceImageContext: sourceImages.map((image, index) => ({ id: `image-source-${index + 1}`, path: image.path })) } : {}),
  };
}
function codeUnitSlice(source, start, end) {
  if (start > 0 && /[\uDC00-\uDFFF]/.test(source[start]) && /[\uD800-\uDBFF]/.test(source[start - 1])) start++;
  if (end < source.length && /[\uD800-\uDBFF]/.test(source[end - 1]) && /[\uDC00-\uDFFF]/.test(source[end])) end--;
  return source.slice(start, end);
}
function sourceExcerpt(production, chapter) {
  const raw = production.brief.sourceMarkdown;
  if (raw.length <= SOURCE_CHUNK) return raw;
  const textSources = production.sources.filter(source => source.kind !== 'image');
  const selected = chapter.sourceRefs.length ? textSources.filter(source => chapter.sourceRefs.includes(source.id)) : textSources;
  if (!selected.length) return '';
  const budget = Math.floor((16000 - selected.length * 90) / selected.length);
  return selected.map(source => {
    const chunk = raw.slice(source.start, source.end);
    const excerpt = chunk.length <= budget ? chunk : `${codeUnitSlice(chunk, 0, Math.floor(budget / 2))}\n[이 구간의 중간 원문은 요약에 포함됨]\n${codeUnitSlice(chunk, chunk.length - Math.floor(budget / 2), chunk.length)}`;
    return `[${source.id}; 원문 위치 ${source.start}~${source.end}]\n${excerpt}`;
  }).join('\n\n');
}
function sectionRequest(project, chapterIndex, sectionIndex, signal) {
  const production = project.production, chapter = production.plan.chapters[chapterIndex], section = chapter.sections[sectionIndex];
  const before = production.plan.chapters.flatMap((entry, ci) => entry.sections.filter((part, si) => ci < chapterIndex || ci === chapterIndex && si < sectionIndex).filter(part => part.content).map(part => `${entry.title}\n${part.content}`)).join('\n\n');
  const plan = { title: production.plan.title, subtitle: production.plan.subtitle, description: production.plan.description, chapters: production.plan.chapters.map(({ sections, ...entry }) => entry) };
  return { brief: requestBrief(production), sourceSummary: production.sources.map(source => source.digest), sourceExcerpt: sourceExcerpt(production, chapter), plan, chapter: plan.chapters[chapterIndex], index: chapterIndex, sectionIndex, sectionCount: chapter.sections.length, targetChars: section.targetChars, diagramCount: chapterDiagramCount(production, chapterIndex, sectionIndex), previousContext: codeUnitSlice(before, Math.max(0, before.length - 6000), before.length), signal };
}

export function getProductionProgress(project) {
  const production = project?.production;
  if (!production) return null;
  const budgets = derive(production.brief), sections = production.plan?.chapters.flatMap(chapter => chapter.sections) || [];
  const totalSections = budgets.sectionBudgets.flat().length;
  const completedSections = sections.filter(section => TERMINAL_SECTION.has(section.status)).length;
  const completedSources = production.sources.filter(source => source.digest).length;
  const totalSources = production.sources.length;
  const images = production.sources.filter(source => source.kind === 'image');
  const completedImages = images.filter(source => source.digest).length;
  const totalPlanningBatches = production.chapterCount > SINGLE_PLAN_MAX ? Math.ceil(production.chapterCount / PLAN_BATCH) : 1;
  const plannedChapters = production.plan ? production.chapterCount : production.planning?.chapters.length || 0;
  const completedPlanningBatches = production.plan ? totalPlanningBatches : Math.ceil(plannedChapters / PLAN_BATCH);
  const paidSources = production.sources.filter(source => source.kind === 'image' || production.brief.sourceMarkdown.slice(source.start, source.end).trim()).length;
  const needsReviewSections = sections.filter(section => section.status === 'needs_review').length;
  const actualChars = (project.chapters || []).reduce((sum, chapter) => sum + countProductionChars(chapter.content), 0);
  let integrityError = '';
  try { assertUnchanged(project); } catch (error) { integrityError = error.message; }
  const status = production.status === 'running' && !activeRuns.has(project) ? 'paused' : production.status;
  const messages = {
    ready: '제작 요청을 저장했습니다. 집필을 시작할 수 있습니다.',
    running: production.stage === 'source' ? '원문 자료를 읽고 있습니다.' : production.stage === 'plan' ? '책의 목차를 구성하고 있습니다.' : '원문과 지시에 맞춰 집필하고 있습니다.',
    paused: '저장된 구간부터 제작을 이어갈 수 있습니다.',
    failed: production.error || '제작이 멈췄습니다. 저장된 구간부터 이어갈 수 있습니다.',
    complete: '목표 분량의 원고를 완성했습니다. 내용을 검토하고 내보내세요.',
    needs_review: '원고를 보존했습니다. 목표 분량에 맞지 않는 구간을 확인해 주세요.',
  };
  return {
    status, stage: production.stage, targetChars: production.targetChars, actualChars,
    estimatedPages: Math.ceil(actualChars / PAGE_CHARS), targetPages: Math.ceil(production.targetChars / PAGE_CHARS),
    completedSections, totalSections, completedChapters: production.plan?.chapters.filter(chapter => chapter.sections.every(section => TERMINAL_SECTION.has(section.status))).length || 0,
    totalChapters: production.chapterCount, completedSources, totalSources, completedImages, totalImages: images.length, needsReviewSections,
    plannedChapters, completedPlanningBatches, totalPlanningBatches,
    percent: Math.round(100 * (completedSources + completedPlanningBatches + completedSections) / (totalSources + totalPlanningBatches + totalSections)),
    message: integrityError || messages[status], canResume: !integrityError && !activeRuns.has(project) && !['complete', 'needs_review'].includes(status),
    canRetry: !integrityError && !activeRuns.has(project) && needsReviewSections > 0,
    minRequests: paidSources + totalPlanningBatches + totalSections, maxRequests: paidSources + totalPlanningBatches + totalSections * 2,
    requestsStarted: production.requestsStarted, error: production.error || '', integrityError,
  };
}

async function execute(project, options, retry) {
  const { api, onProgress = () => {}, onSave = async () => {}, signal } = options || {};
  if (!project?.production) fail('이 책에는 제작 요청이 없습니다.');
  if (activeRuns.has(project)) fail('이 책을 이미 제작하고 있습니다.', 'ALREADY_RUNNING');
  // Validate without replacing references that the editor or storage layer holds.
  validateProductionData(project.production);
  assertUnchanged(project);
  cancellation(signal);
  const production = project.production;
  if (!retry && ['complete', 'needs_review'].includes(production.status)) return project;
  if (retry && !production.plan?.chapters.some(chapter => chapter.sections.some(section => section.status === 'needs_review'))) return project;
  if (!ownObject(api)) fail('AI 제작 연결이 필요합니다.', 'MISSING_API');
  const requireApi = name => { if (typeof api[name] !== 'function') fail('AI 제작 연결을 확인해 주세요.', 'MISSING_API'); };
  // The browser supplies this contract for every paid run. Pure consumers may
  // still inject a local/test API without a provider or billing connection.
  const approvalContext = options.approvalContext;
  const currentConfig = () => approvalContext?.getConfig?.() || approvalContext?.config;
  if (approvalContext) consumeProductionApproval(project, approvalContext.approval, currentConfig(), {retry});
  activeRuns.add(project);
  let saveFailed = false;
  const notify = () => onProgress(getProductionProgress(project), project);
  const save = async () => {
    production.updatedAt = now();
    project.updatedAt = production.updatedAt;
    try {
      if (await onSave(project) === false) throw new Error('save returned false');
    } catch {
      saveFailed = true;
      fail('제작 결과를 저장하지 못해 작업을 멈췄습니다. 현재 원고를 백업한 뒤 저장 공간을 확인해 주세요.', 'SAVE_FAILED');
    }
    notify();
  };
  const beforeRequest = async name => {
    cancellation(signal);
    assertUnchanged(project);
    if (approvalContext) assertProductionApproval(project, approvalContext.approval, currentConfig(), {retry, running:true});
    requireApi(name);
    production.requestsStarted++;
    await save();
    cancellation(signal);
    if (approvalContext) assertProductionApproval(project, approvalContext.approval, currentConfig(), {retry, running:true});
  };
  const revise = async (ci, si, explicit = false) => {
    // A stop at the draft checkpoint has not started a correction request.
    // Keep its attempt available when the saved book is resumed.
    cancellation(signal);
    const chapter = production.plan.chapters[ci], section = chapter.sections[si];
    if (!explicit && section.revisionAttempts >= 1) {
      section.status = 'needs_review';
      await save();
      return;
    }
    section.revisionAttempts++;
    // Saving this marker before the call also bounds retries after a lost response.
    try {
      await beforeRequest('reviseSection');
    } catch (error) {
      // The API has not been invoked. A stop during the checkpoint must not
      // consume the correction; the outer pause checkpoint saves this rollback.
      section.revisionAttempts--;
      throw error;
    }
    const result = validateSectionResult(await api.reviseSection({ ...sectionRequest(project, ci, si, signal), content: section.content, actualChars: countProductionChars(section.content) }), production, ci, si);
    preserveSectionDiagrams(section.content, result.content);
    cancellation(signal);
    assertUnchanged(project);
    if (distance(result.content, section.targetChars) < distance(section.content, section.targetChars)) Object.assign(section, result);
    section.status = withinTarget(section.content, section.targetChars) ? 'complete' : 'needs_review';
    synchronizeChapter(project, ci);
    await save();
  };
  try {
    production.status = 'running';
    production.error = '';
    await save();
    if (retry) {
      production.stage = 'writing';
      for (let ci = 0; ci < production.plan.chapters.length; ci++) for (let si = 0; si < production.plan.chapters[ci].sections.length; si++) {
        if (production.plan.chapters[ci].sections[si].status === 'needs_review') await revise(ci, si, true);
      }
    } else {
      production.stage = 'source';
      for (let index = 0; index < production.sources.length; index++) {
        const source = production.sources[index];
        if (source.digest) continue;
        if (source.kind === 'image') {
          await beforeRequest('summarizeImage');
          const image = { ...production.brief.sourceImages[source.imageIndex], id: source.id };
          const result = await api.summarizeImage({ brief: requestBrief(production), image, index: source.imageIndex, total: production.brief.sourceImages.length, signal });
          cancellation(signal);
          assertUnchanged(project);
          source.digest = validateImageDigest(result, source.id);
          await save();
          continue;
        }
        const chunk = production.brief.sourceMarkdown.slice(source.start, source.end);
        if (!chunk.trim()) {
          source.digest = { id: source.id, summary: '이 자료 조각에는 공백만 있으며 내용이 없습니다.', facts: [], quotes: [], unknowns: [] };
          await save();
          continue;
        }
        await beforeRequest('summarizeSource');
        const result = await api.summarizeSource({ brief: requestBrief(production), chunk: { id: source.id, text: chunk }, index, total: production.sources.filter(entry => entry.kind !== 'image').length, signal });
        cancellation(signal);
        assertUnchanged(project);
        source.digest = validateDigest(result, source.id, chunk);
        await save();
      }
      if (!production.plan) {
        production.stage = 'plan';
        if (production.chapterCount > SINGLE_PLAN_MAX) {
          while ((production.planning?.chapters.length || 0) < production.chapterCount) {
            const startIndex = production.planning?.chapters.length || 0;
            const batchSize = Math.min(PLAN_BATCH, production.chapterCount - startIndex);
            await beforeRequest('planBatch');
            const result = await api.planBatch({ brief: requestBrief(production), sourceSummary: production.sources.map(source => source.digest), startIndex, batchSize, previousPlan: production.planning ? clone(production.planning) : undefined, signal });
            cancellation(signal);
            assertUnchanged(project);
            production.planning = mergePlanningBatch(result, production, startIndex, batchSize);
            await save();
          }
          cancellation(signal);
          assertUnchanged(project);
          production.plan = validatePlan(production.planning, production);
          production.planning = null;
        } else {
          await beforeRequest('planBook');
          const result = await api.planBook({ brief: requestBrief(production), sourceSummary: production.sources.map(source => source.digest), signal });
          cancellation(signal);
          assertUnchanged(project);
          production.plan = validatePlan(result, production);
        }
        project.title = production.brief.title.trim() || production.plan.title;
        production.plan.title = project.title;
        project.subtitle = production.plan.subtitle;
        project.description = production.plan.description;
        project.chapters = production.plan.chapters.map(chapter => ({ id: uid(), title: chapter.title, content: '', editorialNotes: [], imagePrompt: '' }));
        production.manuscriptFingerprint = manuscriptFingerprint(project);
        await save();
      }
      production.stage = 'writing';
      for (let ci = 0; ci < production.plan.chapters.length; ci++) for (let si = 0; si < production.plan.chapters[ci].sections.length; si++) {
        const section = production.plan.chapters[ci].sections[si];
        if (TERMINAL_SECTION.has(section.status)) continue;
        if (section.status === 'pending') {
          await beforeRequest('writeSection');
          const result = validateSectionResult(await api.writeSection(sectionRequest(project, ci, si, signal)), production, ci, si);
          cancellation(signal);
          assertUnchanged(project);
          Object.assign(section, result);
          section.status = withinTarget(section.content, section.targetChars) ? 'complete' : 'drafted';
          synchronizeChapter(project, ci);
          await save();
        }
        if (section.status === 'drafted') await revise(ci, si);
      }
    }
    cancellation(signal);
    const sections = production.plan.chapters.flatMap(chapter => chapter.sections);
    const unfinished = sections.some(section => !TERMINAL_SECTION.has(section.status));
    // Explicit correction only visits flagged sections. An interrupted book
    // may still contain unwritten drafts; keep normal production resumable.
    production.stage = unfinished ? 'writing' : 'complete';
    production.status = unfinished ? 'paused' : sections.some(section => section.status === 'needs_review') ? 'needs_review' : 'complete';
    await save();
    return project;
  } catch (error) {
    production.status = error.name === 'AbortError' ? 'paused' : 'failed';
    production.error = (typeof error.message === 'string' ? error.message : '제작을 이어가지 못했습니다.').slice(0, 1000);
    if (!saveFailed) {
      try { await save(); } catch (saveError) { throw saveError; }
    } else notify();
    throw error;
  } finally {
    activeRuns.delete(project);
    notify();
  }
}

export function runProduction(project, options = {}) { return execute(project, options, false); }
/** Only an explicit user action should invoke this; one new correction per flagged section. */
export function retryProductionSections(project, options = {}) { return execute(project, options, true); }
