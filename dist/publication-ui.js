import { normalizePublication, publicationReadiness, publicationFingerprint, buildPublicationPackage, publicationGuide, PUBLICATION_LINKS, PUBLICATION_REVIEW_DATE, publicationFieldMap, recordPublicationVersion, DISTRIBUTION_STATUS, ISBN_STATUS, DEPOSIT_STATUS } from './publication.js';
import { downloadBlob } from './export.js';
import { createPublicationCover, coverFingerprint } from './publication-cover.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusName = { pass: '확인', warning: '검토 필요', block: '필수 수정', external: '외부 확인' };
const input = (m, name, label, attributes = '') => `<label>${label}<input name="${name}" value="${esc(m[name])}" ${attributes}></label>`;

export function renderPublicationChecks(project, metadata) {
  const report = publicationReadiness(project, metadata);
  return `<div class="publication-summary" role="status"><strong>${report.passed} / ${report.total} 항목 확인</strong><span>${report.blockers ? `필수 수정 ${report.blockers}개` : '준비 패키지 생성 가능'} · 유통 심사는 별도</span></div>${report.staleReview ? '<p class="publication-warning">원고나 표지가 바뀌었습니다. 아래 직접 확인 항목을 다시 검토해 주세요.</p>' : ''}<ul class="publication-checks">${report.checks.map(c => `<li class="publication-check ${c.state}"><span class="publication-check-state">${statusName[c.state]}</span><div><strong>${esc(c.label)}</strong><p>${esc(c.detail)}</p></div></li>`).join('')}</ul>`;
}

function renderFieldMap(project, metadata) {
  const map = publicationFieldMap(project, metadata);
  return '<p class="publication-note">서점 입력 화면으로 옮겨 쓸 대응표입니다. 국내 필수항목은 유페이퍼 판권 안내 기준이며 다른 유통사는 별도 확인합니다.</p><div class="publication-table-wrap"><table class="publication-table"><thead><tr><th>판매 입력 항목</th><th>현재 값</th><th>준비 기준</th></tr></thead><tbody>' + map.fields.map(f => '<tr><th scope="row">' + esc(f.label) + '</th><td>' + esc(f.value || '미입력') + '</td><td>' + (f.required ? (f.complete ? '필수 · 입력됨' : '필수 · 입력 필요') : '선택 / 경로 확인') + '</td></tr>').join('') + '</tbody></table></div>';
}
function renderHistory(project, metadata) {
  const m = normalizePublication(metadata), current = publicationFingerprint(project, m);
  return m.history.length ? '<ol class="publication-history">' + [...m.history].reverse().map(r => '<li><strong>' + esc(r.edition) + '</strong> <span>' + esc(DISTRIBUTION_STATUS[r.distributionStatus] || r.distributionStatus) + ' · ' + esc(r.recordedAt.slice(0, 10)) + '</span><p>' + (r.fingerprint === current ? '현재 판본과 일치' : '이전 내용의 기록') + ' · 권리 ' + (r.review.rightsConfirmed ? '확인' : '미확인') + ' · 교정 ' + (r.review.proofreadConfirmed ? '확인' : '미확인') + ' · 기기 ' + (r.review.deviceReviewConfirmed ? '확인' : '미확인') + '</p><p>ISBN: ' + esc(ISBN_STATUS[r.isbnStatus] || r.isbnStatus) + ' · 납본: ' + esc(DEPOSIT_STATUS[r.depositStatus] || r.depositStatus) + '</p>' + (r.note ? '<p>' + esc(r.note) + '</p>' : '') + '</li>').join('') + '</ol>' : '<p class="publication-note">아직 기록한 판본이 없습니다. 외부 진행 상태를 확인한 뒤 기록하세요.</p>';
}

export function renderPublicationPanel(project) {
  const m = normalizePublication(project.publication), reviewed = m.reviewFingerprint === publicationFingerprint(project);
  const option = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
  return `<section class="publication-panel" aria-labelledby="publication-heading"><div class="publication-heading"><div><span class="publication-eyebrow">PUBLISHING DESK</span><h2 id="publication-heading">출판 준비</h2><p>도서 정보를 정리하고, 판권·원고·검수 자료를 한 번에 준비하세요.</p></div></div>
  <form class="publication-form" aria-label="출판 정보">
  <div class="publication-grid"><label>출판 경로<select name="channel">${[['domestic', '국내 유통 · 유페이퍼 / 출판사'], ['kdp', 'Amazon KDP · 지원 언어 원고'], ['direct', '직접 배포 · 웹북']].map(([v,l]) => option(v,l,m.channel)).join('')}</select></label>${input(m, 'publisher', '발행처 / 출판사명', 'maxlength="200" placeholder="계약할 발행처 입력"')}${input(m, 'publicationDate', '전자책 출판 예정일', 'type="date"')}${input(m, 'isbn', 'ISBN · 발급받은 경우', 'maxlength="40" placeholder="978… 또는 979…"')}<label>정가<div class="publication-price"><input aria-label="정가" name="price" inputmode="decimal" value="${esc(m.price)}" maxlength="30" placeholder="예: 5000"><select aria-label="정가 통화" name="currency">${option('KRW','원 (KRW)',m.currency)}${option('USD','달러 (USD)',m.currency)}</select></div></label>${input(m, 'category', '분류', 'maxlength="200" placeholder="예: 자기계발 / 글쓰기"')}${input(m, 'keywords', '검색 키워드', 'maxlength="500" placeholder="쉼표로 구분"')}${input(m, 'rightsHolder', '저작권 / 이용권 보유자', 'maxlength="200" placeholder="저자명 또는 권리자명"')}</div>
  <details class="publication-details"><summary>소개와 권리·AI 사용 내역</summary><div class="publication-grid"><label class="publication-wide">저자 소개<textarea name="authorBio" rows="3" maxlength="3000">${esc(m.authorBio)}</textarea></label><label class="publication-wide">권리·인용·라이선스 고지<textarea name="rightsStatement" rows="3" maxlength="3000" placeholder="자료 출처와 이용 허락, 사용한 이미지·폰트의 라이선스를 기록하세요.">${esc(m.rightsStatement)}</textarea></label><label>AI 사용 구분<select name="aiDisclosure">${[['unknown','확인 전'],['generated','AI 생성 · 본문/번역/이미지 포함'],['assisted','AI 보조 · 직접 쓴 내용의 교정 등'],['none','AI 사용 없음']].map(([v,l]) => option(v,l,m.aiDisclosure)).join('')}</select></label>${input(m, 'aiTools', '사용한 AI 도구', 'maxlength="500" placeholder="예: Gemini 본문 초안, OpenAI 삽화"')}</div><p class="publication-note">AI가 작성한 내용을 사람이 수정해도 KDP에서는 AI 생성으로 분류합니다. 국내 유통사의 저자명·도구 표기 규칙도 확인하세요.</p></details>
  <details class="publication-details" open><summary>판매용 표지 JPG</summary><p class="publication-note">제목·저자·발행처와 현재 표지 디자인을 합성합니다. KDP는 권장 1600 × 2560px, 국내·웹 배포는 Folio 기본 1600 × 2400px입니다. 국내 유통사의 공통 의무 규격은 아니며 제출처 안내에 맞춰 수정하세요.</p><div class="publication-grid">${input(m, 'coverWidth', '국내·웹 표지 가로 (px)', 'type="number" min="625" max="4096" step="1"')}${input(m, 'coverHeight', '국내·웹 표지 세로 (px)', 'type="number" min="1000" max="4096" step="1"')}</div><p class="publication-note">KDP 선택 시 입력값 대신 1600 × 2560px을 적용합니다. RGB JPEG · Folio 처리 한도 12MB. 표지 시각 검수와 이용 권리는 별도 확인합니다.</p><button class="button secondary" type="button" data-publication-action="cover">판매용 JPG 표지 받기</button><div class="publication-cover-preview" data-publication-cover-preview></div></details>
  <details class="publication-details"><summary>판본·유통·ISBN·납본 이력</summary><p class="publication-note">직접 확인한 외부 상태를 기록합니다. 이 화면에서 판매 신청이나 ISBN 발급·납본이 실행되지는 않습니다. 최근 100건을 보존합니다.</p><div class="publication-grid">${input(m, 'edition', '판본 이름', 'maxlength="100" placeholder="예: 초판 1.0"')}${input(m, 'workflowOwner', '담당자 / 대행 기관', 'maxlength="200"')}${[['distributionStatus','유통 진행',DISTRIBUTION_STATUS],['isbnStatus','ISBN 진행',ISBN_STATUS],['depositStatus','납본 진행',DEPOSIT_STATUS]].map(([name,label,values]) => '<label>'+label+'<select name="'+name+'">'+Object.entries(values).map(([v,l])=>option(v,l,m[name])).join('')+'</select></label>').join('')}${input(m,'submissionDate','외부 제출 확인일','type="date"')}${input(m,'approvedDate','외부 승인 확인일','type="date"')}${input(m,'depositDate','납본 완료 확인일','type="date"')}${input(m,'referenceUrl','진행 증빙 링크','type="url" maxlength="2000" placeholder="https://…"')}<label class="publication-wide">개정 사항<textarea name="editionNotes" rows="2" maxlength="2000">${esc(m.editionNotes)}</textarea></label><label class="publication-wide">이번 진행 기록<textarea name="recordNote" rows="2" maxlength="2000">${esc(m.recordNote)}</textarea></label></div><button class="button secondary" type="button" data-publication-action="record">현재 판본과 진행 상태 기록</button><div data-publication-history>${renderHistory(project,m)}</div></details>
  <fieldset class="publication-confirmations"><legend>저자가 직접 확인할 항목</legend>${[['rightsConfirmed','등록한 원문·인용·이미지의 이용 권리를 확인했습니다.'],['proofreadConfirmed','현재 원고의 사실·출처·교정을 확인했습니다.'],['deviceReviewConfirmed','현재 원고와 표지를 실제 EPUB 리더기·모바일에서 확인했습니다.']].map(([name,label]) => `<label><input type="checkbox" name="${name}"${m[name] && reviewed ? ' checked' : ''}>${label}</label>`).join('')}<small>확인은 현재 원고와 표지에 연결됩니다. 변경 후에는 다시 확인합니다.</small></fieldset>
  <div class="publication-actions"><button class="button primary" type="button" data-publication-action="package">출판 준비 ZIP 만들기</button><button class="button secondary" type="button" data-publication-action="check">다시 점검</button><button class="button secondary" type="button" data-publication-action="guide">절차서 받기</button></div><p class="publication-note">EPUB · JPG 표지와 검사 결과 · 책 넘김 HTML · 인쇄용 HTML · Markdown · 판권 · 도서정보 · 경로별 대응표 · 판본 이력 · 점검표 · EPUBCheck 실행 도우미를 묶습니다. 입력 내용은 책에 자동 저장됩니다.</p><p class="publication-message" aria-live="polite"></p>
  </form><details class="publication-details" open><summary>출판 준비 점검 결과</summary><div data-publication-checks>${renderPublicationChecks(project, m)}</div></details>
  <details class="publication-details"><summary>유통 경로별 입력 대응표</summary><div data-publication-field-map>${renderFieldMap(project,m)}</div></details>
  <details class="publication-details"><summary>출판 절차와 공식 안내</summary><ol class="publication-steps"><li>원고·이미지 권리와 교정을 확인합니다.</li><li>국내 유통사 또는 출판사와 경로·ISBN·납본 담당을 정합니다.</li><li>도서 정보와 판권을 확정하고 준비 ZIP을 생성합니다.</li><li>EPUBCheck와 실제 리더기로 최종 파일을 검사합니다.</li><li>유통사에 계정·정산·계약 정보를 등록하고 도서 파일과 별도 표지를 제출합니다.</li><li>판매 신청을 직접 승인하고 심사 결과·판매 페이지·납본을 확인합니다.</li></ol><p class="publication-note">교보문고 전자책 직접 계약은 ISBN 발급이 가능한 출판사 대상입니다. 개인 저자는 제휴사를 이용합니다. KDP 지원 언어 목록에는 한국어가 없으므로 지원 언어의 원고를 별도로 준비해야 합니다. HTML의 책 넘김은 EPUB/PDF에서 동일하게 보장되지 않습니다.</p><div class="publication-links">${[['domestic','유페이퍼 판권 안내'],['domesticFiles','유페이퍼 파일 등록 정책'],['kyobo','교보문고 전자책 제휴'],['isbn','ISBN·납본'],['epubcheck','EPUBCheck'],['kdpCover','KDP 표지 규격'],['kdpLanguages','KDP 지원 언어'],['kdpAI','KDP AI 정책']].map(([key,label]) => `<a href="${PUBLICATION_LINKS[key]}" target="_blank" rel="noopener noreferrer">${label} ↗</a>`).join('')}</div><p class="publication-note">정책 확인일 ${PUBLICATION_REVIEW_DATE}. 판매 전 공식 안내의 최신 조건을 확인하세요.</p></details></section>`;
}

/** Container can be the rendered section itself or a parent. onSave receives only publication metadata. */
export function mountPublicationPanel(container, { getProject, onSave = () => {}, onNotify = () => {}, download = downloadBlob, makeCover = createPublicationCover } = {}) {
  const panel = container?.matches?.('.publication-panel') ? container : container?.querySelector('.publication-panel');
  if (!panel || typeof getProject !== 'function') return { dispose() {} };
  const form = panel.querySelector('form'), message = panel.querySelector('.publication-message');
  let disposed = false, working = false, reviewInvalidated = false, preparedCover = null, previewUrl = null, saveTail = null, changeVersion = 0;
  const projectId = getProject().id;
  const ensureActive = () => { if (disposed || getProject().id !== projectId) throw new Error('출판 화면이 변경되었습니다. 현재 책에서 다시 실행하세요.'); };
  let displayedFingerprint = publicationFingerprint(getProject());
  const initialMetadata = normalizePublication(getProject().publication);
  for (const select of form.querySelectorAll('select[name]')) if (Object.hasOwn(initialMetadata, select.name)) select.value = initialMetadata[select.name];
  const capture = () => {
    const current = getProject(), values = {};
    for (const control of form.elements) if (control.name) values[control.name] = control.type === 'checkbox' ? control.checked : ['coverWidth', 'coverHeight'].includes(control.name) ? Number(control.value) : control.value;
    const next = normalizePublication({ ...current.publication, ...values });
    const currentFingerprint = publicationFingerprint(current, next);
    reviewInvalidated = displayedFingerprint !== currentFingerprint;
    if (reviewInvalidated) {
      for (const control of form.querySelectorAll('input[type="checkbox"]')) { control.checked = false; next[control.name] = false; }
      displayedFingerprint = currentFingerprint;
      preparedCover = null;
      if (previewUrl) { panel.ownerDocument.defaultView.URL.revokeObjectURL(previewUrl); previewUrl = null; }
      panel.querySelector('[data-publication-cover-preview]').replaceChildren();
    }
    next.reviewFingerprint = currentFingerprint;
    return next;
  };
  const save = metadata => {
    const run = async () => {
      ensureActive();
      if (await onSave(metadata) === false) throw new Error('출판 정보를 저장하지 못했습니다. 저장 공간을 확인한 뒤 다시 실행하세요.');
      ensureActive();
      return metadata;
    };
    const task = saveTail ? saveTail.then(run, run) : run();
    saveTail = task;
    const finished = () => { if (saveTail === task) saveTail = null; };
    task.then(finished, finished);
    return task;
  };
  const refresh = metadata => {
    if (disposed) return;
    panel.querySelector('[data-publication-checks]').innerHTML = renderPublicationChecks(getProject(), metadata);
    panel.querySelector('[data-publication-field-map]').innerHTML = renderFieldMap(getProject(), metadata);
    panel.querySelector('[data-publication-history]').innerHTML = renderHistory(getProject(), metadata);
  };
  const changed = async () => {
    if (working || disposed) return;
    const version = ++changeVersion;
    try {
      const metadata = capture(), invalidated = reviewInvalidated;
      message.textContent = '출판 정보를 저장하고 있습니다…';
      await save(metadata);
      if (disposed || version !== changeVersion || working) return;
      refresh(metadata);
      message.textContent = invalidated ? '원고·표지·등록 자료가 바뀌어 직접 확인 항목을 해제했습니다. 현재 내용으로 다시 검토해 주세요.' : '출판 정보를 저장했습니다.';
    } catch (error) { if (!disposed && version === changeVersion && !working) { message.textContent = error.message; onNotify(error.message, true); } }
  };
  const clicked = async event => {
    const button = event.target.closest('[data-publication-action]');
    if (!button || working || disposed) return;
    event.preventDefault();
    working = true; ++changeVersion;
    const disabledStates = [...form.elements].map(el => [el, el.disabled]);
    for (const [el] of disabledStates) el.disabled = true;
    try {
      const metadata = capture(), invalidated = reviewInvalidated, book = structuredClone(getProject()); book.publication = metadata;
      message.textContent = '출판 정보의 저장을 확인하고 있습니다…';
      await save(metadata);
      if (disposed) return;
      if (publicationFingerprint(getProject()) !== publicationFingerprint(book, metadata)) throw new Error('저장 중 원고 또는 출판 정보가 변경되었습니다. 다시 실행하세요.');
      refresh(metadata);
      if (invalidated) { message.textContent = '원고·표지·등록 자료가 바뀌어 직접 확인 항목을 해제했습니다. 현재 내용으로 다시 검토한 뒤 실행해 주세요.'; return; }
      if (button.dataset.publicationAction === 'check') { message.textContent = '점검을 갱신했습니다. EPUBCheck와 외부 유통 심사는 별도입니다.'; return; }
      if (button.dataset.publicationAction === 'record') {
        const recorded = recordPublicationVersion(book, metadata);
        await save(recorded);
        if (disposed) return;
        if (publicationFingerprint(getProject()) !== publicationFingerprint(book, metadata)) throw new Error('이력 저장 중 원고 또는 출판 정보가 변경되었습니다. 다시 실행하세요.');
        refresh(recorded); message.textContent = '현재 판본의 검수와 직접 확인한 진행 상태를 기록했습니다.'; return;
      }
      if (button.dataset.publicationAction === 'guide') { download(publicationGuide(book, metadata), 'folio-publishing-guide.md', 'text/markdown;charset=utf-8'); message.textContent = '출판 절차서를 준비했습니다.'; return; }
      message.textContent = '원고와 판권, 검수 자료를 묶고 있습니다…';
      if (!preparedCover || preparedCover.fingerprint !== coverFingerprint(book, metadata)) preparedCover = await makeCover(book, metadata, { document: panel.ownerDocument });
      if (disposed) return;
      if (publicationFingerprint(getProject()) !== publicationFingerprint(book, metadata)) throw new Error('표지 생성 중 원고 또는 출판 정보가 변경되었습니다. 다시 실행하세요.');
      if (button.dataset.publicationAction === 'cover') {
        download(preparedCover.bytes, 'cover.jpg', 'image/jpeg');
        const view = panel.ownerDocument.defaultView;
        if (view.URL.createObjectURL) {
          if (previewUrl) view.URL.revokeObjectURL(previewUrl);
          previewUrl = view.URL.createObjectURL(new view.Blob([preparedCover.bytes], { type: 'image/jpeg' }));
          const image = panel.ownerDocument.createElement('img'); image.src = previewUrl; image.alt = '생성한 판매용 표지 JPG';
          panel.querySelector('[data-publication-cover-preview]').replaceChildren(image);
        }
        message.textContent = '현재 제목·저자·발행처를 포함한 JPG 표지를 생성하고 픽셀·형식·용량을 검사했습니다. ' + (preparedCover.warnings || []).join(' ');
        return;
      }
      const result = await buildPublicationPackage(book, metadata, { preparedCover });
      if (disposed) return;
      if (publicationFingerprint(getProject()) !== publicationFingerprint(book, metadata)) throw new Error('패키지 생성 중 원고 또는 출판 정보가 변경되었습니다. 다시 실행하세요.');
      download(result.bytes, 'folio-publication-kit.zip', 'application/zip');
      message.textContent = `${result.files.length}개 파일을 준비했습니다. ZIP의 절차서를 따라 외부 검증과 판매 신청을 진행하세요.`;
      onNotify('출판 준비 ZIP을 만들었습니다.');
    } catch (error) { if (!disposed) { message.textContent = error.message; onNotify(error.message, true); } }
    finally { working = false; if (!disposed) for (const [el, disabled] of disabledStates) el.disabled = disabled; }
  };
  const submit = event => event.preventDefault();
  form.addEventListener('input', changed); form.addEventListener('change', changed); form.addEventListener('submit', submit); panel.addEventListener('click', clicked);
  return { dispose() { disposed = true; if (previewUrl) panel.ownerDocument.defaultView.URL.revokeObjectURL(previewUrl); form.removeEventListener('input', changed); form.removeEventListener('change', changed); form.removeEventListener('submit', submit); panel.removeEventListener('click', clicked); } };
}
