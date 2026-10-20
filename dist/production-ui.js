import {visualProgress} from './visual-workflow.js';
// Pure view helpers. Saving drafts, source files and API work belong to app.js.
import {describeBookLength, formatMoneyRange, formatDurationRange, ESTIMATE_REFERENCES} from './production-estimate.js';
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const object = value => value && typeof value === 'object' ? value : {};
const numeric = (value, fallback = 0) => {
  try { const number = Number(value); return Number.isFinite(number) ? Math.max(0, number) : fallback; }
  catch { return fallback; }
};
const numberText = value => Math.round(numeric(value)).toLocaleString('ko-KR');
const option = (value, label, selected) => `<option value="${escapeHTML(value)}"${selected === value ? ' selected' : ''}>${escapeHTML(label)}</option>`;
const button = (label, action, style = 'secondary', extra = '') => `<button type="button" class="button ${style}" data-action="${action}"${extra}>${escapeHTML(label)}</button>`;
const statusLabels = Object.freeze({ready:'제작 준비',running:'제작 중',paused:'잠시 멈춤',failed:'제작 중단',complete:'초고 작성 완료',needs_review:'검토 필요'});

function targetDetails(brief, progress = {}) {
  const pages = brief.targetUnit === 'pages';
  const value = numeric(brief.targetValue, pages ? 40 : 30000);
  const chars = numeric(progress.targetChars, value * (pages ? 800 : 1));
  return {pages, value, chars, estimatedPages: Math.ceil(chars / 800)};
}

function sourceMetadata(brief) {
  const source = String(brief.sourceMarkdown ?? '');
  const images = Array.isArray(brief.sourceImages) ? brief.sourceImages.length : 0;
  if (!source && !images) return '아직 추가한 자료가 없습니다. 주제로만 시작할 수도 있습니다.';
  return `${brief.sourceName || '원시 자료'} · ${numberText(source.length)}자 (공백 포함)${images ? ` · 이미지 ${images}개` : ''}`;
}

export function renderSourceManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.files) || !manifest.files.length) return '';
  return `<details class="production-source-files" id="production-source-files-list"><summary>반영한 Markdown ${numberText(manifest.files.length)}개 · 파일 경로와 순서</summary><p>${escapeHTML(manifest.folderName ? `${manifest.folderName} 폴더와 모든 하위 폴더` : '직접 선택한 파일')} · 경로의 숫자 순서로 정렬${manifest.ignoredCount ? ` · 지원하지 않는 파일 ${numberText(manifest.ignoredCount)}개 제외` : ''}</p><ol>${manifest.files.map(file=>`<li><span>${escapeHTML(file.path)}</span><small>${numberText(file.chars)}자</small></li>`).join('')}</ol></details>`;
}

export function renderSourceImages(images = [], {editable = false, sources = []} = {}) {
  if (!Array.isArray(images) || !images.length) return '';
  return `<section class="production-source-images" id="production-source-images" aria-label="원시 이미지 자료"><div class="production-image-heading"><h4>원시 이미지 ${numberText(images.length)}개</h4>${editable ? button('이미지 자료 모두 제외','production-source-images-clear','secondary small') : ''}</div><p class="production-small-note">제작을 시작하면 이미지마다 글자·도표·장면을 읽고 집필 자료로 정리합니다. 판독하기 어려운 부분은 분석 결과의 확인 사항을 살펴보세요. 원본과 분석 기록은 JSON 백업에 포함됩니다.</p><div class="production-source-image-grid">${images.map((image,index)=>{
    const src=typeof image.src==='string'&&/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image.src)?image.src:'';
    const digest=sources.find(source=>source.id===`image-source-${index+1}`)?.digest;
    return `<article class="production-source-image"><div class="production-image-preview">${src?`<img src="${escapeHTML(src)}" alt="${escapeHTML(image.path)}" loading="lazy" decoding="async">`:'<span>미리보기 없음</span>'}</div><div class="production-image-info"><b>${escapeHTML(image.path)}</b><small>이미지 ${index+1} · ${numberText(numeric(image.bytes)/1024)}KiB · ${digest?'분석 저장됨':'분석 대기'}</small>${editable?button('자료에서 제외','production-source-image-remove','secondary small',` data-index="${index}" aria-label="${escapeHTML(image.path)} 자료에서 제외"`):''}</div>${digest?`<details class="production-image-digest"><summary>분석 내용 확인</summary><p>${escapeHTML(digest.summary)}</p>${digest.facts?.length?`<ul>${digest.facts.map(fact=>`<li>${escapeHTML(fact)}</li>`).join('')}</ul>`:''}${digest.unknowns?.length?`<div class="production-image-unknowns"><b>확인할 사항</b><ul>${digest.unknowns.map(item=>`<li>${escapeHTML(item)}</li>`).join('')}</ul></div>`:''}</details>`:''}</article>`;
  }).join('')}</div></section>`;
}

function reviewState(project, progress) {
  const p = object(project);
  const production = object(p.production);
  const brief = object(production.brief);
  const detail = object(progress);
  const status = Object.hasOwn(statusLabels, detail.status) ? detail.status : Object.hasOwn(statusLabels, production.status) ? production.status : 'ready';
  const target = targetDetails(brief, {targetChars: detail.targetChars ?? production.targetChars});
  const completedChapters = numeric(detail.completedChapters);
  const totalChapters = numeric(detail.totalChapters, numeric(brief.chapterCount) || Math.min(40, Math.max(2, Math.ceil(target.chars / 6000))));
  const actualChars = numeric(detail.actualChars);
  const percent = Math.min(100, Math.max(0, numeric(detail.percent)));
  const artwork = object(production.artwork);
  const artworkPending = brief.illustrations !== 'none' && brief.illustrations !== 'hybrid' && ['complete','needs_review'].includes(status) && artwork.status !== 'complete';
  return {project:p, production, brief, detail, status, target, completedChapters, totalChapters, actualChars, percent, artwork, artworkPending};
}

export function renderProductionForm(draft = {}) {
  const brief = object(draft);
  const {pages, value, chars, estimatedPages} = targetDetails(brief);
  const illustrations = ['hybrid','design','ai','none'].includes(brief.illustrations) ? brief.illustrations : 'hybrid';
  return `<div class="production-intro">
    <p>주제와 자료, 원하는 방향을 적어 주세요. 목차를 나누고 목표 분량에 맞춰 한 장씩 씁니다.</p>
    <ol class="production-path" aria-label="책 제작 순서"><li aria-current="step"><span>1</span>조건 입력</li><li><span>2</span>검토 · 연결</li><li><span>3</span>책 제작</li></ol>
  </div>
  <form id="production-form" class="production-form">
    <fieldset class="production-section">
      <legend><span class="production-section-number">01</span>어떤 책을 만들까요?</legend>
      <div class="form-grid">
        <div class="field full"><label for="production-topic">책의 주제 · 자료가 있다면 선택</label><textarea id="production-topic" name="topic" maxlength="4000" rows="3" placeholder="예: 퇴근 후 처음 텃밭을 가꾸는 사람을 위한 작은 정원 안내서">${escapeHTML(brief.topic)}</textarea></div>
        <div class="field full"><label for="production-instructions">집필 지시 · 선택</label><textarea id="production-instructions" name="instructions" maxlength="12000" rows="4" placeholder="예: 초보자가 따라 할 수 있도록 계절 순서로 써 주세요. 각 장에 준비물과 시행착오를 넣고, 자료에 없는 경험담은 만들지 마세요." aria-describedby="production-instructions-help">${escapeHTML(brief.instructions)}</textarea><small id="production-instructions-help">꼭 다룰 내용, 제외할 내용, 구성 방식, 지켜야 할 표현을 적어 주세요.</small></div>
        <div class="field"><label for="production-title">책 제목 · 선택</label><input id="production-title" name="title" maxlength="200" value="${escapeHTML(brief.title)}" placeholder="비워 두면 주제에 맞춰 정합니다"></div>
        <div class="field"><label for="production-author">저자명 <span class="production-required">필수</span></label><input id="production-author" name="author" required maxlength="120" value="${escapeHTML(brief.author)}" placeholder="이름 또는 필명" autocomplete="name"></div>
      </div>
      <details class="production-preferences"${brief.audience || brief.tone ? ' open' : ''}><summary>독자와 말투, 언어 정하기</summary><div class="form-grid">
        <div class="field full"><label for="production-audience">예상 독자 · 선택</label><textarea id="production-audience" name="audience" maxlength="2000" rows="2" placeholder="예: 식물을 처음 키우는 직장인. 주말에 2시간 정도 쓸 수 있습니다.">${escapeHTML(brief.audience)}</textarea></div>
        <div class="field full"><label for="production-tone">말투와 문체 · 선택</label><textarea id="production-tone" name="tone" maxlength="2000" rows="2" placeholder="예: 직접 옆에서 알려 주듯 편안하게. 과장하거나 매 장을 똑같은 맺음말로 끝내지 마세요.">${escapeHTML(brief.tone)}</textarea></div>
        <div class="field"><label for="production-language">책의 언어</label><select id="production-language" name="language">${[['ko','한국어'],['en','English'],['ja','日本語']].map(([key,label])=>option(key,label,brief.language || 'ko')).join('')}</select></div>
        <div class="field"><label for="production-genre">책의 성격 · 선택</label><input id="production-genre" name="genre" maxlength="80" value="${escapeHTML(brief.genre)}" placeholder="예: 실용서, 에세이, 교육 자료"></div>
      </div></details>
    </fieldset>
    <fieldset class="production-section">
      <legend><span class="production-section-number">02</span>바탕이 될 자료</legend>
      <p class="production-section-intro">Markdown과 사진·스캔·도표 이미지를 함께 넣을 수 있습니다. 자료는 책의 본문과 따로 보관하며, 주제를 비워 두면 자료를 바탕으로 구성합니다.</p>
      <div class="production-folder-upload field"><label for="production-source-folder">원고 폴더 불러오기 · 하위 폴더 포함</label><input id="production-source-folder" type="file" webkitdirectory directory multiple aria-describedby="production-source-folder-help production-folder-support"><small id="production-source-folder-help">선택한 폴더 아래의 .md·.markdown과 PNG·JPG·WebP 이미지를 모두 모읍니다. 하위 폴더도 포함하며 경로의 숫자 순서(1, 2, 10)로 정렬합니다. 새 선택은 현재 원시 자료를 대체합니다.</small><p id="production-folder-support" class="production-source-meta"></p></div>
      <div class="production-source-alternatives"><div class="field"><label for="production-source-files">MD·이미지 파일 여러 개 선택</label><input id="production-source-files" type="file" accept=".md,.markdown,.png,.jpg,.jpeg,.webp,text/markdown,image/png,image/jpeg,image/webp" multiple aria-describedby="production-source-many-help"><small id="production-source-many-help">폴더 선택을 지원하지 않는 브라우저에서는 필요한 파일을 직접 선택하세요.</small></div><div class="production-source-upload field"><label for="production-source-file">MD·TXT 파일 하나 선택</label><input id="production-source-file" type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" aria-describedby="production-source-file-help production-source-name"><small id="production-source-file-help">Markdown만 바꾸며 선택한 이미지 자료는 유지합니다. 아래에서 내용을 확인하고 고칠 수 있습니다.</small></div></div>
      <p class="production-small-note">폴더·여러 파일: Markdown 최대 500개, 파일 합계 1MiB, 경로 구분을 포함해 120,000자까지. 이미지는 최대 50개, 장당 8MiB·합계 32MiB까지 지원합니다. 다른 형식은 제외합니다. 폴더는 선택 시점의 내용을 읽으며 자동 동기화하지 않습니다.</p>
      <div id="production-source-manifest">${renderSourceManifest(brief.sourceManifest)}</div><div id="production-source-image-preview">${renderSourceImages(brief.sourceImages,{editable:true})}</div><button type="button" class="button secondary small" data-action="production-source-cancel" hidden>자료 읽기 중지</button>
      <div class="field"><label for="production-source">원시 소스 · Markdown</label><textarea id="production-source" class="production-source-editor" name="sourceMarkdown" maxlength="120000" rows="7" spellcheck="false" aria-describedby="production-source-help production-source-name" placeholder="# 조사 메모&#10;&#10;자료를 그대로 붙여 넣으세요. 제목, 표, 링크도 함께 보관합니다.">${escapeHTML(brief.sourceMarkdown)}</textarea><small id="production-source-help">최대 120,000자. 원시 소스에 있는 사실과 인용을 집필의 바탕으로 사용합니다.</small><p id="production-source-name" class="production-source-meta" role="status" aria-live="polite" aria-atomic="true">${escapeHTML(sourceMetadata(brief))}</p></div>
    </fieldset>
    <fieldset class="production-section">
      <legend><span class="production-section-number">03</span>분량과 시각 자료</legend>
      <div class="form-grid">
        <div class="field"><label for="production-target-value" id="production-target-label">${pages ? '목표 쪽수' : '목표 글자 수'}</label><input id="production-target-value" name="targetValue" type="number" min="${pages ? 4 : 3000}" max="${pages ? 375 : 300000}" step="1" value="${value}" required inputmode="numeric" aria-describedby="production-target-help production-target-estimate"><small id="production-target-help">${pages ? '4~375쪽 · 쪽당 공백 제외 800자로 계산' : '3,000~300,000자 · 공백 제외'}</small></div>
        <div class="field"><label for="production-target-unit">분량 단위</label><select id="production-target-unit" name="targetUnit">${option('chars','글자 수 (공백 제외)',pages?'pages':'chars')}${option('pages','예상 쪽수',pages?'pages':'chars')}</select><small>본문 글자 수를 기준으로 집필합니다.</small></div>
        <output class="production-target-estimate" id="production-target-estimate" for="production-target-value production-target-unit" aria-live="polite">${escapeHTML(describeBookLength(chars).label)} · ${escapeHTML(describeBookLength(chars).comparison)}</output>
        <p class="production-length-reference">글 중심 단행본 쪽당 600~1,000자 가정 · 30,000자는 약 30~50쪽의 작은 실용서입니다. 200쪽 책의 약 19% 분량(800자/쪽 기준)으로 생각해 보세요.</p>
        <p class="production-pagination-note">목표의 ±10% 범위를 기준으로 분량을 맞추고, 벗어난 부분은 검토 대상으로 남깁니다. 쪽수는 분량을 정하기 위한 참고값입니다. EPUB은 읽기 설정에 따라, PDF는 글꼴과 여백에 따라 실제 쪽수가 달라집니다.</p>
        <div class="field"><label for="production-chapters">장 수 · 챕터</label><input id="production-chapters" name="chapterCount" type="number" min="0" max="300" step="1" value="${numeric(brief.chapterCount)}" inputmode="numeric" aria-describedby="production-chapters-help production-chapter-budget"><small id="production-chapters-help">0이면 자동 구성 · 직접 정할 때는 2~300장<br>한 장에 최소 500자 · 300장은 최소 150,000자가 필요합니다.</small><p id="production-chapter-budget" class="production-budget-note" role="status" aria-live="polite"></p><button type="button" class="button secondary small" data-action="production-fit-length" hidden>최소 분량 적용</button></div>
        <div class="field full"><label for="production-diagrams">설명에 필요한 도표</label><select id="production-diagrams" name="diagrams" aria-describedby="production-diagrams-help">${option('auto','문맥에 맞게 자동 판단',(brief.diagrams==='none'||(brief.diagrams===undefined&&illustrations==='hybrid'))?'none':'auto')}${option('none','집필 중 도표 생성 안 함 · Claude SVG로 후속 보강',(brief.diagrams==='none'||(brief.diagrams===undefined&&illustrations==='hybrid'))?'none':'auto')}</select><small id="production-diagrams-help">비교표·흐름도·막대 및 꺾은선 차트를 필요한 문단에 넣습니다. 수치 차트는 자료에 근거가 있을 때만 만들며, 별도 이미지 API를 사용하지 않습니다.</small></div>
        <div class="field"><label for="production-illustrations">표지와 삽화</label><select id="production-illustrations" name="illustrations">${option('hybrid','Claude SVG + ChatGPT·Codex 내장 삽화 · 기본',illustrations)}${option('design','디자인 삽화 · 이미지 API 사용 안 함',illustrations)}${option('ai','AI 이미지 · 표지 1장 + 본문 최대 2장',illustrations)}${option('none','그림 없이 시작',illustrations)}</select><small>기본 방식은 집필 후 제작 요청서로 Claude·ChatGPT·Codex에서 만들고 결과를 가져옵니다. ‘AI 이미지’는 별도 API 요금 방식입니다.</small></div>
      </div>
    </fieldset>
    <p id="production-feedback" class="production-feedback" role="alert" hidden></p>
    <div class="production-save-note">조건을 저장하면 새 책으로 보관됩니다. 다음 화면에서 예상 시간·비용을 확인하고 승인해야 AI 집필이 시작됩니다.</div>
    <div class="modal-actions production-form-actions">${button('취소','close-modal')}<button type="submit" class="button primary">제작 조건 저장</button></div>
  </form>`;
}

function progressMarkup(state, compact = false) {
  const {detail,status,percent,completedChapters,totalChapters,actualChars,target} = state;
  return `<div class="production-progress${compact ? ' is-compact' : ''}">
    <div class="production-progress-heading"><span>${numberText(completedChapters)} / ${numberText(totalChapters)}장 작성</span><span>${numberText(actualChars)} / ${numberText(target.chars)}자</span></div>
    ${numeric(detail.totalImages)>0?`<p class="production-planning-progress">이미지 자료 ${numberText(detail.completedImages)} / ${numberText(detail.totalImages)}개 분석</p>`:''}${numeric(detail.totalPlanningBatches)>1?`<p class="production-planning-progress">목차 구성 ${numberText(detail.completedPlanningBatches)} / ${numberText(detail.totalPlanningBatches)}회 · ${numberText(detail.plannedChapters)}장 저장</p>`:''}<progress max="100" value="${percent}" aria-label="자료 읽기와 본문 집필 진행"></progress>
    <p class="production-progress-message" role="status"><b>${numberText(percent)}%</b> · ${escapeHTML(detail.message || (status === 'ready' ? '제작 조건을 저장했습니다. 내용을 확인하고 시작하세요.' : status === 'complete' ? '생성한 초고를 읽고 사실, 인용과 문장의 흐름을 확인하세요.' : '완료된 원고는 저장됩니다. 현재 상태를 확인하세요.'))}</p>
  </div>`;
}

function requestEstimate(detail, brief) {
  const min = numeric(detail.minRequests);
  const max = Math.max(min, numeric(detail.maxRequests, min));
  const text = min ? `집필·자료 분석 약 ${numberText(min)}${max > min ? `~${numberText(max)}` : ''}회` : '목차와 장별 분량에 따라 계산';
  return `${text}${brief.illustrations === 'ai' ? ' · 표지 기획 1회 추가 · 이미지 최대 3회' : ''}`;
}

function artworkMarkup(state) {
  if(state.brief.illustrations==='hybrid'){const v=visualProgress(state.project);return `<div class="production-artwork-status"><strong>Claude SVG · 내장 생성 삽화</strong><span>${v.chapters} / ${v.total}개 장 보강</span><p>본문 집필 후 제작 요청서와 결과 가져오기로 보강합니다. 그림 제작은 별도 단계입니다.</p><button class="button secondary" data-action="visual-workflow">도표·삽화 제작</button></div>`;}
  if (state.brief.illustrations === 'none' || state.status === 'ready') return '';
  const artwork = state.artwork;
  const max = state.brief.illustrations === 'ai' ? 3 : 2;
  const completed = Math.min(max, new Set(Array.isArray(artwork.completed) ? artwork.completed : []).size);
  const labels = {pending:'대기',running:'제작 중',paused:'잠시 멈춤',failed:'중단됨',complete:'완료'};
  const status = Object.hasOwn(labels,artwork.status) ? labels[artwork.status] : '대기';
  return `<div class="production-artwork-status"><strong>삽화 ${status}</strong><span>${numberText(completed)} / ${max}개 배치</span>${state.artworkPending ? '<p>본문은 보관되어 있습니다. 남은 삽화를 이어서 만들 수 있습니다.</p>' : ''}${artwork.error ? `<p class="production-artwork-error">${escapeHTML(String(artwork.error).slice(0,1800))}</p>` : ''}</div>`;
}

export function renderProductionSummary(project, progress = {}) {
  const state = reviewState(project, progress);
  const {brief,detail,status,target,totalChapters,actualChars} = state;
  const started = status !== 'ready';
  const running = status === 'running';
  const resumable = (status === 'paused' || status === 'failed') && detail.canResume !== false;
  const canStart = !detail.integrityError && (status === 'ready' || resumable || state.artworkPending);
  const source = String(brief.sourceMarkdown ?? '');
  const sourceCount = Math.max(0, numeric(detail.totalSources) - numeric(detail.totalImages));
  const illustration = brief.illustrations === 'hybrid' ? 'Claude SVG + ChatGPT·Codex 내장 삽화 · 집필 후 보강' : brief.illustrations === 'ai' ? 'AI 표지 1장 + 본문 최대 2장' : brief.illustrations === 'none' ? '그림 없이 시작' : '디자인 삽화';
  return `<div class="production-summary" data-production-status="${status}">
    <div class="production-review-head"><span class="production-status-badge is-${status}">${statusLabels[status]}</span><h3>${escapeHTML(state.project.title || brief.title || '새 책의 제작 조건')}</h3><p>${escapeHTML(brief.topic || (brief.sourceImages?.length ? '이미지와 원시 자료를 바탕으로 책을 구성합니다.' : '자료를 바탕으로 책을 구성합니다.'))}</p></div>
    <dl class="production-metrics"><div><dt>목표 본문</dt><dd>${numberText(target.chars)}<span>자</span></dd><dd class="production-metric-note">공백 제외 · 약 ${numberText(target.estimatedPages)}쪽 기준</dd></div><div><dt>${started ? '현재 본문' : '예상 구성'}</dt><dd>${numberText(started ? actualChars : totalChapters)}<span>${started ? '자' : '장'}</span></dd><dd class="production-metric-note">${started ? `${numberText(state.completedChapters)} / ${numberText(totalChapters)}장 작성` : '집필 전에 장별 분량을 나눕니다'}</dd></div></dl>
    ${detail.estimate ? renderEstimateDetails(detail.estimate) : ''}
    ${started ? progressMarkup(state) + artworkMarkup(state) : `<ol class="production-stage-list" aria-label="시작 후 진행 순서"><li><b>자료 읽기</b><span>${source ? `${numberText(source.length)}자${sourceCount ? ` · ${numberText(sourceCount)}부분으로 나누어 확인` : ''}` : brief.sourceImages?.length ? '이미지 자료부터 확인' : '주제와 지시부터 확인'}${brief.sourceImages?.length?` · 이미지 ${numberText(brief.sourceImages.length)}개 분석`:''}</span></li><li><b>목차 구성</b><span>${numberText(totalChapters)}장에 분량 배정${totalChapters>40?` · 20장씩 ${numberText(Math.ceil(totalChapters/20))}회 구성`:''}</span></li><li><b>장별 집필</b><span>완성된 부분부터 저장</span></li></ol>`}
    <dl class="production-review-details"><div><dt>저자 · 언어</dt><dd>${escapeHTML(brief.author || state.project.author || '저자 미정')} · ${escapeHTML(({ko:'한국어',en:'English',ja:'日本語'})[brief.language] || '한국어')}</dd></div><div><dt>원시 소스</dt><dd>${escapeHTML(sourceMetadata(brief))}</dd></div><div><dt>표지와 삽화</dt><dd>${escapeHTML(illustration)}</dd></div><div><dt>본문 도표</dt><dd>${brief.diagrams==='none'?'새 도표 생성 안 함':'문맥에 맞게 자동 판단'}</dd></div><div><dt>예상 전체 요청</dt><dd>${escapeHTML(requestEstimate(detail,brief))}</dd></div></dl>
    <p class="production-small-note">목표 분량의 ±10% 범위를 기준으로 집필하며, 벗어난 부분은 검토 대상으로 남깁니다. 요청 수는 분량 보정을 포함한 예상치로, 실제 생성 길이와 중단·재시도에 따라 달라질 수 있습니다. 쪽수는 800자 기준의 참고값이며, 내보낸 책의 실제 쪽수를 보장하지 않습니다.</p>
    <details class="production-brief-details"><summary>집필 지시와 원시 소스 확인</summary><dl><dt>집필 지시</dt><dd class="production-preserve-lines">${escapeHTML(brief.instructions || '추가 지시 없음')}</dd>${brief.audience ? `<dt>예상 독자</dt><dd class="production-preserve-lines">${escapeHTML(brief.audience)}</dd>` : ''}${brief.tone ? `<dt>말투와 문체</dt><dd class="production-preserve-lines">${escapeHTML(brief.tone)}</dd>` : ''}</dl>${renderSourceManifest(brief.sourceManifest)}${renderSourceImages(brief.sourceImages,{sources:state.project.production?.sources||[]})}${source ? `<div class="production-source-heading"><strong>원시 소스</strong>${button('원시 MD 받기','production-source-download','secondary small')}</div><pre class="production-source-preview" tabindex="0" aria-label="보관된 원시 Markdown">${escapeHTML(source)}</pre>` : '<p class="production-small-note">추가한 Markdown 원문은 없습니다.</p>'}</details>
    ${status === 'needs_review' ? '<div class="production-review-notice" role="status">목표 분량이나 생성 결과에 확인할 부분이 있습니다. 현재 원고와 검토 메모를 살펴보고 편집해 주세요.</div>' : ''}
    ${detail.error ? `<p class="production-feedback" role="alert">${escapeHTML(String(detail.error).slice(0,1800))}</p>` : ''}
    ${canStart ? '<p class="production-api-note">제작을 시작하면 주제·지시·원시 Markdown·선택한 이미지가 연결한 AI 제공자로 전송됩니다. 이미지 자료에는 글쓰기 모델의 이미지 이해 기능이 필요합니다. 사용량에 따라 API 비용이 발생할 수 있습니다. 작업 중에는 이 탭을 열어 두세요.</p>' : ''}
    <div class="modal-actions production-review-actions">${!started ? button('조건 수정','production-edit') : button('이 조건으로 새 책','production-copy-config')}${status === 'needs_review' && detail.canRetry && !detail.integrityError ? button('분량 보정 다시 시도','production-retry','soft') : ''}${canStart ? (detail.configured ? button(state.artworkPending ? '남은 삽화 제작' : resumable ? '이어서 제작' : '이 조건으로 제작 시작','production-start','primary') : button('AI 연결하고 돌아오기','settings','primary',' data-production-return="true"')) : button(running ? '작업 중지' : '원고 확인',running ? 'cancel-operation' : 'close-modal',running ? 'secondary' : 'primary')}${canStart && detail.configured ? '<span class="production-start-caption">위 조건으로 제작을 시작합니다.</span>' : ''}</div>
  </div>`;
}

export function renderProductionCard(project, progress = {}) {
  if (!object(project).production) return '';
  const state = reviewState(project, progress);
  return `<section class="production-card" aria-label="조건에 따른 책 제작 현황" data-production-status="${state.status}"><div class="production-card-heading"><div><span class="production-status-badge is-${state.status}">${statusLabels[state.status]}</span><h2>목표 ${numberText(state.target.chars)}자의 책</h2></div><div class="production-card-actions">${state.status === 'needs_review' && state.detail.canRetry && !state.detail.integrityError ? button('분량 보정 다시 시도','production-retry','soft small') : ''}${button(state.artworkPending ? '남은 삽화 확인' : state.status === 'ready' ? '제작 조건 확인' : '제작 현황','production-summary','secondary small')}</div></div>${progressMarkup(state,true)}${artworkMarkup(state)}</section>`;
}

export function renderEstimateDetails(estimate, {compact=false}={}) {
  if(!estimate)return '';
  const textRate=estimate.rates, imageRate=estimate.imageRates;
  return `<section class="production-estimate-panel" aria-label="예상 시간과 비용"><div class="production-estimate-heading"><strong>${estimate.retry?'분량 재보정':'남은 작업'} 예상</strong><span>추가 API 요청 기준</span></div><dl class="production-estimate-values"><div><dt>예상 소요시간</dt><dd>${escapeHTML(formatDurationRange(estimate.minutes))}</dd></div><div><dt>예상 비용 · 달러 / 원화</dt><dd>${escapeHTML(formatMoneyRange(estimate.usd))}<small>${escapeHTML(formatMoneyRange(estimate.krw,'KRW'))}</small></dd></div></dl>${!estimate.completePricing?'<p class="production-estimate-warning" role="status">이 모델의 단가를 확인할 수 없습니다. 아래에서 입력·출력 단가와 필요한 이미지 단가를 입력하면 예상 비용과 승인 버튼이 활성화됩니다.</p>':''}${compact?'':`<p class="production-small-note">${escapeHTML(estimate.length.label)} · ${escapeHTML(estimate.length.comparison)}<br>텍스트 ${numberText(estimate.work.minRequests)}~${numberText(estimate.work.maxRequests)}회 · 이미지 ${numberText(estimate.work.imageCount)}회 · 저장된 작업은 제외</p><details class="production-estimate-assumptions"><summary>계산 기준과 단가 출처</summary><p>완료 시각과 청구액은 확정값이 아닙니다. 글자당 0.5~1.8토큰, 지시·자료 반복 입력, 구간별 분량 보정 1회, 응답당 추론 여유 8,192토큰을 가정했습니다. 텍스트 요청당 약 20~150초, 생성 속도 20~80토큰/초, 이미지당 30~180초를 가정한 범위이며 측정된 성능 보장이 아닙니다. API 혼잡·더 긴 추론·재시도로 범위를 초과할 수 있습니다.</p><p>입력 약 ${numberText(estimate.tokens.inputLow)}~${numberText(estimate.tokens.inputHigh)}토큰 · 출력·추론 약 ${numberText(estimate.tokens.outputLow)}~${numberText(estimate.tokens.outputHigh)}토큰</p><p>${textRate?`${escapeHTML(estimate.config.textModel)}: 입력 $${textRate.input} / 출력 $${textRate.output} (100만 토큰당) · ${escapeHTML(textRate.label)}`:'글쓰기 모델 단가 미확인'}${estimate.work.imageCount?`<br>${imageRate?`${escapeHTML(estimate.config.imageModel)}: 이미지 $${imageRate.low}~$${imageRate.high}/장 · ${escapeHTML(imageRate.label)}${imageRate.custom?'':' + 요청·텍스트·추론 추정 비용'}`:'이미지 모델 단가 미확인'}`:''}</p><p>1 USD = ${estimate.fx.toLocaleString('ko-KR',{maximumFractionDigits:2})} KRW · 환율 기준: ${escapeHTML(estimate.fxDate)}. 무료 구간·캐시 할인은 적용하지 않았습니다. 부가세·카드 수수료·유통 비용은 제외하며, 실제 사용료는 제공자 청구 화면에서 확인하세요. 이 범위는 결제 한도가 아닙니다.</p><p><a href="${estimate.config.provider==='openai'?ESTIMATE_REFERENCES.openai:ESTIMATE_REFERENCES.google}" target="_blank" rel="noopener noreferrer">공식 텍스트 단가 ↗</a> · <a href="${estimate.config.provider==='openai'?ESTIMATE_REFERENCES.image:ESTIMATE_REFERENCES.google}" target="_blank" rel="noopener noreferrer">이미지 단가 ↗</a> · <a href="${ESTIMATE_REFERENCES.fx}" target="_blank" rel="noopener noreferrer">ECB 기준 환율 ↗</a><br>단가 확인일 ${ESTIMATE_REFERENCES.verifiedAt} · 이후 변경될 수 있어 아래에서 조정할 수 있습니다.</p></details>`}</section>`;
}

/** Parent binds change/submit events; rendering never grants approval. */
export function renderProductionApproval(project, estimate) {
  const prefs=estimate.preferences||{};
  const field=(id,label,name,placeholder='',min='0')=>`<div class="field"><label for="${id}">${label}</label><input id="${id}" name="${name}" type="number" min="${min}" max="100000" step="any" value="${escapeHTML(prefs[name]??'')}" placeholder="${escapeHTML(placeholder)}"></div>`;
  return `<div class="production-approval"><p class="modal-intro"><b>${escapeHTML(project.title||'새 책')}</b>의 ${estimate.retry?'분량 재보정':'자료 분석·집필·삽화'}을 시작하기 전에 예상 시간과 비용을 확인해 주세요.</p><p class="production-model-note">${escapeHTML(estimate.config.provider==='openai'?'OpenAI':'Google Gemini')} · ${escapeHTML(estimate.config.textModel)}${estimate.work.imageCount?` / ${escapeHTML(estimate.config.imageModel)}`:''}</p>${renderEstimateDetails(estimate)}<form id="production-estimate-form"><details class="production-estimate-settings"${estimate.completePricing?'':' open'}><summary>환율·단가 직접 조정</summary><p class="production-small-note">비워 두면 확인된 공식 단가를 사용합니다. 사용자 단가는 현재 모델에 대한 값으로 입력하세요. 이미지 직접 입력값은 요청비를 포함한 1장 총액입니다.</p><div class="form-grid">${field('production-estimate-fx','원/달러 환율','usdKrw',String(estimate.fx),'0.01')}${field('production-estimate-input','입력 100만 토큰당 USD','inputPerMillion',estimate.rates?.input??'공식 입력 단가')}${field('production-estimate-output','출력 100만 토큰당 USD','outputPerMillion',estimate.rates?.output??'공식 출력 단가')}${estimate.work.imageCount?field('production-estimate-image','이미지 1장 총액 USD','imagePerImage',estimate.imageRates?.low??'공식 이미지 단가'):''}</div><button type="submit" class="button secondary small" data-action="production-estimate-update">변경한 기준으로 다시 계산</button></details></form><p class="production-api-note">승인하면 주제·집필 지시·원시 자료와 이미지를 위 AI 제공자로 전송하고 유료 API 요청을 시작합니다. 중지한 뒤 다시 시작하거나 모델·조건을 바꾸면 남은 작업을 다시 승인합니다.</p><label class="production-approval-check" for="production-approval-check"><input id="production-approval-check" type="checkbox" ${estimate.completePricing?'':'disabled'}>위 예상 시간·비용과 자료 전송을 확인했고, 이 조건으로 집필을 승인합니다.</label><p id="production-approval-feedback" role="alert" class="production-feedback" hidden></p><div class="modal-actions"><button type="button" class="button secondary" data-action="production-summary">돌아가기</button><button type="button" class="button primary" data-action="production-approve" disabled>${estimate.retry?'승인하고 재보정':'승인하고 집필 시작'}</button></div></div>`;
}

/** Actual saved checkpoints drive the bar; elapsed time never invents progress. */
export function renderProductionLiveProgress(project, progress={}, estimate, {elapsedMs=0}={}) {
  const p=project.production||{}, artwork=p.artwork||{}, needsArt=!['none','hybrid'].includes(p.brief?.illustrations);
  const totalArt=p.brief?.illustrations==='ai'?3:2;
  const doneArt=Math.min(totalArt,new Set(artwork.completed||[]).size);
  const artRatio=artwork.status==='complete'?1:doneArt/totalArt;
  const textPercent=Math.max(0,Math.min(100,numeric(progress.percent)));
  const percent=Math.round(needsArt?textPercent*0.9+artRatio*10:textPercent);
  const stage=p.stage==='complete'&&needsArt&&artwork.status!=='complete'?'artwork':p.stage;
  const stages=[['source','자료 분석'],['plan','목차 구성'],['writing','본문 집필'],['artwork','표지·삽화']];
  const current=stage==='complete'?stages.length:Math.max(0,stages.findIndex(([key])=>key===stage));
  const seconds=Math.floor(Math.max(0,elapsedMs)/1000);
  return `<section class="production-live" aria-label="책 집필 진행"><div class="production-live-head"><strong>${percent}%</strong><span>${escapeHTML(progress.message||'완료된 구간을 저장하며 작업합니다.')}</span></div><progress value="${percent}" max="100" aria-label="책 전체 제작 진행" aria-valuetext="${percent}% 완료"></progress><ol class="production-live-stages">${stages.filter(([key])=>needsArt||key!=='artwork').map(([key,label],index)=>`<li class="${index<current?'is-done':index===current?'is-current':''}"${index===current?' aria-current="step"':''}><span>${index<current?'✓':index+1}</span>${label}</li>`).join('')}</ol><div class="production-live-counts"><span>${numberText(progress.completedChapters)} / ${numberText(progress.totalChapters)}장 저장</span><span>${numberText(progress.actualChars)}자 집필</span><span>${numberText(progress.completedSections)} / ${numberText(progress.totalSections)}구간 완료</span></div><dl class="production-live-timing"><div><dt>이번 작업 경과</dt><dd>${Math.floor(seconds/60)}분 ${seconds%60}초</dd></div><div><dt>남은 시간 추정</dt><dd>${escapeHTML(formatDurationRange(estimate?.minutes))}</dd></div><div><dt>남은 비용 추정</dt><dd>${escapeHTML(formatMoneyRange(estimate?.usd))}<small>${escapeHTML(formatMoneyRange(estimate?.krw,'KRW'))}</small></dd></div></dl><p class="production-small-note">진행률은 저장된 작업 기준입니다. 현재 응답을 기다리는 동안 유지될 수 있습니다. 시간과 비용은 남은 요청의 추정치이며, 실제 청구액은 AI 제공자에서 확인하세요.</p></section>`;
}
