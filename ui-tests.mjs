/** DOM integration only: happy-dom does not render a page or automate a browser. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const originalGlobals = new Map();
const timers = new Set();
const downloads = [];
const blobs = new Map();
const writingTone = '친한 동료에게 설명하듯 담백하게. 원문의 존댓말은 유지해 주세요.';
const voiceSample = '책상을 치우다 작년에 쓴 메모를 찾았습니다.\n\n"내일 하자." 그때도 이 말을 썼더군요. 오늘은 서랍 하나만 비우기로 했습니다.';
let win;

function installGlobal(name, value) {
  if (!originalGlobals.has(name)) originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

function setupWindow(savedState) {
  win = new Window({ url: 'http://localhost:4173', settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true, disableIframePageLoading: true } });
  win.document.body.innerHTML = '<div id="app"></div><div id="toast-region" aria-live="polite"></div><div id="modal-root"></div>';
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLAnchorElement', 'FormData', 'DOMParser', 'File', 'FileReader', 'Image', 'localStorage', 'sessionStorage', 'navigator']) {
    installGlobal(name, name === 'window' ? win : win[name]);
  }
  // Intentionally exercise the documented localStorage fallback.
  Object.defineProperty(win, 'indexedDB', { value: undefined, configurable: true });
  if (savedState) win.localStorage.setItem('folio-studio-v1', savedState);
  win.HTMLAnchorElement.prototype.click = function () {
    downloads.push({ filename: this.download, href: this.href, blob: blobs.get(this.href) });
  };
}

function $ (selector) { const el = document.querySelector(selector); assert.ok(el, `Missing element: ${selector}`); return el; }
function $$ (selector) { return [...document.querySelectorAll(selector)]; }
async function settle() { await new Promise(resolve => nativeSetTimeout(resolve, 0)); }
async function until(condition, message) {
  for (let i = 0; i < 50 && !condition(); i++) await settle();
  assert.ok(condition(), message);
}
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
async function click(selector) { $(selector).click(); await settle(); }
async function input(selector, value, change = false) {
  const el = $(selector); el.value = value;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  if (change) el.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle();
}
async function navigate(view) { await click(`.side-nav [data-action="view"][data-view="${view}"]`); }
async function save() {
  document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true }));
  await settle();
  return JSON.parse(localStorage.getItem('folio-studio-v1'));
}
async function currentProject() {
  const stored = await save();
  return stored.projects.find(project => project.id === stored.activeId);
}
async function submit(selector) { $(selector).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); await settle(); }
async function attachFile(name, contents, type = 'text/plain') {
  const fileInput = $('body > input[type="file"]');
  Object.defineProperty(fileInput, 'files', { configurable: true, value: [new win.File([contents], name, { type })] });
  fileInput.dispatchEvent(new win.Event('change', { bubbles: true }));
  await settle(); await settle();
}

test('Folio UI DOM integration', async t => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;
  installGlobal('setTimeout', (callback, delay, ...args) => {
    const timer = nativeSetTimeout(() => { timers.delete(timer); callback(...args); }, delay);
    timer.unref?.(); timers.add(timer); return timer;
  });
  installGlobal('clearTimeout', timer => { timers.delete(timer); nativeClearTimeout(timer); });
  URL.createObjectURL = blob => { const url = `blob:folio-test-${blobs.size + 1}`; blobs.set(url, blob); return url; };
  URL.revokeObjectURL = () => {};
  installGlobal('fetch', async () => { throw new Error('Unexpected network request in DOM integration test'); });
  setupWindow();
  t.after(async () => {
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear();
    await win.happyDOM.close();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    for (const [name, descriptor] of originalGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  });
  await import(`./dist/app.js?ui-test=${Date.now()}`);
  const ai = await import('./dist/ai.js');
  await settle();
  await click("[data-action=\"editor-tab\"][data-tab=\"write\"]");

  await t.test('sample loads with six chapters and automatically persists a usable workspace', async () => {
    assert.equal($('.project-head h1').textContent, '느리게, 단단하게');
    assert.equal($$('.chapter-link').length, 6);
    assert.equal($('#chapter-title').value, '나만의 속도를 찾는 일');
    assert.ok($('#manuscript-text').value.length > 500);
    const stored = await save();
    assert.equal(stored.projects.length, 1);
    assert.equal(stored.projects[0].chapters.length, 6);
    assert.match($('#save-state').textContent, /이 기기에 저장됨/);
  });

  await t.test('all navigation destinations, reading mode, and preview controls work', async () => {
    await navigate('quality'); assert.equal($$('.audit-item').length, 9);
    await navigate('design'); assert.equal($('#meta-title').value, '느리게, 단단하게');
    await navigate('export'); assert.equal($$('.export-option').length, 3);
    await navigate('editor');
    await click('[data-action="editor-tab"][data-tab="read"]');
    assert.ok($('.read-content').textContent.includes('한동안 아침은'));
    await click('[data-action="editor-tab"][data-tab="write"]');
    await click('[data-action="preview"]');
    await until(() => Boolean(document.querySelector('.modal [data-book-next]')), 'Paginated preview should load');
    assert.equal($$('.modal .folio-book-reader [data-book-section] option').length, 11, 'cover, title, contents, preface, six body chapters, and afterword are navigable');
    assert.equal($('.modal [data-book-prev]').disabled, true);
    const initialPosition = $('.modal [data-book-position]').textContent;
    await click('.modal [data-book-next]');
    assert.notEqual($('.modal [data-book-position]').textContent, initialPosition);
    await input('.modal .folio-book-reader [data-book-section]', '4', true);
    assert.match($('.modal [data-book-stage]').textContent, /나만의 속도를 찾는 일/);
    document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    assert.equal(document.querySelector('.modal'), null);
  });

  await t.test('metadata changes retain field nodes and allow uninterrupted typing in the next field', async () => {
    await navigate('design');
    const fields = $$('[data-meta], [data-image-meta]');
    const title = $('#meta-title');
    const subtitle = $('#meta-subtitle');
    const originalTitle = title.value;
    const originalSubtitle = subtitle.value;
    title.focus();
    await input('#meta-title', '내 걸음으로 쓰는 책', true);
    assert.equal($('#meta-title'), title, 'change must not recreate the field being edited');
    assert.equal($('#meta-subtitle'), subtitle, 'change must retain the next focus target');
    assert.equal(document.activeElement, title);
    assert.equal($('.project-head h1').textContent, '내 걸음으로 쓰는 책');
    assert.equal($('.preview-column .cover-title').textContent, '내 걸음으로 쓰는 책');
    subtitle.focus();
    await input('#meta-subtitle', '나를 지키는 하루의 연습');
    subtitle.setSelectionRange(7, 7);
    // A change from the preceding field must not remove the actively edited next field.
    title.dispatchEvent(new win.Event('change', { bubbles: true }));
    await settle();
    assert.equal(document.activeElement, subtitle);
    assert.equal(subtitle.selectionStart, 7);
    assert.equal(subtitle.value, '나를 지키는 하루의 연습');
    for (const field of fields) assert.equal(document.getElementById(field.id), field);
    subtitle.setRangeText('조용한 ', 7, 7, 'end');
    subtitle.dispatchEvent(new win.Event('input', { bubbles: true }));
    subtitle.dispatchEvent(new win.Event('change', { bubbles: true }));
    const persisted = await currentProject();
    assert.equal(persisted.title, '내 걸음으로 쓰는 책');
    assert.equal(persisted.subtitle, subtitle.value);
    assert.equal(document.activeElement, subtitle);
    await input('#meta-title', originalTitle, true);
    await input('#meta-subtitle', originalSubtitle, true);
    await navigate('editor');
  });

  await t.test('metadata, theme, chapter text, and title changes persist across navigation', async () => {
    await navigate('design');
    await input('#meta-author', '김여유', true);
    await input('#meta-description', '차분하게 하루를 돌보는 독자를 위한, 자기 속도를 찾는 여섯 편의 에세이입니다.', true);
    await click('[data-action="theme"][data-theme="sand"]');
    assert.ok($('[data-theme="sand"]').classList.contains('active'));
    await navigate('editor');
    await input('#chapter-title', '지금의 나에게 맞는 걸음', true);
    await input('#manuscript-text', '나만의 문장입니다.\n\n몇일 뒤에 다시 읽어 볼께요.');
    assert.equal($('.chapter-link.active span:last-child').textContent, '지금의 나에게 맞는 걸음');
    await navigate('quality'); await navigate('editor');
    assert.equal($('#manuscript-text').value, '나만의 문장입니다.\n\n몇일 뒤에 다시 읽어 볼께요.');
    const project = await currentProject();
    assert.equal(project.author, '김여유'); assert.equal(project.theme, 'sand');
    assert.equal(project.chapters[0].title, '지금의 나에게 맞는 걸음');
  });

  await t.test('formatting preserves selected words and preview escapes arbitrary HTML', async () => {
    await input('#manuscript-text', '작은 하루 <script>window.bad=true</script>');
    $('#manuscript-text').setSelectionRange(0, 2);
    await click('[data-action="format"][data-format="bold"]');
    assert.equal($('#manuscript-text').value, '**작은** 하루 <script>window.bad=true</script>');
    await click('[data-action="editor-tab"][data-tab="read"]');
    assert.equal($('.read-content strong').textContent, '작은');
    assert.equal(document.querySelector('.read-content script'), null);
    assert.match($('.read-content').textContent, /<script>/);
    await click('[data-action="editor-tab"][data-tab="write"]');
  });

  await t.test('canceling a completed new-project form does not submit or create a book', async () => {
    const before = await save();
    await click('[data-action="library"]'); await click('.modal [data-action="new-project"]');
    await input('#new-title', '만들면 안 되는 책'); await input('#new-author', '취소한 저자');
    await input('#new-content', '이 원고는 취소되어야 합니다.');
    await click('#new-project-form [data-action="close-modal"]');
    const after = await save();
    assert.equal(after.projects.length, before.projects.length);
    assert.equal(after.activeId, before.activeId);
    assert.equal(document.querySelector('.modal'), null);
  });

  await t.test('new project form creates a distinct book and splits pasted Markdown', async () => {
    await click('[data-action="library"]'); await click('.modal [data-action="new-project"]');
    await input('#new-title', '작은 연습'); await input('#new-author', '연습하는 사람');
    await input('#new-description', '매일 작은 시작을 연습하는 사람들을 위한 짧은 에세이.');
    await input('#new-content', '# 첫 장\n몇일 뒤에 할수있어요.\n\n# 둘째 장\n두 번째 장은 그대로 남아야 합니다.');
    await submit('#new-project-form');
    await click('[data-action="editor-tab"][data-tab="write"]');
    assert.equal($('.project-head h1').textContent, '작은 연습');
    assert.equal($$('.chapter-link').length, 2);
    assert.equal($('#chapter-title').value, '첫 장');
    const stored = await save();
    assert.equal(stored.projects.length, 2);
    assert.notEqual(stored.projects[0].id, stored.activeId);
  });

  await t.test('local automatic preparation corrects prose, adds art, and is reversible', async () => {
    await click('[data-action="autopilot"]'); await click('[data-action="run-local"]');
    assert.equal($('#manuscript-text').value, '며칠 뒤에 할 수 있어요.');
    let project = await currentProject();
    assert.equal(project.chapters.filter(chapter => chapter.image).length, 2);
    await click('[data-action="history"]');
    assert.match($('.history-item').textContent, /기본 자동 정리 전/);
    await click('.history-item [data-action="restore"]');
    assert.equal($('#manuscript-text').value, '몇일 뒤에 할수있어요.');
    project = await currentProject();
    assert.equal(project.chapters.filter(chapter => chapter.image).length, 0);
  });

  await t.test('single edit suggestions change the targeted chapter without touching the other chapter', async () => {
    const before = (await currentProject()).chapters[1].content;
    await navigate('quality');
    await click('[data-action="apply-suggestion"]');
    const project = await currentProject();
    assert.match(project.chapters[0].content, /^며칠/);
    assert.equal(project.chapters[1].content, before);
    await navigate('editor');
  });

  await t.test('deleting a selected chapter preserves the other chapter and history can restore both', async () => {
    const before = await currentProject();
    await click(`.chapter-link[data-id="${before.chapters[1].id}"]`);
    await click('[data-action="chapter-menu"]'); await click('[data-action="confirm-delete-chapter"]');
    await click('[data-action="confirm-chapter"]');
    let after = await currentProject();
    assert.equal(after.chapters.length, 1);
    assert.equal(after.chapters[0].id, before.chapters[0].id);
    assert.equal(after.chapters[0].content, before.chapters[0].content);
    await click('[data-action="history"]'); await click('.history-item [data-action="restore"]');
    after = await currentProject();
    assert.deepEqual(after.chapters, before.chapters);
  });

  await t.test('chapter duplication and ordering preserve text while generating a distinct chapter id', async () => {
    const original = (await currentProject()).chapters[0];
    await click('[data-action="chapter-menu"]'); await click('[data-action="duplicate-chapter"]');
    let project = await currentProject();
    assert.equal(project.chapters.length, 3);
    assert.notEqual(project.chapters[1].id, original.id);
    assert.equal(project.chapters[1].content, original.content);
    const duplicatedId = project.chapters[1].id;
    await click('[data-action="chapter-menu"]'); await click('[data-action="move-down"]');
    project = await currentProject(); assert.equal(project.chapters[2].id, duplicatedId);
  });

  await t.test('text file import creates a new project and preserves the existing library', async () => {
    await click('[data-action="library"]'); await click('.modal [data-action="import"]');
    await attachFile('가져온 책.md', '# 한 장의 시작\n가져온 원고입니다.\n\n# 두 번째 장\n남겨 둘 이야기입니다.');
    assert.equal($('.project-head h1').textContent, '가져온 책');
    assert.equal($$('.chapter-link').length, 2);
    assert.equal($('#manuscript-text').value, '가져온 원고입니다.');
    assert.equal((await save()).projects.length, 3);
  });

  await t.test('optional writing preferences retain manuscript and metadata and persist across navigation', async () => {
    const before = await currentProject();
    await navigate('quality');
    const toneField = $('#writing-tone');
    const sampleField = $('#voice-sample');
    assert.equal(toneField.required, false);
    assert.equal(sampleField.required, false);
    assert.equal(toneField.maxLength, 2000);
    assert.equal(sampleField.maxLength, 4000);
    assert.equal(toneField.value, '');
    assert.equal(sampleField.value, '');
    toneField.focus();
    await input('#writing-tone', writingTone, true);
    assert.equal($('#writing-tone'), toneField, 'Saving preferences must keep the active field mounted');
    sampleField.focus();
    await input('#voice-sample', voiceSample, true);
    assert.equal($('#voice-sample'), sampleField);
    assert.equal(document.activeElement, sampleField);
    const after = await currentProject();
    assert.equal(after.tone, writingTone);
    assert.equal(after.voiceSample, voiceSample);
    const { updatedAt: beforeDate, tone: beforeTone, voiceSample: beforeSample, ...beforeBook } = before;
    const { updatedAt: afterDate, tone: afterTone, voiceSample: afterSample, ...afterBook } = after;
    assert.deepEqual(afterBook, beforeBook, 'A voice preference must not rewrite manuscript or other book fields');
    await navigate('editor');
    assert.equal($('#manuscript-text').value, before.chapters[0].content);
    await navigate('quality');
    assert.equal($('#writing-tone').value, writingTone);
    assert.equal($('#voice-sample').value, voiceSample);
    await navigate('editor');
  });

  await t.test('invalid import fails clearly and does not replace the active book', async () => {
    const before = await currentProject();
    await click('[data-action="library"]'); await click('.modal [data-action="import"]');
    await attachFile('잘못된 백업.json', JSON.stringify({ title: '잘못된 책', chapters: [] }), 'application/json');
    assert.match($('#toast-region').textContent, /올바른 Folio 작업 파일이 아닙니다/);
    assert.equal((await currentProject()).id, before.id);
    await click('[data-action="close-modal"]');
  });

  await t.test('HTML, Markdown, EPUB, and JSON buttons create correctly named downloadable files', async () => {
    await navigate('export');
    for (const action of ['download-html', 'download-md', 'download-epub', 'backup']) {
      const initial = downloads.length;
      await click(`[data-action="${action}"]`);
      for (let i = 0; i < 30 && downloads.length === initial; i++) await settle();
      assert.equal(downloads.length, initial + 1, `${action} should trigger a download: ${$('#toast-region').textContent}`);
    }
    const [html, markdown, epub, json] = downloads.slice(-4);
    assert.equal(html.filename, '가져온 책.html');
    assert.match(await html.blob.text(), /가져온 원고입니다/);
    assert.equal(markdown.filename, '가져온 책.md');
    assert.match(await markdown.blob.text(), /한 장의 시작/);
    assert.equal(epub.filename, '가져온 책.epub');
    assert.deepEqual([...new Uint8Array(await epub.blob.arrayBuffer()).slice(0, 4)], [80, 75, 3, 4]);
    assert.equal(json.filename, '가져온 책.folio.json');
    const backup = JSON.parse(await json.blob.text());
    assert.equal(backup.format, 'folio-project'); assert.equal(backup.project.chapters.length, 2);
    assert.equal(backup.project.title, '가져온 책');
    assert.equal(backup.project.tone, writingTone);
    assert.equal(backup.project.voiceSample, voiceSample);
  });

  await t.test('JSON backups round-trip through import as separate books', async () => {
    const backup = downloads.at(-1);
    const librarySize = (await save()).projects.length;
    await click('[data-action="import"]');
    await attachFile(backup.filename, await backup.blob.text(), 'application/json');
    assert.equal((await save()).projects.length, librarySize + 1);
    assert.equal($('#manuscript-text').value, '가져온 원고입니다.');
    const imported = await currentProject();
    const exported = JSON.parse(await backup.blob.text()).project;
    assert.notEqual(imported.id, exported.id);
    assert.equal(imported.tone, writingTone);
    assert.equal(imported.voiceSample, voiceSample);
    assert.deepEqual(imported.chapters.map(({ title, content }) => ({ title, content })), exported.chapters.map(({ title, content }) => ({ title, content })));
    await navigate('quality');
    assert.equal($('#writing-tone').value, writingTone);
    assert.equal($('#voice-sample').value, voiceSample);
    await navigate('editor');
  });

  await t.test('deleting the final chapter leaves a valid blank editor', async () => {
    for (let i = 0; i < 2; i++) {
      await click('[data-action="chapter-menu"]'); await click('[data-action="confirm-delete-chapter"]');
      await click('[data-action="confirm-chapter"]');
    }
    const project = await currentProject();
    assert.equal(project.chapters.length, 1); assert.equal(project.chapters[0].content, '');
    assert.equal($('#chapter-title').value, '첫 번째 장'); assert.equal($('#manuscript-text').value, '');
  });

  await t.test('AI commands without a connection show setup and never store a typed API key', async () => {
    await click('[data-action="rewrite"]');
    assert.ok($('#ai-form'));
    assert.match($('.modal .notice').textContent, /API 키가 필요/);
    assert.equal($('#ai-provider').value, 'google');
    assert.match($('label[for="api-key"]').textContent, /Google|Gemini/);
    assert.equal($('#text-model').value, ai.getProviderDefaults('google').textModel);
    assert.equal($('#image-model').value, ai.getProviderDefaults('google').imageModel);
    assert.ok($('a[href="https://aistudio.google.com/apikey"]'));
    const fakeKey = 'AIza-unit-test-do-not-transmit';
    await input('#api-key', fakeKey);
    await save();
    assert.ok(!localStorage.getItem('folio-studio-v1').includes(fakeKey));
    assert.ok(!JSON.stringify(ai.getAIConfig()).includes(fakeKey));
    await click('.modal [data-action="close-modal"]');
  });

  await t.test('provider selection updates model defaults and clears a key typed for another provider', async () => {
    await click('[data-action="settings"]');
    const googlePlaceholder = $('#api-key').placeholder;
    await input('#api-key', 'AIza-do-not-forward-to-openai');
    await input('#text-model', 'custom-google-model');
    await input('#ai-provider', 'openai', true);
    assert.equal($('#api-key').value, '');
    assert.match($('label[for="api-key"]').textContent, /OpenAI/);
    assert.notEqual($('#api-key').placeholder, googlePlaceholder);
    assert.equal($('#text-model').value, ai.getProviderDefaults('openai').textModel);
    assert.equal($('#image-model').value, ai.getProviderDefaults('openai').imageModel);
    await input('#api-key', 'sk-do-not-forward-to-google');
    await input('#ai-provider', 'google', true);
    assert.equal($('#api-key').value, '');
    assert.equal($('#api-key').placeholder, googlePlaceholder);
    assert.equal($('#text-model').value, ai.getProviderDefaults('google').textModel);
    assert.equal($('#image-model').value, ai.getProviderDefaults('google').imageModel);
    await click('.modal [data-action="close-modal"]');
  });

  await t.test('Google connection and chapter rewrite use Gemini responses without persisting credentials', async () => {
    const fakeKey = 'AIza-ui-google-connection-key';
    const requests = [];
    const rewritten = { title: '구글로 다듬은 첫 장', content: '나의 속도로 한 문장씩 이야기를 완성합니다.', notes: ['문장의 호흡을 다듬었습니다.'], imagePrompt: '창가에 놓인 책과 햇살' };
    globalThis.fetch = async (url, options) => {
      requests.push({ url, options });
      return jsonResponse(options.method === 'GET'
        ? { name: `models/${ai.getProviderDefaults('google').textModel}`, supportedGenerationMethods: ['generateContent'] }
        : { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(rewritten) }] } }] });
    };
    await click('[data-action="library"]'); await click('.modal [data-action="new-project"]');
    await input('#new-title', '나에게 맞는 정리');
    await input('#new-author', '정리하는 사람');
    await input('#new-genre', '실용서', true);
    await input('#new-content', '나의 속도로 이야기를 써요.');
    await submit('#new-project-form');
    await click('[data-action="editor-tab"][data-tab="write"]');
    await navigate('quality');
    await input('#writing-tone', writingTone, true);
    await input('#voice-sample', voiceSample, true);
    await navigate('editor');
    const original = await currentProject();
    await click('[data-action="settings"]');
    await input('#api-key', fakeKey);
    await submit('#ai-form');
    await until(() => !document.querySelector('#ai-form'), 'Valid Google connection should close setup');
    assert.equal(ai.getAIConfig().provider, 'google');
    assert.equal(ai.isAIConfigured(), true);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].options.method, 'GET');
    assert.equal(new URL(requests[0].url).origin, 'https://generativelanguage.googleapis.com');
    assert.equal(new Headers(requests[0].options.headers).get('x-goog-api-key'), fakeKey);
    assert.equal(new Headers(requests[0].options.headers).get('authorization'), null);
    assert.ok(!requests[0].url.includes(fakeKey));
    assert.ok(!new URL(requests[0].url).searchParams.has('key'));
    await click('[data-action="rewrite"]');
    await until(() => document.querySelector('#manuscript-text')?.value === rewritten.content, 'Gemini rewrite should update the chapter editor');
    assert.equal($('#chapter-title').value, rewritten.title);
    assert.equal(requests.length, 2);
    assert.match(requests[1].url, /:generateContent$/);
    assert.equal(new Headers(requests[1].options.headers).get('x-goog-api-key'), fakeKey);
    const body = JSON.parse(requests[1].options.body);
    assert.ok(Array.isArray(body.contents));
    const prompt = JSON.parse(body.contents.find(content => content.role === 'user').parts.map(part => part.text || '').join(''));
    assert.equal(prompt.chapter.content, original.chapters[0].content);
    assert.equal(prompt.book.genre, '실용서');
    assert.equal(prompt.book.tone, writingTone);
    assert.equal(prompt.book.voiceSample, voiceSample);
    const saved = await currentProject();
    assert.equal(saved.chapters[0].content, rewritten.content);
    assert.ok(!localStorage.getItem('folio-studio-v1').includes(fakeKey));
    assert.ok(!JSON.stringify(ai.getAIConfig()).includes(fakeKey));
    assert.equal(sessionStorage.length, 0);
    await click('[data-action="history"]');
    await click('.history-item [data-action="restore"]');
    const restored = await currentProject();
    assert.deepEqual(restored.chapters, original.chapters, 'Restoring a rewrite must recover the original chapter');
    assert.equal(restored.tone, writingTone);
    assert.equal(restored.voiceSample, voiceSample);
  });

  await t.test('switching provider cancels pending validation and stale failure cannot clear a newer connection', async () => {
    const pendingKey = 'AIza-pending-key-do-not-transmit';
    const newKey = 'sk-ui-openai-new-connection-key';
    const requests = [];
    let rejectStale;
    globalThis.fetch = (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) return new Promise((resolve, reject) => { rejectStale = reject; });
      return Promise.resolve(jsonResponse({ id: ai.getProviderDefaults('openai').textModel }));
    };
    await click('[data-action="settings"]');
    await input('#api-key', pendingKey);
    await submit('#ai-form');
    assert.equal(requests.length, 1);
    assert.equal($('#ai-form [type="submit"]').disabled, true);
    await input('#ai-provider', 'openai', true);
    assert.equal(requests[0].options.signal.aborted, true, 'Switching provider must abort the pending Google request');
    assert.equal($('#api-key').value, '');
    assert.equal($('#ai-form [type="submit"]').disabled, false);
    await input('#api-key', newKey);
    await submit('#ai-form');
    await until(() => !document.querySelector('#ai-form'), 'New provider connection should complete');
    assert.equal(requests.length, 2);
    assert.equal(new URL(requests[1].url).origin, 'https://api.openai.com');
    assert.equal(new Headers(requests[1].options.headers).get('authorization'), `Bearer ${newKey}`);
    assert.equal(new Headers(requests[1].options.headers).get('x-goog-api-key'), null);
    rejectStale(new Error('Delayed failure from obsolete Google request'));
    await settle(); await settle();
    assert.equal(ai.getAIConfig().provider, 'openai');
    assert.equal(ai.isAIConfigured(), true, 'Stale validation failure must not clear the active OpenAI connection');
    await click('[data-action="settings"]');
    assert.equal($('#ai-provider').value, 'openai');
    assert.ok($('[data-action="disconnect"]'));
    assert.equal($('#api-key').value, '', 'Connected credentials must not be written back into the form');
    await save();
    assert.ok(!localStorage.getItem('folio-studio-v1').includes(newKey));
    assert.ok(!localStorage.getItem('folio-studio-v1').includes(pendingKey));
    await click('[data-action="disconnect"]');
    if (document.querySelector('.modal')) await click('.modal [data-action="close-modal"]');
    globalThis.fetch = async () => { throw new Error('Unexpected network request in DOM integration test'); };
  });

  await t.test('reload reads saved content and the same active project from localStorage', async () => {
    await input('#chapter-title', '다시 열린 원고', true);
    await input('#manuscript-text', '저장된 문장은 새로 열어도 남아 있어야 합니다.');
    await save();
    const stored = localStorage.getItem('folio-studio-v1');
    for (const timer of timers) nativeClearTimeout(timer);
    timers.clear(); await win.happyDOM.close(); setupWindow(stored);
    await import(`./dist/app.js?ui-reload=${Date.now()}`); await settle();
  await click("[data-action=\"editor-tab\"][data-tab=\"write\"]");
    assert.equal($('#chapter-title').value, '다시 열린 원고');
    assert.equal($('#manuscript-text').value, '저장된 문장은 새로 열어도 남아 있어야 합니다.');
    assert.equal((await save()).activeId, JSON.parse(stored).activeId);
    await navigate('quality');
    assert.equal($('#writing-tone').value, writingTone);
    assert.equal($('#voice-sample').value, voiceSample);
  });
});
