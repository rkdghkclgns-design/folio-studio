/** Local publishing preparation. Store submission and certification remain external steps. */
import { buildEpub, exportHTML, exportMarkdown, buildArchive } from './export.js';
import { parseDiagramBlocks } from './diagrams.js';

export const PUBLICATION_REVIEW_DATE = '2026-10-19';
export const PUBLICATION_LINKS = Object.freeze({
  domestic: 'https://help.upaper.kr/read/1021795',
  domesticFiles: 'https://help.upaper.kr/read/1021609',
  kyobo: 'https://store.kyobobook.co.kr/pod/introduce?tab=ebook_publishing',
  isbn: 'https://www.nl.go.kr/seoji/',
  epubcheck: 'https://www.w3.org/publishing/epubcheck/docs/installation/',
  kdp: 'https://kdp.amazon.com/en_US/help/topic/GHKDSCW2KQ3K4UU4',
  kdpLanguages: 'https://kdp.amazon.com/en_US/help/topic/G200673300',
  kdpAI: 'https://kdp.amazon.com/en_US/help/topic/G200672390',
  kdpISBN: 'https://kdp.amazon.com/en_US/help/topic/G7DMSKCM9DVS65TC',
});
const TEXT_FIELDS = { publisher: 200, publicationDate: 10, isbn: 40, rightsHolder: 200, rightsStatement: 3000, authorBio: 3000, keywords: 500, category: 200, price: 30, aiTools: 500, reviewFingerprint: 80 };
const FLAGS = ['rightsConfirmed', 'proofreadConfirmed', 'deviceReviewConfirmed'];
const plain = value => typeof value === 'string' ? value.trim() : '';
const dateValid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

export function normalizePublication(value = {}) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const result = { version: 1, channel: ['domestic', 'kdp', 'direct'].includes(source.channel) ? source.channel : 'domestic', currency: source.currency === 'USD' ? 'USD' : 'KRW', aiDisclosure: ['none', 'assisted', 'generated'].includes(source.aiDisclosure) ? source.aiDisclosure : 'unknown' };
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) result[field] = plain(source[field]).slice(0, limit);
  for (const field of FLAGS) result[field] = source[field] === true;
  return result;
}

export function validatePublication(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('출판 준비 정보의 형식이 올바르지 않습니다.');
  for (const [field, limit] of Object.entries(TEXT_FIELDS)) if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > limit)) throw new Error(`출판 정보 ${field}의 길이 또는 형식을 확인해 주세요.`);
  for (const field of FLAGS) if (value[field] !== undefined && typeof value[field] !== 'boolean') throw new Error('출판 확인 정보의 형식이 올바르지 않습니다.');
  for (const [field, allowed] of [['channel', ['domestic', 'kdp', 'direct']], ['currency', ['KRW', 'USD']], ['aiDisclosure', ['unknown', 'none', 'assisted', 'generated']]]) if (value[field] !== undefined && !allowed.includes(value[field])) throw new Error('지원하지 않는 출판 설정입니다.');
  return normalizePublication(value);
}

export function isValidISBN(value) {
  const digits = plain(value).replace(/[-\s]/g, '');
  if (!/^97[89]\d{10}$/.test(digits)) return false;
  return [...digits].reduce((sum, n, i) => sum + Number(n) * (i % 2 ? 3 : 1), 0) % 10 === 0;
}

/** An edit makes earlier human review acknowledgements stale; this is not a security hash. */
export function publicationFingerprint(project) {
  const text = JSON.stringify([project.title, project.subtitle, project.author, project.description, project.language, project.coverImage, project.coverBackground, project.coverDesign, project.registeredSources, project.production?.brief?.sourceMarkdown, project.production?.brief?.sourceImages, (project.chapters || []).map(c => [c.title, c.content, c.image, c.figures])]);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `v1-${(hash >>> 0).toString(16)}-${text.length}`;
}

export function publicationReadiness(project, metadata = project.publication) {
  const m = normalizePublication(metadata), chapters = project.chapters || [], checks = [];
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
  add('language', '유통 언어', m.channel === 'kdp' && /^ko(?:-|$)/i.test(project.language || 'ko') ? 'block' : m.channel === 'kdp' ? 'external' : 'pass', m.channel === 'kdp' ? '2026-10-19 확인한 KDP 지원 목록에 한국어는 없습니다. 지원되는 언어의 실제 원고로 준비하고 공식 목록을 확인하세요.' : '국내 한국어 전자책 유통 경로를 기준으로 준비합니다.', m.channel === 'kdp' ? 'external' : 'automatic');
  add('ai', 'AI 사용 내역', m.aiDisclosure !== 'unknown' && (m.aiDisclosure !== 'generated' || m.aiTools) ? 'pass' : 'warning', '생성한 본문·번역·표지·삽화를 포함해 사용 내역을 기록하세요. KDP는 AI 생성 콘텐츠 신고를 요구합니다.');
  const reviewed = m.reviewFingerprint === publicationFingerprint(project);
  add('rights', '원문·이미지 이용 권리 확인', m.rightsConfirmed && reviewed ? 'pass' : 'warning', '인용 출처, 상업 이용 허락, 인물·개인정보를 저자가 직접 확인합니다.', 'human');
  add('proofread', '최종 교정·사실 확인', m.proofreadConfirmed && reviewed ? 'pass' : 'warning', 'AI 생성 내용의 사실과 출처, 오탈자, 중복을 직접 검토합니다.', 'human');
  add('devices', '리더기·모바일 검수', m.deviceReviewConfirmed && reviewed ? 'pass' : 'warning', '실제 EPUB 리더에서 표지·목차·표·한글·글자 확대를 확인합니다.', 'human');
  add('epubcheck', 'EPUBCheck 정식 검증', 'external', '이 화면에서는 실행하지 않았습니다. 준비 ZIP의 검증 스크립트로 오류·경고 보고서를 생성하세요.', 'external');
  add('submission', '계약·ISBN·유통 심사', 'external', '계정·정산·계약·유통 심사와 납본은 선택한 기관에서 완료합니다.', 'external');
  return { checks, blockers: checks.filter(c => c.state === 'block').length, passed: checks.filter(c => c.state === 'pass').length, total: checks.length, staleReview: FLAGS.some(k => m[k]) && !reviewed, certification: 'not-run', submitted: false };
}

export function copyrightMarkdown(project, metadata = project.publication) {
  const m = normalizePublication(metadata);
  return [plain(project.title), `지은이: ${plain(project.author) || '저자 입력 필요'}`, `발행처: ${m.publisher || '발행처 입력 필요'}`, `전자책 출판일: ${m.publicationDate || '출판일 입력 필요'}`, `정가: ${m.price === '' ? '입력 필요' : `${m.price} ${m.currency}`}`, m.isbn ? `ISBN: ${m.isbn}` : '', m.rightsHolder ? `권리자: ${m.rightsHolder}` : '', m.rightsStatement, m.aiDisclosure === 'generated' ? `AI 생성 도구: ${m.aiTools || '사용 도구 입력 필요'} (저자 검토 필요)` : '', ''].filter(Boolean).join('\n\n');
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
  return `# ${project.title || '전자책'} 출판 준비\n\n검토 기준일: ${PUBLICATION_REVIEW_DATE}\n\n## 지금 할 일\n\n${report.checks.filter(c => c.state !== 'pass').map(c => `- [ ] ${c.label}: ${c.detail}`).join('\n')}\n\n## 권장 절차\n\n1. 원고·인용·이미지 권리를 검토하고 최종 교정을 완료합니다.\n2. 발행처, 출판일, 정가, 소개, 키워드, AI 사용 내역을 확정합니다.\n3. EPUB·HTML과 판권 페이지를 검토합니다. 이 ZIP의 book.epub는 판권 정보가 추가된 준비용 파일입니다. 원래 원고는 변경하지 않았습니다.\n4. EPUBCheck 공식 배포본을 설치하고 아래 스크립트를 실행합니다. 검증 후 실제 리더기에서도 검사합니다.\n5. ${m.channel === 'kdp' ? 'KDP 지원 언어를 먼저 확인하고 계정·본인확인·세금·정산정보를 등록합니다. 한국어 원고는 현재 지원 목록에 없습니다. 지원 언어 원고, 표지, 메타데이터를 올리고 AI 생성 여부를 신고한 후 미리보기를 검수합니다. KDP Select 독점 조건은 별도로 판단합니다.' : m.channel === 'direct' ? '자체 배포 페이지에 판매·다운로드 방식과 이용 조건을 마련하고, 공개할 최종 파일만 업로드합니다.' : '유페이퍼 등 개인 유통 경로 또는 출판사 계약 경로를 선택합니다. 교보문고 전자책 직접 계약은 ISBN 발급이 가능한 출판사 대상이며 개인 저자는 제휴사를 통해 진행합니다. 유페이퍼의 EPUB/PDF 파일 등록 정책·판권 필수항목과 현재 수수료를 확인합니다.'}\n6. 유통사 요구에 맞는 별도 표지 파일과 도서정보를 입력하고 최종 판매 신청을 직접 승인합니다. HTML 책 넘김 효과는 웹용이며 EPUB/PDF의 페이지 전환은 리더기가 정합니다.\n7. 판매 승인 후 노출·가격·미리보기를 확인하고 ISBN·납본 담당 및 처리 완료 여부를 기록합니다. 개정 시 같은 절차로 다시 검수합니다.\n\n## 자동 생성된 파일\n\n- book.epub: 판권 정보가 포함된 EPUB\n- book.html: 오프라인 책 넘김 웹북\n- print.html: PDF 인쇄용 HTML\n- manuscript.md, colophon.md: 원고 및 판권 초안\n- metadata.json: 판매 입력용 메타데이터(유통사 업로드 스키마 아님)\n- checklist.json: Folio의 로컬 사전점검 결과. EPUBCheck 인증 또는 판매 승인 아님\n- validate-epub.ps1 / validate-epub.sh: 설치된 EPUBCheck 실행 도우미\n\n## EPUBCheck 자동 검증\n\nWindows: PowerShell에서 ./validate-epub.ps1 -EpubCheckJar 'C:/tools/epubcheck/epubcheck.jar'\n\nmacOS/Linux: sh ./validate-epub.sh /path/to/epubcheck/epubcheck.jar\n\nJava와 공식 EPUBCheck 배포본을 먼저 설치하세요. 스크립트는 다운로드·판매 신청을 하지 않습니다. 실행 후 epubcheck-report.json을 검토하세요. 경고도 확인 대상으로 처리합니다.\n\n## 공식 자료\n\n${Object.entries(PUBLICATION_LINKS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
}

const POWERSHELL_CHECK = `param([Parameter(Mandatory=$true)][string]$EpubCheckJar)\n$ErrorActionPreference = 'Stop'\n$jarPath = (Resolve-Path -LiteralPath $EpubCheckJar).Path\n$bookPath = Join-Path $PSScriptRoot 'book.epub'\n$reportPath = Join-Path $PSScriptRoot 'epubcheck-report.json'\n& java -jar $jarPath $bookPath --json $reportPath --failonwarnings\nif ($LASTEXITCODE -ne 0) { throw 'EPUBCheck reported errors or warnings. Review epubcheck-report.json.' }\nWrite-Output 'EPUBCheck completed. Confirm the report and inspect the book in a reader.'\n`;
const SHELL_CHECK = '#!/bin/sh\nset -eu\nif [ "$#" -ne 1 ]; then echo "Usage: sh validate-epub.sh /path/to/epubcheck.jar" >&2; exit 2; fi\ncase "$1" in /*) jar="$1" ;; *) jar="$(pwd)/$1" ;; esac\ncd -- "$(dirname -- "$0")"\njava -jar "$jar" book.epub --json epubcheck-report.json --failonwarnings\necho "EPUBCheck completed. Confirm the report and inspect the book in a reader."\n';

export async function buildPublicationPackage(project, metadata = project.publication) {
  const m = normalizePublication(metadata), report = publicationReadiness(project, m);
  if (report.blockers) throw new Error(`출판 준비 점검의 필수 수정 ${report.blockers}개를 먼저 해결해 주세요.`);
  const prepared = preparePublicationProject(project, m);
  const [epub, html, print] = await Promise.all([buildEpub(prepared), exportHTML(prepared), exportHTML(prepared, { interactive: false })]);
  const exportedMetadata = { title: project.title, subtitle: project.subtitle || '', author: project.author, description: project.description || '', language: project.language || 'ko', ...m };
  const entries = [['book.epub', epub], ['book.html', html], ['print.html', print], ['manuscript.md', exportMarkdown(prepared)], ['colophon.md', copyrightMarkdown(project, m)], ['metadata.json', JSON.stringify(exportedMetadata, null, 2)], ['checklist.json', JSON.stringify(report, null, 2)], ['PUBLISHING-GUIDE.md', publicationGuide(project, m)], ['validate-epub.ps1', POWERSHELL_CHECK], ['validate-epub.sh', SHELL_CHECK]];
  return { bytes: buildArchive(entries), report, files: entries.map(([name]) => name) };
}
