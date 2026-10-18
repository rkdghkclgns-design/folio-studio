import test from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { validateDiagram, parseDiagramBlocks, serializeDiagram, diagramPlainText, countableDiagramText, stripDiagramBlocks, renderDiagram, DIAGRAM_CSS } from './dist/diagrams.js';

const table = (extra = {}) => ({ type: 'table', title: '도구를 고르는 기준', caption: '용도에 따라 선택한다.', columns: ['도구', '용도'], rows: [['연필', '스케치'], ['펜', '기록']], labels: [], values: [], unit: '', evidence: [], ...extra });
const flow = (extra = {}) => ({ type: 'flow', title: '한 장이 완성되는 순서', caption: '', columns: [], rows: [], labels: ['자료 읽기', '구성 정리', '집필'], values: [], unit: '', evidence: [], ...extra });
const bar = (extra = {}) => ({ type: 'bar', title: '계절별 매출', caption: '단위가 같은 실제 값을 비교한다.', columns: [], rows: [], labels: ['봄', '여름'], values: [1200.5, -20], unit: '만원', evidence: ['봄 매출은 1,200.5만원이다.', '여름 매출은 -20만원이다.'], ...extra });
const evidence = value => value.evidence.join('\n');
const raw = value => `\`\`\`folio-diagram\n${JSON.stringify(value)}\n\`\`\``;

test('diagram contract accepts all four types, returns detached data, and has no implicit fields', () => {
  for (const value of [table(), flow(), bar(), bar({ type: 'line' })]) {
    const result = validateDiagram(value);
    assert.deepEqual(result, value);
    assert.notEqual(result, value);
    assert.notEqual(result.labels, value.labels);
    assert.deepEqual(parseDiagramBlocks(serializeDiagram(value), { strict: true })[0].diagram, value);
    assert.equal(JSON.stringify(validateDiagram(Object.fromEntries(Object.entries(value).reverse()))), JSON.stringify(result));
  }
  const missing = table(); delete missing.caption;
  for (const value of [null, [], 'table', missing, table({ src: '<svg/>' }), table({ type: 'pie' })]) {
    assert.throws(() => validateDiagram(value), error => error.code === 'INVALID_DIAGRAM');
  }
});

test('table and flow structures enforce dimensions, textual content and empty quantitative fields', () => {
  for (const value of [
    table({ columns: ['하나'] }), table({ columns: Array(7).fill('열') }), table({ rows: [] }), table({ rows: Array.from({ length: 13 }, () => ['x', 'y']) }),
    table({ rows: [['누락']] }), table({ rows: [['문자', 12]] }), table({ rows: [['문자', 'x'.repeat(201)]] }), table({ evidence: ['근거'] }), table({ labels: ['숨긴 값'] }), table({ unit: '%' }),
    flow({ labels: ['하나'] }), flow({ labels: Array(9).fill('단계') }), flow({ labels: ['a', 'x'.repeat(121)] }), flow({ values: [1] }), flow({ evidence: ['근거'] }), flow({ columns: ['열'] }),
  ]) assert.throws(() => validateDiagram(value), /도표/);
  assert.deepEqual(validateDiagram(table({ rows: [['빈칸', '']] })).rows, [['빈칸', '']]);
});

test('numeric chart structures reject misleading labels, units, values and bounds', () => {
  for (const value of [
    bar({ labels: ['봄', ' 봄 '] }), bar({ labels: ['봄'] }), bar({ labels: ['봄', ''] }),
    bar({ values: [NaN, 20] }), bar({ values: [Infinity, 20] }), bar({ values: [1e12 + 1, 20] }), bar({ values: ['1200', 20] }), bar({ values: [20] }),
    bar({ unit: '' }), bar({ unit: 'x'.repeat(41) }), bar({ evidence: [] }), bar({ evidence: ['', '근거'] }), bar({ rows: [['a']] }),
  ]) assert.throws(() => validateDiagram(value), /도표/);
  assert.deepEqual(validateDiagram(bar({ values: [-1e12, 1e12] })).values, [-1e12, 1e12]);
});

test('text bounds, XML safety and total JSON payload bounds are checked before rendering', () => {
  for (const value of [table({ title: '' }), table({ title: 'x'.repeat(121) }), table({ caption: 'x'.repeat(501) }), table({ title: 'bad\u0000title' }), table({ caption: '\uD800' }), table({ title: 'bad\uFFFF' })]) assert.throws(() => validateDiagram(value), /도표/);
  assert.equal(validateDiagram(table({ title: '🌷'.repeat(120) })).title, '🌷'.repeat(120));
  const large = table({ columns: Array(6).fill('열'), rows: Array.from({ length: 12 }, () => Array(6).fill('글'.repeat(200))) });
  assert.throws(() => validateDiagram(large), /12,000/);
  assert.throws(() => parseDiagramBlocks('```folio-diagram\n' + ' '.repeat(12001) + '{}\n```', { strict: true }), /도표/);
});

test('numeric grounding requires the exact original quote, category, unit and exact decimal token', () => {
  const good = bar();
  assert.deepEqual(validateDiagram(good, { evidenceText: `앞 문장.\n${evidence(good)}\n뒤 문장.` }), good);
  for (const [value, source] of [
    [good, '봄 1200.5만원, 여름 -20만원'],
    [bar({ values: [1200, -20] }), evidence(good)],
    [bar({ values: [120, -20] }), evidence(good)],
    [bar({ values: [1200.5, 20] }), evidence(good)],
    [bar({ unit: '원' }), evidence(good).replaceAll('만원', '달러')],
    [bar({ evidence: ['매출은 1,200.5만원이다.', good.evidence[1]] }), `매출은 1,200.5만원이다.\n${good.evidence[1]}`],
    [good, null],
  ]) assert.throws(() => validateDiagram(value, { evidenceText: source }), /도표/);
});

test('category numbers, partial numbers, malformed commas and exponents cannot serve as numeric evidence', () => {
  const base = bar({ labels: ['1월', '2월'], values: [1, 2], unit: '건', evidence: ['1월 실적은 10건', '2월 실적은 20건'] });
  assert.throws(() => validateDiagram(base, { evidenceText: evidence(base) }), /원문 근거/);
  for (const token of ['10', '1.5', '1,20', '1e3', '11', '-1']) {
    const value = bar({ labels: ['봄', '여름'], values: [1, 20], unit: '건', evidence: [`봄 ${token}건`, '여름 20건'] });
    assert.throws(() => validateDiagram(value, { evidenceText: evidence(value) }), /원문 근거/);
  }
  const signed = bar({ values: [+12.5, -20], evidence: ['봄 +12.50만원', '여름 -20.0만원'] });
  assert.deepEqual(validateDiagram(signed, { evidenceText: evidence(signed) }), signed);
});

test('a sentence-final period is allowed but swapped values from another category are rejected', () => {
  const good = bar({ labels: ['봄', '여름'], values: [12, 20], unit: '명', evidence: ['봄에는 12명.', '여름에는 20명.'] });
  assert.deepEqual(validateDiagram(good, { evidenceText: evidence(good) }), good);
  const combined = bar({ values: [20, 1200.5], evidence: ['봄 1,200.5만원, 여름 20만원', '봄 1,200.5만원, 여름 20만원'] });
  assert.throws(() => validateDiagram(combined, { evidenceText: evidence(combined) }), /원문 근거/);
  const months = bar({ labels: ['1월', '11월'], values: [12, 20], unit: '명', evidence: ['1월 12명', '11월 20명'] });
  assert.deepEqual(validateDiagram(months, { evidenceText: evidence(months) }), months);
  const ambiguous = { ...months, values: [20, 20], evidence: ['11월 20명', '11월 20명'] };
  assert.throws(() => validateDiagram(ambiguous, { evidenceText: evidence(ambiguous) }), /원문 근거/);
});

test('numeric values must carry the same complete unit, preventing metric and magnitude swaps', () => {
  for (const [unit, actual] of [['원', '만원'], ['m', 'km'], ['USD', 'USDT'], ['%', '%p']]) {
    const value = bar({ values: [12, 20], unit, evidence: [`봄 12${actual}`, `여름 20${actual}`] });
    assert.throws(() => validateDiagram(value, { evidenceText: evidence(value) }), /원문 근거/);
    const prefixed = { ...value, evidence: [`봄 ${actual} 12`, `여름 ${actual} 20`] };
    assert.throws(() => validateDiagram(prefixed, { evidenceText: evidence(prefixed) }), /원문 근거/);
  }
  const swapped = bar({ values: [20, 20], evidence: ['봄 매출 12만원, 주문 20건', '여름 매출 20만원'] });
  assert.throws(() => validateDiagram(swapped, { evidenceText: evidence(swapped) }), /원문 근거/);
  for (const pair of [['12만원', '20만원'], ['12 (만원)', '20 (만원)'], ['(만원): 12.', '(만원): 20.']]) {
    const good = bar({ values: [12, 20], evidence: [`봄 ${pair[0]}`, `여름 ${pair[1]}`] });
    assert.deepEqual(validateDiagram(good, { evidenceText: evidence(good) }), good);
  }
  const currency = bar({ values: [12, 20], unit: 'USD', evidence: ['봄 매출 USD 12.', '여름 매출 USD: 20.'] });
  assert.deepEqual(validateDiagram(currency, { evidenceText: evidence(currency) }), currency);
  const compactCurrency = { ...currency, evidence: ['봄 매출 USD12.', '여름 매출 USD20.'] };
  assert.deepEqual(validateDiagram(compactCurrency, { evidenceText: evidence(compactCurrency) }), compactCurrency);
  for (const token of ['0x12', '0b12', 'abc12', '0_12']) {
    const invalidToken = bar({ values: [12, 20], evidence: [`봄 코드 ${token}만원`, '여름 20만원'] });
    assert.throws(() => validateDiagram(invalidToken, { evidenceText: evidence(invalidToken) }), /원문 근거/);
  }
});

test('parser preserves offsets and handles CRLF, tilde fences and longer closers', () => {
  const first = raw(table()).replaceAll('\n', '\r\n');
  const second = `~~~folio-diagram\n${JSON.stringify(flow())}\n~~~~`;
  const content = `앞 문단\n\n${first}\n\n가운데\n${second}\n뒤 문단`;
  const blocks = parseDiagramBlocks(content, { strict: true });
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks.map(block => block.diagram.type), ['table', 'flow']);
  for (const block of blocks) assert.equal(content.slice(block.start, block.end), block.raw);
  assert.equal(content.slice(blocks[1].end), '뒤 문단');
});

test('literal examples, nested fences, inline code and four-space indentation never activate diagrams', () => {
  const source = raw(bar());
  for (const content of [
    `\`\`\`\`markdown\n${source}\n\`\`\`\``,
    `~~~markdown\n${source}\n~~~`,
    `문장 ${source}`, // The opener is not at a line boundary; its final fence only opens ordinary code.
    source.split('\n').map(line => `    ${line}`).join('\n'),
    source.replace('folio-diagram', 'folio-diagram example'),
    source.replace('folio-diagram', 'FOLIO-DIAGRAM'),
  ]) assert.deepEqual(parseDiagramBlocks(content, { strict: true }), []);
});

test('malformed and unclosed diagram blocks remain visible in forgiving mode and fail strict validation', () => {
  for (const content of ['```folio-diagram\n{bad}\n```', '```folio-diagram\n{}\n```', '```folio-diagram\n' + JSON.stringify(table())]) {
    const [block] = parseDiagramBlocks(content);
    assert.equal(block.diagram, null);
    assert.match(block.error, /도표/);
    assert.equal(block.raw, content);
    assert.equal(countableDiagramText(content), content);
    assert.equal(stripDiagramBlocks(content).trim(), '');
    assert.throws(() => parseDiagramBlocks(content, { strict: true }), error => error.code === 'INVALID_DIAGRAM');
  }
});

test('parser limits reject excess figures without silently discarding the original block', () => {
  const content = `${serializeDiagram(table())}\n${serializeDiagram(flow())}`;
  const blocks = parseDiagramBlocks(content, { maxDiagrams: 1 });
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].diagram);
  assert.equal(blocks[1].diagram, null);
  assert.match(blocks[1].error, /최대 1개/);
  assert.throws(() => parseDiagramBlocks(content, { maxDiagrams: 1, strict: true }), /최대 1개/);
  assert.throws(() => parseDiagramBlocks(content, { maxDiagrams: 0, strict: true }), /최대 0개/);
});

test('countable text includes reader-visible data, not JSON keys or repeated quoted sources', () => {
  const value = bar();
  const converted = countableDiagramText(`첫 문단\n${serializeDiagram(value)}\n마지막 문단`);
  assert.ok(converted.includes(value.title));
  assert.ok(converted.includes('봄: 1200.5 만원'));
  assert.ok(!converted.includes('"evidence"'));
  assert.ok(!converted.includes(value.evidence[0]));
  assert.ok(converted.endsWith('마지막 문단'));
  assert.equal(diagramPlainText(flow()).split('\n').at(-1), '자료 읽기 → 구성 정리 → 집필');
  assert.ok(diagramPlainText(table()).includes('연필 · 스케치'));
});

test('stripping diagrams prevents their self-contained evidence from becoming a fresh source', () => {
  const content = `원본에 수치는 없다.\n${serializeDiagram(bar())}\n원본의 마지막 문장.`;
  const stripped = stripDiagramBlocks(content);
  assert.equal(stripped.includes('1,200.5'), false);
  assert.ok(stripped.includes('원본의 마지막 문장.'));
  assert.throws(() => parseDiagramBlocks(content, { strict: true, evidenceText: stripped }), /원문 근거/);
  const quoted = `\`\`\`\`markdown\n${serializeDiagram(bar())}\n\`\`\`\``;
  assert.equal(stripDiagramBlocks(quoted), quoted);
});

test('rendering escapes all authored strings and never emits active HTML, URLs, IDs or event handlers', () => {
  const payload = '<img src="https://tracker.invalid" onerror="alert(1)"> & " \' <script>evil()</script>';
  const value = table({ title: payload, caption: payload, columns: ['도구', '설명'], rows: [[payload, payload]] });
  const html = renderDiagram(value);
  const window = new Window();
  window.document.body.innerHTML = html;
  assert.equal(window.document.querySelectorAll('img,script,iframe,a,[onclick],[onerror],[id]').length, 0);
  assert.equal(window.document.querySelector('figcaption strong').textContent, payload);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.equal(window.document.querySelectorAll('table thead th[scope="col"]').length, 2);
  assert.equal(window.document.querySelector('tbody th[scope="row"]').textContent, payload);
  window.happyDOM.abort();
});

test('graphs include accessible actual data and finite geometry with a zero baseline for signed values', () => {
  for (const values of [[10, -20], [-10, -20], [0, 0], [1e12, -1e12], [1e-30, 2e-30]]) {
    for (const type of ['bar', 'line']) {
      const html = renderDiagram(bar({ type, values }));
      const window = new Window();
      window.document.body.innerHTML = html;
      const svg = window.document.querySelector('svg');
      assert.equal(svg.getAttribute('xmlns'), 'http://www.w3.org/2000/svg');
      assert.equal(svg.getAttribute('role'), 'img');
      assert.ok(svg.querySelector('title'));
      assert.ok(svg.querySelector('desc'));
      assert.equal(window.document.querySelectorAll('table tbody tr').length, 2);
      assert.equal(window.document.querySelectorAll('.folio-diagram-evidence li').length, 2);
      assert.ok(!/NaN|Infinity|undefined/.test(html));
      for (const rect of svg.querySelectorAll('rect')) {
        assert.ok(Number(rect.getAttribute('height')) >= 0);
        assert.ok(Number(rect.getAttribute('y')) >= 28);
      }
      if (type === 'line') assert.ok(svg.querySelector('polyline'));
      window.happyDOM.abort();
    }
  }
});

test('flow diagrams retain an ordered list, visible arrows and readable steps without SVG dependencies', () => {
  const html = renderDiagram(flow());
  const window = new Window();
  window.document.body.innerHTML = html;
  assert.equal(window.document.querySelectorAll('ol.folio-diagram-flow li').length, 3);
  assert.equal(window.document.querySelectorAll('.folio-diagram-arrow').length, 2);
  assert.equal(window.document.querySelectorAll('svg,script,img').length, 0);
  assert.match(DIAGRAM_CSS, /break-inside:avoid/);
  assert.match(DIAGRAM_CSS, /overflow-wrap:anywhere/);
  assert.ok(!/url\(|@import/.test(DIAGRAM_CSS));
  window.happyDOM.abort();
});

test('crowded chart axes use compact indices and full numbered category labels remain in the table', () => {
  const labels = Array.from({ length: 10 }, (_, index) => `아주 긴 범주의 이름 ${index + 1}`);
  const html = renderDiagram(bar({ labels, values: labels.map((_, index) => index), evidence: labels.map(label => `${label} 근거`) }));
  const window = new Window();
  window.document.body.innerHTML = html;
  const axes = [...window.document.querySelectorAll('svg text[y="300"]')].map(item => item.textContent);
  assert.deepEqual(axes, labels.map((_, index) => String(index + 1)));
  assert.deepEqual([...window.document.querySelectorAll('tbody th')].map(item => item.textContent), labels.map((label, index) => `${index + 1}. ${label}`));
  window.happyDOM.abort();
});
