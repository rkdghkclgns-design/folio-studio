import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildEpub, exportHTML, exportMarkdown, projectToText, validateImageSource } from './dist/export.js';
import { generateIllustrationSVG, sampleProject } from './dist/editorial.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==';
const fixture = overrides => ({
  id: 'book-한국어-1', title: '오래 머무는 문장', subtitle: '마음의 속도로 쓰는 이야기',
  author: '김작가', description: '당신의 하루를 기록하는 책.', language: 'ko', theme: 'sage',
  updatedAt: '2026-10-18T00:00:00.000Z',
  chapters: [
    { id: 'one', title: '작은 시작', content: '# 처음의 마음\n\n안녕하세요. **소중한 문장**과 *고요한 순간*.\n둘째 줄입니다.\n\n> 마음이 머무는 자리\n\n- 하나\n- 둘\n\n1. 첫째\n2. 둘째\n\n`코드`와 [안전한 링크](https://example.org/a?x=1&y=2).', image: { src: PNG, alt: '잎사귀 & 햇살', caption: '삽화 설명 <첫 번째>' } },
    { id: 'two', title: '다음 페이지', content: '두 번째 장의 모든 내용이 실려야 합니다.\n\n```js\n<script>alert(1)</script>\n```' },
  ], ...overrides,
});

function zipEntries(bytes) {
  const entries = new Map();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const path = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    const start = offset + 30 + nameLength + extraLength;
    entries.set(path, bytes.subarray(start, start + size));
    offset = start + size;
  }
  return entries;
}

test('EPUB is a valid ZIP with correct CRCs, XML, complete manifest, navigation and reading order', async () => {
  const bytes = await buildEpub(fixture());
  assert.ok(bytes instanceof Uint8Array);
  const folder = await mkdtemp(join(tmpdir(), 'folio-export-'));
  try {
    const path = join(folder, 'book.epub');
    await writeFile(path, bytes);
    const python = spawnSync('python3', ['-X', 'utf8', '-c', String.raw`
import sys, zipfile, xml.etree.ElementTree as ET, posixpath
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None, 'ZIP CRC mismatch'
    first = z.infolist()[0]
    assert first.filename == 'mimetype'
    assert first.compress_type == zipfile.ZIP_STORED
    assert first.extra == b''
    assert z.read('mimetype') == b'application/epub+zip'
    names = set(z.namelist())
    for name in names:
        assert not name.startswith('/') and '..' not in name.split('/')
        if name.endswith(('.xml', '.opf', '.xhtml', '.svg')):
            root = ET.fromstring(z.read(name))
            if name.endswith('.xhtml'):
                for node in root.iter():
                    assert node.tag.split('}')[-1] not in ('script', 'iframe', 'object')
                    for key, value in node.attrib.items():
                        assert not key.lower().startswith('on')
                        if key in ('href', 'src') and not value.startswith(('https:', 'http:', 'mailto:', '#')):
                            target = posixpath.normpath(posixpath.join(posixpath.dirname(name), value.split('#')[0]))
                            assert target in names, (name, value)
    ns = {'opf':'http://www.idpf.org/2007/opf','dc':'http://purl.org/dc/elements/1.1/','h':'http://www.w3.org/1999/xhtml','epub':'http://www.idpf.org/2007/ops'}
    opf = ET.fromstring(z.read('OEBPS/package.opf'))
    assert opf.attrib['version'] == '3.0'
    assert opf.find('opf:metadata/dc:title', ns).text == '오래 머무는 문장'
    assert opf.find('opf:metadata/dc:language', ns).text == 'ko'
    manifest = {i.attrib['id']:i.attrib for i in opf.find('opf:manifest', ns)}
    for item in manifest.values(): assert 'OEBPS/' + item['href'] in names
    assert len([i for i in manifest.values() if i.get('properties') == 'cover-image']) == 1
    spine = [i.attrib['idref'] for i in opf.find('opf:spine', ns)]
    assert spine == ['cover', 'titlepage', 'nav', 'chapter-1', 'chapter-2']
    for ref in spine: assert ref in manifest
    nav = ET.fromstring(z.read('OEBPS/nav.xhtml'))
    toc = nav.find('.//h:nav[@id="toc"]/h:ol', ns)
    assert [li.find('h:a', ns).text for li in toc] == ['작은 시작', '다음 페이지']
    assert '두 번째 장의 모든 내용' in z.read('OEBPS/chapter-002.xhtml').decode()
print('ZIP, CRC, XML, manifest, spine and navigation verified')
`, path], { encoding: 'utf8' });
    assert.equal(python.status, 0, python.stderr || python.stdout);
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('EPUB safely escapes user content and preserves limited Markdown formatting', async () => {
  const project = fixture({ title: '<script>alert("title")</script> & 한글', author: '작가\u0000 & <태그>', chapters: [
    { title: '<img src=x onerror=alert(1)>', content: '<script>alert(1)</script>\n\n**굵게** *기울임* `코드`\n\n[실행 금지](javascript:alert)\n\n[웹 링크](https://example.com)' },
  ] });
  const entries = zipEntries(await buildEpub(project));
  const chapter = new TextDecoder().decode(entries.get('OEBPS/chapter-001.xhtml'));
  assert.ok(chapter.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(chapter.includes('<strong>굵게</strong>'));
  assert.ok(chapter.includes('<em>기울임</em>'));
  assert.ok(chapter.includes('<code>코드</code>'));
  assert.ok(!chapter.includes('href="javascript:'));
  assert.ok(!chapter.includes('<script>'));
  assert.ok(chapter.includes('href="https://example.com/"'));
  const opf = new TextDecoder().decode(entries.get('OEBPS/package.opf'));
  assert.ok(!opf.includes('\u0000'));
  assert.ok(opf.includes('&lt;script&gt;'));
});

test('HTML is a standalone printable document containing every chapter and embedded image', async () => {
  const html = await exportHTML(fixture());
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('lang="ko"'));
  assert.ok(html.includes('data:image/png;base64,'));
  assert.ok(html.includes('data:image/svg+xml;base64,'));
  assert.ok(html.includes('두 번째 장의 모든 내용'));
  assert.ok(html.includes('break-before:page'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('삽화 설명 &lt;첫 번째&gt;'));
});

test('shared uploaded cover and chapter images are embedded once with correct cover metadata', async () => {
  const entries = zipEntries(await buildEpub(fixture({ coverImage: { src: PNG, alt: '직접 만든 표지' } })));
  assert.equal([...entries.keys()].filter(name => name.startsWith('OEBPS/images/')).length, 1);
  const opf = new TextDecoder().decode(entries.get('OEBPS/package.opf'));
  assert.equal((opf.match(/properties="cover-image"/g) || []).length, 1);
  assert.ok(opf.includes('media-type="image/png"'));
});

test('unsupported, corrupt and unsafe image sources fail explicitly instead of dropping artwork', async () => {
  for (const src of ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,aW52YWxpZA==', 'javascript:alert(1)', 'file:///private/image.png']) {
    await assert.rejects(() => buildEpub(fixture({ coverImage: { src } })));
    await assert.rejects(() => exportHTML(fixture({ coverImage: { src } })));
  }
});

test('legacy remote artwork fails with reupload guidance without making any network request', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('Export must remain offline'); };
  try {
    for (const src of ['https://tracker.invalid/book.png', 'http://127.0.0.1/private.png', '/private/account/delete', 'blob:https://folio.invalid/old-image']) {
      for (const project of [fixture({ coverImage: { src } }), fixture({ chapters: [{ title: '저장된 장', content: '원고', image: { src } }] })]) {
        await assert.rejects(() => buildEpub(project), /직접 업로드/);
        await assert.rejects(() => exportHTML(project), /직접 업로드/);
      }
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('text exports preserve Korean manuscript content and input validation is explicit', async () => {
  const project = fixture();
  assert.ok(exportMarkdown(project).includes('## 다음 페이지'));
  assert.ok(exportMarkdown(project).includes('두 번째 장의 모든 내용'));
  assert.ok(projectToText(project).includes('지은이: 김작가'));
  assert.ok(projectToText(project).includes('2. 다음 페이지'));
  assert.throws(() => projectToText(null), /책을 먼저/);
  await assert.rejects(() => buildEpub({ title: '잘못된 책' }), /장 목록/);
  assert.ok((await exportHTML(fixture({ title: '', author: '', language: '<script>' }))).includes('lang="ko"'));
});

test('exports are deterministic with a stable project timestamp', async () => {
  const first = await buildEpub(fixture());
  const second = await buildEpub(fixture());
  assert.deepEqual(first, second);
});

const svgSource = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

test('the real sample project exports every generated SVG illustration as safe, well-formed SVG', async () => {
  const project = sampleProject();
  const entries = zipEntries(await buildEpub(project));
  const illustrations = [...entries].filter(([path]) => /^OEBPS\/images\/image-\d+\.svg$/.test(path));
  assert.equal(illustrations.length, project.chapters.filter(chapter => chapter.image).length);
  for (const [path, bytes] of illustrations) {
    const svg = new TextDecoder().decode(bytes);
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), path);
    assert.ok(svg.includes('<path '));
    assert.ok(svg.includes('<title '));
    const parsed = spawnSync('python3', ['-X', 'utf8', '-c', 'import sys,xml.etree.ElementTree as E; E.fromstring(sys.stdin.read())'], { input: svg, encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
  const html = await exportHTML(project);
  assert.equal((html.match(/data:image\/svg\+xml;base64,/g) || []).length, illustrations.length + 1);
});

test('all original drawing styles and palettes survive strict SVG reconstruction', async () => {
  for (const theme of ['sage', 'sand', 'ink', 'terracotta', 'ocean', 'lavender']) {
    for (const kind of ['botanical', 'landscape', 'abstract']) {
      const svg = generateIllustrationSVG(theme, '검증용 씨앗', kind);
      const project = fixture({ coverImage: { src: svgSource(svg), alt: '생성 표지' }, chapters: [] });
      const entries = zipEntries(await buildEpub(project));
      const asset = new TextDecoder().decode(entries.get('OEBPS/images/image-1.svg'));
      assert.ok(asset.includes('<path '), `${theme}/${kind}`);
      const cover = new TextDecoder().decode(entries.get('OEBPS/cover.xhtml'));
      assert.ok(cover.includes('<h1>오래 머무는 문장</h1>'));
      assert.ok(cover.includes('김작가 지음'));
    }
  }
});

test('SVG rejects active content, external references, entity tricks and malformed XML', async () => {
  const attacks = [
    '<script>alert(1)</script>',
    '<g onload="alert(1)"><path d="M0 0"/></g>',
    '<foreignObject><body>HTML</body></foreignObject>',
    '<image href="https://evil.example/image.png"/>',
    '<use href="#shape"/>',
    '<a href="javascript:alert(1)"><rect width="1" height="1"/></a>',
    '<style>@import url(https://evil.example/style.css)</style>',
    '<rect style="fill:url(https://evil.example/image.svg)" width="1" height="1"/>',
    '<rect fill="url(https://evil.example/image.svg)" width="1" height="1"/>',
    '<rect fill="u&#114;l(https://evil.example/image.svg)"/>',
    '<rect xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="https://evil.example"/>',
    '<title>&stolen;</title>',
    '<title>&#60;script&#62;</title>',
    '<rect width="1" width="2"/>',
    '<g><path d="M0 0"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<?xml-stylesheet href="https://evil.example"?>',
    '<![CDATA[unsafe markup]]>',
  ];
  for (const content of attacks) {
    const src = svgSource(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`);
    await assert.rejects(() => buildEpub(fixture({ coverImage: { src } })), /안전한 도형 SVG/, content);
  }
  const dtd = '<!DOCTYPE svg [<!ENTITY stolen SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg"><title>&stolen;</title></svg>';
  await assert.rejects(() => exportHTML(fixture({ coverImage: { src: svgSource(dtd) } })), /안전한 도형 SVG/);
});

test('safe SVG text is escaped anew, base64 works and custom covers retain title, author and A5 print layout', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#fff"/><text x="10" y="20" font-family="sans-serif">&lt;script&gt; &amp; 한글</text></svg>';
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const project = fixture({ coverImage: { src, alt: '그림 & <문자>' } });
  const entries = zipEntries(await buildEpub(project));
  const artwork = new TextDecoder().decode(entries.get('OEBPS/images/image-1.svg'));
  assert.ok(artwork.includes('&lt;script&gt; &amp; 한글'));
  assert.ok(!artwork.includes('<script>'));
  const html = await exportHTML(project);
  assert.ok(html.includes('class="cover-copy"'));
  assert.ok(html.includes('김작가 지음'));
  assert.ok(html.includes('@page{size:A5;margin:16mm 13mm}'));
  assert.ok(html.includes('max-height:178mm'));
  assert.ok(html.includes('max-height:145mm'));
  const epubStyle = new TextDecoder().decode(entries.get('OEBPS/styles/book.css'));
  assert.ok(!epubStyle.includes('size:A5'));
});

test('shared image validation rejects truncated PNGs and bad chunk CRCs while preserving real artwork', () => {
  assert.equal(validateImageSource(PNG), PNG);
  assert.equal(validateImageSource(PNG.replace('image/png', 'image/jpeg')), PNG, 'canonical MIME follows validated file content');
  assert.equal(validateImageSource(PNG.replace(';base64,', ';base64,\n')), PNG);
  const bytes = Buffer.from(PNG.split(',')[1], 'base64');
  for (const length of [8, 16, 33, bytes.length - 1]) {
    assert.throws(() => validateImageSource(`data:image/png;base64,${bytes.subarray(0, length).toString('base64')}`), /손상/);
  }
  const corrupt = Buffer.from(bytes); corrupt[45] ^= 1;
  assert.throws(() => validateImageSource(`data:image/png;base64,${corrupt.toString('base64')}`), /손상/);
  for (const address of ['https://example.org/tracker.png', 'file:///private.png', 'blob:https://example.org/image']) {
    assert.throws(() => validateImageSource(address), /직접 업로드/);
  }
});

test('image pixel limits are checked from valid headers before browser decoding', () => {
  const makePNG = (width, height) => {
    const result = spawnSync('python3', ['-X', 'utf8', '-c', String.raw`
import sys, struct, zlib, base64
def chunk(kind, data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
data=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',int(sys.argv[1]),int(sys.argv[2]),8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\0\0\0\xff'))+chunk(b'IEND',b'')
print(base64.b64encode(data).decode())
`, String(width), String(height)], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return `data:image/png;base64,${result.stdout.trim()}`;
  };
  assert.throws(() => validateImageSource(makePNG(10000, 10000)), /5,000만 화소/);
  assert.throws(() => validateImageSource(makePNG(0, 1)), /손상/);
  assert.throws(() => validateImageSource(`data:image/png;base64,${'A'.repeat(16 * 1024 * 1024 + 65536)}`), /12MB/);
});

test('WebP checks its RIFF size and rejects header-only images before export', async () => {
  // Independently encoded one-pixel VP8 image, not a synthetic RIFF signature.
  const value = 'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=';
  const source = `data:image/webp;base64,${value}`;
  assert.equal(validateImageSource(source), source);
  assert.ok((await exportHTML(fixture({ coverImage: { src: source } }))).includes(source));
  const truncated = Buffer.from(value, 'base64').subarray(0, 20);
  assert.throws(() => validateImageSource(`data:image/webp;base64,${truncated.toString('base64')}`), /손상/);
  assert.throws(() => validateImageSource('data:image/jpeg;base64,/9j/2Q=='), /손상/);
});

test('SVG IDs, accessible descriptions and nonnegative drawing dimensions stay coherent', () => {
  const valid = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" role="img" aria-labelledby="name" aria-describedby="description"><title id="name">한글 삽화</title><desc id="description">화면을 가로지르는 선</desc><path d="M0 0L100 100"/></svg>';
  const normalized = validateImageSource(svgSource(valid));
  const decoded = Buffer.from(normalized.split(',')[1], 'base64').toString();
  assert.ok(decoded.includes('aria-labelledby="name"'));
  assert.ok(decoded.includes('<title id="name">한글 삽화</title>'));
  for (const broken of [
    valid.replace('id="description"', 'id="name"'),
    valid.replace('aria-labelledby="name"', 'aria-labelledby="missing"'),
    valid.replace('width="100"', 'width="-100"'),
    valid.replace('width="100"', 'viewBox="0 0 -100 100"'),
  ]) assert.throws(() => validateImageSource(svgSource(broken)), /안전한 도형 SVG/);
});

test('Unicode and XML-invalid control characters cannot corrupt an exported publication', async () => {
  const source = '한글 😀 𠮷 e\u0301 & <태그>\u0000\uD800\uFFFF';
  const entries = zipEntries(await buildEpub(fixture({ title: source, author: source, chapters: [{ title: source, content: source }] })));
  for (const [path, bytes] of entries) {
    if (!/\.(xhtml|opf|svg|xml)$/.test(path)) continue;
    const parsed = spawnSync('python3', ['-X', 'utf8', '-c', 'import sys,xml.etree.ElementTree as E; E.fromstring(sys.stdin.buffer.read())'], { input: bytes, encoding: 'utf8' });
    assert.equal(parsed.status, 0, `${path}: ${parsed.stderr}`);
  }
  const chapter = new TextDecoder().decode(entries.get('OEBPS/chapter-001.xhtml'));
  assert.ok(chapter.includes('한글 😀 𠮷 e\u0301 &amp; &lt;태그&gt;'));
  assert.ok(chapter.includes('\uFFFD'));
});

test('a thousand chapters retain unique manifest IDs and navigation links at filename boundaries', async () => {
  const chapters = Array.from({ length: 1000 }, (_, index) => ({ title: `제${index + 1}장 & 끝`, content: `고유 원고 ${index + 1}` }));
  const entries = zipEntries(await buildEpub(fixture({ chapters })));
  const opf = new TextDecoder().decode(entries.get('OEBPS/package.opf'));
  const nav = new TextDecoder().decode(entries.get('OEBPS/nav.xhtml'));
  const parsed = spawnSync('python3', ['-X', 'utf8', '-c', String.raw`
import json,sys,xml.etree.ElementTree as E
data=json.load(sys.stdin); ns={'o':'http://www.idpf.org/2007/opf','h':'http://www.w3.org/1999/xhtml'}
opf=E.fromstring(data['opf']); items=opf.findall('o:manifest/o:item',ns)
ids=[item.attrib['id'] for item in items]; assert len(ids)==len(set(ids))
spine=opf.findall('o:spine/o:itemref',ns); assert len(spine)==1003
assert [item.attrib['idref'] for item in spine[3:]]==['chapter-'+str(i) for i in range(1,1001)]
nav=E.fromstring(data['nav']); links=nav.findall('.//h:nav[@id="toc"]/h:ol/h:li/h:a',ns)
assert len(links)==1000
for link in links: assert 'OEBPS/'+link.attrib['href'] in data['names']
assert links[-1].attrib['href']=='chapter-1000.xhtml'
`,], { input: JSON.stringify({ opf, nav, names: [...entries.keys()] }), encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  await assert.rejects(() => buildEpub(fixture({ chapters: [...chapters, chapters[0]] })), /1,000/);
});

test('the cover adapts its title size without silently truncating a supported 160-character Korean title', async () => {
  const title = '소중하게남겨두고싶은문장'.repeat(20).slice(0, 158) + '😀';
  const entries = zipEntries(await buildEpub(fixture({ title })));
  const svg = new TextDecoder().decode(entries.get('OEBPS/images/cover.svg'));
  const parsed = spawnSync('python3', ['-X', 'utf8', '-c', String.raw`
import sys,xml.etree.ElementTree as E,json
root=E.fromstring(sys.stdin.read())
lines=[node for node in root.findall('{http://www.w3.org/2000/svg}text') if node.attrib.get('x')=='100']
assert max(float(node.attrib['y']) for node in lines)<1250
print(json.dumps(''.join(node.text or '' for node in lines),ensure_ascii=False))
`], { input: svg, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal(JSON.parse(parsed.stdout), title);
});

test('long, tilde and unclosed code fences preserve code verbatim, including C# and nested fence examples', async () => {
  const blocks = [
    '# 코드 안의 제목\n```\nSystem.Console.WriteLine("<문자>");\n~~~\n```` still code',
    '<script>문자일 뿐입니다</script>\n```',
    '~~~\n끝까지 남겨야 하는 코드',
  ];
  const content = `\`\`\`\`c#\n${blocks[0]}\n\`\`\`\`\n\n첫째 본문\n\n~~~text\n${blocks[1]}\n~~~\n\n둘째 본문\n\n~~~~markdown\n${blocks[2]}`;
  const project = fixture({ chapters: [{ title: '코드 예제', content }] });
  const entries = zipEntries(await buildEpub(project));
  const chapter = new TextDecoder().decode(entries.get('OEBPS/chapter-001.xhtml'));
  const parsed = spawnSync('python3', ['-X', 'utf8', '-c', String.raw`
import sys,json,xml.etree.ElementTree as E
root=E.fromstring(sys.stdin.read()); ns={'h':'http://www.w3.org/1999/xhtml'}
codes=[node.text or '' for node in root.findall('.//h:pre/h:code',ns)]
paragraphs=[node.text for node in root.findall('.//h:p',ns)]
assert '첫째 본문' in paragraphs and '둘째 본문' in paragraphs
assert not root.findall('.//h:script',ns)
print(json.dumps(codes,ensure_ascii=False))
`], { input: chapter, encoding: 'utf8' });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(JSON.parse(parsed.stdout), blocks);
  const html = await exportHTML(project);
  assert.equal((html.match(/<pre><code>/g) || []).length, 3);
  assert.ok(html.includes('&lt;script&gt;문자일 뿐입니다&lt;/script&gt;'));
});


test('generated cover wraps Korean title at word boundaries', async () => {
  const entries = zipEntries(await buildEpub(fixture({ title: '한국어 출판 조판 검증' })));
  const svg = new TextDecoder().decode(entries.get('OEBPS/images/cover.svg'));
  const lines = [...svg.matchAll(/<text[^>]*font-weight="500">([^<]*)<\/text>/g)].map(match => match[1]);
  assert.deepEqual(lines, ['한국어 출판 조판', '검증']);
});

test('generated cover preserves complete graphemes when a long token must wrap', async () => {
  const title = '가나다라마바사아자차카👨‍👩‍👧‍👦🇰🇷é'.repeat(3);
  const entries = zipEntries(await buildEpub(fixture({ title })));
  const svg = new TextDecoder().decode(entries.get('OEBPS/images/cover.svg'));
  const lines = [...svg.matchAll(/<text[^>]*font-weight="500">([^<]*)<\/text>/g)].map(match => match[1]);
  assert.equal(lines.join(''), title);
  const boundaries = new Set([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(title)].map(part => part.index));
  let offset = 0;
  for (const line of lines) { assert.ok(boundaries.has(offset), 'line starts on a complete grapheme'); offset += line.length; }
});
