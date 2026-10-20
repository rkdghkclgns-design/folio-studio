import { normalizeMediaPresentation, mediaPresentationAttributes, mediaAccentPalette } from './media-style.js';

/** Small, portable diagrams. Only validated data is ever turned into markup. */
const FIELDS = ['type', 'title', 'caption', 'columns', 'rows', 'labels', 'values', 'unit', 'evidence'];
const TYPES = new Set(['table', 'bar', 'line', 'flow']);
const MAX_JSON = 12000;
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

function invalid(message) {
  const error = new Error(`도표를 확인해 주세요: ${message}`);
  error.code = 'INVALID_DIAGRAM';
  throw error;
}

function text(value, label, maximum, required = true) {
  if (typeof value !== 'string' || (required && !value.trim()) || [...value].length > maximum || INVALID_XML.test(value)) {
    invalid(`${label}의 형식 또는 길이가 올바르지 않습니다.`);
  }
  return value;
}

function empty(value, name) {
  if (value.length) invalid(`${name}에는 값을 넣을 수 없습니다.`);
}

function hasExactNumber(quote, label, value, unit) {
  // A year or sequence number in a category name is not evidence for its value.
  const remaining = quote.split(label).join(' ');
  const expression = /[+\-−﹣－＋]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/g;
  const escapedUnit = unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const suffix = new RegExp(`^[\\s:：()]*${escapedUnit}(?![A-Za-z0-9])(?!\\s*[/⁄∕·⋅^²³⁰¹⁴⁵⁶⁷⁸⁹])`, 'u');
  const prefix = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapedUnit}[\\s:：()]*$`, 'u');
  for (const match of remaining.matchAll(expression)) {
    const before = remaining[match.index - 1] || '';
    const after = remaining.slice(match.index + match[0].length);
    const prefixedUnit = prefix.test(remaining.slice(0, match.index));
    // Reject partial decimals, malformed grouping and scientific notation.
    if ((/[\w.,+\-−﹣－＋]/.test(before) && !prefixedUnit) || /^(?:[\deE]|[.,]\d)/.test(after)) continue;
    const number = Number(match[0].replaceAll(',', '').replace(/[−﹣－]/g, '-').replace('＋', '+'));
    if (number === value && (suffix.test(after) || prefixedUnit)) return true;
  }
  return false;
}

/** Validate the shared JSON contract. evidenceText enables numeric grounding. */
export function validateDiagram(value, { evidenceText } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || FIELDS.some(field => !Object.hasOwn(value, field)) || Object.keys(value).some(field => !FIELDS.includes(field) && field !== 'presentation')) {
    invalid('필수 항목이 빠졌거나 허용하지 않는 항목이 있습니다.');
  }
  if (!TYPES.has(value.type)) invalid('지원하지 않는 도표 유형입니다.');
  text(value.title, '제목', 120);
  text(value.caption, '설명', 500, false);
  text(value.unit, '단위', 40, false);
  for (const key of ['columns', 'rows', 'labels', 'values', 'evidence']) {
    if (!Array.isArray(value[key])) invalid(`${key} 항목은 배열이어야 합니다.`);
  }
  if (value.type === 'table') {
    if (value.columns.length < 2 || value.columns.length > 6 || value.rows.length < 1 || value.rows.length > 12) invalid('비교표는 2~6열, 1~12행으로 구성해 주세요.');
    value.columns.forEach(column => text(column, '열 제목', 80));
    value.rows.forEach(row => {
      if (!Array.isArray(row) || row.length !== value.columns.length) invalid('표의 각 행은 열 수와 같아야 합니다.');
      row.forEach(cell => text(cell, '표의 내용', 200, false));
    });
    empty(value.labels, '비교표의 labels'); empty(value.values, '비교표의 values'); empty(value.evidence, '비교표의 evidence');
    if (value.unit !== '') invalid('비교표의 단위는 열 제목에 적어 주세요.');
  } else if (value.type === 'flow') {
    if (value.labels.length < 2 || value.labels.length > 8) invalid('순서도는 2~8단계로 구성해 주세요.');
    value.labels.forEach(label => text(label, '단계', 120));
    empty(value.columns, '순서도의 columns'); empty(value.rows, '순서도의 rows'); empty(value.values, '순서도의 values'); empty(value.evidence, '순서도의 evidence');
    if (value.unit !== '') invalid('순서도의 단위는 비워 주세요.');
  } else {
    if (value.labels.length < 2 || value.labels.length > 10 || value.values.length !== value.labels.length || value.evidence.length !== value.labels.length) invalid('그래프는 2~10개 항목과 항목별 수치·근거가 필요합니다.');
    value.labels.forEach(label => text(label, '항목 이름', 80));
    if (new Set(value.labels.map(label => label.trim())).size !== value.labels.length) invalid('그래프의 항목 이름은 서로 달라야 합니다.');
    value.values.forEach(number => { if (typeof number !== 'number' || !Number.isFinite(number) || Math.abs(number) > 1e12) invalid('수치는 ±1조 이내의 유한한 숫자여야 합니다.'); });
    text(value.unit, '단위', 40);
    value.evidence.forEach(quote => text(quote, '수치 근거', 500));
    empty(value.columns, '그래프의 columns'); empty(value.rows, '그래프의 rows');
    if (evidenceText !== undefined) {
      if (typeof evidenceText !== 'string') invalid('수치의 원문 근거가 올바르지 않습니다.');
      value.evidence.forEach((quote, index) => {
        const label = value.labels[index];
        const otherCategory = value.labels.some((other, otherIndex) => otherIndex !== index && (label.includes(other) ? quote.split(label).join(' ').includes(other) : quote.includes(other)));
        if (!evidenceText.includes(quote) || !quote.includes(label) || !quote.includes(value.unit) || otherCategory || !hasExactNumber(quote, label, value.values[index], value.unit)) {
          invalid(`“${value.labels[index]}”의 수치·단위를 확인할 수 있는 정확한 원문 근거가 필요합니다.`);
        }
      });
    }
  }
  const normalized = Object.fromEntries(FIELDS.map(field => [field, value[field]]));
  if (value.presentation !== undefined) {
    try { normalized.presentation = normalizeMediaPresentation(value.presentation); } catch (error) { invalid(error.message); }
  }
  const serialized = JSON.stringify(normalized);
  if (serialized.length > MAX_JSON) invalid('도표 데이터는 12,000자 이내여야 합니다.');
  return JSON.parse(serialized);
}

/** Find only top-level fences, so a literal example inside an outer fence stays code. */
export function parseDiagramBlocks(content, { strict = false, evidenceText, maxDiagrams = 12 } = {}) {
  if (typeof content !== 'string') invalid('원고는 문자열이어야 합니다.');
  if (!Number.isInteger(maxDiagrams) || maxDiagrams < 0 || maxDiagrams > 1000) invalid('도표 개수 제한이 올바르지 않습니다.');
  const results = [];
  let fence = null;
  const finish = (end, bodyEnd, closed) => {
    if (!fence.diagram) return;
    const raw = content.slice(fence.start, end);
    const block = { start: fence.start, end, diagram: null, raw };
    try {
      if (results.length >= maxDiagrams) invalid(`한 원고에는 최대 ${maxDiagrams}개의 도표를 넣을 수 있습니다.`);
      if (!closed) invalid('도표 코드 블록의 닫는 표시가 없습니다.');
      const json = content.slice(fence.bodyStart, bodyEnd).trim();
      if (!json || json.length > MAX_JSON) invalid('도표 JSON은 비어 있지 않은 12,000자 이내여야 합니다.');
      let data;
      try { data = JSON.parse(json); } catch { invalid('도표 JSON 문법이 올바르지 않습니다.'); }
      block.diagram = validateDiagram(data, { evidenceText });
    } catch (error) {
      if (strict) throw error;
      block.error = error.message;
    }
    results.push(block);
  };
  const lines = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
  for (const match of content.matchAll(lines)) {
    if (!match[0]) continue;
    // Match the exporter's XML cleanup for fence recognition, but retain raw
    // offsets and JSON so invisible control characters cannot bypass validation.
    const line = match[0].replace(/(?:\r\n|\r|\n)$/, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
      .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
    const end = match.index + match[0].length;
    if (fence) {
      const closing = line.match(/^ {0,3}(`{3,}|~{3,})[\t ]*$/);
      if (closing && closing[1][0] === fence.marker && closing[1].length >= fence.length) {
        finish(end, match.index, true); fence = null;
      }
      continue;
    }
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (opening && (opening[1][0] !== '`' || !opening[2].includes('`'))) {
      fence = { marker: opening[1][0], length: opening[1].length, start: match.index, bodyStart: end, diagram: opening[2].trim() === 'folio-diagram' };
    }
  }
  if (fence) finish(content.length, content.length, false);
  return results;
}

export function serializeDiagram(diagram) {
  return `\`\`\`folio-diagram\n${JSON.stringify(validateDiagram(diagram))}\n\`\`\``;
}

export function diagramPlainText(diagram) {
  const value = validateDiagram(diagram);
  const lines = [value.title, value.caption].filter(Boolean);
  if (value.type === 'table') lines.push(value.columns.join(' · '), ...value.rows.map(row => row.join(' · ')));
  else if (value.type === 'flow') lines.push(value.labels.join(' → '));
  else lines.push(...value.labels.map((label, index) => `${label}: ${value.values[index]} ${value.unit}`));
  return lines.join('\n');
}

function replaceBlocks(content, replacement) {
  let result = '', cursor = 0;
  for (const block of parseDiagramBlocks(content)) {
    result += content.slice(cursor, block.start) + replacement(block);
    cursor = block.end;
  }
  return result + content.slice(cursor);
}

/** Count reader-visible diagram data, rather than JSON syntax and repeated evidence. */
export function countableDiagramText(content) {
  return replaceBlocks(content, block => block.diagram ? `${diagramPlainText(block.diagram)}\n` : block.raw);
}

/** Output diagrams cannot cite their own embedded evidence as fresh source material. */
export function stripDiagramBlocks(content) {
  return replaceBlocks(content, () => '\n');
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
}

function numberText(value) {
  const [integer, fraction] = String(value).split('.');
  if (/[eE]/.test(String(value))) return String(value);
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`);
}

function dataTable(columns, rows, caption) {
  return `<div class="folio-diagram-table-wrap"><table class="folio-diagram-table"><caption>${escape(caption)}</caption><thead><tr>${columns.map(column => `<th scope="col">${escape(column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => index === 0 ? `<th scope="row">${escape(cell)}</th>` : `<td>${escape(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function chart(value) {
  const colors = mediaAccentPalette(value.presentation);
  const left = 110, right = 690, top = 28, bottom = 275;
  const minimum = Math.min(0, ...value.values), maximum = Math.max(0, ...value.values);
  const range = maximum - minimum || 1;
  const y = number => bottom - (number - minimum) / range * (bottom - top);
  const zero = y(0), step = (right - left) / value.labels.length;
  const x = index => left + (index + 0.5) * step;
  const decimal = number => Number(number.toFixed(3));
  const title = `${value.title} (${value.unit})`;
  let drawing = `<line x1="${left}" y1="${decimal(zero)}" x2="${right}" y2="${decimal(zero)}" stroke="#87978d" stroke-width="1.5" />`;
  drawing += `<text x="${left - 10}" y="${top + 4}" text-anchor="end" fill="#526258" font-size="12">${escape(numberText(maximum))}</text><text x="${left - 10}" y="${bottom + 4}" text-anchor="end" fill="#526258" font-size="12">${escape(numberText(minimum))}</text>`;
  if (value.type === 'bar') {
    drawing += value.values.map((number, index) => {
      const position = y(number), width = step * 0.6;
      return `<rect x="${decimal(x(index) - width / 2)}" y="${decimal(Math.min(position, zero))}" width="${decimal(width)}" height="${decimal(Math.abs(position - zero))}" fill="${number < 0 ? colors.negative : colors.line}" />`;
    }).join('');
  } else {
    drawing += `<polyline points="${value.values.map((number, index) => `${decimal(x(index))},${decimal(y(number))}`).join(' ')}" fill="none" stroke="${colors.line}" stroke-width="3" />`;
    drawing += value.values.map((number, index) => `<circle cx="${decimal(x(index))}" cy="${decimal(y(number))}" r="4" fill="${colors.line}" />`).join('');
  }
  drawing += value.labels.map((label, index) => {
    const letters = [...label];
    const maximum = Math.max(1, Math.floor(step / 11) - 4);
    const shortened = letters.length > maximum ? `${letters.slice(0, maximum).join('')}…` : label;
    const axisLabel = value.labels.length > 6 ? String(index + 1) : `${index + 1}. ${shortened}`;
    return `<text x="${decimal(x(index))}" y="300" text-anchor="middle" fill="#263c31" font-size="11">${escape(axisLabel)}</text>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="folio-diagram-chart" viewBox="0 0 720 325" role="img" aria-label="${escape(title)}"><title>${escape(title)}</title><desc>${escape(value.labels.map((label, index) => `${label}: ${numberText(value.values[index])} ${value.unit}`).join('; '))}</desc>${drawing}</svg>`;
}

/** Safe XHTML is shared by browser preview, print and EPUB. No user SVG is accepted. */
export function renderDiagram(diagram) {
  const value = validateDiagram(diagram);
  const caption = `<figcaption><strong class="folio-diagram-title">${escape(value.title)}</strong>${value.caption ? `<span class="folio-diagram-caption">${escape(value.caption)}</span>` : ''}</figcaption>`;
  let content;
  if (value.type === 'table') content = dataTable(value.columns, value.rows, value.title);
  else if (value.type === 'flow') content = `<ol class="folio-diagram-flow">${value.labels.map((label, index) => `<li><span class="folio-diagram-step">${escape(label)}</span>${index < value.labels.length - 1 ? '<span class="folio-diagram-arrow" aria-hidden="true">→</span>' : ''}</li>`).join('')}</ol>`;
  else {
    content = chart(value) + dataTable(['항목', `값 (${value.unit})`], value.labels.map((label, index) => [`${index + 1}. ${label}`, numberText(value.values[index])]), `${value.title} — 데이터`);
    content += `<div class="folio-diagram-evidence"><p>수치 근거</p><ol>${value.evidence.map(quote => `<li>${escape(quote)}</li>`).join('')}</ol></div>`;
  }
  return `<figure class="folio-diagram folio-diagram-${value.type}"${mediaPresentationAttributes(value.presentation)} role="group" aria-label="${escape(value.title)}">${caption}${content}</figure>`;
}

export const DIAGRAM_CSS = `
.folio-diagram{margin:1.8em 0;padding:1.15em;border:1px solid #dbe4dc;border-radius:12px;background:#fbfcf9;color:#263c31;max-width:100%;box-sizing:border-box;break-inside:avoid;page-break-inside:avoid}
.folio-diagram figcaption{margin:0 0 .9em;text-align:left;line-height:1.6}
.folio-diagram-title{display:block;font-size:1em;color:#263c31}
.folio-diagram-caption{display:block;margin-top:.35em;font-size:.88em;color:#526258}
.folio-diagram-table-wrap{width:100%;max-width:100%;overflow-x:auto}
.folio-diagram-table{border-collapse:collapse;width:100%;font-size:.85em;line-height:1.6;table-layout:fixed}
.folio-diagram-table caption{font-size:.86em;color:#526258;text-align:left;padding:.4em 0}
.folio-diagram-table th,.folio-diagram-table td{padding:.6em .65em;border:1px solid #dbe4dc;vertical-align:top;overflow-wrap:anywhere;word-break:normal;text-align:left}
.folio-diagram-table thead th{background:#e9eee5;font-weight:700}
.folio-diagram-table tbody th{font-weight:500;background:#f3f6ef}
.folio-diagram-chart{display:block;width:100%;height:auto;max-height:390px;margin:.5em 0 1em;font-family:inherit}
.folio-diagram-flow{display:flex;flex-wrap:wrap;gap:.7em 0;list-style:none;padding:0;margin:1em 0;counter-reset:folio-step}
.folio-diagram-flow li{display:flex;align-items:center;max-width:100%;counter-increment:folio-step}
.folio-diagram-step{display:block;padding:.7em .85em;background:#e9eee5;border:1px solid #cfdbcf;border-radius:8px;overflow-wrap:anywhere;max-width:17em;line-height:1.6}
.folio-diagram-step:before{content:counter(folio-step) ". ";font-weight:700}
.folio-diagram-arrow{display:block;padding:0 .55em;color:#627a68;font-size:1.2em}
.folio-diagram-evidence{margin-top:1em;font-size:.75em;color:#627065;line-height:1.6;overflow-wrap:anywhere}
.folio-diagram-evidence p{margin:0;font-weight:600}.folio-diagram-evidence ol{padding-left:1.4em;margin:.3em 0 0}
@media(max-width:520px){.folio-diagram{padding:.8em}.folio-diagram-table th,.folio-diagram-table td{padding:.45em}.folio-diagram-step{max-width:12em}}
`;
