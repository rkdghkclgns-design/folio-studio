/** Bounded, explicit control of a selected window through the local Folio companion. */
import { validateImageSource } from './export.js';

const ORIGIN = 'http://127.0.0.1:8765';
const MIB = 1024 * 1024;
const MAX_PNG_BYTES = 8 * MIB;
const MAX_RESPONSE_BYTES = Math.ceil(MAX_PNG_BYTES / 3) * 4 + 65536;
const REQUEST_TIMEOUT_MS = 15000;
const keys = new Set(['enter', 'tab', 'escape', 'backspace', 'delete', 'up', 'down', 'left', 'right', 'space', 'ctrl+a', 'ctrl+c', 'ctrl+z', 'ctrl+y', 'ctrl+s', 'f5']);
const actionFields = ['type', 'x', 'y', 'text', 'key', 'amount'];
const pngCache = new WeakMap();
const localErrors = new WeakSet();
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function failure(message, code = 'INVALID_COMPUTER_DATA') {
  const error = new Error(message);
  error.name = 'ComputerError'; error.code = code;
  localErrors.add(error);
  return error;
}
function fail(message, code) { throw failure(message, code); }
function exact(value, fields) {
  if (!object(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) {
    fail('컴퓨터 작업 자료의 항목이 올바르지 않습니다.');
  }
}
function string(value, max, { required = false, line = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)
      || (line && /[\r\n\t]/u.test(value)) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    fail('컴퓨터 작업의 문구가 비어 있거나 허용된 길이·문자 범위를 벗어났습니다.');
  }
  return value;
}
function identifier(value, max = 128) {
  if (typeof value !== 'string' || !new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`).test(value)) fail('컴퓨터 작업 식별자가 올바르지 않습니다.');
  return value;
}
function abortError() { const error = new Error('컴퓨터 작업을 중지했습니다.'); error.name = 'AbortError'; return error; }
function checkAbort(signal) { if (signal?.aborted) throw abortError(); }

/** Both a type-specific input and the model's full canonical shape are accepted. */
export function validateComputerAction(value) {
  if (!object(value) || typeof value.type !== 'string' || !Object.hasOwn(value, 'type') || Object.keys(value).some(key => !actionFields.includes(key))) fail('허용되지 않은 컴퓨터 동작입니다.');
  const allowed = {
    click: ['x', 'y'], double_click: ['x', 'y'], type_text: ['text'], press_key: ['key'],
    scroll: ['x', 'y', 'amount'], wait: [], capture: [], finish: [], ask_user: [],
  };
  if (!Object.hasOwn(allowed, value.type)) fail('허용되지 않은 컴퓨터 동작입니다.');
  const result = { type: value.type, x: 0, y: 0, text: '', key: '', amount: 0 };
  for (const field of actionFields.slice(1)) {
    if (allowed[value.type].includes(field)) {
      if (!Object.hasOwn(value, field)) fail('컴퓨터 동작에 필요한 값이 없습니다.');
      result[field] = value[field];
    } else if (Object.hasOwn(value, field) && value[field] !== result[field]) fail('컴퓨터 동작에 불필요한 값이 포함되어 있습니다.');
  }
  if (allowed[value.type].includes('x') && (![result.x, result.y].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1000))) fail('클릭 위치가 작업 창을 벗어났습니다.');
  if (value.type === 'type_text') string(result.text, 4000, { required: true });
  if (value.type === 'press_key') {
    if (typeof result.key !== 'string' || !keys.has(result.key.toLowerCase())) fail('허용되지 않은 단축키입니다.');
    result.key = result.key.toLowerCase();
  }
  if (value.type === 'scroll' && (!Number.isInteger(result.amount) || result.amount < -5 || result.amount > 5)) fail('스크롤 범위가 올바르지 않습니다.');
  return result;
}

export function validateComputerDecision(value) {
  exact(value, ['action', 'summary', 'title', 'caption', 'extractedText']);
  return {
    action: validateComputerAction(value.action), summary: string(value.summary, 1000),
    title: string(value.title, 150), caption: string(value.caption, 1500), extractedText: string(value.extractedText, 12000),
  };
}

function png(src, cacheKey) {
  const cached = object(cacheKey) ? pngCache.get(cacheKey) : null;
  if (cached && cached.src === src) return cached;
  if (typeof src !== 'string' || src.length > Math.ceil(MAX_PNG_BYTES / 3) * 4 + 22
      || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(src)) fail('작업 화면에는 8 MiB 이하의 PNG만 사용할 수 있습니다.', 'INVALID_COMPUTER_IMAGE');
  const encoded = src.slice(22);
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (!Number.isInteger(bytes) || bytes <= 0 || bytes > MAX_PNG_BYTES) fail('작업 화면의 PNG 용량이 올바르지 않습니다.', 'INVALID_COMPUTER_IMAGE');
  let canonical, header;
  try { canonical = validateImageSource(src); header = atob(encoded.slice(0, 44)); }
  catch { fail('작업 화면 PNG가 손상되었습니다.', 'INVALID_COMPUTER_IMAGE'); }
  if (!canonical.startsWith('data:image/png;base64,') || header.length < 24) fail('작업 화면은 PNG 형식이어야 합니다.', 'INVALID_COMPUTER_IMAGE');
  const uint32 = offset => header.charCodeAt(offset) * 16777216 + header.charCodeAt(offset + 1) * 65536 + header.charCodeAt(offset + 2) * 256 + header.charCodeAt(offset + 3);
  const width = uint32(16), height = uint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 50000000) fail('작업 화면 해상도가 너무 큽니다.', 'INVALID_COMPUTER_IMAGE');
  const result = { src: canonical, bytes, width, height };
  if (object(cacheKey)) pngCache.set(cacheKey, result);
  return result;
}

function windowInfo(value) {
  exact(value, ['id', 'title']);
  return { id: identifier(value.id), title: string(value.title, 1000, { line: true }) };
}
export function validateComputerFrame(value) {
  exact(value, ['sessionId', 'frameId', 'window', 'image']);
  exact(value.image, ['src', 'width', 'height']);
  const asset = png(value.image.src, value.image);
  if (value.image.width !== asset.width || value.image.height !== asset.height) fail('작업 화면의 실제 해상도와 표시된 값이 일치하지 않습니다.', 'INVALID_COMPUTER_IMAGE');
  const result = {
    sessionId: identifier(value.sessionId), frameId: identifier(value.frameId), window: windowInfo(value.window),
    image: { src: asset.src, width: asset.width, height: asset.height },
  };
  pngCache.set(result.image, asset);
  return result;
}

/** A durable notebook contains evidence only; credentials and executable actions never belong here. */
export function validateComputerResearch(value) {
  if (value === undefined) return undefined;
  exact(value, ['version', 'goal', 'target', 'records']);
  if (value.version !== 1 || !Array.isArray(value.records) || value.records.length > 20) fail('컴퓨터 작업 자료는 최대 20개까지 보관할 수 있습니다.');
  const result = { version: 1, goal: string(value.goal, 4000), target: string(value.target, 500), records: [] };
  let total = 0;
  const ids = new Set();
  for (const record of value.records) {
    exact(record, ['id', 'capturedAt', 'windowTitle', 'title', 'caption', 'extractedText', 'src', 'steps']);
    const id = identifier(record.id, 80);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) fail('작업 자료 식별자에는 영문·숫자·하이픈·밑줄만 사용할 수 있습니다.');
    if (ids.has(id)) fail('중복된 컴퓨터 작업 자료 식별자입니다.');
    ids.add(id);
    if (typeof record.capturedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.capturedAt)
        || !Number.isFinite(Date.parse(record.capturedAt)) || new Date(record.capturedAt).toISOString() !== record.capturedAt) fail('작업 화면의 촬영 시각이 올바르지 않습니다.');
    if (!Array.isArray(record.steps) || record.steps.length > 50) fail('컴퓨터 작업 기록은 최대 50단계까지 보관할 수 있습니다.');
    const asset = png(record.src, record);
    total += asset.bytes;
    if (total > 32 * MIB) fail('컴퓨터 작업 화면의 합계는 32 MiB 이하여야 합니다.', 'COMPUTER_IMAGE_TOTAL_LIMIT');
    const clean = {
      id, capturedAt: record.capturedAt, windowTitle: string(record.windowTitle, 1000, { line: true }),
      title: string(record.title, 150), caption: string(record.caption, 1500), extractedText: string(record.extractedText, 12000),
      src: asset.src, steps: record.steps.map(step => string(step, 1000)),
    };
    pngCache.set(clean, asset);
    result.records.push(clean);
  }
  return result;
}

const bridgeMessages = {
  UNAUTHORIZED: 'PC 도우미의 연결 코드를 다시 확인해 주세요.',
  AUTH_REQUIRED: 'PC 도우미의 연결 코드를 다시 확인해 주세요.',
  FORBIDDEN: '이 사이트의 PC 도우미 연결이 허용되지 않았습니다.',
  STALE_FRAME: '작업 창이 변경되었거나 화면의 유효 시간이 지났습니다. 창을 확인하고 다시 연결해 주세요.',
  WINDOW_CHANGED: '선택한 작업 창이 변경되었습니다. 창을 확인하고 다시 연결해 주세요.',
  NOT_FOREGROUND: '선택한 작업 창이 전면에 없어 조작을 멈췄습니다.',
  FOCUS_CHANGED: '선택한 작업 창이 전면에 없어 조작을 멈췄습니다. 창을 다시 선택해 주세요.',
  FOCUS_REQUIRED: '선택한 작업 창을 앞에 띄운 뒤 다시 선택해 주세요.',
  FRAME_EXPIRED: '작업 화면의 유효 시간이 지났습니다. 작업 창을 다시 선택해 이어서 진행해 주세요.',
  SESSION_EXPIRED: '컴퓨터 작업 연결이 만료되었습니다. 작업 창을 다시 선택해 주세요.',
  STOPPED: '컴퓨터 작업을 중지했습니다. 이어서 작업하려면 창을 다시 선택해 주세요.',
  WINDOW_UNAVAILABLE: '선택한 창을 찾을 수 없습니다. 프로그램을 열고 창 목록을 새로고침해 주세요.',
  WINDOW_OBSCURED: '다른 창이 작업 화면을 가리고 있습니다. 가린 창을 치운 뒤 다시 선택해 주세요.',
  WINDOW_BOUNDS: '작업 창의 크기나 위치를 확인한 뒤 다시 선택해 주세요.',
  CAPTURE_FAILED: '이 창의 화면을 가져오지 못했습니다. 직접 촬영한 PNG를 추가할 수도 있습니다.',
  INPUT_BLOCKED: '프로그램이 입력을 받지 못했습니다. 선택한 창과 권한을 확인해 주세요.',
  MODIFIER_HELD: '키보드의 Ctrl·Alt·Shift·Windows 키에서 손을 뗀 뒤 다시 시작해 주세요.',
  BUSY: 'PC 도우미의 이전 작업이 끝난 뒤 다시 시작해 주세요.',
  SESSION_STOPPED: '컴퓨터 작업 연결이 중지되었습니다. 작업 창을 다시 선택해 주세요.',
  INVALID_SESSION: '컴퓨터 작업 연결이 만료되었습니다. 작업 창을 다시 선택해 주세요.',
};

/** The token remains inside this closure and is never copied into project data or error text. */
export function createComputerClient({ token, fetchImpl = globalThis.fetch, baseURL = ORIGIN } = {}) {
  if (typeof token !== 'string' || !/^[a-fA-F0-9]{64}$/.test(token)) fail('PC 도우미에 표시된 64자리 연결 코드를 입력해 주세요.', 'INVALID_COMPUTER_TOKEN');
  if (typeof baseURL !== 'string' || !/^http:\/\/127\.0\.0\.1:8765\/?$/.test(baseURL)) fail('PC 도우미는 지정된 로컬 주소에만 연결할 수 있습니다.', 'INVALID_COMPUTER_ORIGIN');
  if (typeof fetchImpl !== 'function') fail('이 브라우저에서는 PC 도우미에 연결할 수 없습니다.');
  async function request(endpoint, body, signal, large = false) {
    checkAbort(signal);
    const controller = new AbortController();
    let reader, timedOut = false, rejectCancellation;
    const cancelled = new Promise((_, reject) => { rejectCancellation = reject; });
    const cancel = () => { controller.abort(); rejectCancellation(timedOut ? failure('PC 도우미의 응답 시간이 초과되었습니다. 작업 창을 확인해 주세요.', 'COMPUTER_TIMEOUT') : abortError()); };
    const timer = setTimeout(() => { timedOut = true; cancel(); }, REQUEST_TIMEOUT_MS);
    signal?.addEventListener('abort', cancel, { once: true });
    const url = `${ORIGIN}/v1/${endpoint}`;
    const limit = large ? MAX_RESPONSE_BYTES : 256 * 1024;
    try {
      const work = async () => {
        const response = await fetchImpl(url, {
          method: body === undefined ? 'GET' : 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store',
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
        });
        if (controller.signal.aborted) {
          try { response.body?.cancel()?.catch(() => {}); } catch { /* Closed response. */ }
          checkAbort(controller.signal);
        }
        if (response.redirected || (response.url && response.url !== url)) fail('PC 도우미의 응답 주소가 일치하지 않습니다.', 'INVALID_COMPUTER_RESPONSE');
        if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) fail('PC 도우미가 올바른 응답을 보내지 않았습니다.', 'INVALID_COMPUTER_RESPONSE');
        const size = response.headers.get('content-length');
        if (size !== null && (!/^\d+$/.test(size) || Number(size) > limit)) fail('PC 도우미 응답의 크기 제한을 초과했습니다.', 'COMPUTER_RESPONSE_LIMIT');
        if (!response.body?.getReader) fail('PC 도우미의 응답을 읽을 수 없습니다.', 'INVALID_COMPUTER_RESPONSE');
        reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8', { fatal: true });
        let bytes = 0, content = '';
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > limit) fail('PC 도우미 응답의 크기 제한을 초과했습니다.', 'COMPUTER_RESPONSE_LIMIT');
          content += decoder.decode(chunk.value, { stream: true });
        }
        content += decoder.decode();
        let value;
        try { value = JSON.parse(content); } catch { fail('PC 도우미의 응답을 해석할 수 없습니다.', 'INVALID_COMPUTER_RESPONSE'); }
        if (!response.ok) {
          const code = typeof value?.error?.code === 'string' && /^[A-Z_]{1,60}$/.test(value.error.code) ? value.error.code : 'COMPUTER_REQUEST_FAILED';
          fail(bridgeMessages[code] || 'PC 도우미가 작업을 중단했습니다. 선택한 창과 연결 상태를 확인해 주세요.', code);
        }
        return value;
      };
      return await Promise.race([work(), cancelled]);
    } catch (error) {
      if (signal?.aborted) throw abortError();
      if (localErrors.has(error)) throw error;
      // Transport failures may contain request metadata; expose a fixed message only.
      throw failure('PC 도우미에 연결하지 못했습니다. 도우미 실행과 브라우저의 로컬 네트워크 권한을 확인해 주세요.', 'COMPUTER_CONNECTION_FAILED');
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', cancel);
      controller.abort();
      if (reader) { try { const cleanup = reader.cancel(); cleanup?.catch(() => {}); } catch { /* Already released. */ } }
    }
  }
  function ok(value) { exact(value, ['ok']); if (value.ok !== true) fail('PC 도우미가 작업 완료를 확인하지 않았습니다.'); return { ok: true }; }
  return Object.freeze({
    async status(signal) { const value = await request('status', undefined, signal); exact(value, ['version', 'platform']); if (value.version !== 1 || value.platform !== 'windows') fail('지원되는 Windows PC 도우미가 아닙니다.'); return { version: 1, platform: 'windows' }; },
    async windows(signal) { const value = await request('windows', undefined, signal); exact(value, ['windows']); if (!Array.isArray(value.windows) || value.windows.length > 200) fail('작업 창 목록이 올바르지 않습니다.'); const windows = value.windows.map(windowInfo); if (new Set(windows.map(window => window.id)).size !== windows.length) fail('작업 창 목록에 중복 항목이 있습니다.'); return { windows }; },
    async select(windowId, signal) { const value = await request('select', { windowId: identifier(windowId) }, signal); exact(value, ['sessionId']); return { sessionId: identifier(value.sessionId) }; },
    async observe(sessionId, signal) { const value = validateComputerFrame(await request('observe', { sessionId: identifier(sessionId) }, signal, true)); if (value.sessionId !== sessionId) fail('다른 컴퓨터 작업의 화면이 반환되었습니다.'); return value; },
    async act(sessionId, frameId, action, signal) { const clean = validateComputerAction(action); if (['capture', 'finish', 'ask_user'].includes(clean.type)) fail('이 동작은 화면 조작 요청으로 보낼 수 없습니다.'); return ok(await request('action', { sessionId: identifier(sessionId), frameId: identifier(frameId), action: clean }, signal)); },
    async stop() { return ok(await request('stop', {})); },
  });
}

/** Observe, decide once, execute once. Every exit revokes the selected-window session. */
export async function runComputerTask({ client, sessionId, goal, context = {}, decide, signal, maxSteps = 20, onProgress, onCapture } = {}) {
  identifier(sessionId);
  string(goal, 4000, { required: true });
  if (!client || !['observe', 'act', 'stop'].every(key => typeof client[key] === 'function') || typeof decide !== 'function' || typeof onCapture !== 'function') fail('컴퓨터 작업을 시작할 준비가 되지 않았습니다.');
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 50) fail('컴퓨터 작업은 1~50단계로 설정해 주세요.');
  const steps = [], history = [];
  let stopPromise;
  const stop = () => { if (!stopPromise) stopPromise = Promise.resolve().then(() => client.stop()).catch(() => {}); return stopPromise; };
  const abort = () => { void stop(); };
  signal?.addEventListener('abort', abort, { once: true });
  async function progress(event) { checkAbort(signal); if (onProgress) await onProgress(event); checkAbort(signal); }
  try {
    for (let step = 1; step <= maxSteps; step++) {
      checkAbort(signal);
      await progress({ step, type: 'observe', message: '선택한 작업 창을 확인하고 있습니다.' });
      const frame = validateComputerFrame(await client.observe(sessionId, signal));
      const observedAt = new Date().toISOString();
      if (frame.sessionId !== sessionId) fail('다른 컴퓨터 작업의 화면이 반환되었습니다.');
      Object.freeze(frame.window); Object.freeze(frame.image); Object.freeze(frame);
      checkAbort(signal);
      await progress({ step, type: 'decide', message: '현재 화면에서 다음 작업을 정하고 있습니다.', frame });
      const decision = validateComputerDecision(await decide({ goal, context, frame, history: history.slice(-20).map(item => ({ action: { ...item.action }, summary: item.summary })), signal }));
      checkAbort(signal);
      const message = decision.summary.trim() || ({ capture: '작업 화면을 촬영했습니다.', finish: '작업을 마쳤습니다.', ask_user: '사용자의 확인이 필요합니다.' }[decision.action.type] || '선택한 창에서 다음 단계를 진행합니다.');
      steps.push(message);
      history.push({ action: decision.action, summary: message });
      if (decision.action.type === 'ask_user') return { status: 'needs_user', message, steps: [...steps] };
      if (decision.action.type === 'capture' || decision.action.type === 'finish') {
        checkAbort(signal);
        const record = {
          id: globalThis.crypto?.randomUUID?.() || `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          capturedAt: observedAt, windowTitle: frame.window.title,
          title: decision.title.trim() || '작업 화면', caption: decision.caption.trim() || '선택한 작업 창에서 촬영한 화면입니다.',
          extractedText: decision.extractedText, src: frame.image.src, steps: [...steps],
        };
        const safe = validateComputerResearch({ version: 1, goal, target: '', records: [record] }).records[0];
        await onCapture(safe);
        checkAbort(signal);
        await progress({ step, type: 'capture', message: '촬영한 화면과 설명을 작업 자료에 저장했습니다.', frame });
        if (decision.action.type === 'finish') return { status: 'complete', message, steps: [...steps] };
      } else {
        await progress({ step, type: 'action', message });
        checkAbort(signal);
        await client.act(sessionId, frame.frameId, decision.action, signal);
        checkAbort(signal);
      }
    }
    return { status: 'limit', message: '설정한 작업 단계에 도달했습니다. 저장된 화면을 확인한 뒤 이어서 진행해 주세요.', steps: [...steps] };
  } finally {
    signal?.removeEventListener('abort', abort);
    await stop();
  }
}
