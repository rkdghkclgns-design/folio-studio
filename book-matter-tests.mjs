import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBookMatter, ensureBookMatter, getReadingChapters, cleanDefaultIllustrationCaptions } from './dist/book-matter.js';
import { publicationFingerprint, publicationReadiness, preparePublicationProject } from './dist/publication.js';
import { createExchange, parseExchange, planExchangeMerge, resolveExchangeMerge, exchangeRevision } from './dist/collaboration.js';
import { exportMarkdown, prepareBookPreview, exportHTML, projectToText } from './dist/export.js';

const fixture = () => ({ id: 'book', title: '게임기획과 AI', author: '작가', description: '게임 기획의 개념과 작업 방법을 살펴봅니다.', chapters: [{ id: 'a', title: '기획의 시작', content: '첫 본문 원고.' }, { id: 'b', title: '기획의 실천', content: '마지막 본문 원고.' }], production: { status: 'paused', nextChapter: 1, chapters: [{ id: 'a' }, { id: 'b' }], progress: 25 } });

test('legacy book migration adds editable matter once without changing production or body', () => {
  const p = fixture(), before = structuredClone(p);
  assert.equal(ensureBookMatter(p), true);
  assert.equal(ensureBookMatter(p), false);
  assert.deepEqual(p.chapters, before.chapters);
  assert.deepEqual(p.production, before.production);
  assert.match(p.bookMatter.preface.content, /게임기획과 AI/);
  assert.match(p.bookMatter.preface.content, /기획의 시작/);
  assert.match(p.bookMatter.afterword.content, /기획의 실천/);
  assert.doesNotMatch(p.bookMatter.preface.content + p.bookMatter.afterword.content, /나의 경험|내가 경험|직접 경험|저는/);
  assert.deepEqual(getReadingChapters(p).map(c => c.kind || 'body'), ['preface', 'body', 'body', 'afterword']);
});

test('authored matter, intentional empty text and metadata remain untouched on reload', () => {
  const p = fixture();
  p.bookMatter = { preface: { id: 'own-opening', title: '내가 쓴 시작말', content: '', kind: 'preface' }, afterword: { id: 'own-ending', title: '마지막 인사', content: '사용자가 쓴 마무리.', kind: 'afterword' } };
  const before = structuredClone(p);
  assert.equal(ensureBookMatter(p), false);
  assert.deepEqual(p, before);
  p.title = '새 제목'; ensureBookMatter(p);
  assert.equal(p.bookMatter.afterword.content, '사용자가 쓴 마무리.');
});

test('exact existing aliases reorder only the reading view and are never duplicated or rewritten', () => {
  const p = fixture();
  p.chapters.unshift({ id: 'ending', title: '에필로그', content: '기존 맺음말' });
  p.chapters.push({ id: 'opening', title: '들어가며', content: '기존 시작말' });
  const before = structuredClone(p);
  assert.equal(ensureBookMatter(p), false);
  assert.equal(p.bookMatter, undefined);
  assert.deepEqual(p, before);
  const reading = getReadingChapters(p);
  assert.deepEqual(reading.map(c => c.id), ['opening', 'a', 'b', 'ending']);
  assert.equal(reading[0].kind, 'preface');
  assert.equal(p.chapters.at(-1).kind, undefined);
});

test('a title containing an alias is still a normal chapter; explicit kind is respected', () => {
  const p = fixture(); p.chapters[0].title = '서문을 쓰는 방법';
  p.chapters[1].kind = 'afterword';
  ensureBookMatter(p);
  assert.ok(p.bookMatter.preface);
  assert.equal(p.bookMatter.afterword, undefined);
  assert.deepEqual(getReadingChapters(p).map(c => c.id), ['folio-preface', 'a', 'b']);
});

test('stable IDs avoid body collisions and nested export normalization does not duplicate matter', () => {
  const p = fixture(); p.chapters[0].id = 'folio-preface'; p.chapters[1].id = 'folio-afterword';
  ensureBookMatter(p);
  assert.equal(p.bookMatter.preface.id, 'folio-preface-2');
  assert.equal(p.bookMatter.afterword.id, 'folio-afterword-2');
  const reading = getReadingChapters(p);
  assert.deepEqual(getReadingChapters({ ...p, chapters: reading }), reading);
  assert.equal(new Set(reading.map(c => c.id)).size, 4);
});

test('publication colophon remains after the closing matter, including repeat preparation', () => {
  const p = fixture(); ensureBookMatter(p);
  const prepared = preparePublicationProject(preparePublicationProject(p));
  const reading = getReadingChapters(prepared);
  assert.equal(reading.at(-2).kind, 'afterword');
  assert.equal(reading.at(-1).kind, 'folio-publication-colophon');
  assert.equal(reading.filter(c => c.kind === 'folio-publication-colophon').length, 1);
  assert.equal(p.chapters.length, 2);
});

test('only exact old illustration boilerplate is removed from images and figures', () => {
  const p = fixture(); ensureBookMatter(p);
  p.chapters[0].image = { src: 'unchanged', alt: '그림 설명', caption: 'AI 생성 삽화' };
  p.chapters[0].figures = [{ id: 'f1', caption: ' AI 생성 삽화 ' }, { id: 'f2', caption: 'AI 생성 삽화의 활용 예시' }];
  p.bookMatter.preface.image = { caption: 'AI 생성 삽화' };
  p.bookMatter.afterword.image = { caption: '내가 쓴 삽화 설명' };
  p.chapters[1].content = 'AI 생성 삽화에 관한 본문은 보존합니다.';
  assert.equal(cleanDefaultIllustrationCaptions(p), true);
  assert.equal(cleanDefaultIllustrationCaptions(p), false);
  assert.equal(p.chapters[0].image.caption, ''); assert.equal(p.chapters[0].image.src, 'unchanged');
  assert.equal(p.chapters[0].figures[0].caption, '');
  assert.equal(p.chapters[0].figures[1].caption, 'AI 생성 삽화의 활용 예시');
  assert.equal(p.bookMatter.afterword.image.caption, '내가 쓴 삽화 설명');
  assert.equal(p.chapters[1].content, 'AI 생성 삽화에 관한 본문은 보존합니다.');
});

test('matter normalization preserves valid text, rejects malformed values and bounds without truncation', () => {
  assert.equal(normalizeBookMatter(undefined), undefined);
  const source = { preface: { id: 'custom', title: '내 서문', content: '원고\n\n원고', kind: 'untrusted', editorialNotes: ['메모'], imagePrompt: '삽화' } };
  const normalized = normalizeBookMatter(source);
  assert.equal(normalized.preface.content, source.preface.content);
  assert.equal(normalized.preface.kind, 'preface');
  assert.notEqual(normalized.preface, source.preface);
  for (const bad of [null, [], 'text', { unknown: {} }, { preface: [] }, { preface: { content: 1 } }, { afterword: { content: 'x'.repeat(500001) } }, { preface: { editorialNotes: ['x'.repeat(4001)] } }]) assert.throws(() => normalizeBookMatter(bad));
  assert.throws(() => normalizeBookMatter({ preface: { id: 'duplicate' } }, { chapterIds: ['duplicate'] }), /중복/);
  assert.throws(() => normalizeBookMatter({ preface: { id: 'same' }, afterword: { id: 'same' } }), /중복/);
  assert.throws(() => normalizeBookMatter({ preface: { id: 'unsafe\u0000' } }), /식별자/);
});

test('matter media must pass importer validators and regular backup imports remap IDs safely', () => {
  const source = { preface: { id: 'old', content: '내 원고', image: { src: 'test' }, figures: [{ id: 'figure' }] }, afterword: { id: 'ending', content: '끝 원고' } };
  assert.throws(() => normalizeBookMatter(source), /이미지/);
  let images = 0, figures = 0;
  const normalized = normalizeBookMatter(source, { chapterIds: ['folio-preface'], remapIds: true, validateImage: value => { images++; return { ...value, checked: true }; }, validateFigures: value => { figures++; return structuredClone(value); } });
  assert.equal(normalized.preface.id, 'folio-preface-2');
  assert.equal(normalized.afterword.id, 'folio-afterword');
  assert.equal(normalized.preface.image.checked, true);
  assert.equal(images, 1); assert.equal(figures, 1);
  assert.throws(() => normalizeBookMatter(source, { validateImage: () => { throw new Error('unsafe media'); } }), /unsafe media/);
});

test('publication approval invalidates when opening or closing text/media changes and checks empty matter', () => {
  const p = fixture(); ensureBookMatter(p);
  const metadata = { rightsConfirmed: true, proofreadConfirmed: true, deviceReviewConfirmed: true };
  metadata.reviewFingerprint = publicationFingerprint(p, metadata);
  assert.equal(publicationReadiness(p, metadata).staleReview, false);
  p.bookMatter.preface.content += '\n\n수정';
  assert.equal(publicationReadiness(p, metadata).staleReview, true);
  const revised = publicationFingerprint(p, metadata);
  p.bookMatter.afterword.image = { src: 'a', alt: '내 그림', caption: '' };
  assert.notEqual(publicationFingerprint(p, metadata), revised);
  p.bookMatter.afterword.content = '';
  assert.equal(publicationReadiness(p).checks.find(c => c.id === 'manuscript').state, 'block');
});

test('exchange includes matter and independently changed opening/closing sections merge without body changes', async () => {
  const p = fixture(); ensureBookMatter(p);
  const before = structuredClone(p.chapters), first = await createExchange(p, { name: '저자' });
  assert.deepEqual(first.exchange.project.bookMatter, p.bookMatter);
  p.collaboration = first.origin;
  p.bookMatter.preface.content = '저자가 수정한 시작말';
  first.exchange.project.bookMatter.afterword.content = '편집자가 수정한 맺음말';
  const plan = await planExchangeMerge(p, parseExchange(first.exchange, structuredClone));
  assert.equal(plan.conflicts.length, 0);
  const merged = await resolveExchangeMerge(plan);
  assert.equal(merged.bookMatter.preface.content, '저자가 수정한 시작말');
  assert.equal(merged.bookMatter.afterword.content, '편집자가 수정한 맺음말');
  assert.deepEqual(merged.chapters.map(c => ({ id: c.id, title: c.title, content: c.content })), before);
  assert.deepEqual(merged.production, p.production);
});

test('same-matter conflicts require an explicit choice and a matter edit changes exchange revision', async () => {
  const p = fixture(); ensureBookMatter(p);
  const first = await createExchange(p, { name: '저자' }); p.collaboration = first.origin;
  const before = await exchangeRevision(p);
  p.bookMatter.preface.content = '내 변경'; first.exchange.project.bookMatter.preface.content = '상대 변경';
  assert.notEqual(await exchangeRevision(p), before);
  const plan = await planExchangeMerge(p, parseExchange(first.exchange, structuredClone));
  assert.equal(plan.conflicts[0].key, 'matter:preface');
  assert.equal(plan.conflicts[0].label, '시작말');
  await assert.rejects(resolveExchangeMerge(plan), /모든 충돌/);
  const merged = await resolveExchangeMerge(plan, { 'matter:preface': 'remote' });
  assert.equal(merged.bookMatter.preface.content, '상대 변경');
});

test('older exchange baselines without matter keys retain local added matter', async () => {
  const p = fixture(), first = await createExchange(p, { name: '저자' });
  first.origin.base = first.origin.base.filter(([key]) => !key.startsWith('matter:'));
  first.exchange.origin = first.origin; first.exchange.project.collaboration = first.origin;
  p.collaboration = first.origin; ensureBookMatter(p);
  first.exchange.project.chapters[0].content = '기존 형식에서 수정한 본문';
  const plan = await planExchangeMerge(p, parseExchange(first.exchange, structuredClone));
  assert.equal(plan.conflicts.length, 0);
  const merged = await resolveExchangeMerge(plan);
  assert.deepEqual(merged.bookMatter, p.bookMatter);
  assert.equal(merged.chapters[0].content, '기존 형식에서 수정한 본문');
});

test('Markdown export places opening before body and closing before colophon without mutating saved book', () => {
  const p = fixture(); ensureBookMatter(p);
  p.bookMatter.preface.content = 'OPENING-MARKER'; p.bookMatter.afterword.content = 'CLOSING-MARKER';
  const before = structuredClone(p), text = exportMarkdown(preparePublicationProject(p));
  assert.ok(text.indexOf('OPENING-MARKER') < text.indexOf('첫 본문 원고.'));
  assert.ok(text.indexOf('마지막 본문 원고.') < text.indexOf('CLOSING-MARKER'));
  assert.ok(text.indexOf('CLOSING-MARKER') < text.indexOf('판권 정보'));
  assert.equal(text.split('OPENING-MARKER').length, 2);
  assert.equal(text.split('CLOSING-MARKER').length, 2);
  assert.deepEqual(p, before);
});


test('opening and closing stay unnumbered while the first body chapter remains 01 in previews and text', async () => {
  const p = fixture(); ensureBookMatter(p);
  const prepared = await prepareBookPreview(preparePublicationProject(p));
  const chapters = prepared.sections.filter(section => section.chapterId);
  assert.doesNotMatch(chapters[0].html, /class="chapter-number"/);
  assert.match(chapters[1].html, /class="chapter-number">01<\/p>/);
  assert.match(chapters[2].html, /class="chapter-number">02<\/p>/);
  assert.doesNotMatch(chapters.at(-2).html, /class="chapter-number"/);
  assert.doesNotMatch(chapters.at(-1).html, /class="chapter-number"/);
  const toc = prepared.sections.find(section => section.kind === 'toc').html;
  assert.match(toc, />시작말<\/a>/); assert.match(toc, />01　기획의 시작<\/a>/); assert.match(toc, />맺음말<\/a>/);
  const plain = projectToText(p);
  assert.match(plain, /\n\n시작말\n\n/); assert.match(plain, /\n\n1\. 기획의 시작\n\n/);
  assert.match(plain, /\n\n맺음말\n\n/);
});

test('a thousand body chapters plus matter and colophon survive nested HTML normalization', async () => {
  const p = fixture(); p.chapters = Array.from({ length: 1000 }, (_, index) => ({ id: 'body-' + index, title: '본문 ' + index, content: '원고 ' + index }));
  ensureBookMatter(p);
  const prepared = preparePublicationProject(p);
  const html = await exportHTML(prepared, { interactive: false });
  assert.equal((html.match(/data-book-kind="chapter"/g) || []).length, 1003);
  assert.match(html, /class="chapter-number">1000<\/p>/);
  p.chapters.push({ id: 'overflow', title: '초과 본문', content: '원고' });
  await assert.rejects(exportHTML(p), /1,000/);
});
