import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { getCoverPresentation, normalizeCoverDesign, validateCoverDesign } from './dist/cover.js';
import { buildEpub, exportHTML } from './dist/export.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const svgSource = value => `data:image/svg+xml,${encodeURIComponent(value)}`;
const ART = svgSource('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><title>원래 삽화</title><rect width="800" height="1200" fill="#123456"/></svg>');
const design = overrides => ({ source: 'background', fit: 'contain', position: 'bottom', overlay: 60, textColor: 'dark', layout: 'bottom', ...overrides });
const fixture = overrides => ({
  id: 'cover-fixture', title: '땅의 온도를 읽는 사람', subtitle: '도시의 정원과 계절의 기록', author: '김정원', language: 'ko', theme: 'sand',
  updatedAt: '2026-10-18T00:00:00.000Z', coverImage: { src: ART, alt: '원래 삽화' }, coverBackground: { src: PNG, alt: '사용자 사진' },
  coverDesign: design(), chapters: [{ title: '씨앗을 심는 날', content: '이른 아침 흙을 고르고 씨앗을 심었다.' }], ...overrides,
});

function entries(bytes) {
  const files = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), nameSize = view.getUint16(offset + 26, true), extraSize = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameSize));
    const start = offset + 30 + nameSize + extraSize;
    files.set(name, bytes.subarray(start, start + size)); offset = start + size;
  }
  return files;
}
const text = (files, path) => new TextDecoder().decode(files.get(path));

test('legacy cover defaults and optional partial settings remain independent data objects', () => {
  const first = normalizeCoverDesign(), second = normalizeCoverDesign();
  assert.deepEqual(first, { source: 'art', fit: 'cover', position: 'center', overlay: 45, textColor: 'light', layout: 'top' });
  first.overlay = 0;
  assert.equal(second.overlay, 45);
  assert.deepEqual(validateCoverDesign({ layout: 'center' }), { ...second, layout: 'center' });
  assert.deepEqual(normalizeCoverDesign(null), second);
});

test('strict imports reject malformed styling while display normalization cannot emit arbitrary CSS', () => {
  for (const bad of [null, [], 'cover', { overlay: -1 }, { overlay: 81 }, { overlay: 1.5 }, { overlay: '45' }, { overlay: NaN }, { source: 'url(https://tracker.invalid)' }, { fit: 'cover;color:red' }, { position: 'left' }, { textColor: '#000' }, { layout: 'fixed' }, { style: 'background:url(evil)' }]) {
    assert.throws(() => validateCoverDesign(bad), /표지 설정/);
    const normalized = normalizeCoverDesign(bad);
    assert.ok(['cover', 'contain'].includes(normalized.fit));
    assert.ok(Number.isInteger(normalized.overlay) && normalized.overlay >= 0 && normalized.overlay <= 80);
  }
  assert.equal(validateCoverDesign({ overlay: 0 }).overlay, 0);
  assert.equal(validateCoverDesign({ overlay: 80 }).overlay, 80);
});

test('cover selection preserves both originals and falls back when the selected source is missing', () => {
  const project = fixture(), before = structuredClone(project);
  let presentation = getCoverPresentation(project);
  assert.equal(presentation.source, 'background');
  assert.equal(presentation.image, project.coverBackground);
  assert.equal(presentation.objectPosition, 'center bottom');
  assert.equal(presentation.justifyContent, 'flex-end');
  assert.equal(presentation.ink, '#17251d');
  assert.equal(presentation.shade, '#fff');
  assert.deepEqual(project, before);
  presentation = getCoverPresentation({ ...project, coverBackground: null });
  assert.equal(presentation.source, 'art');
  assert.equal(presentation.image, project.coverImage);
  presentation = getCoverPresentation({ ...project, coverImage: null, coverDesign: { source: 'art' } });
  assert.equal(presentation.source, 'background');
  assert.equal(presentation.image, project.coverBackground);
  assert.equal(getCoverPresentation({ theme: 'constructor' }).palette.background, '#e9eee5');
});

test('HTML and printable PDF markup applies the selected user background and all cover controls', async () => {
  const html = await exportHTML(fixture());
  assert.ok(html.includes(PNG));
  assert.ok(!html.includes(Buffer.from(decodeURIComponent(ART.split(',')[1])).toString('base64')));
  assert.ok(html.includes('object-fit:contain;object-position:center bottom'));
  assert.ok(html.includes('background:#fff;opacity:0.6'));
  assert.ok(html.includes('style="color:#17251d"'));
  assert.ok(html.includes('style="justify-content:flex-end"'));
  assert.ok(html.includes('<h1>땅의 온도를 읽는 사람</h1>'));
  assert.ok(html.includes('김정원 지음'));
  assert.ok(html.includes('padding-top:150%'));
  assert.ok(html.includes('height:178mm;width:118.66mm;max-width:100%;padding-top:0'));
});

test('switching back to generated artwork changes only the rendered source', async () => {
  const project = fixture({ coverDesign: design({ source: 'art', fit: 'cover', position: 'top', overlay: 0, textColor: 'light', layout: 'center' }) });
  const before = structuredClone(project);
  const html = await exportHTML(project);
  assert.ok(!html.includes(PNG));
  assert.ok(html.includes('data:image/svg+xml;base64,'));
  assert.ok(html.includes('object-fit:cover;object-position:center top'));
  assert.ok(html.includes('background:#000;opacity:0'));
  assert.ok(html.includes('style="justify-content:center"'));
  assert.deepEqual(project, before);
});

test('EPUB thumbnail composes the title, subtitle, author and selected image into one self-contained cover', async () => {
  const files = entries(await buildEpub(fixture()));
  const opf = text(files, 'OEBPS/package.opf'), svg = text(files, 'OEBPS/images/cover.svg');
  assert.match(opf, /id="cover-image" href="images\/cover.svg" media-type="image\/svg\+xml" properties="cover-image"/);
  assert.equal((opf.match(/properties="cover-image"/g) || []).length, 1);
  assert.ok(svg.includes('viewBox="0 0 1200 1800"'));
  assert.ok(svg.includes(`xlink:href="${PNG}"`));
  assert.ok(svg.includes('preserveAspectRatio="xMidYMax meet"'));
  assert.ok(svg.includes('fill="#fff" opacity="0.6"'));
  assert.ok(svg.includes('<title>땅의 온도를 읽는 사람</title>'));
  assert.ok(svg.includes('도시의 정원과 계절의 기록'));
  assert.ok(svg.includes('김정원 지음'));
  assert.ok(text(files, 'OEBPS/cover.xhtml').includes('src="images/cover.svg"'));
  const parsed = spawnSync('python3', ['-X', 'utf8', '-c', 'import sys,xml.etree.ElementTree as E; E.fromstring(sys.stdin.buffer.read())'], { input: svg, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
});

test('a background-only project gets a composed EPUB cover even without explicit settings', async () => {
  const project = fixture({ coverImage: null, coverDesign: undefined });
  const files = entries(await buildEpub(project));
  const svg = text(files, 'OEBPS/images/cover.svg');
  assert.ok(svg.includes(`xlink:href="${PNG}"`));
  assert.ok(svg.includes('preserveAspectRatio="xMidYMid slice"'));
  assert.ok((await exportHTML(project)).includes(PNG));
});

test('a configured text-only cover honors title placement without applying an image shade', async () => {
  const make = layout => fixture({ coverImage: null, coverBackground: null, coverDesign: design({ layout }) });
  const topFiles = entries(await buildEpub(make('top'))), bottomFiles = entries(await buildEpub(make('bottom')));
  const top = text(topFiles, 'OEBPS/images/cover.svg'), bottom = text(bottomFiles, 'OEBPS/images/cover.svg');
  const baseline = svg => Number(svg.match(/<text x="100" y="([\d.]+)"[^>]*font-weight="500"/)[1]);
  assert.ok(baseline(bottom) > baseline(top));
  assert.ok(!top.includes('<image '));
  assert.ok(!top.includes('opacity="0.6"'));
  assert.ok(top.includes('fill="#584635"'));
  assert.ok(top.includes('viewBox="0 0 1200 1800"'));
});

test('title-like HTML cannot escape SVG or HTML text on a custom background', async () => {
  const project = fixture({ title: '<script>alert("표지")</script> & 제목', subtitle: '<img onerror="evil"/>', author: '<작가> & 저자' });
  const files = entries(await buildEpub(project));
  const svg = text(files, 'OEBPS/images/cover.svg'), html = await exportHTML(project);
  for (const output of [svg, html]) {
    assert.ok(!output.includes('<script>'));
    assert.ok(!output.includes('<img onerror='));
    assert.ok(output.includes('&lt;script&gt;'));
    assert.ok(output.includes('&lt;작가&gt; &amp; 저자'));
  }
});

test('selected external and active background sources fail without a network request', async () => {
  const saved = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Unexpected request'); };
  try {
    for (const src of ['https://tracker.invalid/background.png', 'blob:https://folio.invalid/expired', 'file:///private/background.png', svgSource('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.invalid/x"/></svg>')]) {
      const project = fixture({ coverBackground: { src } });
      await assert.rejects(() => buildEpub(project));
      await assert.rejects(() => exportHTML(project));
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = saved; }
});

test('unused retained art is never fetched or embedded when the user chooses their background', async () => {
  const project = fixture({ coverImage: { src: 'https://old.invalid/art.png' } });
  const html = await exportHTML(project);
  const files = entries(await buildEpub(project));
  assert.ok(html.includes(PNG));
  assert.ok(!html.includes('old.invalid'));
  assert.ok(!text(files, 'OEBPS/images/cover.svg').includes('old.invalid'));
});

test('composed SVG keeps an entire long Korean title and subtitle instead of silently shortening them', async () => {
  const title = '남겨두고싶은문장'.repeat(24).slice(0, 198) + '😀';
  const subtitle = '정원에서보낸계절의기록'.repeat(45).slice(0, 500);
  const files = entries(await buildEpub(fixture({ title, subtitle })));
  const svg = text(files, 'OEBPS/images/cover.svg');
  const parsed = spawnSync('python3', ['-X', 'utf8', '-c', String.raw`
import sys,xml.etree.ElementTree as E,json
root=E.fromstring(sys.stdin.read()); lines=root.findall('{http://www.w3.org/2000/svg}text')
texts=''.join(n.text or '' for n in lines)
assert max(float(n.attrib['y']) for n in lines)<1800
print(json.dumps(texts,ensure_ascii=False))
`], { input: svg, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  const contents = JSON.parse(parsed.stdout);
  assert.ok(contents.includes(title));
  assert.ok(contents.includes(subtitle));
  assert.ok(!svg.includes('…'));
});

test('new cover exports remain deterministic and leave the saved project unchanged', async () => {
  const project = fixture(), before = structuredClone(project);
  assert.deepEqual(await buildEpub(project), await buildEpub(project));
  await exportHTML(project);
  assert.deepEqual(project, before);
});
