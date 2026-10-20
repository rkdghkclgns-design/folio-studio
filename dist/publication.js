/** Local publishing preparation. Store submission and certification remain external steps. */
import { buildEpub, exportHTML, exportMarkdown, buildArchive } from './export.js';
import { parseDiagramBlocks } from './diagrams.js';
import { coverSettings, validatePreparedCover } from './publication-cover.js';
import { getReadingChapters } from './book-matter.js';
import { publicationHelpMarkdown } from './publication-help.js';

export const PUBLICATION_REVIEW_DATE = '2026-10-20';
export const PUBLICATION_LINKS = Object.freeze({
  domestic: 'https://help.upaper.kr/read/1021795',
  domesticFiles: 'https://help.upaper.kr/read/1021609',
  kyobo: 'https://store.kyobobook.co.kr/pod/introduce?tab=ebook_publishing',
  isbn: 'https://www.nl.go.kr/seoji/',
  epubcheck: 'https://www.w3.org/publishing/epubcheck/docs/installation/',
  kdp: 'https://kdp.amazon.com/en_US/help/topic/GHKDSCW2KQ3K4UU4',
  kdpLanguages: 'https://kdp.amazon.com/en_US/help/topic/G200673300',
  kdpCover: 'https://kdp.amazon.com/en_US/help/topic/G200645690',
  kdpAI: 'https://kdp.amazon.com/en_US/help/topic/G200672390',
  kdpISBN: 'https://kdp.amazon.com/en_US/help/topic/G7DMSKCM9DVS65TC',
});
const TEXT_FIELDS = { publisher: 200, publicationDate: 10, isbn: 40, rightsHolder: 200, rightsStatement: 3000, authorBio: 3000, keywords: 500, category: 200, price: 30, aiTools: 500, reviewFingerprint: 80, edition: 100, editionNotes: 2000, workflowOwner: 200, recordNote: 2000, referenceUrl: 2000, submissionDate: 10, approvedDate: 10, depositDate: 10 };
export const DISTRIBUTION_STATUS = Object.freeze({ draft: '준비 중', submitted: '심사 제출', revision: '수정 요청', approved: '승인 확인', live: '판매 중', withdrawn: '판매 중단' });
export const ISBN_STATUS = Object.freeze({ unknown: '담당 확인 전', requested: '발급 신청', issued: '발급 확인', 'not-required': '해당 경로 불필요 확인' });
export const DEPOSIT_STATUS = Object.freeze({ unknown: '담당 확인 전', pending: '납본 처리 중', completed: '납본 완료 확인', 'not-required': '대상 아님 확인' });
const STATUS_OPTIONS = { distributionStatus: DISTRIBUTION_STATUS, isbnStatus: ISBN_STATUS, depositStatus: DEPOSIT_STATUS };
const HISTORY_TEXT = { id: 100, recordedAt: 30, edition: 100, fingerprint: 80, channel: 20, distributionStatus: 30, isbnStatus: 30, depositStatus: 30, isbn: 40, note: 2000, referenceUrl: 2000, workflowOwner: 200, editionNotes: 2000, submissionDate: 10, approvedDate: 10, depositDate: 10 };
const validUrl = value => { if (!value) return true; try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };
const FLAGS = ['rightsConfirmed', 'proofreadConfirmed', 'deviceReviewConfirmed'];
const plain = value => typeof value === 'string' ? value.trim() : '';
const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function normalizePublication(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { version: 1, channel: ['domestic', 'kdp', 'direct'].includes(source.channel) ? source.channel : 'domestic', currency: source.currency === 'USD' ? 'USD' : 'KRW', aiDisclosure: ['none', 'assisted', 'generated'].includes(source.aiDisclosure) ? source.aiDisclosure : 'unknown' };
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) result[field] = plain(source[field]).slice(0, limit);
  for (const field of FLAGS) result[field] = source[field] === true;
  for (const [field, allowed] of Object.entries(STATUS_OPTIONS)) result[field] = Object.hasOwn(allowed, source[field]) ? source[field] : field === 'distributionStatus' ? 'draft' : 'unknown';
  result.coverWidth = Number.isInteger(source.coverWidth) ? source.coverWidth : 1600;
  result.coverHeight = Number.isInteger(source.coverHeight) ? source.coverHeight : 2400;
  result.history = Array.isArray(source.history) ? source.history.slice(-100).map(item => {
    const record = {}; for (const [key, limit] of Object.entries(HISTORY_TEXT)) record[key] = plain(item?.[key]).slice(0, limit);
    record.review = Object.fromEntries(FLAGS.map(key => [key, item?.review?.[key] === true]));
    return record;
  }) : [];
  return result;
}

export function validatePublication(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('출판 준비 정보의 형식이 올바르지 않습니다.');
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > limit)) throw new Error(`출판 정보 ${field}의 길이 또는 형식을 확인해 주세요.`);
  for (const field of FLAGS) if (value[field] !== undefined && typeof value[field] !== 'boolean') throw new Error('출판 확인 정보의 형식이 올바르지 않습니다.');
  for (const [field, allowed] of [['channel', ['domestic', 'kdp', 'direct']], ['currency', ['KRW', 'USD']], ['aiDisclosure', ['unknown', 'none', 'assisted', 'generated']]]) if (value[field] !== undefined && !allowed.includes(value[field])) throw new Error('지원하지 않는 출판 설정입니다.');
  for (const [field, allowed] of Object.entries(STATUS_OPTIONS)) if (value[field] !== undefined && !Object.hasOwn(allowed, value[field])) throw new Error('출판 진행 상태가 올바르지 않습니다.');
  for (const field of ['coverWidth', 'coverHeight']) if (value[field] !== undefined && (!Number.isInteger(value[field]) || value[field] < (field === 'coverWidth' ? 625 : 1000) || value[field] > 4096)) throw new Error('표지 크기가 올바르지 않습니다.');
  if (!validUrl(value.referenceUrl)) throw new Error('출판 확인 링크는 http 또는 https 주소를 사용하세요.');
  if (value.history !== undefined) {
    if (!Array.isArray(value.history) || value.history.length > 100) throw new Error('출판 이력은 최대 100건까지 보관합니다.');
    const recordIds = new Set();
    for (const record of value.history) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('출판 이력의 형식이 올바르지 않습니다.');
      for (const [key, limit] of Object.entries(HISTORY_TEXT)) if (record[key] !== undefined && (typeof record[key] !== 'string' || record[key].length > limit)) throw new Error('출판 이력의 내용이 올바르지 않습니다.');
      for (const [key, allowed] of Object.entries(STATUS_OPTIONS)) if (record[key] !== undefined && !Object.hasOwn(allowed, record[key])) throw new Error('출판 이력의 상태가 올바르지 않습니다.');
      if (!record.id || recordIds.has(record.id)) throw new Error('출판 이력의 식별자가 없거나 중복되었습니다.');
      recordIds.add(record.id);
      for (const field of ['submissionDate', 'approvedDate', 'depositDate']) if (record[field] && !dateValid(record[field])) throw new Error('출판 이력의 날짜가 올바르지 않습니다.');
      if (!validUrl(record.referenceUrl) || !Number.isFinite(Date.parse(record.recordedAt)) || !record.fingerprint || !['domestic', 'kdp', 'direct'].includes(record.channel)) throw new Error('출판 이력의 확인 정보가 올바르지 않습니다.');
      if (record.review !== undefined && (!record.review || typeof record.review !== 'object' || Array.isArray(record.review) || FLAGS.some(key => record.review[key] !== undefined && typeof record.review[key] !== 'boolean'))) throw new Error('판본별 검수 이력이 올바르지 않습니다.');
    }
  }
  return normalizePublication(value);
}

export function isValidISBN(value) {
  const digits = plain(value).replace(/[-\s]/g, '');
  if (!/^97[89]\d{10}$/.test(digits)) return false;
  return [...digits].reduce((sum, n, i) => sum + Number(n) * (i % 2 ? 3 : 1), 0) % 10 === 0;
}

/** An edit makes earlier human review acknowledgements stale; this is not a security hash. */
export function publicationFingerprint(project, metadata = project.publication) {
  const m = normalizePublication(metadata);
  const text = JSON.stringify([project.title, project.subtitle, project.author, project.description, project.language, project.reviewDesk, project.coverImage, project.coverBackground, project.coverDesign, project.theme, [m.channel, m.publisher, m.publicationDate, m.isbn, m.price, m.currency, m.rightsHolder, m.rightsStatement, m.aiDisclosure, m.aiTools, m.edition, m.coverWidth, m.coverHeight], project.registeredSources, project.sharedReviewSources, project.production?.brief?.sourceMarkdown, project.production?.brief?.sourceImages, getReadingChapters(project).map(c => [c.id, c.kind, c.title, c.content, c.image, c.figures])]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `v1-${(hash >>> 0).toString(16)}-${text.length}`;
}

export function publicationReadiness(project, metadata = project.publication) {
  const m = normalizePublication(metadata), chapters = getReadingChapters(project), checks = [];
  const add = (id, label, state, detail, kind = 'automatic') => checks.push({ id, label, state, detail, kind });
  add('title', '제목과 저자', plain(project.title) && plain(project.author) ? 'pass' : 'block', '책 정보에서 제목과 저자를 입력하세요. 표지·판권·판매 페이지의 표기가 일치해야 합니다.');
  add('manuscript', '비어 있는 장', chapters.length && chapters.every(c => plain(c.content)) ? 'pass' : 'block', `${chapters.filter(c => !plain(c.content)).length}개의 빈 장이 있습니다.`);
  add('description', '책 소개', plain(project.description) ? 'pass' : 'warning', '독자와 제공 가치를 설명하는 소개를 책 정보에 작성하세요.');
  add('publisher', '발행처와 출판일', m.publisher && dateValid(m.publicationDate) ? 'pass' : 'warning', '실제 사용할 발행처와 유효한 날짜를 입력하세요. 출판사명은 계약·ISBN 정보와 맞춰야 합니다.');
  add('price', '판매 정가', /^\d+(?:\.\d{1,2})?$/.test(m.price) && Number.isFinite(Number(m.price)) ? 'pass' : 'warning', '통화와 정가를 입력하세요. 0은 무료 배포를 뜻합니다.');
  add('isbn', 'ISBN 형식', !m.isbn ? 'external' : isValidISBN(m.isbn) ? 'pass' : 'block', m.isbn ? '체크 숫자만 검사합니다. 실제 발급 여부와 권리자는 발급기관에서 확인하세요.' : m.channel === 'kdp' ? 'KDP 전자책은 ISBN이 필수가 아닙니다.' : '국내 유통사의 ISBN 발급·대행 방식과 납본 담당을 확인하세요.', !m.isbn ? 'external' : 'automatic');
  const placeholders = chapters.filter(c => /\b(?:TODO|TBD)\b|\[(?:작성 예정|내용 입력|추가 필요)\]/i.test(c.content || ''));
  add('placeholders', '미완성 표시', placeholders.length ? 'warning' : 'pass', placeholders.length ? `${placeholders.length}개 장에 TODO/TBD 또는 작성 예정 표시가 있습니다.` : '알려진 미완성 표시가 발견되지 않았습니다. 내용의 완결성을 보증하지는 않습니다.');
  const badFigures = chapters.some(c => [...String(c.content || '').matchAll(/!\[[^\]]*\]\(folio-asset:([^\s)]+)\)/g)].some(match => !c.figures?.some(f => f.id === match[1])));
  const externalImages = chapters.some(c => /!\[[^\]]*\]\((?!folio-asset:)[^)]+\)/.test(c.content || ''));
  add('figures', '본문 이미지 참조', badFigures ? 'block' : externalImages ? 'warning' : 'pass', badFigures ? '본문에서 참조한 화면 이미지가 없습니다. 이미지를 다시 연결하세요.' : externalImages ? '일반 Markdown 이미지 링크는 내보내기에서 이미지로 포함되지 않을 수 있습니다. 삽화/화면 예시로 등록하고 결과물을 확인하세요.' : '화면 이미지 참조가 연결되어 있습니다.');
  let diagramErrors = 0;
  for (const c of chapters) try { diagramErrors += parseDiagramBlocks(c.content || '').filter(block => block.error).length; } catch { diagramErrors++; }
  add('diagrams', '도표 문법', diagramErrors ? 'block' : 'pass', diagramErrors ? `${diagramErrors}개 도표를 수정하세요.` : '도표 문법에서 오류를 찾지 못했습니다.');
  add('language', '유통 언어', m.channel === 'kdp' && /^ko(?:-|$)/i.test(project.language || 'ko') ? 'block' : m.channel === 'kdp' ? 'external' : 'pass', m.channel === 'kdp' ? '2026-10-20 확인한 KDP 지원 목록에 한국어는 없습니다. 지원되는 언어의 실제 원고로 준비하고 공식 목록을 확인하세요.' : '국내 한국어 전자책 유통 경로를 기준으로 준비합니다.', m.channel === 'kdp' ? 'external' : 'automatic');
  add('ai', 'AI 사용 내역', m.aiDisclosure !== 'unknown' && (m.aiDisclosure !== 'generated' || m.aiTools) ? 'pass' : 'warning', '생성한 본문·번역·표지·삽화를 포함해 사용 내역을 기록하세요. KDP는 AI 생성 콘텐츠 신고를 요구합니다.');
  const reviewed = m.reviewFingerprint === publicationFingerprint(project, m);
  add('rights', '원문·이미지 이용 권리 확인', m.rightsConfirmed && reviewed ? 'pass' : 'warning', '인용 출처, 상업 이용 허락, 인물·개인정보를 저자가 직접 확인합니다.', 'human');
  add('proofread', '최종 교정·사실 확인', m.proofreadConfirmed && reviewed ? 'pass' : 'warning', 'AI 생성 내용의 사실과 출처, 오탈자, 중복을 직접 검토합니다.', 'human');
  add('devices', '리더기·모바일 검수', m.deviceReviewConfirmed && reviewed ? 'pass' : 'warning', '실제 EPUB 리더에서 표지·목차·표·한글·글자 확대를 확인합니다.', 'human');
  add('epubcheck', 'EPUBCheck 정식 검증', 'external', '이 화면에서는 실행하지 않았습니다. 준비 ZIP의 검증 스크립트로 오류·경고 보고서를 생성하세요.', 'external');
  add('submission', '계약·ISBN·유통 심사', 'external', '계정·정산·계약·유통 심사와 납본은 선택한 기관에서 완료합니다.', 'external');
  const mapping = publicationFieldMap(project, m);
  for (const item of mapping.fields) if (item.required && !item.complete) add('field-' + item.key, item.label + ' · 경로별 필수', 'block', item.help);
  try { const spec = coverSettings(m); add('cover-file', '판매용 JPG 표지', 'external', spec.width + ' × ' + spec.height + 'px · ZIP 또는 JPG 버튼에서 현재 표지를 생성·검사합니다. ' + (m.channel === 'domestic' ? '국내 공통 의무 규격이 아니므로 제출 기관의 기준을 확인하세요.' : '시각적 품질과 제목·저자 표기를 최종 확인하세요.'), 'external'); } catch (error) { add('cover-file', '판매용 JPG 표지', 'block', error.message); }
  if (m.isbnStatus === 'issued' && !isValidISBN(m.isbn)) add('isbn-tracking', 'ISBN 발급 기록', 'block', '발급 확인 상태에는 유효한 ISBN을 입력하세요.');
  for (const [key, label] of [['submissionDate', '제출일'], ['approvedDate', '승인일'], ['depositDate', '납본 완료일']]) if (m[key] && !dateValid(m[key])) add(key, label, 'block', '실제로 확인한 날짜를 입력하세요.');
  if (!validUrl(m.referenceUrl)) add('reference-url', '진행 확인 링크', 'block', 'http 또는 https 주소를 입력하세요.');
  return { checks, blockers: checks.filter(c => c.state === 'block').length, passed: checks.filter(c => c.state === 'pass').length, total: checks.length, staleReview: FLAGS.some(k => m[k]) && !reviewed, certification: 'not-run', submitted: false };
}


/** Copy map, not a private store API schema. Domestic required fields follow Upaper colophon guidance. */
export function publicationFieldMap(project, metadata = project.publication) {
  const m = normalizePublication(metadata), domestic = m.channel === 'domestic', kdp = m.channel === 'kdp';
  const fields = [
    ['title', '도서명', project.title, true, '표지·판권·판매 페이지의 제목을 동일하게 입력하세요.'],
    ['author', '저자명', project.author, true, '표지·판권·판매 페이지의 저자 표기를 확인하세요.'],
    ['publisher', '출판사명', m.publisher, domestic, '국내 경로의 실제 발행처를 입력하세요.'],
    ['publicationDate', '전자책 출판일', m.publicationDate, domestic, '판권에 표시할 유효한 출판일을 입력하세요.'],
    ['price', '정가', m.price, domestic || kdp, '유통 경로에서 사용할 정가와 통화를 확정하세요.'],
    ['description', '책 소개', project.description, kdp, 'KDP 도서 상세정보에 사용할 소개를 입력하세요.'],
    ['language', '원고 언어', project.language || 'ko', true, '원고의 실제 언어와 지원 여부를 확인하세요.'],
    ['category', '분류', m.category, kdp, 'KDP 등록 단계에서 선택할 분류를 준비하세요.'],
    ['keywords', '검색 키워드', m.keywords, false, '서점의 입력 개수·길이에 맞춰 옮겨 입력하세요.'],
    ['isbn', 'ISBN', m.isbn, false, '국내 유통사의 발급 순서에 따르세요. KDP 전자책에는 필수가 아닙니다.'],
    ['aiDisclosure', 'AI 사용 신고', m.aiDisclosure, kdp, 'KDP 업로드 화면에서 생성/보조 구분을 직접 신고하세요.'],
  ].map(([key, label, value, required, help]) => ({ key, label, value: String(value ?? ''), required, complete: key === 'publicationDate' ? dateValid(value) : key === 'price' ? /^\d+(?:\.\d{1,2})?$/.test(value) : key === 'aiDisclosure' ? value !== 'unknown' && (value !== 'generated' || Boolean(m.aiTools)) : Boolean(plain(value)), help }));
  return { channel: m.channel, checkedAt: PUBLICATION_REVIEW_DATE, source: domestic ? PUBLICATION_LINKS.domestic : kdp ? PUBLICATION_LINKS.kdp : '', schema: 'manual-entry-map', fields };
}

/** Record only a user's declared external state, tied to one exact manuscript/metadata snapshot. */
export function recordPublicationVersion(project, metadata = project.publication, now = new Date()) {
  const m = validatePublication(normalizePublication(metadata));
  if (!m.edition) throw new Error('판본 이름을 입력하세요. 예: 초판 1.0');
  if (m.isbnStatus === 'issued' && !isValidISBN(m.isbn)) throw new Error('발급 확인 상태에는 유효한 ISBN이 필요합니다.');
  for (const field of ['submissionDate', 'approvedDate', 'depositDate']) if (m[field] && !dateValid(m[field])) throw new Error('진행 기록의 날짜를 확인하세요.');
  const fingerprint = publicationFingerprint(project, m), reviewed = m.reviewFingerprint === fingerprint;
  let sequence = m.history.length + 1;
  while (m.history.some(r => r.id === 'publication-' + now.getTime() + '-' + sequence)) sequence++;
  const record = { id: 'publication-' + now.getTime() + '-' + sequence, recordedAt: now.toISOString(), edition: m.edition, fingerprint, channel: m.channel, distributionStatus: m.distributionStatus, isbnStatus: m.isbnStatus, depositStatus: m.depositStatus, isbn: m.isbn, note: m.recordNote, referenceUrl: m.referenceUrl, workflowOwner: m.workflowOwner, editionNotes: m.editionNotes, submissionDate: m.submissionDate, approvedDate: m.approvedDate, depositDate: m.depositDate, review: Object.fromEntries(FLAGS.map(key => [key, reviewed && m[key]])) };
  return { ...m, history: [...m.history, record].slice(-100) };
}

export function copyrightMarkdown(project, metadata = project.publication) {
  const m = normalizePublication(metadata);
  return [plain(project.title), `지은이: ${plain(project.author) || '저자 입력 필요'}`, m.edition ? `판본: ${m.edition}` : '', `발행처: ${m.publisher || '발행처 입력 필요'}`, `전자책 출판일: ${m.publicationDate || '출판일 입력 필요'}`, `정가: ${m.price === '' ? '입력 필요' : `${m.price} ${m.currency}`}`, m.isbn ? `ISBN: ${m.isbn}` : '', m.rightsHolder ? `권리자: ${m.rightsHolder}` : '', m.rightsStatement, m.aiDisclosure === 'generated' ? `AI 생성 도구: ${m.aiTools || '사용 도구 입력 필요'} (저자 검토 필요)` : '', ''].filter(Boolean).join('\n\n');
}

export function preparePublicationProject(project, metadata = project.publication) {
  const output = structuredClone(project);
  output.publication = normalizePublication(metadata);
  output.chapters = (output.chapters || []).filter(c => c.kind !== 'folio-publication-colophon');
  output.chapters.push({ id: 'folio-publication-colophon', title: '판권 정보', kind: 'folio-publication-colophon', content: copyrightMarkdown(output, output.publication) });
  return output;
}

export function publicationGuide(project, metadata = project.publication) {
  const m = normalizePublication(metadata), report = publicationReadiness(project, m);
  return `# ${project.title || '전자책'} 출판 준비\n\n검토 기준일: ${PUBLICATION_REVIEW_DATE}\n\n## 지금 할 일\n\n${report.checks.filter(c => c.state !== 'pass').map(c => `- [ ] ${c.label}: ${c.detail}`).join('\n')}\n\n## 권장 절차\n\n1. 원고·인용·이미지 권리를 검토하고 최종 교정을 완료합니다.\n2. 발행처, 출판일, 정가, 소개, 키워드, AI 사용 내역을 확정합니다.\n3. EPUB·HTML과 판권 페이지를 검토합니다. 이 ZIP의 book.epub는 판권 정보가 추가된 준비용 파일입니다. 원래 원고는 변경하지 않았습니다.\n4. EPUBCheck 공식 배포본을 설치하고 아래 스크립트를 실행합니다. 검증 후 실제 리더기에서도 검사합니다.\n5. ${m.channel === 'kdp' ? 'KDP 지원 언어를 먼저 확인하고 계정·본인확인·세금·정산정보를 등록합니다. 한국어 원고는 현재 지원 목록에 없습니다. 지원 언어 원고, 표지, 메타데이터를 올리고 AI 생성 여부를 신고한 후 미리보기를 검수합니다. KDP Select 독점 조건은 별도로 판단합니다.' : m.channel === 'direct' ? '자체 배포 페이지에 판매·다운로드 방식과 이용 조건을 마련하고, 공개할 최종 파일만 업로드합니다.' : '유페이퍼 등 개인 유통 경로 또는 출판사 계약 경로를 선택합니다. 교보문고 전자책 직접 계약은 ISBN 발급이 가능한 출판사 대상이며 개인 저자는 제휴사를 통해 진행합니다. 유페이퍼의 EPUB/PDF 파일 등록 정책·판권 필수항목과 현재 수수료를 확인합니다.'}\n6. 판매용 JPG 표지의 선명도와 제출처 규격을 확인하고 도서정보를 입력한 뒤 최종 판매 신청을 직접 승인합니다. HTML 책 넘김 효과는 웹용이며 EPUB/PDF의 페이지 전환은 리더기가 정합니다.\n7. 판매 승인 후 노출·가격·미리보기를 확인하고 ISBN·납본 담당 및 처리 완료 여부를 기록합니다. 개정 시 같은 절차로 다시 검수합니다.\n\n## 자동 생성된 파일\n\n- book.epub: 판권 정보가 포함된 EPUB\n- book.html: 오프라인 책 넘김 웹북\n- print.html: PDF 인쇄용 HTML\n- manuscript.md, colophon.md: 원고 및 판권 초안\n- metadata.json: 판매 입력용 메타데이터(유통사 업로드 스키마 아님)\n- channel-metadata-map.json: 선택 경로의 필수항목 대응표\n- publication-history.json: 저자가 기록한 판본·검수·유통·ISBN·납본 상태\n- cover.jpg / cover-report.json: 브라우저에서 표지를 생성한 경우 포함하는 RGB JPEG와 픽셀·형식·용량 검사 결과\n- vivliostyle.config.json / TYPESETTING.md: 선택형 A5 PDF 전문 조판 실행 설정\n- checklist.json: Folio의 로컬 사전점검 결과. EPUBCheck 인증 또는 판매 승인 아님\n- validate-epub.ps1 / validate-epub.sh: 설치된 EPUBCheck 실행 도우미\n\n## EPUBCheck 자동 검증\n\nWindows: PowerShell에서 ./validate-epub.ps1 -EpubCheckJar 'C:/tools/epubcheck/epubcheck.jar'\n\nmacOS/Linux: sh ./validate-epub.sh /path/to/epubcheck/epubcheck.jar\n\nJava와 공식 EPUBCheck 배포본을 먼저 설치하세요. 스크립트는 다운로드·판매 신청을 하지 않습니다. 실행 후 epubcheck-report.json을 검토하세요. 경고도 확인 대상으로 처리합니다.\n\n## 판본과 진행 기록\n\n출판 준비의 판본·유통·ISBN·납본 이력에서 확인한 상태와 증빙 링크를 저장하세요. 원고·표지·판권 정보 변경은 이전 검수를 무효화합니다. 현재 판본 기록 버튼으로 해당 내용의 검수와 상태를 최근 100건까지 보존합니다. 상태는 직접 입력한 기록이며 실제 제출·발급·납본 완료를 자동 확인하지 않습니다.\n\n## 선택형 전문 조판\n\nNode.js 22.12.0 이상에서 TYPESETTING.md의 고정 버전 명령을 실행하면 print.html을 A5 PDF로 조판할 수 있습니다. 이 ZIP에는 생성된 PDF가 없으며 결과물은 별도 검수해야 합니다.\n\n${publicationHelpMarkdown(report.checks, m.channel)}\n\n## 공식 자료\n\n${Object.entries(PUBLICATION_LINKS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
}

const POWERSHELL_CHECK = `param([Parameter(Mandatory=$true)][string]$EpubCheckJar)\n$ErrorActionPreference = 'Stop'\n$jarPath = (Resolve-Path -LiteralPath $EpubCheckJar).Path\n$bookPath = Join-Path $PSScriptRoot 'book.epub'\n$reportPath = Join-Path $PSScriptRoot 'epubcheck-report.json'\n& java -jar $jarPath $bookPath --json $reportPath --failonwarnings\nif ($LASTEXITCODE -ne 0) { throw 'EPUBCheck reported errors or warnings. Review epubcheck-report.json.' }\nWrite-Output 'EPUBCheck completed. Confirm the report and inspect the book in a reader.'\n`;
const SHELL_CHECK = '#!/bin/sh\nset -eu\nif [ "$#" -ne 1 ]; then echo "Usage: sh validate-epub.sh /path/to/epubcheck.jar" >&2; exit 2; fi\ncase "$1" in /*) jar="$1" ;; *) jar="$(pwd)/$1" ;; esac\ncd -- "$(dirname -- "$0")"\njava -jar "$jar" book.epub --json epubcheck-report.json --failonwarnings\necho "EPUBCheck completed. Confirm the report and inspect the book in a reader."\n';

export async function buildPublicationPackage(project, metadata = project.publication, { preparedCover } = {}) {
  const m = normalizePublication(metadata), report = publicationReadiness(project, m);
  if (report.blockers) throw new Error(`출판 준비 점검의 필수 수정 ${report.blockers}개를 먼저 해결해 주세요.`);
  const coverReport = preparedCover ? validatePreparedCover(preparedCover, project, m) : null;
  if (coverReport) { const check = report.checks.find(c => c.id === 'cover-file'); check.state = 'pass'; check.kind = 'automatic'; check.detail = coverReport.width + ' × ' + coverReport.height + 'px RGB JPEG · ' + coverReport.bytes + 'bytes. ' + coverReport.scope; report.passed++; report.cover = coverReport; }
  const prepared = preparePublicationProject(project, m);
  const [epub, html, print] = await Promise.all([buildEpub(prepared), exportHTML(prepared), exportHTML(prepared, { interactive: false })]);
  const exportedMetadata = { title: project.title, subtitle: project.subtitle || '', author: project.author, description: project.description || '', language: project.language || 'ko', ...m };
  const entries = [['book.epub', epub], ['book.html', html], ['print.html', print], ['manuscript.md', exportMarkdown(prepared)], ['colophon.md', copyrightMarkdown(project, m)], ['metadata.json', JSON.stringify(exportedMetadata, null, 2)], ['checklist.json', JSON.stringify(report, null, 2)], ['PUBLISHING-GUIDE.md', publicationGuide(project, m)], ['validate-epub.ps1', POWERSHELL_CHECK], ['validate-epub.sh', SHELL_CHECK]];
  entries.push(['channel-metadata-map.json', JSON.stringify(publicationFieldMap(project, m), null, 2)], ['publication-history.json', JSON.stringify({ declaredByUser: true, currentFingerprint: publicationFingerprint(project, m), history: m.history }, null, 2)]);
  entries.push(['vivliostyle.config.json', JSON.stringify({ title: project.title, author: project.author, language: project.language || 'ko', entry: ['print.html'], output: 'book-print.pdf', size: 'A5', workspaceDir: '.vivliostyle' }, null, 2)], ['TYPESETTING.md', "# 선택형 A5 PDF 조판\n\nNode.js 22.12.0 이상과 npm이 필요합니다. ZIP을 풀고 이 폴더에서 실행하세요. 첫 실행에는 고정 버전의 npm 패키지와 렌더링 브라우저를 다운로드할 수 있습니다. 한글 글꼴이 없는 운영체제에는 사용 권한이 있는 한글 글꼴을 먼저 설치하세요.\n\n```sh\nnpx --yes @vivliostyle/cli@11.4.0 build --config vivliostyle.config.json\n```\n\n입력: print.html / 설정: vivliostyle.config.json / 출력: book-print.pdf. 생성 중간 파일은 .vivliostyle/에 있습니다. PDF는 이 ZIP에 미리 포함되어 있지 않습니다.\n\n## Windows에서 렌더링 브라우저가 실행되지 않을 때\n\n자동 다운로드한 브라우저에서 spawn UNKNOWN 등 실행 오류가 나면 이미 설치한 Chrome 또는 Edge 실행 파일을 지정하세요. 다음은 Chrome 설치 경로의 예이며 실제 설치 경로로 바꿉니다.\n\n```sh\nnpx --yes @vivliostyle/cli@11.4.0 build --config vivliostyle.config.json --executable-browser \"C:/Program Files/Google/Chrome/Application/chrome.exe\"\n```\n\n## 결과 검수\n\n- PDF 모든 쪽이 A5(148 × 210mm)인지 확인합니다.\n- 긴 표의 첫 행과 마지막 행, 반복 머리글, 이미지·캡션, 한글 글자와 줄바꿈을 확인합니다.\n- 장 첫머리, 마지막 문장과 긴 코드가 잘리거나 누락되지 않았는지 확인합니다.\n- 폰트와 실행 브라우저에 따라 줄바꿈·쪽수가 달라질 수 있습니다.\n\nHTML의 책 넘김은 PDF에 적용되지 않습니다. 이 설정은 일반 RGB PDF 조판이며 PDF/X·PDF/UA 인증, CMYK 인쇄 승인 또는 유통사 심사 통과를 보증하지 않습니다.\n\n공식 안내: https://docs.vivliostyle.org/en/cli/using-config-file/\nFolio 검증 절차: https://github.com/rkdghkclgns-design/folio-studio/blob/main/docs/TYPESETTING-VALIDATION.md\n"]);
  if (preparedCover) entries.push(['cover.jpg', preparedCover.bytes], ['cover-report.json', JSON.stringify(coverReport, null, 2)]);
  return { bytes: buildArchive(entries), report, files: entries.map(([name]) => name) };
}
