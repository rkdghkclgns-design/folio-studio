/** Portable, dependency-free exports for Folio Studio. */
import { getCoverPresentation } from './cover.js';
import { DIAGRAM_CSS, renderDiagram } from './diagrams.js';
import { BOOK_PREVIEW_CSS, standaloneReaderScript } from './book-preview.js';

const encoder = new TextEncoder();
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 50000000;
const MAX_BOOK_IMAGE_BYTES = 128 * 1024 * 1024;
const MAX_CHAPTERS = 1000;
const FIGURE_REFERENCE = /^ {0,3}!\[([^\]\n]*)\]\(folio-asset:([^\s)]+)\)[\t ]*$/;
const FONT_SERIF = "'Noto Serif KR', 'Nanum Myeongjo', 'Batang', Georgia, serif";
const FONT_SANS = "'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif";
const PALETTES = {
  sage: { background: '#e9eee5', ink: '#263c31', accent: '#8b9d81' },
  ink: { background: '#1f2b38', ink: '#f4f0e7', accent: '#9faeb8' },
  sand: { background: '#f2e7d5', ink: '#584635', accent: '#b99c78' },
};

function clean(value = '') {
  return String(value ?? '').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

function escape(value = '') {
  return clean(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[character]));
}

function normalizeProject(project) {
  if (!project || typeof project !== 'object') throw new Error('내보낼 책을 먼저 선택해 주세요.');
  if (!Array.isArray(project.chapters)) throw new Error('책의 장 목록이 올바르지 않습니다.');
  if (project.chapters.length > MAX_CHAPTERS) throw new Error('한 권에는 최대 1,000개의 장을 내보낼 수 있습니다.');
  const updated = new Date(project.updatedAt || Date.now());
  return {
    ...project,
    title: clean(project.title).trim() || '제목 없는 책',
    subtitle: clean(project.subtitle).trim(),
    author: clean(project.author).trim() || '이름 없는 작가',
    description: clean(project.description).trim(),
    language: /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(project.language || '') ? project.language : 'ko',
    theme: Object.hasOwn(PALETTES, project.theme) ? project.theme : 'sage',
    updatedAt: Number.isNaN(updated.getTime()) ? new Date().toISOString() : updated.toISOString(),
    chapters: project.chapters.map((chapter, index) => ({
      ...chapter,
      title: clean(chapter?.title).trim() || `${index + 1}장`,
      content: clean(chapter?.content),
    })),
  };
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function inlineMarkdown(value, depth = 0) {
  if (depth > 3) return escape(value);
  const expression = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\[\]\n]+)\]\(([^\s)\[]+)\)/g;
  let result = '', cursor = 0;
  for (const match of value.matchAll(expression)) {
    result += escape(value.slice(cursor, match.index));
    if (match[1] !== undefined) result += `<code>${escape(match[1])}</code>`;
    else if (match[2] !== undefined) result += `<strong>${inlineMarkdown(match[2], depth + 1)}</strong>`;
    else if (match[3] !== undefined) result += `<em>${inlineMarkdown(match[3], depth + 1)}</em>`;
    else {
      const href = safeLink(match[5]);
      const label = inlineMarkdown(match[4], depth + 1);
      result += href ? `<a href="${escape(href)}">${label}</a>` : label;
    }
    cursor = match.index + match[0].length;
  }
  return result + escape(value.slice(cursor));
}

/** Split a pipe row without turning escaped or inline-code pipes into columns. */
function tableCells(value) {
  const line = value.trim(), cells = [];
  let cell = '', ticks = 0, delimiters = 0;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '\\' && line[index + 1] === '\\') { cell += '\\\\'; index++; continue; }
    if (character === '\\' && line[index + 1] === '|') { cell += '|'; index++; continue; }
    if (character === '`') {
      let end = index + 1;
      while (line[end] === '`') end++;
      const count = end - index;
      if (!ticks) ticks = count;
      else if (ticks === count) ticks = 0;
      cell += line.slice(index, end); index = end - 1; continue;
    }
    if (character === '|' && !ticks) { cells.push(cell.trim()); cell = ''; delimiters++; }
    else cell += character;
  }
  if (!delimiters) return null;
  cells.push(cell.trim());
  if (line.startsWith('|')) cells.shift();
  if (line.endsWith('|') && !ticks && cell === '') cells.pop();
  return cells;
}

function markdownTable(header, divider) {
  const columns = tableCells(header), rules = tableCells(divider || '');
  if (!columns?.length || !rules || columns.length !== rules.length || rules.some(rule => !/^:?-{3,}:?$/.test(rule))) return null;
  return { columns, align: rules.map(rule => rule.startsWith(':') && rule.endsWith(':') ? 'center' : rule.endsWith(':') ? 'right' : 'left') };
}

function codeMarkup(code, closed = true) {
  const value = code.lines.join('\n');
  if (code.language === 'folio-diagram') {
    try { if (closed) return renderDiagram(JSON.parse(value)); } catch { /* Preserve the original data visibly if parsing or validation fails. */ }
    return `<aside class="folio-diagram-error"><p>도표를 표시할 수 없습니다. 원본 데이터를 확인해 주세요.</p><pre><code>${escape(value)}</code></pre></aside>`;
  }
  return `<pre><code>${escape(value)}</code></pre>`;
}

/** Resolves only validated local figures; export paths are supplied privately below. */
function renderMarkdownWithFigures(content, figures) {
  const lines = clean(content).split('\n');
  const output = [];
  let paragraph = [], list = [], listType = '', quote = [], code = null;
  const flushParagraph = () => {
    if (paragraph.length) output.push(`<p>${paragraph.map(line => inlineMarkdown(line)).join('<br />')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) output.push(`<${listType}>${list.map(line => `<li>${inlineMarkdown(line)}</li>`).join('')}</${listType}>`);
    list = []; listType = '';
  };
  const flushQuote = () => {
    if (quote.length) output.push(`<blockquote><p>${quote.map(line => inlineMarkdown(line)).join('<br />')}</p></blockquote>`);
    quote = [];
  };
  const flush = () => { flushParagraph(); flushList(); flushQuote(); };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (code !== null) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/);
      if (closing && closing[1][0] === code.marker && closing[1].length >= code.length) {
        output.push(codeMarkup(code)); code = null;
      } else code.lines.push(line);
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      flush(); code = { marker: opening[1][0], length: opening[1].length, language: opening[2].trim(), lines: [] }; continue;
    }
    const reference = line.match(FIGURE_REFERENCE);
    if (reference) {
      flush();
      const image = figures.get(reference[2]);
      const alt = reference[1].trim() || image?.alt || reference[2];
      output.push(image ? figure({ ...image, alt }, image.src) : `<aside class="folio-missing-figure"><p>이미지를 찾을 수 없습니다: ${escape(alt)}</p></aside>`);
      continue;
    }
    const table = markdownTable(line, lines[index + 1]);
    if (table) {
      flush(); index++;
      const rows = [];
      while (index + 1 < lines.length) {
        if (/^ {0,3}(?:`{3,}|~{3,}|#{1,6}\s|>\s?|[-+*]\s|\d+\.\s)/.test(lines[index + 1])) break;
        if (FIGURE_REFERENCE.test(lines[index + 1])) break;
        const cells = tableCells(lines[index + 1]);
        if (!cells || cells.length !== table.columns.length) break;
        rows.push(cells); index++;
      }
      const cell = (value, column, tag) => `<${tag}${tag === 'th' ? ' scope="col"' : ''} class="folio-align-${table.align[column]}">${inlineMarkdown(value)}</${tag}>`;
      output.push(`<div class="folio-table-scroll"><table class="folio-markdown-table"><thead><tr>${table.columns.map((value, column) => cell(value, column, 'th')).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((value, column) => cell(value, column, 'td')).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      flush();
      const level = Math.min(heading[1].length + 1, 6);
      output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) { flush(); output.push('<hr />'); continue; }
    const item = line.match(/^\s*(?:([-+*])|\d+\.)\s+(.+)$/);
    if (item) {
      flushParagraph(); flushQuote();
      const type = item[1] ? 'ul' : 'ol';
      if (listType && type !== listType) flushList();
      listType = type; list.push(item[2]); continue;
    }
    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); continue; }
    flushList(); flushQuote(); paragraph.push(line);
  }
  flush();
  if (code !== null) output.push(codeMarkup(code, false));
  return output.join('\n') || '<p class="empty-chapter">&#160;</p>';
}

/** A shared, safe Markdown renderer for the editor, preview, HTML and EPUB. */
export function renderMarkdown(content, { figures } = {}) {
  return renderMarkdownWithFigures(content, new Map(validateChapterFigures(figures).map(image => [image.id, image])));
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const decoded = atob(value), bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  return bytes;
}

function imageMime(bytes) {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

function corruptImage() { throw new Error('이미지가 손상되었거나 지원되지 않는 형식입니다. PNG, JPEG, WebP 파일을 다시 업로드해 주세요.'); }

function checkDimensions(width, height) {
  if (!width || !height) corruptImage();
  if (width * height > MAX_IMAGE_PIXELS) throw new Error('이미지 해상도가 너무 큽니다. 5,000만 화소 이하의 이미지를 사용해 주세요.');
}

/** Structural checks run before a browser decoder allocates image pixel memory. */
function validateRaster(bytes) {
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('이미지 한 장의 용량은 12MB 이하여야 합니다.');
  const mime = imageMime(bytes);
  if (!mime) corruptImage();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (offset, length) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (mime === 'image/png') {
    let cursor = 8, header = false, pixels = false, ended = false, palette = false, imageDataStarted = false, imageDataEnded = false, depth, color;
    while (cursor + 12 <= bytes.length) {
      const size = view.getUint32(cursor), kind = ascii(cursor + 4, 4), start = cursor + 8, end = start + size;
      if (!/^[A-Za-z]{4}$/.test(kind) || end + 4 > bytes.length || (!header && kind !== 'IHDR')) corruptImage();
      if (crc32(bytes.subarray(cursor + 4, end)) !== view.getUint32(end)) corruptImage();
      if (kind === 'IHDR') {
        if (header || size !== 13) corruptImage();
        checkDimensions(view.getUint32(start), view.getUint32(start + 4));
        depth = bytes[start + 8]; color = bytes[start + 9];
        if (!({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] })[color]?.includes(depth)
            || bytes[start + 10] || bytes[start + 11] || bytes[start + 12] > 1) corruptImage();
        header = true;
      } else if (kind === 'PLTE') {
        if (palette || imageDataStarted || [0, 4].includes(color) || !size || size % 3 || size > 768 || (color === 3 && size / 3 > 2 ** depth)) corruptImage();
        palette = true;
      } else if (kind === 'IDAT') {
        if (imageDataEnded || (color === 3 && !palette)) corruptImage();
        imageDataStarted = true; if (size) pixels = true;
      }
      else if (kind === 'IEND') { if (size || !pixels || end + 4 !== bytes.length) corruptImage(); ended = true; }
      else if (kind[0] === kind[0].toUpperCase() && kind !== 'PLTE') corruptImage();
      if (imageDataStarted && kind !== 'IDAT') imageDataEnded = true;
      cursor = end + 4;
    }
    if (!header || !ended || cursor !== bytes.length) corruptImage();
  } else if (mime === 'image/jpeg') {
    let cursor = 2, frame = false, scan = false, ended = false;
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    while (cursor < bytes.length) {
      if (bytes[cursor++] !== 0xff) corruptImage();
      while (bytes[cursor] === 0xff) cursor++;
      const marker = bytes[cursor++];
      if (marker === 0xd9) { ended = cursor === bytes.length; break; }
      if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) corruptImage();
      if (marker === 1) continue;
      if (cursor + 2 > bytes.length) corruptImage();
      const size = view.getUint16(cursor);
      if (size < 2 || cursor + size > bytes.length) corruptImage();
      if (frameMarkers.has(marker)) {
        if (size < 8 || size !== 8 + bytes[cursor + 7] * 3) corruptImage();
        checkDimensions(view.getUint16(cursor + 5), view.getUint16(cursor + 3)); frame = true;
      }
      if (marker === 0xda && (!frame || size < 6 || size !== 6 + bytes[cursor + 2] * 2)) corruptImage();
      cursor += size;
      if (marker === 0xda) {
        scan = true;
        while (cursor < bytes.length) {
          if (bytes[cursor] !== 0xff) { cursor++; continue; }
          const markerStart = cursor++;
          while (bytes[cursor] === 0xff) cursor++;
          if (bytes[cursor] === 0 || (bytes[cursor] >= 0xd0 && bytes[cursor] <= 0xd7)) { cursor++; continue; }
          cursor = markerStart; break;
        }
      }
    }
    if (!frame || !scan || !ended) corruptImage();
  } else {
    if (view.getUint32(4, true) + 8 !== bytes.length) corruptImage();
    const uint24 = offset => bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
    const pixelDimensions = (kind, start, size) => {
      let width, height;
      if (kind === 'VP8 ') {
        if (size <= 10 || bytes[start] & 1 || ascii(start + 3, 3) !== '\x9d\x01\x2a') corruptImage();
        width = view.getUint16(start + 6, true) & 0x3fff; height = view.getUint16(start + 8, true) & 0x3fff;
      } else {
        if (size <= 5 || bytes[start] !== 0x2f || bytes[start + 4] >> 5) corruptImage();
        const packed = view.getUint32(start + 1, true);
        width = (packed & 0x3fff) + 1; height = ((packed >>> 14) & 0x3fff) + 1;
      }
      checkDimensions(width, height);
      return { width, height };
    };
    let cursor = 12, pixels = false, canvas = null, animated = false, animationHeader = false;
    while (cursor + 8 <= bytes.length) {
      const kind = ascii(cursor, 4), size = view.getUint32(cursor + 4, true), start = cursor + 8, end = start + size;
      if (end + (size % 2) > bytes.length) corruptImage();
      if (kind === 'VP8 ' || kind === 'VP8L') {
        if (pixels || animated) corruptImage();
        const frame = pixelDimensions(kind, start, size);
        if (canvas && (frame.width !== canvas.width || frame.height !== canvas.height)) corruptImage();
        pixels = true;
      } else if (kind === 'VP8X') {
        if (size !== 10 || cursor !== 12 || canvas || bytes[start] & 0xc1 || bytes[start + 1] || bytes[start + 2] || bytes[start + 3]) corruptImage();
        canvas = { width: uint24(start + 4) + 1, height: uint24(start + 7) + 1 };
        checkDimensions(canvas.width, canvas.height);
        animated = Boolean(bytes[start] & 2);
      } else if (kind === 'ANIM') {
        if (!animated || animationHeader || pixels || size !== 6) corruptImage();
        animationHeader = true;
      } else if (kind === 'ANMF') {
        if (!animated || !animationHeader || size < 24 || bytes[start + 15] & 0xfc) corruptImage();
        const frame = { width: uint24(start + 6) + 1, height: uint24(start + 9) + 1 };
        checkDimensions(frame.width, frame.height);
        if (uint24(start) * 2 + frame.width > canvas.width || uint24(start + 3) * 2 + frame.height > canvas.height) corruptImage();
        let inner = start + 16, imageSeen = false, alphaSeen = false;
        while (inner + 8 <= end) {
          const innerKind = ascii(inner, 4), innerSize = view.getUint32(inner + 4, true), innerStart = inner + 8, innerEnd = innerStart + innerSize;
          if (innerEnd + innerSize % 2 > end) corruptImage();
          if (innerKind === 'VP8 ' || innerKind === 'VP8L') {
            if (imageSeen || (innerKind === 'VP8L' && alphaSeen)) corruptImage();
            const decoded = pixelDimensions(innerKind, innerStart, innerSize);
            if (decoded.width !== frame.width || decoded.height !== frame.height) corruptImage();
            imageSeen = true;
          } else if (innerKind === 'ALPH') {
            if (alphaSeen || imageSeen || innerSize < 2) corruptImage();
            alphaSeen = true;
          } else if (['ANIM', 'ANMF', 'VP8X'].includes(innerKind)) corruptImage();
          inner = innerEnd + innerSize % 2;
        }
        if (!imageSeen || inner !== end) corruptImage();
        pixels = true;
      }
      cursor = end + (size % 2);
    }
    if (!pixels || cursor !== bytes.length) corruptImage();
  }
  return { bytes, mime };
}

const SVG_TAG_ATTRIBUTES = {
  svg: ['xmlns', 'width', 'height', 'viewBox', 'preserveAspectRatio'],
  g: [], path: ['d'], circle: ['cx', 'cy', 'r'], ellipse: ['cx', 'cy', 'rx', 'ry'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'], line: ['x1', 'y1', 'x2', 'y2'],
  polyline: ['points'], polygon: ['points'], title: [], desc: [],
  text: ['x', 'y', 'dx', 'dy', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'letter-spacing'],
  tspan: ['x', 'y', 'dx', 'dy', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'letter-spacing'],
};
const SVG_COMMON_ATTRIBUTES = new Set(['id', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'fill', 'stroke', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'fill-rule', 'clip-rule', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'transform', 'vector-effect']);
// The alternatives are disjoint, avoiding quadratic backtracking on long digits.
const SVG_NUMBER = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][-+]?\\d+)?';
const SVG_LENGTH = new RegExp(`^${SVG_NUMBER}(?:px|pt|em|%)?$`);

function unsafeSvg() { throw new Error('안전한 도형 SVG만 내보낼 수 있습니다. 스크립트, 스타일, 외부 참조가 없는 SVG 또는 PNG 이미지를 사용해 주세요.'); }

function decodeXmlText(value) {
  // No DTD, custom entities or numeric-entity obfuscation is accepted by this subset.
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(value)) unsafeSvg();
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity]);
}

function svgNumberList(value, lengths) {
  if (value.length > 100000 || /[\d.eE+\-]{65}/.test(value)) return false;
  if (!new RegExp(`^\\s*${SVG_NUMBER}(?:[ ,]+${SVG_NUMBER})*\\s*$`).test(value)) return false;
  const numbers = value.trim().split(/[ ,]+/).map(Number);
  return (!lengths || lengths.includes(numbers.length)) && numbers.every(number => Number.isFinite(number) && Math.abs(number) <= 1000000);
}

function safeSvgAttribute(tag, name, value) {
  if (!SVG_TAG_ATTRIBUTES[tag].includes(name) && !SVG_COMMON_ATTRIBUTES.has(name)) unsafeSvg();
  if (value.length > 250000 || /[\u0000-\u001f<>]/.test(value)) unsafeSvg();
  if (name === 'xmlns') { if (tag !== 'svg' || value !== 'http://www.w3.org/2000/svg') unsafeSvg(); }
  else if (name === 'id') { if (!/^[A-Za-z_][\w.-]*$/.test(value)) unsafeSvg(); }
  else if (name === 'aria-labelledby' || name === 'aria-describedby') { if (!/^[A-Za-z_][\w. -]*$/.test(value)) unsafeSvg(); }
  else if (name === 'aria-label') { /* Escaped text only, never markup. */ }
  else if (name === 'role') { if (!['img', 'presentation', 'none'].includes(value)) unsafeSvg(); }
  else if (name === 'fill' || name === 'stroke') {
    if (!/^(?:#[\da-f]{3}|#[\da-f]{4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,24}|(?:rgb|rgba|hsl|hsla)\([\d.,% +\-]+\))$/i.test(value)) unsafeSvg();
  } else if (name === 'viewBox') { if (!svgNumberList(value, [4]) || value.trim().split(/[ ,]+/).slice(2).some(number => Number(number) <= 0)) unsafeSvg(); }
  else if (name === 'points') { if (!svgNumberList(value) || value.trim().split(/[ ,]+/).length % 2) unsafeSvg(); }
  else if (name === 'd') { if (!/^[MmZzLlHhVvCcSsQqTtAa\d.eE+,\s-]+$/.test(value)) unsafeSvg(); }
  else if (name === 'transform') {
    const transforms = value.trim();
    const expression = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^()]*)\)\s*/gy;
    let cursor = 0, match;
    while ((match = expression.exec(transforms))) {
      if (!svgNumberList(match[2], { matrix: [6], translate: [1, 2], scale: [1, 2], rotate: [1, 3], skewX: [1], skewY: [1] }[match[1]])) unsafeSvg();
      cursor = expression.lastIndex;
    }
    if (!cursor || cursor !== transforms.length) unsafeSvg();
  } else if (name === 'stroke-dasharray') { if (value !== 'none' && !svgNumberList(value)) unsafeSvg(); }
  else if (name === 'fill-rule' || name === 'clip-rule') { if (!['nonzero', 'evenodd'].includes(value)) unsafeSvg(); }
  else if (name === 'stroke-linecap') { if (!['butt', 'round', 'square'].includes(value)) unsafeSvg(); }
  else if (name === 'stroke-linejoin') { if (!['miter', 'round', 'bevel'].includes(value)) unsafeSvg(); }
  else if (name === 'vector-effect') { if (!['none', 'non-scaling-stroke'].includes(value)) unsafeSvg(); }
  else if (name === 'preserveAspectRatio') { if (!/^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(value)) unsafeSvg(); }
  else if (name === 'font-family') { if (!/^[\p{L}\p{N} ,'"_-]{1,200}$/u.test(value)) unsafeSvg(); }
  else if (name === 'font-weight') { if (!/^(?:normal|bold|[1-9]00)$/.test(value)) unsafeSvg(); }
  else if (name === 'text-anchor') { if (!['start', 'middle', 'end'].includes(value)) unsafeSvg(); }
  else if (name === 'dominant-baseline') { if (!['auto', 'middle', 'central', 'hanging', 'alphabetic', 'text-before-edge', 'text-after-edge'].includes(value)) unsafeSvg(); }
  else if (value.length > 64 || !SVG_LENGTH.test(value) || Math.abs(parseFloat(value)) > 1000000
      || (['width', 'height', 'r', 'rx', 'ry', 'stroke-width', 'font-size'].includes(name) && parseFloat(value) < 0)
      || (['opacity', 'fill-opacity', 'stroke-opacity'].includes(name) && (value.includes('%') ? parseFloat(value) < 0 || parseFloat(value) > 100 : parseFloat(value) < 0 || parseFloat(value) > 1))) unsafeSvg();
  return `${name}="${escape(value)}"`;
}

/** Parses a small SVG grammar and serializes it anew; never trusts raw SVG markup. */
function sanitizeSvg(input) {
  const source = input.trim();
  if (source.length > 1024 * 1024 || /<!|<\?|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(source)) unsafeSvg();
  let cursor = 0, count = 0, rootSeen = false, namespaceSeen = false;
  const stack = [], output = [], ids = new Set(), references = [];
  while (cursor < source.length) {
    if (source[cursor] !== '<') {
      const end = source.indexOf('<', cursor);
      const text = decodeXmlText(source.slice(cursor, end < 0 ? source.length : end));
      if (text.trim() && !['title', 'desc', 'text', 'tspan'].includes(stack.at(-1))) unsafeSvg();
      output.push(escape(text)); cursor = end < 0 ? source.length : end; continue;
    }
    let end = cursor + 1, quote = '';
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) { if (character === quote) quote = ''; }
      else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
    }
    if (end === source.length || ++count > 15000) unsafeSvg();
    const token = source.slice(cursor, end + 1);
    cursor = end + 1;
    const closing = token.match(/^<\/([A-Za-z][\w-]*)\s*>$/);
    if (closing) {
      if (stack.pop() !== closing[1]) unsafeSvg();
      output.push(`</${closing[1]}>`); continue;
    }
    const opening = token.match(/^<([A-Za-z][\w-]*)([\s\S]*?)(\/?)>$/);
    if (!opening || !Object.hasOwn(SVG_TAG_ATTRIBUTES, opening[1])) unsafeSvg();
    const [, tag, attributeSource, selfClosing] = opening;
    if (!stack.length) {
      if (rootSeen || tag !== 'svg') unsafeSvg();
      rootSeen = true;
    } else if (tag === 'svg' || ['title', 'desc'].includes(stack.at(-1)) || (['text', 'tspan'].includes(stack.at(-1)) && tag !== 'tspan')) unsafeSvg();
    const attributes = [], seen = new Set();
    const expression = /\s+([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/gy;
    let attributeCursor = 0, attribute;
    while ((attribute = expression.exec(attributeSource))) {
      const name = attribute[1];
      if (seen.has(name)) unsafeSvg();
      seen.add(name);
      if (name === 'xmlns') namespaceSeen = true;
      const value = decodeXmlText(attribute[2] ?? attribute[3]);
      if (name === 'id') { if (ids.has(value)) unsafeSvg(); ids.add(value); }
      if (name === 'aria-labelledby' || name === 'aria-describedby') references.push(...value.split(/\s+/));
      attributes.push(safeSvgAttribute(tag, name, value));
      attributeCursor = expression.lastIndex;
    }
    if (attributeSource.slice(attributeCursor).trim()) unsafeSvg();
    output.push(`<${tag}${attributes.length ? ` ${attributes.join(' ')}` : ''}${selfClosing ? '/' : ''}>`);
    if (!selfClosing) { stack.push(tag); if (stack.length > 32) unsafeSvg(); }
  }
  if (!rootSeen || !namespaceSeen || stack.length || references.some(reference => !ids.has(reference))) unsafeSvg();
  return output.join('');
}

function readDataImage(src) {
  if (typeof src !== 'string' || !src.trim()) throw new Error('삽화의 이미지 주소가 비어 있습니다.');
  if (src.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 65536) throw new Error('이미지 한 장의 용량은 12MB 이하여야 합니다.');
  if (/^data:/i.test(src)) {
    const svg = src.match(/^data:image\/svg\+xml(?:;charset=utf-8)?(;base64)?,([\s\S]*)$/i);
    if (svg) {
      if (svg[2].length > MAX_IMAGE_BYTES * 3) throw new Error('SVG 이미지의 용량이 너무 큽니다.');
      let decoded;
      try {
        decoded = svg[1] ? new TextDecoder('utf-8', { fatal: true }).decode(base64ToBytes(svg[2])) : decodeURIComponent(svg[2]);
      } catch { throw new Error('SVG 이미지 데이터가 손상되었습니다.'); }
      return { bytes: encoder.encode(sanitizeSvg(decoded)), mime: 'image/svg+xml' };
    }
    const match = src.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw new Error('PNG, JPEG, WebP 이미지만 내보낼 수 있습니다.');
    const value = match[2].replace(/\s/g, '');
    if (value.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('이미지 한 장의 용량은 12MB 이하여야 합니다.');
    let bytes;
    try {
      bytes = base64ToBytes(value);
    } catch { throw new Error('이미지 데이터가 손상되었습니다. 이미지를 다시 업로드해 주세요.'); }
    return validateRaster(bytes);
  }
  throw new Error('이미지 파일을 직접 업로드해 주세요. 외부 이미지 주소는 사용할 수 없습니다.');
}

/** Shared by import, previews and AI responses. Only self-contained, inert artwork is accepted. */
export function validateImageSource(src) {
  const asset = readDataImage(src);
  return `data:${asset.mime};base64,${bytesToBase64(asset.bytes)}`;
}

/** Chapter screenshots are portable raster data, never URLs or active artwork. */
export function validateChapterFigures(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) throw new Error('한 장에는 화면 예시를 최대 20개 넣을 수 있습니다.');
  const ids = new Set();
  return value.map(image => {
    if (!image || typeof image !== 'object' || Array.isArray(image) || typeof image.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(image.id) || ids.has(image.id)) {
      throw new Error('화면 예시의 식별자가 올바르지 않거나 중복되었습니다.');
    }
    ids.add(image.id);
    if (typeof image.src !== 'string' || !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(image.src)) throw new Error('화면 예시는 PNG, JPEG, WebP 이미지 파일만 사용할 수 있습니다.');
    for (const [field, limit] of [['alt', 2000], ['caption', 4000]]) {
      if (image[field] !== undefined && (typeof image[field] !== 'string' || image[field].length > limit)) throw new Error('화면 예시의 설명이 올바르지 않거나 너무 깁니다.');
    }
    return { id: image.id, src: validateImageSource(image.src), alt: clean(image.alt).trim() || '화면 예시', caption: clean(image.caption).trim() };
  });
}

async function readImage(src) {
  return readDataImage(src);
}

async function webpToPng(asset) {
  if (asset.mime !== 'image/webp') return asset;
  // PNG is a core EPUB image type; WebP is converted for broad reader compatibility.
  if (typeof document === 'undefined') throw new Error('WebP 이미지의 EPUB 변환은 브라우저에서 실행해 주세요.');
  const objectURL = URL.createObjectURL(new Blob([asset.bytes], { type: asset.mime }));
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('WebP 이미지를 변환할 수 없습니다. PNG 또는 JPEG로 다시 업로드해 주세요.'));
      image.src = objectURL;
    });
    if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 50000000) throw new Error('이미지 해상도가 너무 큽니다. 5,000만 화소 이하의 이미지를 사용해 주세요.');
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지 변환을 지원하지 않는 브라우저입니다.');
    context.drawImage(image, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('삽화 변환에 실패했습니다.');
    if (blob.size > MAX_IMAGE_BYTES) throw new Error('변환된 이미지가 12MB를 초과합니다. 이미지 크기를 줄여 주세요.');
    return { mime: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) };
  } finally { URL.revokeObjectURL(objectURL); }
}

function wrapCoverText(value, width, maximum = 8) {
  const lines = [];
  let line = '', weight = 0;
  for (const character of Array.from(clean(value))) {
    const next = /[\u0000-\u007f]/.test(character) ? 0.55 : 1;
    if (character === '\n' || (weight + next > width && line)) {
      lines.push(line.trim()); line = ''; weight = 0;
    }
    if (character !== '\n') { line += character; weight += next; }
  }
  if (line) lines.push(line.trim());
  if (lines.length > maximum) return [...lines.slice(0, maximum - 1), `${Array.from(lines[maximum - 1]).slice(0, -1).join('')}…`];
  return lines;
}

function coverSvg(project) {
  const palette = PALETTES[project.theme];
  let fontSize = 96, titleLines;
  do {
    titleLines = wrapCoverText(project.title, 1000 / fontSize, 1000);
    if (titleLines.length * fontSize * 1.35 <= 760 || fontSize <= 24) break;
    fontSize -= 4;
  } while (true);
  const titleY = titleLines.length > 4 ? 420 : 520;
  const subtitleY = titleY + titleLines.length * fontSize * 1.35 + 48;
  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600" viewBox="0 0 1200 1600" role="img" aria-label="${escape(project.title)}">
<rect width="1200" height="1600" fill="${palette.background}"/>
<circle cx="1120" cy="145" r="390" fill="none" stroke="${palette.accent}" stroke-width="1" opacity=".45"/>
<circle cx="1120" cy="145" r="310" fill="none" stroke="${palette.accent}" stroke-width="1" opacity=".35"/>
<path d="M100 250H1100M100 1350H1100" fill="none" stroke="${palette.ink}" stroke-width="1" opacity=".35"/>
<text x="106" y="193" fill="${palette.ink}" font-family="sans-serif" font-size="20" letter-spacing="6">DIGITAL EDITION</text>
${titleLines.map((line, index) => `<text x="100" y="${titleY + index * fontSize * 1.35}" fill="${palette.ink}" font-family="${escape(FONT_SERIF)}" font-size="${fontSize}" font-weight="500">${escape(line)}</text>`).join('\n')}
${wrapCoverText(project.subtitle, 26, 2).map((line, index) => `<text x="106" y="${subtitleY + index * 46}" fill="${palette.ink}" opacity=".7" font-family="${escape(FONT_SANS)}" font-size="32">${escape(line)}</text>`).join('\n')}
<text x="106" y="1434" fill="${palette.ink}" font-family="${escape(FONT_SANS)}" font-size="28">${escape(project.author)}</text>
</svg>`;
}

/** A self-contained thumbnail: typography is composed here, never by the image model. */
function artworkCoverSvg(project, artwork) {
  const { design, palette, ink, shade } = getCoverPresentation(project);
  let fontSize = 96, subtitleSize = 34, titleLines, subtitleLines, blockHeight;
  do {
    titleLines = wrapCoverText(project.title, 1000 / fontSize, 10000);
    subtitleLines = wrapCoverText(project.subtitle, 1000 / subtitleSize, 10000);
    blockHeight = titleLines.length * fontSize * 1.35 + (subtitleLines.length ? 42 + subtitleLines.length * subtitleSize * 1.45 : 0);
    if (blockHeight <= 1120 || fontSize <= 20) break;
    fontSize -= 4; subtitleSize = Math.max(18, Math.round(fontSize * .36));
  } while (true);
  const startY = 300 + (design.layout === 'center' ? Math.max(0, (1120 - blockHeight) / 2) : design.layout === 'bottom' ? Math.max(0, 1120 - blockHeight) : 0);
  const titleY = startY + fontSize;
  const subtitleY = startY + titleLines.length * fontSize * 1.35 + 42 + subtitleSize;
  const authorLines = wrapCoverText(`${project.author} 지음`, 35, 10000);
  const authorY = 1716 - (authorLines.length - 1) * 40;
  const alignment = { top: 'YMin', center: 'YMid', bottom: 'YMax' }[design.position];
  const fit = design.fit === 'contain' ? 'meet' : 'slice';
  const data = artwork ? `data:${artwork.mime};base64,${bytesToBase64(artwork.bytes)}` : null;
  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="1800" viewBox="0 0 1200 1800" role="img" aria-label="${escape(`${project.title} — ${project.author}`)}">
<title>${escape(project.title)}</title>
<rect width="1200" height="1800" fill="${palette.background}"/>
${data ? `<image x="0" y="0" width="1200" height="1800" preserveAspectRatio="xMid${alignment} ${fit}" xlink:href="${data}"/>\n<rect width="1200" height="1800" fill="${shade}" opacity="${design.overlay / 100}"/>` : `<circle cx="1120" cy="145" r="390" fill="none" stroke="${palette.accent}" stroke-width="1" opacity=".45"/>\n<circle cx="1120" cy="145" r="310" fill="none" stroke="${palette.accent}" stroke-width="1" opacity=".35"/>`}
<text x="100" y="180" fill="${ink}" font-family="sans-serif" font-size="20" letter-spacing="5" opacity=".8">A LITTLE BOOK OF YOUR OWN</text>
${titleLines.map((line, index) => `<text x="100" y="${titleY + index * fontSize * 1.35}" fill="${ink}" font-family="${escape(FONT_SERIF)}" font-size="${fontSize}" font-weight="500">${escape(line)}</text>`).join('\n')}
${subtitleLines.map((line, index) => `<text x="100" y="${subtitleY + index * subtitleSize * 1.45}" fill="${ink}" opacity=".85" font-family="${escape(FONT_SANS)}" font-size="${subtitleSize}">${escape(line)}</text>`).join('\n')}
${authorLines.map((line, index) => `<text x="100" y="${authorY + index * 40}" fill="${ink}" font-family="${escape(FONT_SANS)}" font-size="28">${escape(line)}</text>`).join('\n')}
</svg>`;
}

async function prepareImages(project, epub) {
  const assets = [];
  const cache = new Map();
  let totalBytes = 0;
  const addImage = async (image, isCover = false) => {
    if (!image?.src) return null;
    let asset = cache.get(image.src);
    if (!asset) {
      const loaded = await readImage(image.src);
      const converted = epub ? await webpToPng(loaded) : loaded;
      totalBytes += converted.bytes.length;
      if (totalBytes > MAX_BOOK_IMAGE_BYTES) throw new Error('한 권의 이미지 용량은 합계 128MB 이하여야 합니다. 이미지 크기를 줄이거나 책을 나누어 내보내 주세요.');
      const extension = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' })[converted.mime];
      asset = { ...converted, id: `image-${assets.length + 1}`, path: `images/image-${assets.length + 1}.${extension}` };
      assets.push(asset); cache.set(image.src, asset);
    }
    if (isCover) asset.cover = true;
    return { ...asset, alt: clean(image.alt || (isCover ? project.title : '삽화')), caption: clean(image.caption) };
  };
  const presentation = getCoverPresentation(project);
  const composed = epub && (project.coverDesign !== undefined || Boolean(project.coverBackground?.src));
  let cover = await addImage(presentation.image, !composed);
  if (cover && composed) {
    cover = { bytes: encoder.encode(artworkCoverSvg(project, cover)), mime: 'image/svg+xml', id: 'cover-image', path: 'images/cover.svg', cover: true, alt: `${project.title} — ${project.author}`, composed: true };
    totalBytes += cover.bytes.length;
    if (totalBytes > MAX_BOOK_IMAGE_BYTES) throw new Error('한 권의 이미지 용량은 합계 128MB 이하여야 합니다. 이미지 크기를 줄이거나 책을 나누어 내보내 주세요.');
    assets.push(cover);
  }
  if (!cover) {
    cover = { bytes: encoder.encode(project.coverDesign !== undefined ? artworkCoverSvg(project, null) : coverSvg(project)), mime: 'image/svg+xml', id: 'cover-image', path: 'images/cover.svg', cover: true, alt: `${project.title} 표지` };
    assets.push(cover);
  }
  const chapters = [], figures = [];
  for (const chapter of project.chapters) {
    chapters.push(await addImage(chapter.image));
    const mapped = new Map();
    for (const image of validateChapterFigures(chapter.figures)) {
      const prepared = await addImage(image);
      mapped.set(image.id, { ...prepared, src: epub ? prepared.path : `data:${prepared.mime};base64,${bytesToBase64(prepared.bytes)}` });
    }
    figures.push(mapped);
  }
  return { assets, cover, chapters, figures };
}

export const MARKDOWN_CSS = `
.folio-table-scroll{max-width:100%;overflow-x:auto;margin:1.5em 0}.folio-markdown-table{width:100%;border-collapse:collapse;font-size:.9em;line-height:1.6}.folio-markdown-table th,.folio-markdown-table td{border:1px solid #d9dfd5;padding:.6em .8em;vertical-align:top;overflow-wrap:anywhere}.folio-markdown-table th{background:#edf1e9;font-weight:600}.folio-markdown-table .folio-align-left{text-align:left}.folio-markdown-table .folio-align-center{text-align:center}.folio-markdown-table .folio-align-right{text-align:right}.folio-diagram-error{margin:1.5em 0;padding:1em;border:1px solid #b26c42;background:#fff8ef}.folio-diagram-error p{margin:0;font-family:${FONT_SANS};font-size:.85em;color:#784526}
.folio-missing-figure{margin:1.5em 0;padding:1em;border:1px dashed #9a8071;background:#fff8ef}.folio-missing-figure p{margin:0;font-family:${FONT_SANS};font-size:.85em;color:#784526}
${DIAGRAM_CSS}
`;

const BOOK_CSS = `
@charset "UTF-8";
*{box-sizing:border-box}
html{color:#272c29;background:#fff}
body{margin:0;font-family:${FONT_SERIF};font-size:1em;line-height:1.95;word-break:keep-all;overflow-wrap:break-word;-webkit-text-size-adjust:100%}
h1,h2,h3,h4,h5,h6{font-weight:600;line-height:1.5;page-break-after:avoid;break-after:avoid}
h1{font-size:2em;margin:.4em 0 1.5em;letter-spacing:-.03em}
h2{font-size:1.5em;margin:2em 0 .8em}h3{font-size:1.2em;margin:1.8em 0 .6em}
p{margin:0 0 1.25em;orphans:3;widows:3}
blockquote{margin:1.8em 0;padding:.2em 0 .2em 1.2em;border-left:2px solid #a4b29a;color:#586353}
blockquote p:last-child{margin-bottom:0}
ul,ol{padding-left:1.5em;margin:1em 0 1.6em}li{margin:.35em 0}
a{color:inherit;text-decoration:underline;text-underline-offset:.16em}
hr{border:0;border-top:1px solid #d9dfd5;margin:2.5em auto;width:28%}
code{font-family:monospace;font-size:.88em;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f3f5f0;padding:1em;border-radius:4px;line-height:1.6}
${MARKDOWN_CSS}
figure{margin:2em 0;page-break-inside:avoid;break-inside:avoid}figure img{display:block;width:100%;height:auto;max-height:70vh;object-fit:contain}
figcaption{margin-top:.7em;font-family:${FONT_SANS};font-size:.75em;color:#6a7465;text-align:center;line-height:1.6}
.chapter-number{font-family:${FONT_SANS};font-size:.7em;letter-spacing:.18em;color:#74816b;margin:0 0 1em}
.chapter{padding:2em 0}.cover-page{margin:0;padding:0;text-align:center}.cover-page img{display:block;width:100%;height:auto;max-height:100vh;object-fit:contain;margin:0 auto}
.cover-frame{position:relative;background:#263c31;text-align:left;overflow:hidden;padding-top:150%}.cover-frame img{position:absolute;top:0;left:0;width:100%;height:100%;max-height:none;object-fit:cover}.cover-shade{position:absolute;inset:0}.cover-copy{position:absolute;inset:0;padding:11% 9% 9%;color:#fff;display:flex;flex-direction:column}.cover-heading{flex:1;display:flex;flex-direction:column;padding:8% 0;min-height:0}.cover-copy h1{font-size:2.6em;margin:0 0 .45em;line-height:1.45}.cover-overline{font-family:${FONT_SANS};font-size:.55em;letter-spacing:.2em}.cover-copy .book-subtitle{color:inherit;font-size:.95em;opacity:.86}.cover-copy .cover-author{font-family:${FONT_SANS};font-size:.8em;margin:0}
.book-subtitle{font-size:1.1em;color:#6a7465}.book-author{font-family:${FONT_SANS};font-size:.9em}
.toc ol{list-style:none;padding:0}.toc li{border-bottom:1px solid #e5e8e0;padding:.7em 0}.toc a{text-decoration:none}
@page{margin:16mm 13mm}
`;

function xhtml(project, title, body, extraClass = '') {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escape(project.language)}" xml:lang="${escape(project.language)}">
<head><title>${escape(title)}</title><meta charset="utf-8"/><link rel="stylesheet" type="text/css" href="styles/book.css"/></head>
<body${extraClass ? ` class="${escape(extraClass)}"` : ''}>${body}</body></html>`;
}

function figure(image, src) {
  return image ? `<figure><img src="${escape(src)}" alt="${escape(image.alt)}"/>${image.caption ? `<figcaption>${escape(image.caption)}</figcaption>` : ''}</figure>` : '';
}

function coverMarkup(project, cover, src, epub = false) {
  const { design, hasImage, palette, ink, shade, objectPosition, justifyContent } = getCoverPresentation(project);
  const image = `<img src="${escape(src)}" alt="${escape(cover.alt)}"${hasImage && !cover.composed ? ` style="object-fit:${design.fit};object-position:${objectPosition}"` : ''}/>`;
  const content = hasImage && !cover.composed ? `<div class="cover-frame" style="background:${palette.background}">${image}<div class="cover-shade" style="background:${shade};opacity:${design.overlay / 100}"></div><div class="cover-copy" style="color:${ink}"><p class="cover-overline">A LITTLE BOOK OF YOUR OWN</p><div class="cover-heading" style="justify-content:${justifyContent}"><h1>${escape(project.title)}</h1>${project.subtitle ? `<p class="book-subtitle">${escape(project.subtitle)}</p>` : ''}</div><p class="cover-author">${escape(project.author)} 지음</p></div></div>` : image;
  return `<section${epub ? ' epub:type="cover"' : ' class="cover-page"'} aria-label="표지">${content}</section>`;
}

function hashIdentifier(value) {
  let hash = 2166136261;
  for (const byte of encoder.encode(value)) { hash ^= byte; hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

/** ZIP STORE is intentional: EPUB's mimetype must be the first, uncompressed entry. */
function zip(entries, modified) {
  if (entries.length > 65535) throw new Error('내보낼 파일이 너무 많습니다.');
  const parts = [], central = [];
  let offset = 0, centralSize = 0;
  const date = new Date(modified);
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2);
  for (const [path, content] of entries) {
    const name = encoder.encode(path), bytes = typeof content === 'string' ? encoder.encode(content) : content;
    if (bytes.length > 0xffffffff || offset + bytes.length + 30 + name.length > 0xffffffff) throw new Error('전자책 용량이 ZIP 형식의 한도를 초과했습니다.');
    const crc = crc32(bytes);
    const local = new Uint8Array(30 + name.length), localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); localView.setUint16(8, 0, true);
    localView.setUint16(10, dosTime, true); localView.setUint16(12, dosDate, true);
    localView.setUint32(14, crc, true); localView.setUint32(18, bytes.length, true); localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, name.length, true); localView.setUint16(28, 0, true); local.set(name, 30);
    parts.push(local, bytes);
    const directory = new Uint8Array(46 + name.length), directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true); directoryView.setUint16(4, 20, true); directoryView.setUint16(6, 20, true);
    directoryView.setUint16(8, 0x0800, true); directoryView.setUint16(10, 0, true);
    directoryView.setUint16(12, dosTime, true); directoryView.setUint16(14, dosDate, true);
    directoryView.setUint32(16, crc, true); directoryView.setUint32(20, bytes.length, true); directoryView.setUint32(24, bytes.length, true);
    directoryView.setUint16(28, name.length, true); directoryView.setUint32(42, offset, true); directory.set(name, 46);
    central.push(directory); centralSize += directory.length; offset += local.length + bytes.length;
  }
  const end = new Uint8Array(22), endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
  endView.setUint32(12, centralSize, true); endView.setUint32(16, offset, true);
  const total = offset + centralSize + end.length;
  if (total > 0xffffffff) throw new Error('전자책 용량이 ZIP 형식의 한도를 초과했습니다.');
  const result = new Uint8Array(total);
  let cursor = 0;
  for (const part of [...parts, ...central, end]) { result.set(part, cursor); cursor += part.length; }
  return result;
}

export async function buildEpub(input) {
  const project = normalizeProject(input);
  const { assets, cover, chapters: images, figures } = await prepareImages(project, true);
  const identifier = `urn:folio:${hashIdentifier(clean(project.id) || `${project.title}|${project.author}`)}`;
  const modified = project.updatedAt.replace(/\.\d{3}Z$/, 'Z');
  const publication = project.publication && typeof project.publication === 'object' ? project.publication : {};
  const isbn = clean(publication.isbn).replace(/[-\s]/g, '');
  const validISBN = /^(978|979)\d{10}$/.test(isbn) && [...isbn].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0) % 10 === 0;
  const publicationDate = clean(publication.publicationDate);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(publicationDate) && !Number.isNaN(Date.parse(publicationDate)) && new Date(publicationDate).toISOString().slice(0, 10) === publicationDate;
  const rights = clean(publication.rightsStatement || publication.rightsHolder).trim();
  const publishingMetadata = `${publication.publisher ? `<dc:publisher>${escape(publication.publisher)}</dc:publisher>` : ''}${rights ? `<dc:rights>${escape(rights)}</dc:rights>` : ''}${validDate ? `<dc:date>${publicationDate}</dc:date>` : ''}${validISBN ? `<dc:identifier>urn:isbn:${isbn}</dc:identifier>` : ''}`;
  const chapterFile = index => `chapter-${String(index + 1).padStart(3, '0')}.xhtml`;
  const chapterMarkup = project.chapters.map((chapter, index) => renderMarkdownWithFigures(chapter.content, figures[index]));
  const nav = `<nav epub:type="toc" id="toc" class="toc" role="doc-toc"><h1>목차</h1><ol>${project.chapters.length ? project.chapters.map((chapter, index) => `<li><a href="${chapterFile(index)}">${escape(chapter.title)}</a></li>`).join('') : '<li><a href="title.xhtml">책 소개</a></li>'}</ol></nav>
<nav epub:type="landmarks" hidden="hidden"><h2>책의 구성</h2><ol><li><a epub:type="cover" href="cover.xhtml">표지</a></li><li><a epub:type="toc" href="nav.xhtml#toc">목차</a></li>${project.chapters.length ? `<li><a epub:type="bodymatter" href="${chapterFile(0)}">본문</a></li>` : ''}</ol></nav>`;
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>',
    '<item id="style" href="styles/book.css" media-type="text/css"/>',
    ...assets.map(asset => `<item id="${asset.id}" href="${asset.path}" media-type="${asset.mime}"${asset.cover ? ' properties="cover-image"' : ''}/>`),
    ...project.chapters.map((_, index) => `<item id="chapter-${index + 1}" href="${chapterFile(index)}" media-type="application/xhtml+xml"${/<svg(?:\s|>)/.test(chapterMarkup[index]) ? ' properties="svg"' : ''}/>`),
  ];
  const packageDocument = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${escape(project.language)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${escape(identifier)}</dc:identifier><dc:title>${escape(project.title)}</dc:title><dc:creator>${escape(project.author)}</dc:creator><dc:language>${escape(project.language)}</dc:language>${project.description ? `<dc:description>${escape(project.description)}</dc:description>` : ''}${publishingMetadata}<meta property="dcterms:modified">${modified}</meta><meta name="cover" content="${cover.id}"/></metadata>
<manifest>${manifest.join('\n')}</manifest>
<spine><itemref idref="cover"/><itemref idref="titlepage"/><itemref idref="nav"/>${project.chapters.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join('')}</spine></package>`;
  const entries = [
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', '<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'],
    ['OEBPS/package.opf', packageDocument],
    ['OEBPS/styles/book.css', BOOK_CSS],
    ['OEBPS/cover.xhtml', xhtml(project, `${project.title} — 표지`, coverMarkup(project, cover, cover.path, true), 'cover-page')],
    ['OEBPS/title.xhtml', xhtml(project, project.title, `<section epub:type="titlepage" class="chapter"><h1>${escape(project.title)}</h1>${project.subtitle ? `<p class="book-subtitle">${escape(project.subtitle)}</p>` : ''}<p class="book-author">${escape(project.author)}</p>${project.description ? `<p>${escape(project.description).replace(/\n/g, '<br />')}</p>` : ''}</section>`)],
    ['OEBPS/nav.xhtml', xhtml(project, `${project.title} — 목차`, nav)],
    ...project.chapters.map((chapter, index) => [`OEBPS/${chapterFile(index)}`, xhtml(project, chapter.title, `<section epub:type="chapter" class="chapter"><p class="chapter-number">${String(index + 1).padStart(2, '0')}</p><h1>${escape(chapter.title)}</h1>${figure(images[index], images[index]?.path)}${chapterMarkup[index]}</section>`)]),
    ...assets.map(asset => [`OEBPS/${asset.path}`, asset.bytes]),
  ];
  return zip(entries, project.updatedAt);
}

/** Reuse the publication ZIP writer for offline publishing packages. */
export function buildArchive(entries, modified = new Date().toISOString()) {
  if (!Array.isArray(entries) || entries.some(entry => !Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[0] || /(^\/|\\|(?:^|\/)\.\.(?:\/|$))/.test(entry[0]) || !(typeof entry[1] === 'string' || entry[1] instanceof Uint8Array))) throw new Error('압축할 파일 목록이 올바르지 않습니다.');
  if (new Set(entries.map(([path]) => path)).size !== entries.length) throw new Error('압축 파일 이름이 중복되었습니다.');
  const date = new Date(modified);
  if (Number.isNaN(date.getTime())) throw new Error('압축 파일의 날짜가 올바르지 않습니다.');
  return zip(entries, date.toISOString());
}

/** Validated HTML sections shared by the app viewer and standalone export. */
export async function prepareBookPreview(input) {
  const project = normalizeProject(input);
  const { cover, chapters: images, figures } = await prepareImages(project, false);
  const src = image => `data:${image.mime};base64,${bytesToBase64(image.bytes)}`;
  const sections = [
    { id: 'book-cover', title: '표지', kind: 'cover', html: coverMarkup(project, cover, src(cover)) },
    { id: 'book-title', title: '책 소개', kind: 'title', html: `<h1>${escape(project.title)}</h1>${project.subtitle ? `<p class="book-subtitle">${escape(project.subtitle)}</p>` : ''}<p class="book-author">${escape(project.author)}</p>${project.description ? `<p>${escape(project.description).replace(/\n/g, '<br>')}</p>` : ''}` },
    { id: 'book-toc', title: '목차', kind: 'toc', html: `<h1>목차</h1><ol>${project.chapters.map((chapter, index) => `<li><a href="#chapter-${index + 1}">${String(index + 1).padStart(2, '0')}　${escape(chapter.title)}</a></li>`).join('')}</ol>` },
    ...project.chapters.map((chapter, index) => ({ id: `chapter-${index + 1}`, title: chapter.title, kind: 'chapter', html: `<p class="chapter-number">${String(index + 1).padStart(2, '0')}</p><h1>${escape(chapter.title)}</h1>${figure(images[index], images[index] ? src(images[index]) : '')}${renderMarkdownWithFigures(chapter.content, figures[index])}` })),
  ];
  return { title: project.title, language: project.language, sections };
}

/** HTML defaults to an offline page-turning reader; print/PDF may opt out. */
export async function exportHTML(input, { interactive = true } = {}) {
  const project = normalizeProject(input), { sections } = await prepareBookPreview(project);
  const script = interactive ? standaloneReaderScript() : '';
  const scriptHash = script ? bytesToBase64(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(script)))) : '';
  const body = sections.map(section => {
    const attributes = `id="${section.id}" data-book-kind="${section.kind}" data-book-title="${escape(section.title)}"`;
    if (section.kind === 'cover') return section.html.replace('<section', `<section ${attributes}`);
    const tag = section.kind === 'toc' ? 'nav' : 'section';
    return `<${tag} ${attributes} class="${section.kind === 'title' ? 'title-page' : section.kind}"${section.kind === 'toc' ? ' aria-label="목차"' : ''}>${section.html}</${tag}>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="${escape(project.language)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="author" content="${escape(project.author)}"><meta name="description" content="${escape(project.description)}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; ${script ? `script-src 'sha256-${scriptHash}'; ` : ''}font-src 'none'; base-uri 'none'; form-action 'none'"><title>${escape(project.title)}</title><style>${BOOK_CSS}
html{background:#f0f1ed}body{max-width:800px;margin:40px auto;background:#fff;box-shadow:0 12px 60px #24302710}
.cover-page img{max-height:none}.title-page,.toc,.chapter{padding:72px 80px}.title-page h1{margin-bottom:.5em}.title-page{border-bottom:1px solid #e7e9e3}.chapter+.chapter{border-top:1px solid #e7e9e3}
@media(max-width:640px){body{margin:0}.title-page,.toc,.chapter{padding:40px 24px}h1{font-size:1.7em}}
@page{size:A5;margin:16mm 13mm}
@media print{html,body{background:#fff}body{margin:0;max-width:none;box-shadow:none;font-size:11pt}.cover-page{break-after:page;page-break-after:always;print-color-adjust:exact;-webkit-print-color-adjust:exact}.cover-page img{max-height:178mm;width:auto;max-width:100%;margin:auto}.cover-frame{height:178mm;width:118.66mm;max-width:100%;padding-top:0;margin:0 auto}.cover-frame img{height:100%;min-height:0;width:100%}.cover-copy h1{font-size:28pt}.title-page,.toc,.chapter{padding:0;border:0!important;break-before:page;page-break-before:always}.chapter+.chapter{border:0}figure img{max-height:145mm}a{text-decoration:none}h1{font-size:24pt}h2{font-size:17pt}h3{font-size:14pt}}
${interactive ? `${BOOK_PREVIEW_CSS}
#folio-book-reader{display:none}.folio-reader-enhanced #folio-book-reader{display:block}.folio-reader-enhanced #folio-book-source{display:none}.folio-reader-enhanced body{max-width:1020px;margin:16px auto;padding:20px 24px;background:transparent;box-shadow:none}.folio-book-page-body.toc{padding:0}
@media(max-width:640px){.folio-reader-enhanced body{padding:14px}}@media print{.folio-reader-enhanced body{padding:0}.folio-reader-enhanced #folio-book-reader{display:none!important}.folio-reader-enhanced #folio-book-source{display:block!important}}
` : ''}
</style></head><body>
${interactive ? '<div id="folio-book-reader"></div>' : ''}<main id="folio-book-source">${body}</main>
${script ? `<script id="folio-book-runtime">${script}</script>` : ''}
</body></html>`;
}

export function exportMarkdown(input) {
  const project = normalizeProject(input);
  const metadata = [`# ${project.title}`, project.subtitle, `지은이: ${project.author}`, project.description].filter(Boolean).join('\n\n');
  const chapters = project.chapters.map(chapter => `## ${chapter.title}\n\n${chapter.image ? `> 삽화: ${clean(chapter.image.alt || chapter.image.caption || '삽화')}\n\n` : ''}${chapter.content.trim()}`);
  return `${[metadata, ...chapters].join('\n\n---\n\n')}\n`;
}

export function projectToText(input) {
  const project = normalizeProject(input);
  return [project.title, project.subtitle, `지은이: ${project.author}`, project.description, ...project.chapters.map((chapter, index) => `${index + 1}. ${chapter.title}\n\n${chapter.content.trim()}`)].filter(Boolean).join('\n\n');
}

export function downloadBlob(data, filename, mime = 'application/octet-stream') {
  if (typeof document === 'undefined') throw new Error('파일 다운로드는 브라우저에서 실행해 주세요.');
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = clean(filename || 'book').replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').slice(0, 180);
  link.style.display = 'none';
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
