import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPublicationPackage, normalizePublication } from './dist/publication.js';
import { buildArchive, validateImageSource } from './dist/export.js';
import { TYPESETTING_CLI_VERSION, typesettingFixture, fixtureChart, expectedMarkers, packageEntries, validatePdfReport } from './scripts/validate-typesetting.mjs';

test('the real typesetting fixture supplies Korean paragraphs, multi-page table and an original valid bitmap', () => {
  const fixture = typesettingFixture(), content = fixture.chapters.map(chapter => chapter.content).join('\n');
  assert.equal(fixture.chapters.length, 3);
  assert.equal(expectedMarkers().length, 68);
  for (const marker of expectedMarkers()) assert.equal(content.split(marker).length - 1, 1);
  const source = fixture.chapters[2].figures[0].src;
  assert.ok(validateImageSource(source));
  assert.deepEqual(fixtureChart(), fixtureChart(), 'test artwork must be reproducible');
  assert.ok(source.startsWith('data:image/png;base64,'));
});

test('publication kit has explicit A5 config, pinned compiler and recoverable Windows browser instructions', async () => {
  const project = typesettingFixture(), original = JSON.stringify(project);
  const result = await buildPublicationPackage(project, normalizePublication({ channel: 'direct', publisher: '검증', publicationDate: '2026-10-20', price: '0' }));
  const files = packageEntries(result.bytes), text = name => new TextDecoder().decode(files.get(name));
  const config = JSON.parse(text('vivliostyle.config.json'));
  assert.equal(config.size, 'A5'); assert.deepEqual(config.entry, ['print.html']);
  assert.equal(config.output, 'book-print.pdf'); assert.equal(config.workspaceDir, '.vivliostyle');
  assert.equal(config.language, 'ko'); assert.equal(config.title, project.title);
  assert.ok(text('TYPESETTING.md').includes('@vivliostyle/cli@' + TYPESETTING_CLI_VERSION));
  assert.match(text('TYPESETTING.md'), /build --config vivliostyle\.config\.json/);
  assert.match(text('TYPESETTING.md'), /--executable-browser/);
  assert.match(text('TYPESETTING.md'), /PDF\/X·PDF\/UA/);
  assert.match(text('TYPESETTING.md'), /한글 글꼴/);
  assert.equal(files.has('book-print.pdf'), false, 'the browser package must not claim an uncompiled PDF exists');
  assert.doesNotMatch(text('print.html'), /<script[\s>]/);
  for (const marker of expectedMarkers()) assert.ok(text('print.html').includes(marker));
  assert.match(text('print.html'), /data:image\/png;base64,/);
  assert.equal(JSON.stringify(project), original);
});

const completeReport = () => ({ pages: 14, sizes: Array.from({ length: 14 }, () => [419.528, 595.276]), markerCounts: Object.fromEntries(expectedMarkers().map(marker => [marker, 1])), missingKorean: [], images: [{ page: 12, width: 800, height: 360 }], outOfPageCharacters: [] });

test('PDF validation rejects lost or duplicated text, wrong page size, absent figures and clipping', () => {
  assert.doesNotThrow(() => validatePdfReport(completeReport()));
  const mutate = change => { const report = completeReport(); change(report); assert.throws(() => validatePdfReport(report)); };
  mutate(report => { report.markerCounts['TABLE-48'] = 0; });
  mutate(report => { report.markerCounts['KOREAN-01'] = 2; });
  mutate(report => { report.sizes[7] = [595.28, 841.89]; });
  mutate(report => { report.pages = 1; });
  mutate(report => { report.missingKorean = ['한국어']; });
  mutate(report => { report.images = []; });
  mutate(report => { report.outOfPageCharacters = [{ page: 12, text: '끝', box: [0, 600, 10, 615] }]; });
});

test('validation package extraction rejects unsafe names and truncated archive contents', () => {
  assert.throws(() => packageEntries(buildArchive([['../outside.txt', 'blocked']])));
  const archive = buildArchive([['safe.txt', 'complete content']]);
  assert.throws(() => packageEntries(archive.slice(0, 40)));
  assert.equal(new TextDecoder().decode(packageEntries(archive).get('safe.txt')), 'complete content');
});
