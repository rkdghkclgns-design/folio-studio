/** Scoped manuscript editing: shared by the workspace and the book preview dialog. */
import { validateChapterFigures, validateImageSource, validateImageProvenance } from './export.js';
import { parseDiagramBlocks, serializeDiagram, validateDiagram } from './diagrams.js';
import { normalizeMediaPresentation } from './media-style.js';

const PREFIX = 'FOLIO_MEDIA_CLIPBOARD_V1\n';
const MIME = 'application/x-folio-media+json';
const MAX_CLIPBOARD = 20 * 1024 * 1024;
const MAX_TABLE = 256 * 1024;
const EDITOR_TEXT_LIMITS = { title: 200, content: 500000 };
const PALETTES = [['none', '강조 없음'], ['sage', '초록'], ['blue', '파랑'], ['amber', '노랑'], ['rose', '분홍']];
const FIGURE = /^ {0,3}!\[([^\]\n]*)\]\(folio-asset:([A-Za-z0-9_-]{1,100})\)[\t ]*$/;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => `pasted-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;

/** Match import/book-matter limits; reject whole changes instead of truncating input. */
export function validateBookEditorText(value, field) {
  const limit = EDITOR_TEXT_LIMITS[field];
  if (!limit) throw new Error('지원하지 않는 원고 항목입니다.');
  if (typeof value !== 'string' || value.length > limit) {
    const label = field === 'title' ? '장 제목' : '한 장의 원고';
    throw new Error(`${label}은 ${limit.toLocaleString('ko-KR')}자까지 입력할 수 있습니다. 변경을 적용하지 않았으며 기존 내용을 보존했습니다.`);
  }
  return value;
}

function imageValue(image, raster = false) {
  if (!image || typeof image !== 'object' || Array.isArray(image)) throw new Error('복사한 이미지의 형식이 올바르지 않습니다.');
  if (raster) return validateChapterFigures([{ ...image, id: image.id || 'clipboard' }])[0];
  const src = validateImageSource(image.src);
  for (const [key, limit] of [['alt', 2000], ['caption', 4000]]) {
    if (image[key] !== undefined && (typeof image[key] !== 'string' || image[key].length > limit)) throw new Error('이미지 설명이 올바르지 않습니다.');
  }
  return { src, alt: image.alt || '삽화', caption: image.caption || '', ...(image.presentation ? { presentation: normalizeMediaPresentation(image.presentation) } : {}), ...(image.provenance === undefined ? {} : { provenance: validateImageProvenance(image.provenance) }) };
}

/** The text fallback is portable across tabs/books even when custom clipboard MIME is blocked. */
export function serializeMediaClipboard(media) {
  let value;
  if (media?.kind === 'diagram') value = { kind: 'diagram', diagram: validateDiagram(media.diagram) };
  else if (media?.kind === 'figure') value = { kind: 'figure', image: imageValue(media.image, true) };
  else if (media?.kind === 'illustration') value = { kind: 'illustration', image: imageValue(media.image) };
  else throw new Error('복사할 이미지나 도표를 선택해 주세요.');
  const text = PREFIX + JSON.stringify({ version: 1, ...value });
  if (text.length > MAX_CLIPBOARD) throw new Error('복사할 미디어가 너무 큽니다. 이미지 크기를 줄여 주세요.');
  return text;
}

export function parseMediaClipboard(text) {
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return null;
  if (text.length > MAX_CLIPBOARD) throw new Error('복사한 미디어의 용량이 너무 큽니다.');
  let value;
  try { value = JSON.parse(text.slice(PREFIX.length)); } catch { throw new Error('복사한 미디어 데이터가 손상되었습니다. 다시 복사해 주세요.'); }
  if (value?.version !== 1) throw new Error('지원하지 않는 미디어 복사 형식입니다.');
  // Reconstruct an allowlisted object, excluding prototypes and arbitrary metadata.
  const safe = serializeMediaClipboard(value);
  return JSON.parse(safe.slice(PREFIX.length));
}

function tableCell(value) {
  return String(value).replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\\/g, '\\\\').replace(/([`*_\[\]<>])/g, '\\$1').replace(/\|/g, '\\|');
}

function markdownTable(rows) {
  if (rows.length < 1 || rows.length > 100) throw new Error('한 번에 붙여넣을 표는 100행 이하여야 합니다.');
  const width = Math.max(...rows.map(row => row.length));
  if (width < 2) return null;
  if (width > 20) throw new Error('한 번에 붙여넣을 표는 20열 이하여야 합니다.');
  const normalized = rows.map(row => Array.from({ length: width }, (_, index) => {
    const text = row[index] || '';
    if (text.length > 4000) throw new Error('표의 셀 하나에는 4,000자까지 붙여넣을 수 있습니다.');
    return tableCell(text);
  }));
  const line = row => `| ${row.join(' | ')} |`;
  return [line(normalized[0]), line(Array(width).fill('---')), ...normalized.slice(1).map(line)].join('\n');
}

function tsvRows(text) {
  if (!text.includes('\t')) return null;
  const rows = [], row = [];
  let cell = '', quoted = false, start = true;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"' && (start || quoted)) {
      if (quoted && text[index + 1] === '"') { cell += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && (character === '\t' || character === '\n' || character === '\r')) {
      row.push(cell); cell = ''; start = true;
      if (character !== '\t') {
        rows.push(row.splice(0));
        if (character === '\r' && text[index + 1] === '\n') index++;
      }
      continue;
    } else cell += character;
    start = false;
  }
  if (quoted) throw new Error('표의 따옴표가 닫히지 않았습니다. 표 영역을 다시 복사해 주세요.');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** HTML is parsed in an inert document and converted to text only; no source markup is inserted. */
export function clipboardTableMarkdown({ html = '', text = '' } = {}, document) {
  if (html.length > MAX_TABLE || text.length > MAX_TABLE) {
    if (/<table[\s>]/i.test(html) || text.includes('\t')) throw new Error('한 번에 붙여넣을 표는 256KB 이하여야 합니다.');
    return null;
  }
  if (html && /<table[\s>]/i.test(html) && document?.defaultView?.DOMParser) {
    const parsed = new document.defaultView.DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script,style,template,noscript,iframe,object').forEach(node => node.remove());
    const table = parsed.querySelector('table');
    if (table) {
      if (table.querySelector('table')) throw new Error('중첩된 표는 단일 표로 나눠 붙여넣어 주세요.');
      const rows = [...table.querySelectorAll('tr')].map(row => [...row.children].filter(cell => /^(TD|TH)$/.test(cell.tagName)).map(cell => {
        if (Number(cell.getAttribute('rowspan') || 1) > 1 || Number(cell.getAttribute('colspan') || 1) > 1) throw new Error('병합된 셀은 해제한 뒤 표를 붙여넣어 주세요.');
        cell.querySelectorAll('br').forEach(node => node.replaceWith(parsed.createTextNode(' ')));
        cell.querySelectorAll('p,div,li').forEach(node => node.append(parsed.createTextNode(' ')));
        return cell.textContent || '';
      })).filter(row => row.length);
      return markdownTable(rows);
    }
  }
  const rows = tsvRows(text);
  return rows ? markdownTable(rows) : null;
}

export function listChapterMedia(chapter) {
  const media = [];
  if (chapter?.image?.src) media.push({ key: 'illustration', kind: 'illustration', label: chapter.image.alt || '장 삽화', image: chapter.image });
  for (const image of chapter?.figures || []) media.push({ key: `figure:${image.id}`, kind: 'figure', label: image.alt || '본문 이미지', image });
  for (const block of parseDiagramBlocks(chapter?.content || '')) {
    if (block.diagram) media.push({ key: `diagram:${block.start}`, kind: 'diagram', label: block.diagram.title, diagram: block.diagram, block });
  }
  return media;
}

export function renderBookEditor(chapter, { textareaId, titleId, showTitle = true } = {}) {
  const id = value => value ? ` id="${escape(value)}"` : '';
  return `<div class="book-editor">
    ${showTitle ? `<label class="book-editor-title-label">장 제목<input${id(titleId)} data-book-editor-title value="${escape(chapter?.title)}" /></label>` : ''}
    <div class="book-editor-tools" aria-label="원고 편집 도구">
      <button type="button" data-book-edit-action="upload">이미지 넣기</button>
      <button type="button" data-book-edit-action="paste">붙여넣기</button>
      <button type="button" data-book-edit-action="table">표 넣기</button>
      <label>문장 강조<select data-book-text-accent aria-label="문장 강조 색상">${PALETTES.slice(1).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <button type="button" data-book-edit-action="highlight">선택 문장 강조</button>
      <button type="button" data-book-edit-action="unhighlight">강조 해제</button>
      <input type="file" data-book-editor-file accept="image/png,image/jpeg,image/webp" hidden />
    </div>
    <p class="book-editor-help">본문에 이미지·표를 붙여넣으세요(Ctrl+V / ⌘V). 이미지·도표는 아래에서 크기와 강조색을 조절할 수 있습니다.</p>
    <label class="book-editor-content-label"><span class="book-editor-sr-only">Markdown 원고</span><textarea${id(textareaId)} data-book-editor-content spellcheck="false" placeholder="이 장의 내용을 적어 주세요.">${escape(chapter?.content)}</textarea></label>
    <fieldset class="book-editor-media"><legend>이미지·도표 조절</legend>
      <label class="book-editor-media-choice">대상<select data-book-editor-media aria-label="편집할 이미지 또는 도표"></select></label>
      <label class="book-editor-width">너비 <output data-book-editor-width-value>100%</output><input type="range" min="25" max="100" step="5" value="100" data-book-editor-width aria-label="이미지 또는 도표 너비" /></label>
      <label>강조색<select data-book-editor-accent aria-label="이미지 또는 도표 강조색">${PALETTES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <button type="button" data-book-edit-action="copy">선택 미디어 복사</button>
      <button type="button" data-book-edit-action="locate">본문 위치로</button>
    </fieldset>
    <div class="book-editor-copy-fallback" data-book-copy-fallback hidden><label>자동 복사가 허용되지 않았습니다. 아래 선택된 내용을 Ctrl+C / ⌘C로 복사한 뒤 다른 책의 에디터에서 붙여넣으세요.<textarea data-book-copy-text readonly aria-label="직접 복사할 미디어 데이터"></textarea></label><button type="button" data-book-edit-action="close-copy">닫기</button></div>
    <p class="book-editor-status" data-book-editor-status role="status" aria-live="polite"></p>
  </div>`;
}

function dataURL(bytes, type) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 32768) binary += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return `data:${type};base64,${btoa(binary)}`;
}

async function decodeImage(src, win, signal) {
  return new Promise((resolve, reject) => {
    const image = new win.Image();
    const clean = () => { clearTimeout(timer); image.onload = image.onerror = null; signal?.removeEventListener('abort', abort); };
    const abort = () => { clean(); reject(new Error('이미지 편집이 종료되었습니다.')); };
    const timer = setTimeout(() => { clean(); reject(new Error('이미지 확인 시간이 초과되었습니다. 다시 시도해 주세요.')); }, 15000);
    image.onload = () => { clean(); resolve(image); };
    image.onerror = () => { clean(); reject(new Error('이미지 파일을 읽을 수 없습니다. 다른 PNG, JPEG, WebP 파일을 선택해 주세요.')); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    image.src = src;
  });
}

async function rasterizeImage(image, doc, signal) {
  const safe = imageValue(image);
  if (!safe.src.startsWith('data:image/svg+xml;')) return imageValue({ ...safe, id: 'clipboard' }, true);
  const decoded = await decodeImage(safe.src, doc.defaultView, signal);
  const width = decoded.naturalWidth || decoded.width, height = decoded.naturalHeight || decoded.height;
  if (!width || !height || width * height > 50000000) throw new Error('이미지 해상도가 너무 큽니다.');
  const canvas = doc.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('이 브라우저에서는 삽화를 붙여넣을 수 없습니다. PNG로 저장한 뒤 넣어 주세요.');
  context.drawImage(decoded, 0, 0);
  return imageValue({ ...safe, src: canvas.toDataURL('image/png'), id: 'clipboard' }, true);
}

/**
 * Parent owns persistence/checkpointing. getChapter must return the captured object
 * only while its project/chapter remains active. All DOM lookups stay within host.
 */
export function mountBookEditor(host, { getChapter, onBeforeChange = () => {}, onChange = () => {}, onError = () => {}, clipboard } = {}) {
  const element = host.matches?.('.book-editor') ? host : host.querySelector('.book-editor');
  if (!element || typeof getChapter !== 'function') throw new Error('책 편집기를 연결할 수 없습니다.');
  const chapter = getChapter(), doc = element.ownerDocument, win = doc.defaultView;
  if (!chapter) throw new Error('편집할 장을 찾을 수 없습니다.');
  const $ = selector => element.querySelector(selector);
  const textarea = $('[data-book-editor-content]'), title = $('[data-book-editor-title]'), select = $('[data-book-editor-media]');
  const status = $('[data-book-editor-status]');
  const systemClipboard = clipboard || win.navigator?.clipboard;
  const abortController = new (win.AbortController || globalThis.AbortController)();
  const removers = [], pending = new Set();
  let destroyed = false, checkpointed = false, operation = 0, mediaTimer;
  const active = () => !destroyed && element.isConnected && element.contains(textarea) && getChapter() === chapter;
  const report = message => { if (!destroyed) status.textContent = message; };
  const fail = error => { if (!destroyed) { report(error.message || String(error)); onError(error); } };
  const watch = promise => {
    const watched = Promise.resolve(promise).catch(fail).finally(() => pending.delete(watched));
    pending.add(watched); return watched;
  };
  const listen = (node, event, fn) => { node.addEventListener(event, fn); removers.push(() => node.removeEventListener(event, fn)); };
  const beforeChange = label => {
    if (!active()) throw new Error('편집 대상이 변경되었습니다. 현재 장을 다시 열어 주세요.');
    if (!checkpointed) {
      if (onBeforeChange(chapter, label) === false) throw new Error('현재 작업이 끝난 뒤 다시 편집해 주세요.');
      checkpointed = true;
    }
  };
  // Notify synchronously so the parent can arm its unload guard before this event returns.
  const changed = kind => {
    try { watch(onChange(chapter, { kind })); } catch (error) { fail(error); }
  };
  const selected = () => listChapterMedia(chapter).find(item => item.key === select.value);
  const updateControls = () => {
    if (!active()) return;
    const item = selected(), disabled = !item;
    for (const selector of ['[data-book-editor-width]', '[data-book-editor-accent]', '[data-book-edit-action="copy"]', '[data-book-edit-action="locate"]']) {
      const control = $(selector); if (control) control.disabled = disabled;
    }
    const style = normalizeMediaPresentation(item?.kind === 'diagram' ? item.diagram.presentation : item?.image?.presentation);
    $('[data-book-editor-width]').value = String(style.width); $('[data-book-editor-width-value]').value = `${style.width}%`;
    $('[data-book-editor-accent]').value = style.accent;
  };
  const refreshMedia = () => {
    if (!active()) return;
    const prior = select.value, items = listChapterMedia(chapter);
    select.innerHTML = items.length ? items.map(item => `<option value="${escape(item.key)}">${item.kind === 'diagram' ? '도표' : item.kind === 'illustration' ? '삽화' : '이미지'} · ${escape(item.label)}</option>`).join('') : '<option value="">아직 이미지·도표가 없습니다</option>';
    select.disabled = !items.length;
    select.value = items.some(item => item.key === prior) ? prior : (items[0]?.key || '');
    updateControls();
  };
  const refresh = () => {
    if (!active()) return;
    if (textarea.value !== (chapter.content || '')) textarea.value = chapter.content || '';
    if (title && title.value !== (chapter.title || '')) title.value = chapter.title || '';
    refreshMedia();
  };
  const snapshot = () => ({ content: chapter.content || '', start: textarea.selectionStart, end: textarea.selectionEnd });
  const insert = (text, { point = snapshot(), image, label = '미디어 붙여넣기 전' } = {}) => {
    if (!active()) throw new Error('붙여넣을 장이 변경되어 적용하지 않았습니다.');
    if ((chapter.content || '') !== point.content) throw new Error('이미지를 읽는 동안 원고가 변경되었습니다. 원하는 위치에 다시 붙여넣어 주세요.');
    let figures;
    if (image) figures = validateChapterFigures([...(chapter.figures || []), image]);
    const before = point.content.slice(0, point.start), after = point.content.slice(point.end);
    const prefix = before && !before.endsWith('\n\n') ? (before.endsWith('\n') ? '\n' : '\n\n') : '';
    const suffix = after && !after.startsWith('\n\n') ? (after.startsWith('\n') ? '\n' : '\n\n') : '\n';
    const content = validateBookEditorText(before + prefix + text + suffix + after, 'content');
    beforeChange(label);
    if (figures) chapter.figures = figures;
    chapter.content = content;
    textarea.value = chapter.content; const cursor = before.length + prefix.length + text.length + suffix.length;
    textarea.setSelectionRange(cursor, cursor); textarea.focus(); refreshMedia(); changed('content');
  };
  const pasteMedia = async (value, point, token) => {
    if (!active() || token !== operation) return true;
    let image;
    if (value.kind !== 'diagram') image = await rasterizeImage(value.image, doc, abortController.signal);
    if (!active() || token !== operation) return true;
    if (value.kind === 'diagram') insert(serializeDiagram(value.diagram), { point });
    else {
      image = { ...image, id: uid() };
      const alt = (image.alt || '본문 이미지').replace(/[\[\]\r\n]/g, ' ').slice(0, 2000);
      insert(`![${alt}](folio-asset:${image.id})`, { point, image }); select.value = `figure:${image.id}`; updateControls();
    }
    report('미디어를 붙여넣었습니다. 너비와 강조색을 조절할 수 있습니다.');
    return true;
  };
  const pasteFile = async (file, point, token) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('PNG, JPEG, WebP 이미지를 붙여넣어 주세요.');
    if (file.size > 8 * 1024 * 1024) throw new Error('8MB 이하의 이미지를 사용해 주세요.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!active() || token !== operation) return;
    const src = validateImageSource(dataURL(bytes, file.type));
    const decoded = await decodeImage(src, win, abortController.signal);
    if (!decoded.naturalWidth || !decoded.naturalHeight || decoded.naturalWidth * decoded.naturalHeight > 50000000) throw new Error('이미지 해상도가 너무 큽니다. 5,000만 화소 이하의 이미지를 사용해 주세요.');
    if (!active() || token !== operation) return;
    await pasteMedia({ kind: 'figure', image: { id: 'clipboard', src, alt: (file.name || '붙여넣은 이미지').replace(/\.[^.]+$/, ''), caption: '' } }, point, token);
  };
  const pasteText = (text, html, point, token) => {
    if (!active() || token !== operation) return true;
    const media = parseMediaClipboard(text);
    if (media) return pasteMedia(media, point, token);
    const table = clipboardTableMarkdown({ html, text }, doc);
    if (table) { insert(table, { point, label: '표 붙여넣기 전' }); report('표를 붙여넣었습니다. 첫 번째 행을 열 제목으로 사용합니다.'); return true; }
    return false;
  };
  listen(textarea, 'input', () => {
    if (!active()) return;
    try { const content = validateBookEditorText(textarea.value, 'content'); beforeChange('원고 편집 전'); chapter.content = content; changed('content'); clearTimeout(mediaTimer); mediaTimer = setTimeout(refreshMedia, 250); }
    catch (error) { textarea.value = chapter.content || ''; fail(error); }
  });
  if (title) listen(title, 'input', () => {
    try { const value = validateBookEditorText(title.value, 'title'); beforeChange('장 제목 편집 전'); chapter.title = value; changed('title'); }
    catch (error) { title.value = chapter.title || ''; fail(error); }
  });
  listen(select, 'change', updateControls);
  const applyPresentation = () => {
    try {
      const item = selected(); if (!item) return;
      const presentation = normalizeMediaPresentation({ width: Number($('[data-book-editor-width]').value), accent: $('[data-book-editor-accent]').value });
      if (item.kind === 'diagram') {
        const block = serializeDiagram({ ...item.diagram, presentation });
        const content = validateBookEditorText(chapter.content.slice(0, item.block.start) + block + '\n' + chapter.content.slice(item.block.end), 'content');
        beforeChange('이미지·도표 서식 변경 전');
        chapter.content = content;
        textarea.value = chapter.content;
      } else {
        beforeChange('이미지·도표 서식 변경 전');
        item.image.presentation = presentation;
      }
      refreshMedia(); changed('media'); report(`너비 ${presentation.width}% · ${PALETTES.find(([key]) => key === presentation.accent)?.[1]}`);
    } catch (error) { refreshMedia(); fail(error); }
  };
  listen($('[data-book-editor-width]'), 'input', () => { $('[data-book-editor-width-value]').value = `${$('[data-book-editor-width]').value}%`; });
  listen($('[data-book-editor-width]'), 'change', applyPresentation);
  listen($('[data-book-editor-accent]'), 'change', applyPresentation);
  listen(textarea, 'paste', event => {
    if (!active() || !event.clipboardData) return;
    const data = event.clipboardData, point = snapshot(), token = ++operation;
    try {
      const text = data.getData('text/plain') || (data.getData(MIME) ? PREFIX + data.getData(MIME) : '');
      const html = data.getData('text/html');
      const file = [...(data.files || [])].find(file => file.type.startsWith('image/')) || [...(data.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
      if (text.startsWith(PREFIX)) { event.preventDefault(); watch(pasteText(text, '', point, token)); }
      else if (file) { event.preventDefault(); watch(pasteFile(file, point, token)); }
      else {
        const table = clipboardTableMarkdown({ html, text }, doc);
        if (table) { event.preventDefault(); insert(table, { point, label: '표 붙여넣기 전' }); report('표를 붙여넣었습니다. 첫 번째 행을 열 제목으로 사용합니다.'); }
      }
    } catch (error) { event.preventDefault(); fail(error); }
  });
  listen(textarea, 'copy', event => {
    if (!active() || !event.clipboardData) return;
    const text = textarea.value.slice(textarea.selectionStart, textarea.selectionEnd).trim();
    const reference = text.match(FIGURE), blocks = parseDiagramBlocks(text);
    const item = reference ? listChapterMedia(chapter).find(item => item.kind === 'figure' && item.image.id === reference[2])
      : blocks.length === 1 && blocks[0].diagram && blocks[0].raw.trim() === text ? { kind: 'diagram', diagram: blocks[0].diagram } : null;
    if (!item) return;
    try { const copied = serializeMediaClipboard(item); event.clipboardData.setData('text/plain', copied); try { event.clipboardData.setData(MIME, copied.slice(PREFIX.length)); } catch { /* text/plain fallback still carries the complete validated asset. */ } event.preventDefault(); report('이미지·도표 데이터를 복사했습니다. 다른 장에서도 붙여넣을 수 있습니다.'); }
    catch (error) { fail(error); }
  });
  listen($('[data-book-editor-file]'), 'change', event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (file) watch(pasteFile(file, snapshot(), ++operation));
  });
  const copySelected = async () => {
    const item = selected(); if (!item) throw new Error('복사할 이미지나 도표를 선택해 주세요.');
    const text = serializeMediaClipboard(item);
    try {
      if (!systemClipboard?.writeText) throw new Error('Clipboard unavailable');
      await systemClipboard.writeText(text);
      if (active()) report('선택한 미디어를 복사했습니다. 붙여넣을 책의 에디터에서 Ctrl+V / ⌘V를 누르세요.');
    } catch {
      if (!active()) return;
      $('[data-book-copy-fallback]').hidden = false;
      const fallback = $('[data-book-copy-text]'); fallback.value = text; fallback.focus(); fallback.select();
      report('직접 복사할 내용이 선택되었습니다. Ctrl+C / ⌘C를 눌러 주세요.');
    }
  };
  const pasteFromClipboard = async () => {
    const point = snapshot(), token = ++operation;
    try {
      if (systemClipboard?.read) {
        const items = await systemClipboard.read();
        if (!active() || token !== operation) return;
        for (const item of items) {
          if (item.types.includes('text/plain')) {
            const text = await (await item.getType('text/plain')).text();
            if (text.startsWith(PREFIX)) { await pasteMedia(parseMediaClipboard(text), point, token); return; }
          }
          const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type));
          if (type) { await pasteFile(await item.getType(type), point, token); return; }
          const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : '';
          const text = item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : '';
          if (await pasteText(text, html, point, token)) return;
          if (text) { insert(text, { point, label: '붙여넣기 전' }); return; }
        }
      } else if (systemClipboard?.readText) {
        const text = await systemClipboard.readText();
        if (await pasteText(text, '', point, token)) return;
        if (text) { insert(text, { point, label: '붙여넣기 전' }); return; }
      }
      report('붙여넣을 내용이 없습니다. 본문을 누르고 Ctrl+V / ⌘V를 사용해 주세요.');
    } catch (error) {
      if (error?.name === 'NotAllowedError' || !systemClipboard) report('본문을 누르고 Ctrl+V / ⌘V로 붙여넣어 주세요.');
      else throw error;
    }
  };
  const textHighlight = remove => {
    const start = textarea.selectionStart, end = textarea.selectionEnd, text = textarea.value.slice(start, end);
    if (!text) throw new Error('강조할 문장을 본문에서 먼저 선택해 주세요.');
    let replacement;
    if (remove) replacement = text.replace(/==([^=\n]+)==\{(?:sage|blue|amber|rose)\}/g, '$1');
    else {
      if (/\n|=/.test(text)) throw new Error('등호가 없는 한 줄의 문장을 선택해 주세요.');
      replacement = `==${text}=={${$('[data-book-text-accent]').value}}`;
    }
    if (replacement === text) { report('선택한 영역에 색상 강조가 없습니다. 강조 표시를 포함해 선택해 주세요.'); return; }
    const content = validateBookEditorText(textarea.value.slice(0, start) + replacement + textarea.value.slice(end), 'content');
    beforeChange('문장 강조 변경 전');
    chapter.content = content;
    textarea.value = chapter.content; textarea.focus(); textarea.setSelectionRange(start, start + replacement.length);
    changed('content'); report(remove ? '선택 문장의 강조를 해제했습니다.' : '선택 문장을 강조했습니다. 프리뷰에서 색상을 확인하세요.');
  };
  listen(element, 'click', event => {
    const button = event.target.closest('[data-book-edit-action]');
    if (!button || !element.contains(button)) return;
    event.preventDefault(); event.stopPropagation();
    try {
      if (!active()) return;
      const action = button.dataset.bookEditAction;
      if (action === 'upload') $('[data-book-editor-file]').click();
      if (action === 'paste') watch(pasteFromClipboard());
      if (action === 'copy') watch(copySelected());
      if (action === 'table') insert('| 항목 | 설명 |\n| --- | --- |\n| 첫 항목 | 내용을 입력하세요 |', { label: '표 추가 전' });
      if (action === 'highlight') textHighlight(false);
      if (action === 'unhighlight') textHighlight(true);
      if (action === 'close-copy') { $('[data-book-copy-fallback]').hidden = true; $('[data-book-copy-text]').value = ''; textarea.focus(); }
      if (action === 'locate') {
        const item = selected(); if (!item) return;
        if (item.kind === 'diagram') { textarea.focus(); textarea.setSelectionRange(item.block.start, item.block.end); }
        else if (item.kind === 'figure') {
          const lines = /[^\n]*(?:\n|$)/g;
          for (const match of textarea.value.matchAll(lines)) {
            const ref = match[0].trim().match(FIGURE);
            if (ref?.[2] === item.image.id) { textarea.focus(); textarea.setSelectionRange(match.index, match.index + match[0].trimEnd().length); return; }
          }
          report('본문에 이 이미지 참조가 없습니다. 복사 후 원하는 위치에 붙여넣어 주세요.');
        } else report('장 삽화는 장 제목 아래에 표시됩니다. 본문에 넣으려면 복사 후 붙여넣으세요.');
      }
    } catch (error) { fail(error); }
  });
  refreshMedia();
  return {
    refresh,
    focus() { if (active()) textarea.focus(); },
    async flush() { while (pending.size) await Promise.allSettled([...pending]); },
    destroy() {
      if (destroyed) return;
      destroyed = true; operation++; abortController.abort(); clearTimeout(mediaTimer);
      removers.splice(0).forEach(remove => remove());
      const fallback = $('[data-book-copy-text]'); if (fallback) fallback.value = '';
    },
  };
}
