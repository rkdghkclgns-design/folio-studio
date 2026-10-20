import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEpub, exportHTML, renderMarkdown } from './dist/export.js';
import { epubFixtureProjects } from './scripts/epub-fixtures.mjs';
import { EPUBCHECK, verifyArchive, summarizeReport } from './scripts/validate-epub.mjs';

function entries(bytes) {
  const result = new Map(), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true), nameLength = view.getUint16(offset + 26, true), extraLength = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLength)), start = offset + 30 + nameLength + extraLength;
    result.set(name, new TextDecoder().decode(bytes.subarray(start, start + size))); offset = start + size;
  }
  return result;
}

test('EPUB records truthful accessibility features and named chapter landmarks without certification claims', async () => {
  const [, project] = epubFixtureProjects()[1], files = entries(await buildEpub(project));
  const opf = files.get('OEBPS/package.opf'), chapter = files.get('OEBPS/chapter-001.xhtml');
  for (const feature of ['tableOfContents', 'readingOrder', 'structuralNavigation']) assert.ok(opf.includes(`<meta property="schema:accessibilityFeature">${feature}</meta>`));
  assert.match(opf, /schema:accessibilitySummary/);
  assert.match(opf, /별도 검토가 필요/);
  assert.doesNotMatch(opf, /certifiedBy|dcterms:conformsTo|WCAG-AA/);
  assert.match(chapter, /<main>/);
  assert.match(chapter, /role="doc-chapter" aria-labelledby="chapter-heading"/);
  assert.match(chapter, /<h1 id="chapter-heading">처음의 마음<\/h1>/);
});

test('EPUB and printable HTML keep Korean words intact with overflow fallback', async () => {
  const [, project] = epubFixtureProjects()[1];
  const epub = entries(await buildEpub(project));
  assert.match(epub.get('OEBPS/styles/book.css'), /word-break:keep-all;overflow-wrap:anywhere;line-break:strict/);
  assert.match(await exportHTML(project, { interactive: false }), /word-break:keep-all;overflow-wrap:anywhere;line-break:strict/);
});

test('official validator rejects altered downloads before executing them', () => {
  assert.match(EPUBCHECK.url, /^https:\/\/github.com\/w3c\/epubcheck\/releases\/download\/v5\.4\.0\//);
  assert.match(EPUBCHECK.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => verifyArchive(Buffer.from('untrusted archive')), /checksum mismatch/);
});

test('validation gate fails closed for warnings, errors, malformed reports and crashed checkers', () => {
  const valid = { checker: { checkerVersion: EPUBCHECK.version, filename: 'book.epub', nFatal: 0, nError: 0, nWarning: 0, nUsage: 0 }, messages: [] };
  assert.equal(summarizeReport(valid, 0).passed, true);
  assert.equal(summarizeReport(valid, 1).passed, false);
  assert.equal(summarizeReport(valid, null).passed, false);
  for (const key of ['nFatal', 'nError', 'nWarning']) assert.equal(summarizeReport({ ...valid, checker: { ...valid.checker, [key]: 1 } }, 0).passed, false);
  assert.equal(summarizeReport({ ...valid, messages: [{ severity: 'WARNING' }] }, 0).passed, false);
  for (const invalid of [null, {}, { ...valid, checker: {} }, { ...valid, messages: null }, { ...valid, checker: { ...valid.checker, checkerVersion: '0.0' } }]) assert.throws(() => summarizeReport(invalid, 0), /invalid EPUBCheck report/);
});

test('validation matrix covers prose, figures, native diagrams, real sample and publishing metadata', () => {
  const fixtures = epubFixtureProjects();
  assert.equal(fixtures.length, 6);
  assert.equal(new Set(fixtures.map(([name]) => name)).size, fixtures.length);
  assert.ok(fixtures.some(([, project]) => project.chapters.some(chapter => chapter.figures?.length)));
  assert.ok(fixtures.some(([, project]) => project.chapters.some(chapter => chapter.content.includes('```folio-diagram'))));
  assert.ok(fixtures.some(([, project]) => project.publication?.isbn));
});

test('Markdown punctuation escapes retain literal imported prose without enabling markup or unsafe links', () => {
  assert.equal(renderMarkdown(String.raw`\*별표\*와 \[링크\]\(https://example.com\), C:\\books`), '<p>*별표*와 [링크](https://example.com), C:\\books</p>');
  assert.equal(renderMarkdown(String.raw`\<script\>bad\<\/script\>`), '<p>&lt;script&gt;bad&lt;/script&gt;</p>');
  assert.equal(renderMarkdown(String.raw`\[위험\]\(javascript:alert\)`), '<p>[위험](javascript:alert)</p>');
  assert.equal(renderMarkdown('**굵게**와 `\\*코드\\*`'), '<p><strong>굵게</strong>와 <code>\\*코드\\*</code></p>');
  assert.equal(renderMarkdown(String.raw`\문자`), '<p>\\문자</p>');
});
