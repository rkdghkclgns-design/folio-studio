import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { buildEpub, exportHTML, exportMarkdown, renderMarkdown, MARKDOWN_CSS } from './dist/export.js';

const base = { title: '도표 제목', caption: '설명이 필요한 곳에 쓰는 도표.', columns: [], rows: [], labels: [], values: [], unit: '', evidence: [] };
const diagrams = {
  table: { ...base, type: 'table', title: '준비물 비교', columns: ['도구', '용도'], rows: [['연필', '스케치'], ['펜', '기록']] },
  flow: { ...base, type: 'flow', title: '작업 순서', labels: ['자료 읽기', '구성 정리', '집필'] },
  bar: { ...base, type: 'bar', title: '매출 비교', labels: ['봄', '여름', '가을'], values: [12, -20, 0], unit: '만원', evidence: ['봄 매출 12만원', '여름 매출 -20만원', '가을 매출 0만원'] },
  line: { ...base, type: 'line', title: '매출 추이', labels: ['봄', '여름', '가을'], values: [12, -20, 0], unit: '만원', evidence: ['봄 매출 12만원', '여름 매출 -20만원', '가을 매출 0만원'] },
};
const block = value => `\`\`\`folio-diagram\n${JSON.stringify(value)}\n\`\`\``;
const book = chapters => ({ id: 'diagram-export-book', title: '도표가 있는 책', author: '테스트 작가', language: 'ko', theme: 'sage', updatedAt: '2026-10-18T00:00:00.000Z', chapters });
const chapter = (type, content = block(diagrams[type])) => ({ id: type, title: `${type} 장`, content });

function zipEntries(bytes) {
  const entries = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), decoder = new TextDecoder();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const path = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.set(path, decoder.decode(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  return entries;
}

function xmlCheck(value, assertions = '') {
  const result = spawnSync('python3', ['-c', `import sys, xml.etree.ElementTree as E\nroot = E.fromstring(sys.stdin.read())\n${assertions}`], { input: value, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

for (const type of ['table', 'flow', 'bar', 'line']) {
  test(`${type} diagrams render in place between manuscript paragraphs as safe XHTML`, () => {
    const html = renderMarkdown(`도표 앞의 문장.\n\n${block(diagrams[type])}\n\n도표 뒤의 문장.`);
    assert.match(html, /<figure\b/);
    assert.ok(html.indexOf('도표 앞의 문장.') < html.indexOf('<figure'));
    assert.ok(html.indexOf('</figure>') < html.indexOf('도표 뒤의 문장.'));
    assert.ok(html.includes(diagrams[type].title));
    assert.ok(!html.includes('folio-diagram-error'));
    xmlCheck(`<body xmlns="http://www.w3.org/1999/xhtml">${html}</body>`, `
for node in root.iter():
    assert node.tag.split('}')[-1] not in ('script', 'iframe', 'foreignObject')
    assert not any(key.lower().startswith('on') for key in node.attrib)
${['bar', 'line'].includes(type) ? "assert len(root.findall('.//{http://www.w3.org/2000/svg}svg')) == 1" : ''}
`);
  });
}

test('numeric diagrams preserve signed and zero values alongside accessible source evidence', () => {
  for (const type of ['bar', 'line']) {
    const html = renderMarkdown(block(diagrams[type]));
    assert.match(html, /<svg\b/);
    for (const text of ['봄', '여름', '가을', '12', '-20', '0', '만원']) assert.ok(html.includes(text), text);
    assert.ok(!/NaN|Infinity|undefined/.test(html));
    assert.match(html, /<table\b/);
    assert.match(html, /role="img"/);
  }
});

test('all diagram text is escaped in HTML and remains well-formed XML', () => {
  const hostile = '<script>alert("x")</script> & "quoted"';
  const values = [
    { ...diagrams.table, title: hostile, caption: hostile, columns: [hostile, '용도'], rows: [[hostile, '기록']] },
    { ...diagrams.flow, title: hostile, caption: hostile, labels: [hostile, '완료'] },
    { ...diagrams.bar, title: hostile, caption: hostile, labels: [hostile, '여름', '가을'] },
  ];
  for (const value of values) {
    const html = renderMarkdown(block(value));
    assert.match(html, /&lt;script&gt;/);
    assert.ok(!html.includes('<script>'));
    xmlCheck(`<body xmlns="http://www.w3.org/1999/xhtml">${html}</body>`);
  }
});

test('malformed, unsafe and unfinished diagram fences retain escaped data and a visible notice', () => {
  const malformed = '{"type":"bar","title":"<script>bad</script>"';
  const unknown = { ...diagrams.flow, type: 'script' };
  const noEvidence = { ...diagrams.bar, evidence: [] };
  for (const content of [`\`\`\`folio-diagram\n${malformed}\n\`\`\``, block(unknown), block(noEvidence), `\`\`\`folio-diagram\n${JSON.stringify(diagrams.bar)}`]) {
    const html = renderMarkdown(content);
    assert.match(html, /도표를 표시할 수 없습니다/);
    assert.match(html, /<pre><code>/);
    assert.ok(!html.includes('<svg'));
    assert.ok(!html.includes('<script>'));
    xmlCheck(`<body xmlns="http://www.w3.org/1999/xhtml">${html}</body>`);
  }
  assert.match(renderMarkdown(`\`\`\`folio-diagram\n${malformed}\n\`\`\``), /&lt;script&gt;bad&lt;\/script&gt;/);
});

test('outer code fences protect nested diagram examples and normal code keeps its old semantics', () => {
  const nested = `\`\`\`\`markdown\n${block(diagrams.bar)}\n\`\`\`\``;
  const html = renderMarkdown(nested);
  assert.match(html, /^<pre><code>/);
  assert.ok(html.includes('```folio-diagram'));
  assert.ok(!html.includes('<figure'));
  assert.ok(!html.includes('folio-diagram-error'));
  assert.equal(renderMarkdown('```js\n<script>unsafe</script>\n```'), '<pre><code>&lt;script&gt;unsafe&lt;/script&gt;</code></pre>');
  assert.equal(renderMarkdown('~~~txt\n``\n~~~'), '<pre><code>``</code></pre>');
  assert.equal(renderMarkdown('```txt\nunfinished'), '<pre><code>unfinished</code></pre>');
  assert.match(renderMarkdown(`~~~folio-diagram\n${JSON.stringify(diagrams.flow)}\n~~~`), /<figure/);
});

test('standard Markdown pipe tables render alignment, inline text and literal pipes safely', () => {
  const html = renderMarkdown('표 앞.\n\n| 항목 | 설명 | 수치 |\n| :--- | :---: | ---: |\n| **중요** | A\\|B와 `C|D` | 12 |\n| <script>x</script> | [안전](https://example.com?a=1&b=2) | -2 |\n\n표 뒤.');
  assert.match(html, /<table class="folio-markdown-table">/);
  assert.match(html, /<th scope="col" class="folio-align-left">항목<\/th>/);
  assert.match(html, /folio-align-center/);
  assert.match(html, /folio-align-right/);
  assert.match(html, /<strong>중요<\/strong>/);
  assert.match(html, /A\|B와 <code>C\|D<\/code>/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  xmlCheck(`<body xmlns="http://www.w3.org/1999/xhtml">${html}</body>`, `
ns = {'h': 'http://www.w3.org/1999/xhtml'}
rows = root.findall('.//h:tbody/h:tr', ns)
assert len(rows) == 2
assert all(len(row) == 3 for row in rows)
`);
});

test('pipe text without a divider remains prose and tables do not swallow adjacent code fences', () => {
  assert.equal(renderMarkdown('a | b\nc | d'), '<p>a | b<br />c | d</p>');
  assert.equal(renderMarkdown('제목\n---'), '<p>제목</p>\n<hr />');
  const html = renderMarkdown('| A | B |\n| --- | --- |\n| 첫째 | 둘째 |\n```text | sample\n<script>x</script>\n```');
  assert.match(html, /<\/table><\/div>\n<pre><code>&lt;script&gt;x&lt;\/script&gt;/);
});

test('EPUB embeds all diagram types, exact SVG manifest properties, reading order and safe fallback', async () => {
  const chapters = ['table', 'flow', 'bar', 'line'].map(type => chapter(type));
  chapters.push(chapter('invalid', '```folio-diagram\n{"type":"svg","body":"<svg><script>x</script></svg>"}\n```'));
  chapters.push(chapter('example', `\`\`\`\`markdown\n${block(diagrams.bar)}\n\`\`\`\``));
  const entries = zipEntries(await buildEpub(book(chapters)));
  const opf = entries.get('OEBPS/package.opf');
  for (let index = 0; index < chapters.length; index++) {
    const path = `chapter-${String(index + 1).padStart(3, '0')}.xhtml`, body = entries.get(`OEBPS/${path}`);
    const manifestItem = opf.match(new RegExp(`<item id="chapter-${index + 1}"[^>]*>`))?.[0];
    assert.ok(manifestItem);
    assert.equal(manifestItem.includes('properties="svg"'), /<svg(?:\s|>)/.test(body), path);
    assert.ok(entries.get('OEBPS/nav.xhtml').includes(`href="${path}"`));
    assert.ok(opf.includes(`<itemref idref="chapter-${index + 1}"/>`));
    xmlCheck(body);
  }
  assert.match(entries.get('OEBPS/chapter-005.xhtml'), /도표를 표시할 수 없습니다/);
  assert.ok(!entries.get('OEBPS/chapter-005.xhtml').includes('<svg'));
  assert.ok(entries.get('OEBPS/styles/book.css').includes(MARKDOWN_CSS));
  xmlCheck(opf);
});

test('standalone printable HTML includes diagrams, table styles and zero network dependencies', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Export must remain offline'); };
  try {
    const html = await exportHTML(book(['table', 'flow', 'bar', 'line'].map(type => chapter(type))));
    assert.equal(requests, 0);
    assert.equal((html.match(/<svg\b/g) || []).length, 2);
    assert.match(html, /@media print/);
    assert.match(html, /break-inside:avoid/);
    assert.ok(html.includes(MARKDOWN_CSS));
    assert.match(html, /default-src 'none'/);
    assert.ok(!html.includes('<script'));
  } finally { globalThis.fetch = originalFetch; }
});

test('Markdown export retains editable diagram source exactly and deterministic EPUB has no duplicate IDs', async () => {
  const source = block(diagrams.bar), project = book([chapter('one', source), chapter('two', source)]);
  const markdown = exportMarkdown(project);
  assert.equal(markdown.split(source).length - 1, 2);
  const first = await buildEpub(project), second = await buildEpub(project);
  assert.deepEqual(first, second);
  for (const [path, xml] of zipEntries(first)) {
    if (path.endsWith('.xhtml')) xmlCheck(xml, `
ids = [node.attrib['id'] for node in root.iter() if 'id' in node.attrib]
assert len(ids) == len(set(ids))
`);
  }
});
