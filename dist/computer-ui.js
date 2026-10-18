/** Local computer examples. Credentials and live sessions never enter book data. */
import { createComputerClient, validateComputerResearch, validateComputerFrame, runComputerTask } from './computer.js';
import { nextComputerAction } from './ai.js';

const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = value => JSON.parse(JSON.stringify(value));
const checkAbort = signal => { if (signal?.aborted) throw new DOMException('작업 중지', 'AbortError'); };
const newId = () => `screen-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const MAPLE_GOAL = '메이플스토리 월드 에디터에서 이 장의 설명에 맞는 작은 실습 예제를 만들어 주세요. 현재 화면과 프로젝트 상태를 먼저 확인하고, 연습용 오브젝트 하나를 만들고 설정 과정을 설명해 주세요. 실행 미리보기에서 결과를 확인해 책에 넣을 화면을 촬영해 주세요. 필요한 메뉴나 상태가 보이지 않으면 추측하지 말고 사용자에게 알려 주세요.';
const button = (action, label, style = 'secondary', extra = '') => `<button type="button" class="button ${style}" data-computer-action="${action}" ${extra}>${label}</button>`;

/** The surrounding app owns its modal, project selection and durable storage. */
export function mountComputerStudio(root, {
  getResearch = () => undefined, context = {}, isAIConfigured = () => false,
  saveResearch, insertRecords, onBusy = () => {}, notify = () => {}, services = {},
} = {}) {
  if (!root || typeof saveResearch !== 'function' || typeof insertRecords !== 'function') throw new Error('컴퓨터 자료실을 열 수 없습니다. 저장 연결을 확인해 주세요.');
  const createClient = services.createClient || createComputerClient;
  const runTask = services.runTask || runComputerTask;
  const decide = services.decide || nextComputerAction;
  const bookContext = { bookTitle: String(context.bookTitle || '').slice(0, 200), chapterTitle: String(context.chapterTitle || '').slice(0, 200), excerpt: String(context.excerpt || '').slice(0, 6000) };
  let research = validateComputerResearch(getResearch()) || { version: 1, goal: '', target: '', records: [] };
  let client = null, windows = [], busy = false, disposed = false, controller = null, dirty = false;
  const selected = new Set();
  const $ = selector => root.querySelector(selector);

  root.classList.add('computer-studio');
  root.innerHTML = `<div class="computer-intro"><p>실제 프로그램에서 예제를 만들고, 화면과 설명을 책의 자료로 담습니다. 담은 자료를 검토한 뒤 현재 장에 넣을 수 있습니다.</p><div class="computer-destination"><span>자료를 넣을 장</span><strong>${escapeHTML(bookContext.bookTitle)} · ${escapeHTML(bookContext.chapterTitle)}</strong></div></div>
    <details class="computer-setup"${research.records.length ? '' : ' open'}><summary>처음 연결하기 · Windows PC에서 3단계</summary>
      <ol><li><b>연결 도우미 준비</b><p>이 빌더와 조작할 프로그램을 같은 Windows PC에서 여세요. Python 3.11 이상을 설치한 뒤 도우미 압축을 풀어 주세요.</p><a class="button secondary small" href="./downloads/folio-computer-companion.zip" download>Windows 연결 도우미 받기</a></li>
      <li><b>도우미 실행</b><p>압축 안의 <code>start-windows.cmd</code>를 실행하고, 창에 표시되는 연결 코드를 아래에 붙여 넣으세요. 처음 실행할 때 필요한 패키지를 설치합니다.</p></li>
      <li><b>연결 후 조작할 창 선택</b><p>브라우저가 로컬 네트워크 연결을 물으면 허용해 주세요. 시작하거나 촬영하면 선택한 창을 앞으로 가져옵니다. Windows가 자동 전환을 막으면 8초 안에 해당 창을 직접 클릭해 주세요. 창이 앞으로 나온 뒤에는 PC 입력을 잠시 멈추고, 급히 중단하려면 <kbd>F8</kbd>을 누르세요.</p></li></ol>
      <p class="computer-note">Windows 10·11의 Chrome 또는 Edge에서 사용하세요. 연결 대상은 이 PC의 <code>127.0.0.1:8765</code>입니다. 휴대폰에서 다른 PC를 원격 조작하는 기능은 지원하지 않습니다. 도우미를 종료하거나 이 창을 닫으면 연결 코드는 다시 입력해야 합니다. 프로그램이 화면 촬영을 지원하지 않으면 PNG 파일을 직접 추가해 주세요.</p>
    </details>
    <section class="computer-section" aria-labelledby="computer-connect-title"><h3 id="computer-connect-title">1. 작업할 창 연결</h3>
      <form id="computer-connect-form" class="computer-connect-form"><div class="field"><label for="computer-token">도우미의 연결 코드</label><input id="computer-token" type="password" autocomplete="off" spellcheck="false" maxlength="64" placeholder="64자리 연결 코드" data-computer-idle aria-describedby="computer-token-help"><small id="computer-token-help">연결 코드는 이 창에서만 사용하며 책이나 백업에 저장하지 않습니다.</small></div><button class="button secondary" type="submit" data-computer-idle>도우미 연결</button></form>
      <p id="computer-connection" class="computer-connection" role="status">아직 연결하지 않았습니다. 아래에서 PNG 화면 자료를 직접 추가할 수도 있습니다.</p>
      <div class="computer-window-row"><div class="field"><label for="computer-window">조작할 프로그램 창</label><select id="computer-window" data-computer-idle disabled><option value="">연결 후 창을 선택하세요</option></select></div>${button('refresh', '창 목록 새로고침', 'secondary small', 'data-computer-idle disabled')}${button('disconnect', '연결 끊기', 'secondary small', 'data-computer-idle disabled')}</div>
    </section>
    <section class="computer-section" aria-labelledby="computer-task-title"><div class="computer-section-heading"><h3 id="computer-task-title">2. 예제 만들기</h3>${button('preset', '메이플스토리 월드 예시', 'secondary small', 'data-computer-idle')}</div>
      <div class="field"><label for="computer-goal">만들 예제와 담을 내용</label><textarea id="computer-goal" maxlength="4000" rows="4" placeholder="예: 이 장에서 설명할 발판 오브젝트를 만들고, 속성 설정과 실행 결과를 각각 화면으로 담아 주세요." data-computer-idle>${escapeHTML(research.goal)}</textarea></div>
      <div class="computer-task-options"><div class="field"><label for="computer-max-steps">한 번에 진행할 최대 단계</label><select id="computer-max-steps" data-computer-idle><option value="10">10단계 · 짧은 예제</option><option value="20" selected>20단계 · 기본</option><option value="40">40단계 · 긴 예제</option></select></div><p class="computer-note">화면을 읽고 한 단계씩 진행합니다. 각 단계에 AI 요청 비용이 발생하며, 확인이 필요하면 멈추고 이유를 알려 드립니다.</p></div>
      <p id="computer-ai-state" class="computer-note"></p>
      <p class="computer-delegation">‘선택한 창 조작 시작’을 누르면 해당 창의 조작을 위임하며, 화면이 현재 연결한 AI 제공자에게 전송됩니다. 현재 창 한 장 담기도 AI가 연결되어 있으면 화면 설명을 읽습니다.</p>
      <div class="computer-actions">${button('start', '선택한 창 조작 시작', 'primary', 'data-computer-idle disabled')}${button('capture', '현재 창 한 장 담기', 'secondary', 'data-computer-idle disabled')}${button('stop', '즉시 중지', 'computer-stop', 'disabled')}</div>
      <p id="computer-feedback" class="computer-feedback" role="status" aria-live="polite" aria-atomic="true">연결할 창과 만들 예제를 정해 주세요.</p><ol id="computer-progress" class="computer-progress" aria-label="진행 기록" aria-live="polite"></ol>
    </section>
    <section class="computer-section" aria-labelledby="computer-gallery-title"><div class="computer-section-heading"><h3 id="computer-gallery-title">3. 화면과 설명 검토</h3><span id="computer-count" class="computer-count"></span></div>
      <div class="computer-upload field"><label for="computer-upload">직접 찍은 화면 추가 · PNG</label><input id="computer-upload" type="file" accept=".png,image/png" multiple data-computer-idle><small>AI나 도우미 없이도 추가할 수 있습니다. 최대 20장 · 이미지 합계 32MiB. 직접 추가한 화면의 설명은 아래에서 적어 주세요.</small></div>
      <p id="computer-save-state" class="computer-save-state" role="status"></p><div id="computer-gallery"></div>
      <div class="computer-actions computer-gallery-actions">${button('select-all', '모두 선택', 'secondary small', 'data-computer-idle')}${button('save', '설명 수정 저장', 'secondary', 'data-computer-idle')}${button('retry-save', '저장 다시 시도', 'secondary', 'data-computer-idle hidden')}${button('insert', '선택한 자료를 현재 장에 넣기', 'primary', 'data-computer-idle disabled')}</div>
      <p class="computer-note">캡션과 추출한 설명을 확인해 주세요. 자료를 장에 넣으면 이미지와 설명이 본문에 함께 들어갑니다. 여기에 보관한 원본은 JSON 백업에도 포함됩니다.</p>
    </section>`;

  function feedback(message, error = false) {
    if (disposed) return;
    $('#computer-feedback').textContent = message;
    $('#computer-feedback').classList.toggle('is-error', error);
  }
  function updateControls() {
    if (disposed) return;
    root.querySelectorAll('[data-computer-idle]').forEach(el => { el.disabled = busy; });
    for (const action of ['refresh', 'disconnect', 'capture']) $(`[data-computer-action="${action}"]`).disabled = busy || !client;
    $('#computer-window').disabled = busy || !client || !windows.length;
    $('[data-computer-action="start"]').disabled = busy || !client || !windows.length || !isAIConfigured();
    $('[data-computer-action="capture"]').disabled = busy || !client || !windows.length;
    $('[data-computer-action="stop"]').disabled = !busy;
    $('[data-computer-action="insert"]').disabled = busy || !selected.size;
    $('[data-computer-action="select-all"]').disabled = busy || !research.records.length;
    $('[data-computer-action="retry-save"]').hidden = !dirty;
    $('#computer-ai-state').textContent = isAIConfigured() ? 'AI가 연결되어 있습니다. 선택한 창의 화면을 읽어 조작과 설명 추출을 진행합니다.' : '자동 조작에는 AI 연결이 필요합니다. 이 창을 닫고 설정에서 Google 또는 OpenAI API를 연결하세요. 화면 촬영과 PNG 추가는 연결 없이 가능합니다.';
    root.querySelectorAll('#computer-gallery input, #computer-gallery textarea, #computer-gallery button').forEach(el => { el.disabled = busy; });
  }
  function setBusy(value) { busy = value; onBusy(value); updateControls(); }
  function log(message) {
    if (disposed) return;
    const item = root.ownerDocument.createElement('li'); item.textContent = String(message).slice(0, 1000);
    const list = $('#computer-progress'); list.append(item);
    while (list.children.length > 50) list.firstElementChild.remove();
    list.scrollTop = list.scrollHeight;
  }
  function renderGallery() {
    if (disposed) return;
    $('#computer-count').textContent = `${research.records.length} / 20장`;
    $('#computer-save-state').textContent = dirty ? '저장되지 않은 자료가 있습니다. 저장을 다시 시도해 주세요.' : research.records.length ? '담은 자료가 이 책에 저장되어 있습니다.' : '';
    $('#computer-save-state').classList.toggle('is-error', dirty);
    $('#computer-gallery').innerHTML = research.records.length ? research.records.map((record, index) => `<article class="computer-record" data-computer-record="${escapeHTML(record.id)}"><div class="computer-record-image"><img src="${escapeHTML(record.src)}" alt="${escapeHTML(record.title || `화면 ${index + 1}`)}" loading="lazy" decoding="async"></div><div class="computer-record-editor"><label class="computer-record-selection"><input type="checkbox" data-computer-select="${escapeHTML(record.id)}" ${selected.has(record.id) ? 'checked' : ''}>화면 ${index + 1} · 본문에 넣기</label><p class="computer-record-origin">${escapeHTML(record.windowTitle)} · ${escapeHTML(new Date(record.capturedAt).toLocaleString('ko-KR'))}</p><div class="field"><label for="computer-record-title-${index}">그림 제목</label><input id="computer-record-title-${index}" data-computer-field="title" maxlength="150" value="${escapeHTML(record.title)}"></div><div class="field"><label for="computer-record-caption-${index}">그림 설명</label><textarea id="computer-record-caption-${index}" data-computer-field="caption" maxlength="1500" rows="2">${escapeHTML(record.caption)}</textarea></div><details class="computer-record-detail"><summary>추출한 내용과 작업 기록</summary><div class="field"><label for="computer-record-text-${index}">본문에 함께 넣을 내용</label><textarea id="computer-record-text-${index}" data-computer-field="extractedText" maxlength="12000" rows="5">${escapeHTML(record.extractedText)}</textarea></div>${record.steps.length ? `<ol>${record.steps.map(step => `<li>${escapeHTML(step)}</li>`).join('')}</ol>` : '<p>직접 추가하거나 한 장 촬영한 자료입니다.</p>'}</details>${button('remove', '자료에서 삭제', 'secondary small', `data-computer-id="${escapeHTML(record.id)}"`)}</div></article>`).join('') : '<div class="computer-empty"><strong>책에 넣을 장면을 모아 보세요.</strong><p>창을 연결해 촬영하거나 PNG 파일을 추가하면, 여기에서 화면과 설명을 함께 검토할 수 있습니다.</p></div>';
    updateControls();
  }
  function readDraft() {
    const records = research.records.map(record => {
      const card = [...root.querySelectorAll('[data-computer-record]')].find(el => el.dataset.computerRecord === record.id);
      if (!card) return record;
      const result = { ...record };
      for (const key of ['title', 'caption', 'extractedText']) result[key] = card.querySelector(`[data-computer-field="${key}"]`).value;
      return result;
    });
    const targetWindow = windows.find(item => item.id === $('#computer-window').value);
    return validateComputerResearch({ version: 1, goal: $('#computer-goal').value, target: targetWindow ? targetWindow.title.slice(0, 500) : research.target, records });
  }
  async function persist(candidate = readDraft()) {
    if (disposed) throw new DOMException('작업이 중지되었습니다.', 'AbortError');
    research = validateComputerResearch(candidate); dirty = true; renderGallery();
    await saveResearch(clone(research));
    dirty = false; renderGallery();
  }
  async function keepRecord(record) {
    if (disposed) throw new DOMException('작업이 중지되었습니다.', 'AbortError');
    const candidate = readDraft(); candidate.records.push(record);
    // Validate before changing local state; a limit failure never replaces originals.
    validateComputerResearch(candidate); selected.add(record.id);
    await persist(candidate);
  }
  async function operate(work) {
    if (busy || disposed) return;
    controller = new AbortController(); const signal = controller.signal;
    setBusy(true);
    try { await work(signal); checkAbort(signal); }
    catch (error) {
      if (!disposed) {
        const message = signal.aborted || error?.name === 'AbortError' ? '작업을 중지했습니다. 이미 담은 자료는 아래에서 확인할 수 있습니다.' : String(error?.message || '작업을 완료하지 못했습니다. 연결과 저장 상태를 확인해 주세요.').slice(0, 700);
        feedback(message, !(signal.aborted || error?.name === 'AbortError'));
        if (!signal.aborted && error?.name !== 'AbortError') notify(message, true);
      }
    } finally { controller = null; setBusy(false); }
  }
  async function refreshWindows(signal) {
    const previous = $('#computer-window').value;
    const response = await client.windows(signal);
    if (disposed || signal.aborted) return;
    windows = response.windows;
    $('#computer-window').innerHTML = '<option value="">직접 조작할 창을 선택하세요</option>' + windows.map(item => `<option value="${escapeHTML(item.id)}">${escapeHTML(item.title)}</option>`).join('');
    if (windows.some(item => item.id === previous)) $('#computer-window').value = previous;
    $('#computer-connection').textContent = windows.length ? `도우미 연결됨 · 열린 창 ${windows.length}개. 작업할 창을 직접 선택하세요.` : '도우미 연결됨 · 조작할 프로그램 창을 열고 목록을 새로고침하세요.';
    updateControls();
  }
  function requireWindow() {
    const target = windows.find(item => item.id === $('#computer-window').value);
    if (!client || !target) throw new Error('조작하거나 촬영할 프로그램 창을 선택해 주세요.');
    return target;
  }
  function requireRoom() {
    if (research.records.length >= 20) throw new Error('화면 자료는 최대 20장까지 보관할 수 있습니다. 필요 없는 자료를 삭제한 뒤 다시 시도해 주세요.');
  }
  async function capture(signal) {
    const target = requireWindow(); requireRoom(); await persist(); checkAbort(signal);
    feedback('선택한 프로그램 창을 앞으로 가져옵니다. 자동으로 열리지 않으면 8초 안에 해당 창을 클릭해 주세요.');
    const currentClient = client;
    try {
      const { sessionId } = await currentClient.select(target.id, signal);
      const frame = validateComputerFrame(await currentClient.observe(sessionId, signal));
      const capturedAt = new Date().toISOString();
      let description = { title: '실습 화면', caption: `${target.title}에서 촬영한 화면입니다.`, extractedText: '' }, analysisNote = '';
      if (isAIConfigured()) {
        feedback('화면에 보이는 내용과 설명을 읽고 있습니다.');
        try {
          const result = await decide({ goal: $('#computer-goal').value.trim() || '이 화면에서 확인할 수 있는 내용을 책에 넣을 그림 설명으로 정리해 주세요.', context: bookContext, frame, history: [], mode: 'capture', signal });
          if (result.action.type === 'ask_user') analysisNote = result.summary || '화면 내용을 확인하려면 사용자 설명이 필요합니다.';
          else description = result;
        } catch (error) {
          if (signal.aborted || error?.name === 'AbortError') throw error;
          analysisNote = 'AI가 설명을 읽지 못했습니다. 촬영한 화면은 저장했으니 설명을 직접 적거나 다시 촬영해 주세요.';
        }
      }
      if (signal.aborted) throw new DOMException('작업 중지', 'AbortError');
      await keepRecord({ id: newId(), capturedAt, windowTitle: frame.window.title, title: description.title, caption: description.caption, extractedText: description.extractedText, src: frame.image.src, steps: [] });
      feedback(analysisNote || '현재 화면을 담았습니다. 제목과 설명을 확인한 뒤 본문에 넣어 주세요.');
    } finally { await currentClient.stop().catch(() => {}); }
  }
  async function start(signal) {
    const target = requireWindow(); requireRoom();
    const goal = $('#computer-goal').value.trim();
    if (!goal) throw new Error('만들 예제와 책에 담을 내용을 먼저 적어 주세요.');
    if (!isAIConfigured()) throw new Error('설정에서 AI API를 연결한 뒤 시작해 주세요.');
    await persist(); checkAbort(signal); $('#computer-progress').replaceChildren();
    feedback('선택한 프로그램 창을 앞으로 가져옵니다. 자동으로 열리지 않으면 8초 안에 해당 창을 클릭해 주세요.');
    const { sessionId } = await client.select(target.id, signal);
    const result = await runTask({ client, sessionId, goal, context: bookContext, decide, signal, maxSteps: Number($('#computer-max-steps').value), onProgress: progress => { if (!disposed) { log(progress.message); feedback(progress.message); } }, onCapture: keepRecord });
    if (result.status === 'complete') feedback(result.message || '예제를 만들고 화면을 담았습니다. 아래 자료를 확인해 주세요.');
    else if (result.status === 'needs_user') feedback(`확인이 필요해 멈췄습니다. ${result.message}`);
    else feedback(`정한 단계에 도달해 멈췄습니다. ${result.message || '담은 자료와 프로그램 상태를 확인하고 이어서 할 작업을 적어 주세요.'}`);
  }
  async function readPNG(file) {
    if (!/\.png$/i.test(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 8 * 1024 * 1024) throw new Error('PNG 파일을 선택해 주세요. 파일 한 장은 8MiB 이하여야 합니다.');
    const Reader = root.ownerDocument.defaultView.FileReader;
    return new Promise((resolve, reject) => {
      const reader = new Reader();
      reader.onerror = () => reject(new Error('이미지 파일을 읽지 못했습니다.'));
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
  }
  async function upload(files, signal) {
    if (!files.length) return;
    if (research.records.length + files.length > 20) throw new Error('화면 자료는 최대 20장까지 추가할 수 있습니다.');
    const currentBytes = research.records.reduce((sum, record) => {
      const encoded = record.src.slice(record.src.indexOf(',') + 1);
      return sum + encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
    }, 0);
    if (files.some(file => !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 8 * 1024 * 1024)) throw new Error('PNG 파일 한 장은 8MiB 이하여야 합니다.');
    if (currentBytes + files.reduce((sum, file) => sum + file.size, 0) > 32 * 1024 * 1024) throw new Error('보관할 화면 자료의 합계는 32MiB 이하여야 합니다.');
    const candidate = readDraft();
    for (const file of files) {
      const src = await readPNG(file);
      if (signal.aborted) throw new DOMException('작업 중지', 'AbortError');
      candidate.records.push({ id: newId(), capturedAt: new Date().toISOString(), windowTitle: file.name.slice(0, 1000), title: file.name.replace(/\.png$/i, '').slice(0, 150), caption: '', extractedText: '', src, steps: [] });
    }
    const validated = validateComputerResearch(candidate);
    for (const record of validated.records.slice(research.records.length)) selected.add(record.id);
    await persist(validated); feedback(`${files.length}장의 화면 자료를 추가했습니다. 설명을 적은 뒤 본문에 넣어 주세요.`);
  }
  async function onConnect(event) {
    event.preventDefault();
    if (busy || disposed) return;
    const token = $('#computer-token').value.trim(); $('#computer-token').value = '';
    await operate(async signal => {
      if (client) await client.stop().catch(() => {});
      client = null; windows = [];
      const candidate = createClient({ token });
      feedback('이 PC의 연결 도우미를 확인하고 있습니다.');
      await candidate.status(signal);
      if (disposed || signal.aborted) return;
      client = candidate; await refreshWindows(signal);
      feedback('도우미가 연결되었습니다. 작업할 창을 선택해 주세요.');
    });
  }
  async function onClick(event) {
    const trigger = event.target.closest?.('[data-computer-action]');
    if (!trigger || !root.contains(trigger)) return;
    event.preventDefault(); event.stopPropagation();
    const action = trigger.dataset.computerAction;
    if (action === 'stop') {
      controller?.abort(); client?.stop().catch(() => {});
      feedback('중지 요청을 보냈습니다. 도우미에서 F8을 눌러도 즉시 멈출 수 있습니다.'); return;
    }
    if (busy || disposed) return;
    if (action === 'preset') { $('#computer-goal').value = MAPLE_GOAL; onInput({ target: $('#computer-goal') }); $('#computer-goal').focus(); return; }
    if (action === 'select-all') {
      if (selected.size === research.records.length) selected.clear(); else research.records.forEach(record => selected.add(record.id));
      // Preserve text edits before rebuilding the cards.
      research = readDraft(); renderGallery(); return;
    }
    await operate(async signal => {
      if (action === 'refresh') await refreshWindows(signal);
      else if (action === 'disconnect') {
        try { await client?.stop(); }
        finally {
          client = null; windows = [];
          $('#computer-window').innerHTML = '<option value="">연결 후 창을 선택하세요</option>';
          $('#computer-connection').textContent = '연결을 끊었습니다. 다시 연결하려면 도우미의 코드를 입력하세요.';
        }
        feedback('도우미와의 연결을 끊었습니다. 담은 자료는 유지됩니다.');
      } else if (action === 'capture') await capture(signal);
      else if (action === 'start') await start(signal);
      else if (action === 'save' || action === 'retry-save') { await persist(); feedback('화면 자료와 설명을 저장했습니다.'); }
      else if (action === 'remove') {
        const candidate = readDraft(); candidate.records = candidate.records.filter(record => record.id !== trigger.dataset.computerId);
        selected.delete(trigger.dataset.computerId); await persist(candidate); feedback('자료를 삭제했습니다. 이미 본문에 넣은 그림은 그대로 남아 있습니다.');
      } else if (action === 'insert') {
        const candidate = readDraft(), records = candidate.records.filter(record => selected.has(record.id));
        if (!records.length) throw new Error('본문에 넣을 자료를 선택해 주세요.');
        await persist(candidate); checkAbort(signal); await insertRecords(clone(records)); selected.clear(); renderGallery();
        feedback(`${records.length}장의 화면과 설명을 ‘${bookContext.chapterTitle}’에 넣었습니다.`);
      }
    });
  }
  function onChange(event) {
    const target = event.target;
    if (target.matches('[data-computer-select]')) { target.checked ? selected.add(target.dataset.computerSelect) : selected.delete(target.dataset.computerSelect); updateControls(); }
    else if (target.id === 'computer-upload') { const files = [...target.files]; target.value = ''; operate(signal => upload(files, signal)); }
    else if (target.id === 'computer-window') updateControls();
  }
  function onInput(event) {
    if (event.target.matches('[data-computer-field], #computer-goal')) {
      dirty = true;
      $('#computer-save-state').textContent = '수정한 설명을 아직 저장하지 않았습니다. 설명 수정 저장을 눌러 주세요.';
      $('#computer-save-state').classList.add('is-error'); updateControls();
    }
  }
  function onBeforeUnload(event) {
    if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
  }
  $('#computer-connect-form').addEventListener('submit', onConnect);
  root.addEventListener('click', onClick); root.addEventListener('change', onChange); root.addEventListener('input', onInput);
  root.ownerDocument.defaultView.addEventListener('beforeunload', onBeforeUnload);
  renderGallery();
  return { dispose() {
    if (disposed) return;
    // The app stages this snapshot synchronously, then persists it. Closing a
    // modal must not silently discard captions typed since the last save.
    let pendingSave;
    if (dirty && !busy) {
      try { pendingSave = Promise.resolve(saveResearch(clone(readDraft()))).catch(() => { notify('화면 자료의 변경 내용을 저장하지 못했습니다. 저장 복구 안내를 확인해 주세요.', true); }); }
      catch { notify('화면 자료의 변경 내용을 저장하지 못했습니다. 자료실을 다시 열어 확인해 주세요.', true); }
    }
    disposed = true; controller?.abort(); client?.stop().catch(() => {}); client = null; windows = []; selected.clear();
    $('#computer-token').value = '';
    $('#computer-connect-form').removeEventListener('submit', onConnect);
    root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); root.removeEventListener('input', onInput); onBusy(false);
    root.ownerDocument.defaultView.removeEventListener('beforeunload', onBeforeUnload);
    return pendingSave;
  } };
}
