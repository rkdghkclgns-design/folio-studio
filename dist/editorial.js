import {countableDiagramText} from './diagrams.js';
/** Local, explainable editorial tools. No network calls or model claims. */

const COPY_RULES = [
  { re: /(?<![\p{L}\p{N}_])안되요(?![\p{L}\p{N}_])/gu, to: '안 돼요', reason: '‘되어요’의 준말은 ‘돼요’이며, 부정 부사 ‘안’은 띄어 씁니다.' },
  { re: /(?<![\p{L}\p{N}_])되요(?![\p{L}\p{N}_])/gu, to: '돼요', reason: '‘되어요’의 준말은 ‘돼요’입니다.' },
  { re: /(?<![\p{L}\p{N}_])됬(?=(?:다|어요|습니다|는데|네요|네|냐|죠|지|고|던|으면|을)?(?:$|[^\p{L}\p{N}_]))/gu, to: '됐', reason: '‘되었’의 준말은 ‘됐’입니다.' },
  { re: /(?<![\p{L}\p{N}_])몇일(?=(?:은|는|이|가|을|를|의|도|만|에|이나|동안|째|간)?(?:$|[^\p{L}\p{N}_]))/gu, to: '며칠', reason: '날짜나 날의 수를 나타낼 때는 ‘며칠’로 씁니다.' },
  { re: /(?<![\p{L}\p{N}_])왠만(?=(?:한|하면|하다|해|해서|큼|하니|하게|하네요|하지)?(?:$|[^\p{L}\p{N}_]))/gu, to: '웬만', reason: '표준 표기는 ‘웬만’입니다.' },
  { re: /(?<![\p{L}\p{N}_])어의없(?=(?:다|어요|는|게|고|어서|네요|었다)?(?:$|[^\p{L}\p{N}_]))/gu, to: '어이없', reason: '뜻밖이거나 기막힌 상황을 가리킬 때는 ‘어이없다’로 씁니다.' },
  { re: /(?<![\p{L}\p{N}_])(할|갈|볼|줄|쓸|살|먹을|읽을|기다릴)께(?=요?(?:$|[^\p{L}\p{N}_]))/gu, to: '$1게', reason: '약속을 나타내는 종결 어미는 ‘-ㄹ게’로 씁니다.' },
  { re: /(?<![\p{L}\p{N}_])뿐만아니라(?![\p{L}\p{N}_])/gu, to: '뿐만 아니라', reason: '‘아니라’ 앞을 띄어 씁니다.' },
  { re: /(?<![\p{L}\p{N}_])(할|갈|볼|올|줄|쓸|살|알|될|먹을|읽을)수[ \t]*(있|없)/gu, to: '$1 수 $2', reason: '의존 명사 ‘수’는 앞말과 띄어 씁니다.' },
  { re: /(?<![\p{L}\p{N}_])(할|갈|볼|올|줄|쓸|살|알|될|먹을|읽을) 수(있|없)/gu, to: '$1 수 $2', reason: '의존 명사 ‘수’ 뒤의 ‘있다·없다’를 띄어 씁니다.' },
  { re: /([가-힣A-Za-z」』”’)]) +([,.!?;:])/g, to: '$1$2', reason: '문장 부호는 앞말에 붙여 씁니다.' },
  { re: /([가-힣])([,;])(?=[가-힣A-Za-z])/g, to: '$1$2 ', reason: '쉼표와 쌍반점 뒤에 한 칸을 둡니다.' },
  { re: /([^\s]) {2,}(?=[^\s])/g, to: '$1 ', reason: '문장 안에 겹쳐 입력된 공백을 정리합니다.' },
];

function asText(value) { return typeof value === 'string' ? value : ''; }
function uniqueId(prefix, index) { return `${prefix}-${index + 1}`; }
function charCount(text) { return Array.from(countableDiagramText(asText(text)).replace(/\s/g, '')).length; }
function normalizedHeading(text) { return asText(text).replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim().normalize('NFC'); }

function fenceStart(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
  if (!match || (match[1][0] === '`' && match[2].includes('`'))) return null;
  return { marker: match[1][0], length: match[1].length };
}
function fenceEnd(line, fence) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
}

/** Source ranges whose exact spelling or layout can carry meaning. */
function protectedRanges(source) {
  const ranges = [];
  const add = (start, end) => { if (end > start) ranges.push({ start, end }); };
  let fence = null;
  let fenceOffset = 0;
  for (const match of source.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    if (!match[0]) continue;
    const line = match[0].replace(/(?:\r\n|\r|\n)$/, '');
    if (fence) {
      if (fenceEnd(line, fence)) { add(fenceOffset, match.index + match[0].length); fence = null; }
      continue;
    }
    const opening = fenceStart(line);
    if (opening) { fence = opening; fenceOffset = match.index; continue; }
    if (/^(?: {4}|\t| {0,3}>)/.test(line) || line.includes('\t') || /^\s*\|.*\|\s*$/.test(line) || /^\s*(?:[-?]\s+)?[\p{L}\p{N}_$.-]+:[ \t]+/u.test(line) || /^\s*(?:(?:const|let|var|function|class|def|import|from|return|SELECT|INSERT|UPDATE|DELETE|CREATE)\b|[\p{L}_$][\p{L}\p{N}_$.[\]]*\s*=(?!=))/u.test(line)) add(match.index, match.index + match[0].length);
  }
  if (fence) add(fenceOffset, source.length);
  const inline = [
    /<(pre|code|script|style)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi,
    /<[^>\n]+>/g,
    /\b(?:[a-z][a-z\d+.-]*:\/\/|mailto:|tel:|www\.)[^\s<>"'“”‘’]+/gi,
    /!?\[[^\]\n]*\]\([^\n]*?\)/g,
  ];
  for (const re of inline) for (const match of source.matchAll(re)) add(match.index, match.index + match[0].length);
  for (const match of source.matchAll(/[^\s<>()[\]{}"'“”‘’]+/g)) {
    if (match[0].includes('@') && /@[^@]+\.[^@]+/.test(match[0])) add(match.index, match.index + match[0].length);
  }
  for (const match of source.matchAll(/[\p{L}\p{N}_$.]+/gu)) {
    if ((/[A-Za-z_$]/.test(match[0]) && /[가-힣]/.test(match[0])) || /[\p{L}_$]\.[\p{L}\p{N}_$]/u.test(match[0])) add(match.index, match.index + match[0].length);
  }
  // Backtick spans close only with the same run length, including multi-line spans.
  const ticks = [...source.matchAll(/`+/g)];
  const nextSame = new Map();
  const closes = Array(ticks.length).fill(-1);
  for (let i = ticks.length - 1; i >= 0; i--) {
    closes[i] = nextSame.get(ticks[i][0].length) ?? -1;
    nextSame.set(ticks[i][0].length, i);
  }
  for (let i = 0; i < ticks.length; i++) {
    const opening = ticks[i];
    if (closes[i] >= 0) {
      const closing = ticks[closes[i]];
      add(opening.index, closing.index + closing[0].length);
      i = closes[i];
    } else {
      const lineEnd = source.indexOf('\n', opening.index);
      const end = lineEnd < 0 ? source.length : lineEnd;
      add(opening.index, end);
      while (i + 1 < ticks.length && ticks[i + 1].index < end) i++;
    }
  }
  const quotePairs = { '"': '"', "'": "'", '“': '”', '‘': '’', '「': '」', '『': '』', '《': '》', '〈': '〉' };
  const quotes = /["'“‘「『《〈]/g;
  let quote;
  while ((quote = quotes.exec(source))) {
    const opening = quote[0];
    if ((opening === "'" || opening === '"') && /[\p{L}\p{N}]/u.test(source[quote.index - 1] || '')) continue;
    let end = source.indexOf(quotePairs[opening], quote.index + 1);
    while (end >= 0 && source[end - 1] === '\\') end = source.indexOf(quotePairs[opening], end + 1);
    if (end < 0) { end = source.indexOf('\n', quote.index); if (end < 0) end = source.length; }
    else end++;
    add(quote.index, end);
    quotes.lastIndex = end;
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function proseSpans(source) {
  const spans = [];
  let start = 0;
  for (const range of protectedRanges(source)) {
    if (start < range.start) spans.push({ start, end: range.start });
    start = range.end;
  }
  if (start < source.length) spans.push({ start, end: source.length });
  return spans;
}

function ruleCandidates(source, rules, spans = proseSpans(source)) {
  const edits = [];
  for (const span of spans) {
    const text = source.slice(span.start, span.end);
    for (const { re, to, reason } of rules) {
      for (const match of text.matchAll(re)) {
        const start = span.start + match.index;
        const end = start + match[0].length;
        const after = to.replace(/\$(\d+)/g, (_, n) => match[Number(n)] ?? '');
        if (match[0] === after) continue;
        edits.push({ before: match[0], after, reason, start, end });
      }
    }
  }
  edits.sort((a, b) => a.start - b.start);
  const nonoverlapping = [];
  for (const edit of edits) if (!nonoverlapping.length || edit.start >= nonoverlapping.at(-1).end) nonoverlapping.push(edit);
  return nonoverlapping;
}

/** Keeps quotations, code, links and ambiguous words intact. */
export function localCopyedit(input) {
  let text = asText(input);
  const changes = [];
  // A follow-up pass can see punctuation exposed by an earlier spacing correction.
  for (let pass = 0; pass < COPY_RULES.length; pass++) {
    const edits = ruleCandidates(text, COPY_RULES);
    if (!edits.length) break;
    for (const { before, after, reason } of edits) changes.push({ before, after, reason });
    const pieces = [];
    let cursor = 0;
    for (const edit of edits) { pieces.push(text.slice(cursor, edit.start), edit.after); cursor = edit.end; }
    pieces.push(text.slice(cursor));
    text = pieces.join('');
  }
  return { text, changes };
}

const STYLE_RULES = [
  { re: /미리 사전에/g, to: '미리', reason: '‘미리’와 ‘사전에’의 뜻이 겹칩니다. 강조가 필요하지 않다면 하나만 남겨 보세요.' },
  { re: /다시 재차/g, to: '다시', reason: '같은 뜻의 표현이 겹칩니다. 문맥에 맞으면 간결하게 정리할 수 있습니다.' },
  { re: /서로 상호/g, to: '서로', reason: '‘서로’와 ‘상호’가 같은 의미를 나타냅니다. 의도한 강조인지 확인해 보세요.' },
  { re: /(?<![\p{L}\p{N}_])금새(?![\p{L}\p{N}_])/gu, to: '금세', reason: '‘지금 바로’라는 뜻이라면 ‘금세’로 씁니다. ‘물건의 값’이라는 뜻의 ‘금새’나 이름은 원문을 유지하세요.' },
  { re: /(?<![\p{L}\p{N}_])웬지(?![\p{L}\p{N}_])/gu, to: '왠지', reason: '‘왜인지’라는 뜻이라면 ‘왠지’로 씁니다. 사람이나 장소의 이름이라면 원문을 유지하세요.' },
];

/** Only the exact source occurrence reviewed by the author may be replaced. */
export function applyEditorialSuggestion(input, suggestion) {
  const source = asText(input);
  if (!suggestion || !Number.isInteger(suggestion.start) || !Number.isInteger(suggestion.end) || suggestion.start < 0 || suggestion.end <= suggestion.start || suggestion.end > source.length || typeof suggestion.before !== 'string' || typeof suggestion.after !== 'string' || source.slice(suggestion.start, suggestion.end) !== suggestion.before) throw new Error('원고가 바뀌어 이 제안을 적용할 수 없습니다. 다시 점검해 주세요.');
  if (protectedRanges(source).some(range => suggestion.start < range.end && suggestion.end > range.start)) throw new Error('인용문·코드·주소가 포함된 부분은 자동으로 수정하지 않습니다. 원문을 확인해 주세요.');
  return source.slice(0, suggestion.start) + suggestion.after + source.slice(suggestion.end);
}

/** A mechanical checklist; its percentage does not assess literary or factual quality. */
export function analyzeProject(project = {}) {
  project = project && typeof project === 'object' ? project : {};
  const chapters = Array.isArray(project.chapters) ? project.chapters.filter(chapter => chapter && typeof chapter === 'object') : [];
  const totalChars = chapters.reduce((sum, chapter) => sum + charCount(chapter.content), 0);
  const suggestions = [];
  const addSuggestion = (chapter, edit, kind) => {
    if (suggestions.length >= 30 || edit.before === edit.after) return;
    if (suggestions.some(item => item.chapterId === chapter.id && edit.start < item.end && edit.end > item.start)) return;
    suggestions.push({ id: `suggestion-${suggestions.length + 1}`, chapterId: chapter.id, ...edit, kind });
  };
  let correctionCount = 0;
  let longParagraphCount = 0;
  let incompleteChapterCount = 0;
  const headingCounts = new Map();
  for (const chapter of chapters) {
    const content = asText(chapter.content);
    const spans = proseSpans(content);
    const corrections = ruleCandidates(content, COPY_RULES, spans);
    correctionCount += corrections.length;
    for (const edit of corrections) addSuggestion(chapter, edit, '교정');
    for (const edit of ruleCandidates(content, STYLE_RULES, spans)) addSuggestion(chapter, edit, '윤문');
    for (const match of content.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g)) {
      const paragraph = match[0];
      if (charCount(paragraph) <= 650) continue;
      // Keep quoted material, technical examples and markup out of layout suggestions.
      if (!spans.some(span => span.start <= match.index && span.end >= match.index + paragraph.length)) continue;
      longParagraphCount++;
      const sentenceEnd = /[.!?。！？][”’」』)]?\s+/g;
      let chosen = null;
      for (const boundary of paragraph.matchAll(sentenceEnd)) {
        const position = boundary.index + boundary[0].trimEnd().length;
        if (position >= paragraph.length * 0.3 && position <= paragraph.length * 0.7) { chosen = { position, end: boundary.index + boundary[0].length }; break; }
      }
      if (chosen) addSuggestion(chapter, { before: paragraph, after: `${paragraph.slice(0, chosen.position)}\n\n${paragraph.slice(chosen.end)}`, start: match.index, end: match.index + paragraph.length, reason: '한 문단이 650자를 넘습니다. 문장의 경계에서 나누면 작은 화면에서 읽기 편해집니다. 논리의 흐름을 확인하고 적용하세요.' }, '구성');
    }
    if (!asText(chapter.title).trim() || charCount(content) < 120) incompleteChapterCount++;
    const heading = normalizedHeading(chapter.title);
    if (heading) headingCounts.set(heading, (headingCounts.get(heading) || 0) + 1);
  }
  const duplicateTitles = [...headingCounts].filter(([, count]) => count > 1).map(([title]) => title);
  const images = [...(project.coverImage ? [project.coverImage] : []), ...chapters.flatMap(chapter => chapter.image ? [chapter.image] : [])];
  const missingAlt = images.filter(img => !asText(img?.alt).trim()).length;
  const checks = [
    { id: 'title', label: '책 제목', status: asText(project.title).trim() ? 'pass' : 'warn', detail: asText(project.title).trim() ? '책 제목이 입력되어 있습니다.' : '독자가 기억할 수 있는 책 제목을 입력해 주세요.' },
    { id: 'author', label: '저자 정보', status: asText(project.author).trim() && asText(project.author).trim() !== '나의 이름' ? 'pass' : 'warn', detail: asText(project.author).trim() && asText(project.author).trim() !== '나의 이름' ? '저자명이 입력되어 있습니다.' : '출간할 때 사용할 저자명 또는 필명을 입력해 주세요.' },
    { id: 'description', label: '책 소개', status: charCount(project.description) >= 40 ? 'pass' : 'warn', detail: charCount(project.description) >= 40 ? '책 소개가 준비되어 있습니다. 독자와 책의 약속이 잘 드러나는지 확인해 주세요.' : '책의 독자와 읽고 나서 얻을 것을 담은 소개를 40자 이상 적어 주세요.' },
    { id: 'structure', label: '목차 구성', status: chapters.length >= 3 ? 'pass' : 'warn', detail: chapters.length >= 3 ? `${chapters.length}개의 장으로 구성되어 있습니다. 각 장의 순서와 연결을 마지막으로 살펴보세요.` : '현재 3장 미만입니다. 짧은 책이라면 그대로 출간할 수 있으며, 의도한 구성이 맞는지 확인해 주세요.' },
    { id: 'completeness', label: '원고 채움', status: chapters.length > 0 && incompleteChapterCount === 0 ? 'pass' : 'warn', detail: chapters.length === 0 ? '원고를 작성하거나 파일을 가져와 첫 장을 만들어 주세요.' : incompleteChapterCount ? `${incompleteChapterCount}개 장에 제목이 없거나 본문이 120자 미만입니다. 짧은 장이 의도된 것인지 확인해 주세요.` : '모든 장에 제목과 120자 이상의 본문이 있습니다.' },
    { id: 'paragraphs', label: '문단의 호흡', status: totalChars && longParagraphCount === 0 ? 'pass' : 'warn', detail: !totalChars ? '본문을 입력하면 일반 문장의 문단 길이를 점검합니다.' : longParagraphCount ? `650자를 넘는 일반 문단이 ${longParagraphCount}개 있습니다. 모바일 화면의 읽기 흐름을 확인해 주세요.` : '점검 가능한 일반 문단에서 650자를 넘는 긴 문단을 찾지 못했습니다. 인용문·코드·링크가 포함된 문단은 직접 확인해 주세요.' },
    { id: 'headings', label: '제목 중복', status: chapters.length && !duplicateTitles.length ? 'pass' : 'warn', detail: !chapters.length ? '장을 추가하면 제목 중복을 점검합니다.' : duplicateTitles.length ? `중복된 장 제목: ${duplicateTitles.slice(0, 3).join(', ')}. 의도한 반복인지 확인해 주세요.` : '중복된 장 제목을 찾지 못했습니다.' },
    { id: 'copy', label: '기본 표기', status: totalChars && !correctionCount ? 'pass' : 'warn', detail: !totalChars ? '본문을 입력하면 기본 표기를 점검합니다.' : correctionCount ? `${correctionCount}건의 표기·공백 수정 후보를 찾았습니다. 문맥을 확인하고 적용해 주세요.` : '지원하는 기본 표기 규칙에서 수정 후보를 찾지 못했습니다. 인용문·코드·주소는 검사하지 않으며 전체 맞춤법 검사를 대신하지는 않습니다.' },
    { id: 'accessibility', label: '삽화 접근성', status: missingAlt ? 'warn' : 'pass', detail: missingAlt ? `${missingAlt}개 이미지에 대체 텍스트가 없습니다. 그림의 의미를 짧게 설명해 주세요.` : images.length ? `${images.length}개 이미지에 대체 텍스트가 있습니다.` : '이미지가 없는 원고입니다. 삽화를 추가하면 대체 텍스트도 함께 작성해 주세요.' },
  ];
  const passed = checks.filter(check => check.status === 'pass').length;
  const score = totalChars ? Math.round(passed / checks.length * 100) : 0;
  const label = score === 100 ? '기본 점검 완료' : score >= 75 ? '마지막 다듬기' : score >= 45 ? '원고를 다듬는 중' : '책의 기초 만들기';
  return { score, label, checks, suggestions, totalChars, readingMinutes: totalChars ? Math.max(1, Math.ceil(totalChars / 500)) : 0 };
}

/** Split plain text or Markdown while preserving code and literal title characters. */
export function splitManuscript(input, bookTitle = '') {
  const text = asText(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (!text.trim()) return [];
  const chapters = [];
  let title = '';
  let lines = [];
  let fence = null;
  let skippedBookTitle = '';
  const trimBlankLines = content => content.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '');
  const flush = () => {
    const content = trimBlankLines(lines.join('\n'));
    if (!title && !content.trim()) return;
    chapters.push({ id: uniqueId('chapter', chapters.length), title: title || (chapters.length ? `제${chapters.length + 1}장` : '들어가는 글'), content });
    lines = [];
    title = '';
  };
  for (const line of text.split('\n')) {
    if (fence) { lines.push(line); if (fenceEnd(line, fence)) fence = null; continue; }
    const opening = fenceStart(line);
    if (opening) { fence = opening; lines.push(line); continue; }
    const markdown = line.match(/^ {0,3}#{1,6}(?:[ \t]+(.*)|[ \t]*)$/);
    const korean = line.match(/^ {0,3}(?:제\s*)?(\d{1,3})\s*장(?:\s*[.:：\-–—]\s*|\s+|$)(.*?)\s*$/);
    const english = line.match(/^ {0,3}chapter\s+(\d{1,3})(?:\s*[.:：\-–—]\s*|\s+|$)(.*?)\s*$/i);
    // An optional closing hash sequence requires a preceding space (C# is a title).
    const mdTitle = markdown ? (markdown[1] || '').replace(/(?:^|[ \t]+)#+[ \t]*$/, '').trim() : '';
    const heading = markdown && mdTitle ? mdTitle : korean ? `제${Number(korean[1])}장${korean[2] ? ` ${korean[2]}` : ''}` : english ? `Chapter ${Number(english[1])}${english[2] ? ` ${english[2]}` : ''}` : null;
    if (heading !== null) {
      if (!skippedBookTitle && chapters.length === 0 && !title && !lines.join('').trim() && normalizedHeading(heading) === normalizedHeading(bookTitle) && asText(bookTitle).trim()) { skippedBookTitle = heading; continue; }
      const pending = Boolean(title || lines.join('').trim());
      if (chapters.length + (pending ? 1 : 0) >= 1000) { lines.push(line); continue; }
      flush();
      title = heading;
    } else lines.push(line);
  }
  flush();
  if (!chapters.length && skippedBookTitle) chapters.push({ id: uniqueId('chapter', 0), title: skippedBookTitle, content: '' });
  if (chapters.length === 1 && chapters[0].title === '들어가는 글') chapters[0].title = asText(bookTitle).trim() || '첫 번째 장';
  return chapters;
}

const PALETTES = {
  sage: ['#F4F2E8', '#DDE3CF', '#60765F', '#344F43', '#C5A774'],
  sand: ['#F4EDE0', '#E4D3B8', '#A48B67', '#5E594D', '#B57252'],
  terracotta: ['#F5EDE5', '#EBCBB9', '#AD6C50', '#744D42', '#C8AA76'],
  ocean: ['#EDF2F1', '#C9DEDE', '#528489', '#2E515B', '#C9A77F'],
  ink: ['#F3F0E8', '#D8DAD8', '#798583', '#283D40', '#B7A277'],
  lavender: ['#F3F0F5', '#E0D7E7', '#94829E', '#5A526C', '#BFA780'],
};

function seedNumber(seed) {
  let value = 2166136261;
  for (const ch of String(seed ?? 'folio')) { value ^= ch.codePointAt(0); value = Math.imul(value, 16777619); }
  return value >>> 0;
}

/** An original, deterministic SVG drawing; no external assets or raster data. */
export function generateIllustrationSVG(theme = 'sage', seed = 'folio', kind = 'botanical') {
  const [paper, pale, leaf, ink, accent] = PALETTES[theme] || PALETTES.sage;
  const hash = seedNumber(seed);
  const offset = hash % 75 - 37;
  const lean = hash % 16 - 8;
  const identifier = `folio-${hash.toString(36)}`;
  const leafPair = (x, y, rotation, size = 1) => `<g transform="translate(${x} ${y}) rotate(${rotation}) scale(${size})"><path d="M0 0 C-70-4-104-42-101-85 C-48-86-2-45 0 0Z" fill="${leaf}"/><path d="M0 0 C57-7 99-43 95-81 C45-79 2-38 0 0Z" fill="${pale}" stroke="${leaf}" stroke-width="2"/><path d="M-2-2-78-67M2-2 75-63" fill="none" stroke="${paper}" stroke-opacity=".42" stroke-width="1.6"/></g>`;
  let drawing;
  if (kind === 'landscape') {
    drawing = `<circle cx="${690 + offset}" cy="240" r="93" fill="${accent}" opacity=".76"/><path d="M84 482Q275 211 489 432T916 394V616H84Z" fill="${pale}"/><path d="M84 531Q334 370 561 496T916 435V616H84Z" fill="${leaf}" opacity=".66"/><path d="M84 576Q292 460 544 562T916 520V616H84Z" fill="${ink}"/><path d="M518 616Q426 548 527 492T583 424" fill="none" stroke="${paper}" stroke-opacity=".65" stroke-width="6"/><path d="M158 186h110m-55 15h122" stroke="${leaf}" stroke-opacity=".3" stroke-width="2"/>`;
  } else if (kind === 'abstract' || kind === 'geometric') {
    drawing = `<path d="M${290 + offset} 530V310a170 170 0 0 1 340 0v220Z" fill="${pale}"/><path d="M365 530V333a100 100 0 0 1 200 0v197" fill="none" stroke="${leaf}" stroke-width="2"/><circle cx="${650 + offset}" cy="257" r="83" fill="${accent}" opacity=".8"/><path d="M210 530h570v42H210Z" fill="${ink}"/><path d="M260 572h470v19H260Z" fill="${leaf}" opacity=".46"/><path d="M200 410q65-108 115 0t98 0" fill="none" stroke="${leaf}" stroke-width="3"/>`;
  } else {
    drawing = `<circle cx="${544 + offset}" cy="322" r="205" fill="${pale}" opacity=".7"/><circle cx="${699 + offset}" cy="195" r="54" fill="${accent}" opacity=".65"/><path d="M193 581Q500 544 800 581" fill="none" stroke="${leaf}" stroke-opacity=".22" stroke-width="2"/><g transform="translate(${offset} 0) rotate(${lean} 500 540)"><path d="M490 574Q510 420 480 172" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>${leafPair(493, 482, -10, 1.05)}${leafPair(493, 391, 9, .95)}${leafPair(489, 303, -9, .78)}${leafPair(484, 227, 6, .57)}<path d="M480 182Q435 142 467 109Q501 131 480 182Z" fill="${leaf}"/></g><path d="M643 572Q645 479 696 414" fill="none" stroke="${ink}" stroke-width="2"/><path d="M665 496Q616 486 622 449Q665 451 665 496ZM682 454Q721 452 729 420Q689 419 682 454Z" fill="${leaf}" opacity=".7"/><circle cx="251" cy="243" r="5" fill="${accent}"/><circle cx="271" cy="228" r="2.5" fill="${accent}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="700" viewBox="0 0 1000 700" role="img" aria-labelledby="${identifier}-title ${identifier}-desc"><title id="${identifier}-title">고요한 사색을 위한 ${kind === 'landscape' ? '풍경' : kind === 'abstract' || kind === 'geometric' ? '추상' : '식물'} 삽화</title><desc id="${identifier}-desc">따뜻한 종이 색 바탕에 절제된 색과 유기적인 선으로 그린 독창적인 편집 삽화.</desc><rect width="1000" height="700" fill="${paper}"/><rect x="35" y="35" width="930" height="630" rx="2" fill="none" stroke="${leaf}" stroke-opacity=".14"/>${drawing}<path d="M461 632h78" stroke="${leaf}" stroke-opacity=".3" stroke-width="1"/></svg>`;
}

function svgImage(theme, seed, kind, alt, caption) {
  return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generateIllustrationSVG(theme, seed, kind))}`, alt, caption };
}

export function sampleProject() {
  return {
    id: 'folio-sample',
    title: '느리게, 단단하게',
    subtitle: '나만의 속도로 삶을 가꾸는 연습',
    author: '나의 이름',
    description: '늘 한발 늦은 것 같아 마음이 조급해지는 사람에게 건네는 여섯 편의 에세이. 비워 둔 시간, 작고 다정한 습관, 적절한 마음의 경계를 통해 자기 삶의 속도를 찾아갑니다. 더 많은 일을 해내기보다, 오늘의 나를 오래 지탱할 방식을 함께 생각합니다.',
    language: 'ko',
    theme: 'sage',
    chapters: [
      {
        id: 'chapter-1', title: '나만의 속도를 찾는 일', kind: 'essay',
        content: `한동안 아침은 늘 뒤처졌다는 느낌으로 시작됐다. 눈을 뜨자마자 휴대전화를 집어 들면 누군가는 새 일을 시작했고, 누군가는 먼 곳으로 떠났으며, 누군가는 내가 아직 결심조차 하지 못한 일을 끝내고 있었다. 창밖의 나무에는 어제와 비슷한 빛이 걸려 있었지만, 화면 속에서는 세상이 밤사이 몇 계절을 앞서간 것 같았다.

어느 날 출근길에 한 정거장을 걸었다. 거창한 결심이 있었던 것은 아니다. 버스를 놓쳤고, 다음 차를 기다리는 시간이 아까웠다. 늘 차창 너머로 지나치던 빵집 앞에서 따뜻한 냄새가 났다. 담벼락의 작은 틈에는 이름 모를 풀이 자라고 있었다. 내가 느려진 동안에도 도시는 멈추지 않았다. 다만 그동안 보이지 않던 것이 보이기 시작했다.

빠르게 사는 일이 잘못은 아니다. 집중해서 앞으로 나아가야 하는 때가 있고, 기회를 잡기 위해 서둘러야 하는 순간도 있다. 문제는 속도를 선택하는 사람이 누구냐는 데 있었다. 나는 오랫동안 다른 사람의 소식을 내 시간표로 착각했다. 그들의 다음 장을 보고, 내가 쓰고 있는 문장을 서둘러 끝내려 했다.

그래서 하루의 끝에 질문 하나를 남기기로 했다. 오늘 얼마나 많이 했느냐 대신, 오늘 무엇이 내게 남았느냐고. 어떤 날에는 정성껏 답한 짧은 편지가 남았고, 어떤 날에는 끝내 해결하지 못한 문제 앞에서 배운 한계가 남았다. 기록할 것이 별로 없는 날도 있었다. 그런 날까지 빈칸 그대로 받아들이자 하루를 재판하는 시간이 조금 줄었다.

나만의 속도는 한 번 정하면 끝나는 규칙이 아니었다. 몸이 지친 날과 마음이 환한 날의 걸음이 다르듯, 삶의 속도도 계절에 따라 바뀌었다. 중요한 것은 언제나 같은 속도로 걷는 능력이 아니라, 지금의 나에게 맞는 걸음을 알아차리는 감각이었다. 오늘 나는 그 감각을 믿어 보기로 한다. 길을 다 알지 못해도, 내 발이 바닥에 닿는 느낌은 알 수 있으니까.`,
        image: svgImage('sage', 'chapter-one', 'botanical', '옅은 초록 원 앞에서 줄기를 곧게 뻗은 식물과 작은 새싹.', '자라는 일에는 저마다의 시간이 필요하다.'),
      },
      {
        id: 'chapter-2', title: '비워 둔 시간의 쓸모', kind: 'essay',
        content: `일정표에 빈칸이 생기면 어쩐지 잘못한 기분이 들었다. 해야 할 일을 빠뜨렸거나 시간을 낭비하고 있다는 생각이었다. 약속이 없는 토요일에도 할 일을 줄줄이 적었다. 장을 보고, 밀린 글을 읽고, 집을 정리하고, 운동까지 마치면 주말을 잘 보냈다고 여겼다. 그런데 목록에 표시가 늘어날수록 월요일을 맞는 몸은 더 무거워졌다.

처음으로 아무 일정도 잡지 않은 오후에는 오히려 불편했다. 소파에 앉아서도 무엇을 해야 할지 계속 찾았다. 쉬는 데도 연습이 필요하다는 사실을 그때 알았다. 내 몸은 멈춰 있었지만 머릿속의 작은 감독은 쉬지 않고 다음 순서를 지시했다. 나는 그 목소리를 잠시 듣다가, 대답하는 대신 물을 끓였다.

찻잔을 두 손으로 감싸고 창가에 앉았다. 특별한 깨달음은 오지 않았다. 건너편 베란다의 빨래가 마르고, 골목에서 자전거가 지나갔다. 물이 식어 가는 속도로 어깨의 긴장도 조금씩 풀렸다. 아주 짧은 시간 동안, 나는 무엇을 준비하는 사람도 무엇을 증명하는 사람도 아니었다. 그저 오후에 앉아 있는 사람이었다.

빈 시간은 반드시 좋은 생각이나 새로운 성과로 이어져야 하는 것이 아니다. 휴식의 가치를 또 다른 결과로 설명하려 하면, 쉬는 시간에도 일을 시키게 된다. 물론 잠깐 멈춘 뒤 어려운 문제가 풀릴 때도 있다. 그렇지만 아무 문제도 풀리지 않은 오후 역시 쓸모없지 않다. 지친 사람이 더 지치지 않았다는 사실만으로 충분한 날이 있다.

지금은 일주일에 작은 빈칸 하나를 남겨 둔다. 꼭 지켜야 할 과제가 되지 않도록, 놓친 날을 만회하려 들지도 않는다. 산책을 하거나 낮잠을 자고, 때로는 오래된 노래 한 곡을 두 번 듣는다. 그 시간에 무엇을 했는지 묻는 말에는 길게 대답하지 않아도 된다. 잘 쉬었다고 말할 수 있다면, 그 오후는 제 몫을 다했다.`,
      },
      {
        id: 'chapter-3', title: '작은 습관이 만드는 바닥', kind: 'essay',
        content: `책상 서랍에는 끝까지 채우지 못한 수첩이 여러 권 있다. 첫 장에는 늘 비슷한 다짐이 적혀 있다. 매일 한 시간씩 운동하기, 책을 쉰 권 읽기, 아침 다섯 시에 일어나기. 계획을 세우던 날의 나는 내일의 나를 무척 부지런하고 강인한 사람으로 믿었다. 그러나 다음 주의 나는 피곤했고, 예상하지 못한 일이 생겼으며, 자주 늦잠을 잤다.

오랫동안 나는 그것을 의지의 문제라고 생각했다. 그러다 계획의 크기를 줄여 보았다. 한 시간 운동 대신 현관 밖으로 나가기, 긴 독서 대신 책을 펼쳐 한 쪽 읽기. 너무 쉬워서 성과라고 부르기 민망할 정도였다. 그런데 이상하게도 시작하는 날이 늘었다. 산책은 때때로 십 분이 되었고, 한 쪽은 세 쪽이 되었다. 그대로 끝나도 실패는 아니었다.

작은 습관의 힘은 결과의 크기보다 돌아오기 쉬운 데 있었다. 사흘을 쉬었더라도 다음 날 책 한 쪽을 읽는 일은 크게 부담스럽지 않았다. 놓친 분량을 모두 보충해야 한다는 규칙을 없애자, 다시 시작하는 데 쓰이던 힘이 줄었다. 꾸준함은 빈틈없는 줄이 아니라 여러 번 돌아온 흔적에 가까웠다.

나는 새로운 행동을 익숙한 장면 옆에 두었다. 아침에 물을 마신 뒤 창문을 열고, 점심을 먹은 뒤 건물 밖을 한 바퀴 걸었다. 할 일을 기억하려 애쓰기보다 이미 반복되는 하루에 작은 표식을 붙이는 방식이었다. 물론 모든 날에 맞지는 않았다. 몸이 아프거나 돌봐야 할 일이 많은 날에는 표식을 잠시 치워 두었다.

좋은 습관은 나를 감시하는 규칙이 아니라 힘이 없는 날 발을 디딜 바닥이어야 한다. 더 나은 사람이 되겠다는 약속보다 지금의 나를 덜 힘들게 하겠다는 약속이 오래갔다. 오늘 할 수 있는 만큼만 해도 괜찮다는 말은 성장을 포기하는 말이 아니었다. 내일 다시 시작할 자리를 남겨 두는 말이었다.`,
        image: svgImage('sage', 'chapter-three', 'abstract', '겹친 아치와 낮은 두 단의 발판 위로 둥근 해가 떠 있는 추상 그림.', '작은 반복은 돌아올 수 있는 자리가 된다.'),
      },
      {
        id: 'chapter-4', title: '마음의 경계를 돌보는 법', kind: 'essay',
        content: `부탁을 받으면 대답보다 사정을 먼저 헤아렸다. 얼마나 급한지, 누가 대신할 수 있는지, 거절하면 얼마나 곤란할지. 상대의 형편을 자세히 생각하는 동안 정작 내 일정과 피로는 뒤로 밀렸다. 괜찮다고 말한 뒤 혼자 서운해지는 일이 잦았다. 아무도 읽을 수 없는 마음속 약속을 만들어 놓고, 그 약속이 지켜지기를 기다렸던 셈이다.

경계를 세운다는 말을 처음에는 차갑게 느꼈다. 사람과 사람 사이에 선을 긋고 문을 닫는 모습이 떠올랐다. 하지만 내가 필요했던 것은 높은 벽보다 작은 안내문이었다. 오늘은 어렵다거나, 여기까지는 도울 수 있다거나, 내일 다시 답하겠다고 알리는 일. 상대가 내 상태를 짐작하는 대신 실제 정보를 가지고 선택할 수 있게 하는 일이었다.

처음으로 답변을 미뤄 보았을 때 뜻밖에도 아무 일도 일어나지 않았다. 일정을 확인하고 알려 주겠다는 말에 상대는 고개를 끄덕였다. 내가 즉시 응답해야만 관계가 유지된다는 믿음은 대부분 내 안에 있었다. 시간을 두고 생각하니 할 수 있는 부탁과 무리해야 하는 부탁이 조금 더 분명하게 나뉘었다.

물론 모든 사람이 내 경계를 편안하게 받아들이지는 않는다. 설명을 했는데도 섭섭해하는 사람이 있고, 나 역시 누군가의 거절에 서운할 수 있다. 그 감정이 생겼다는 이유만으로 경계가 잘못된 것은 아니다. 서로의 아쉬움을 완전히 없애는 일과 서로를 존중하는 일은 같지 않다. 친절하게 말하되 결정까지 모두 돌려주지는 않는 연습이 필요했다.

내 시간을 지킨 날에는 남은 시간에 더 온전히 사람을 만날 수 있었다. 마음속으로 다른 일을 걱정하면서 고개만 끄덕이는 대신, 그 사람의 말에 귀를 기울였다. 경계는 관계에서 멀어지기 위해 필요한 것만은 아니었다. 오래 곁에 있기 위해, 내가 감당할 수 있는 거리와 속도를 솔직하게 알리는 방법이기도 했다.`,
      },
      {
        id: 'chapter-5', title: '흔들리면서도 계속 걷기', kind: 'essay',
        content: `잘 지내는 줄 알았다가 사소한 말 한마디에 하루가 무너지는 때가 있다. 이미 지나왔다고 생각한 고민이 익숙한 얼굴로 돌아오기도 한다. 그럴 때면 그동안 달라진 것이 하나도 없는 것 같았다. 나는 같은 자리에서 같은 문제를 되풀이하는 사람이라고, 마음속에서 너무 빠른 결론을 내렸다.

지난 기록을 읽다가 조금 다른 사실을 발견했다. 고민의 내용은 비슷했지만 나의 반응은 완전히 같지 않았다. 예전에는 며칠 동안 혼자 끌어안던 일을 이번에는 친구에게 말했다. 아무것도 하지 못하던 날에도 끼니를 챙겼고, 성급하게 답장을 보내는 대신 한밤을 기다렸다. 커다란 변화만 찾는 눈에는 이런 차이가 잘 보이지 않았다.

단단함을 흔들리지 않는 상태라고 생각하면 누구나 자주 실패한다. 나무는 바람을 받을 때 가지를 움직인다. 사람에게도 움직일 여지가 필요하다. 계획을 고치고, 도움을 청하고, 잠깐 쉬었다가 다시 생각하는 일은 무너짐과 다르다. 처음의 자세를 끝까지 고집하는 것만이 자신을 지키는 방법은 아니다.

어려운 날에는 삶 전체를 평가하지 않기로 했다. 피곤한 저녁의 생각이 나의 모든 시간을 공정하게 판단할 수는 없기 때문이다. 먼저 밥을 먹고 잠을 자거나, 가능한 사람에게 지금의 상태를 알렸다. 오래 지속되는 어려움에는 적절한 도움을 구하는 일도 필요하다. 내 힘만으로 견뎌야 한다는 조건을 내려놓으면 선택할 수 있는 길이 조금 넓어진다.

앞으로도 나는 조급해지고, 비교하고, 돌아온 고민 앞에서 한숨을 쉴 것이다. 다만 그 순간을 처음으로 되돌아간 증거로 읽지는 않으려 한다. 익숙한 길에서도 날씨는 달라지고 짐의 무게는 달라진다. 오늘의 걸음이 짧다고 해서 지금까지 걸어온 길이 사라지지는 않는다. 잠시 멈춘 자리에서도, 다시 내딛을 발은 내 곁에 있다.`,
      },
      {
        id: 'chapter-6', title: '오늘을 오래 기억하는 방식', kind: 'essay',
        content: `한 해를 돌아볼 때면 큰 사건부터 떠올랐다. 새로운 일을 시작한 날, 먼 여행을 다녀온 날, 오래 기다리던 결과를 받은 날. 그런 장면을 지나고 나면 나머지 시간은 빈 페이지처럼 느껴졌다. 분명 매일을 살았는데 기억 속에는 몇 장의 사진만 남아 있었다. 평범한 날들이 아무것도 남기지 않은 것은 아닐 텐데, 나는 그것들을 부르는 이름을 몰랐다.

그 뒤로 저녁마다 한 문장씩 적었다. 오늘 좋았던 일을 반드시 찾아내지는 않았다. 비가 와서 신발이 젖었다고 쓰기도 했고, 점심에 먹은 국이 뜨거웠다고 쓰기도 했다. 기록은 하루를 아름답게 꾸미는 일이 아니라 지나간 시간을 만져 볼 작은 손잡이를 만드는 일이었다. 솔직한 한 문장이 근사한 감상보다 그날에 더 가까울 때가 많았다.

몇 달 뒤 수첩을 읽으며 가장 오래 머문 곳은 아주 사소한 문장들이었다. 친구가 통화를 끊기 전에 잠깐 웃었던 일, 집으로 돌아오는 길의 달이 낮게 보였던 일, 새 수건에서 난 햇볕 냄새. 당시에는 설명할 필요도 없었던 장면들이 시간이 지나자 내가 어떤 하루들 속에서 살았는지 알려 주었다.

모든 순간을 붙잡을 수는 없다. 기록하려고 휴대전화를 꺼내는 사이 놓치는 표정도 있고, 말로 적는 순간 달라지는 느낌도 있다. 그래서 어떤 날은 쓰지 않고 충분히 바라보는 쪽을 택했다. 남기지 않은 경험도 내 안에서 제 역할을 한다. 기억은 보관한 문장의 양만으로 만들어지지 않으니까.

이 책의 마지막에서 커다란 결심을 권하고 싶지는 않다. 내일 아침 자신의 걸음을 잠깐 느껴 보는 것으로도 좋겠다. 물 한 잔을 천천히 마시거나, 오늘의 일정에 숨을 돌릴 틈을 남기는 일도 괜찮다. 우리는 여전히 바쁜 날을 살아갈 테지만, 그 안에서 나를 잃지 않는 작은 방식을 배울 수 있다. 느리게, 그리고 단단하게. 오늘을 내 삶으로 받아들이는 연습은 그렇게 이어진다.`,
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}
