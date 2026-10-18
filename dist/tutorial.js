// This module renders guidance only. Navigation and actions live in app.js.
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));

export const TUTORIAL_STEPS = Object.freeze([
  {
    id: 'book', title: '책의 뼈대 만들기', shortTitle: '새 책',
    summary: '주제와 자료로 책을 만들거나, 빈 원고에 직접 써 내려가세요.',
    view: 'editor', action: 'new-project', label: '직접 쓸 새 책 양식 열기', selector: '#new-title',
    instructions: [
      '작업 화면의 조건으로 책 만들기를 열고 주제와 집필 지시를 적으세요. 원고 폴더 불러오기를 선택하면 하위 폴더의 MD와 PNG·JPG·WebP 이미지를 함께 모읍니다. 파일 여러 개를 선택하거나 원시 Markdown을 붙여 넣을 수도 있습니다.',
      '목표 글자 수 또는 예상 쪽수, 장 수를 정하세요. 장 수는 최대 300장(챕터)이며, 300장에는 최소 15만 자가 필요합니다. 설명에 필요한 도표는 자동 판단이 기본이며 끌 수 있습니다. 조건을 저장한 뒤 AI를 연결하고 제작 시작을 누르면 집필합니다.',
      '직접 쓰려면 새 전자책 양식에 제목과 저자명을 입력하고 빈 원고로 시작하세요. TXT·Markdown·Folio JSON 파일은 원고 가져오기로 열 수 있습니다.'
    ],
    tip: 'Markdown은 최대 500개·1MiB·12만 자, 이미지는 최대 50개·장당 8MiB·합계 32MiB까지 읽습니다. 제작 시작 후 이미지별 분석 요청이 발생합니다. 이미지 미리보기와 경로를 확인하세요. 폴더는 자동 동기화하지 않습니다.'
  },
  {
    id: 'write', title: '쓰고, 나누고, 다시 읽기', shortTitle: '원고',
    summary: '한 장씩 써 내려가며 책의 흐름을 잡아 보세요.',
    view: 'editor', action: null, label: '원고 편집 열기', selector: '#manuscript-text',
    instructions: [
      '장 제목 아래에 원고를 쓰거나 붙여 넣으세요. 변경 내용은 현재 브라우저에 자동 저장됩니다.',
      '새로운 장 추가로 내용을 나누세요. 장 관리에서 순서를 바꾸거나 장을 복제할 수 있습니다.',
      '도표 보강은 현재 장을 읽고 필요한 비교표·차트·흐름도를 추가합니다. 읽기 모드에서 도표를 살피고, 책 미리보기로 전체 흐름을 확인하세요.'
    ],
    tip: '중요한 수정 전에는 수정 이력 → 현재 상태 기록을 눌러 두세요. 최근 8개 상태를 보관합니다.'
  },
  {
    id: 'polish', title: '내 문체로 다듬기', shortTitle: '윤문',
    summary: '표기는 정돈하고, 문장의 말투는 원고에 맞춥니다.',
    view: 'quality', action: null, label: '윤문 · 교정 열기', selector: '.writing-preferences summary',
    instructions: [
      '기본 교정 적용은 책 전체의 공백과 기본 표기를 정리합니다. AI 연결 없이 사용할 수 있습니다.',
      '원하는 말투와 참고 문장을 열어 문체 요청과 직접 쓴 문장을 적으세요. 비워 두어도 됩니다.',
      'AI를 연결한 뒤 자연스럽게 다듬기를 누르면 현재 선택한 장을 윤문합니다. 적용된 글과 검토 메모를 함께 읽어 보세요.'
    ],
    tip: 'AI 윤문은 장마다 12,000자까지 지원합니다. 적용 전 원고는 수정 이력에 남습니다. 사실과 인용은 직접 확인해 주세요.'
  },
  {
    id: 'connect', title: 'Google AI 연결하기', shortTitle: 'AI 연결',
    summary: '본인의 Google Gemini API 키로 집필·윤문·이미지 생성을 사용하세요.',
    view: 'editor', action: 'settings', label: 'AI 연결 설정 열기', selector: '#api-key',
    instructions: [
      'Google AI Studio에서 Gemini API 키를 발급받으세요. 설정 안에 발급 페이지 링크가 있습니다.',
      'AI 연결 및 설정에서 Google Gemini를 선택하고 API 키를 붙여 넣으세요. 모델명은 계정에서 사용할 수 있는 모델로 맞춥니다.',
      '연결 확인 후 사용을 누르세요. 제작 조건에서 연결했다면 조건 화면으로 돌아갑니다. 연결 확인은 글쓰기 모델의 접근 권한만 확인하며 원고나 이미지를 생성하지 않습니다.'
    ],
    tip: '연결 후 설정을 다시 열어 실제 생성 테스트를 누르면 짧은 예문 1회로 응답을 확인합니다. 원고는 바뀌지 않습니다. 키는 현재 탭에만 보관되고 새로고침하면 지워집니다. 생성 요청은 Google로 직접 전송되며 사용량에 따라 별도 비용이 발생할 수 있습니다.'
  },
  {
    id: 'design', title: '표지와 삽화 입히기', shortTitle: '디자인',
    summary: '책의 분위기를 정하고, 필요한 자리에 그림을 더하세요.',
    view: 'design', action: null, label: '표지 & 삽화 열기', selector: '#meta-title',
    instructions: [
      '책 제목·저자·소개를 확인한 뒤 북 디자인에서 표지 색상을 고르세요.',
      '내용에 맞는 AI 표지를 누르면 제목과 본문의 주요 부분을 분석해 표지를 만듭니다. 제목은 그림 위에 별도로 배치됩니다.',
      '내 배경 이미지에서 사진이나 그림을 추가하고, 맞춤·중심·배경 보정·제목 위치를 조절하세요. 본문 삽화는 현재 선택한 장에 넣고 설명과 캡션을 적습니다.'
    ],
    tip: '배경 업로드와 디자인 삽화는 API 키 없이 사용할 수 있습니다. AI 표지는 기획 1회와 이미지 생성 1회를 요청하며, 직접 올린 배경은 그대로 보관합니다.'
  },
  {
    id: 'export', title: '읽을 파일과 작업 백업 남기기', shortTitle: '내보내기',
    summary: '독자에게 보낼 책과 계속 편집할 원본을 함께 보관하세요.',
    view: 'export', action: null, label: '출판 · 내보내기 열기', selector: '.export-options',
    instructions: [
      '책 미리보기에서 목차·삽화·도표·문장 흐름을 살피고 저자명과 제목을 확인하세요.',
      '전자책 리더용은 EPUB, 브라우저에서 읽을 파일은 HTML을 선택하세요. PDF는 인쇄 창에서 PDF로 저장을 고릅니다.',
      '현재 책 백업 · JSON도 내려받으세요. 다른 기기에서 가져오기로 이어 쓸 수 있고, 설정의 서재 전체 백업에는 수정 이력도 포함됩니다.'
    ],
    tip: '자동 저장은 현재 브라우저에 남습니다. 브라우저 데이터를 지우거나 기기를 바꾸기 전에 JSON 백업을 보관하세요.'
  }
].map(step => Object.freeze({...step, instructions: Object.freeze(step.instructions)})));

function indexWithinSteps(index) {
  let number;
  try { number = Number(index); } catch { number = 0; }
  return Number.isFinite(number) ? Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, Math.trunc(number))) : 0;
}

const paperLines = '<span class="tutorial-lines"><i></i><i></i><i></i><i></i></span>';

function renderVisual(id) {
  const visuals = {
    book: `<div class="tutorial-book"><span class="tutorial-mock-label">나의 첫 번째 책</span><strong>어떤 이야기를<br>쓰고 싶나요?</strong><span class="tutorial-book-rule"></span><small>내 이름으로 남기는 한 권</small></div><span class="tutorial-token">제목 · 독자 · 주제</span>`,
    write: `<div class="tutorial-sheet"><span class="tutorial-mock-label">CHAPTER 01</span><strong class="tutorial-sheet-title">첫 번째 장</strong>${paperLines}<span class="tutorial-caret"></span></div><span class="tutorial-token">쓰고, 읽고, 이어 쓰기</span>`,
    polish: `<div class="tutorial-sheet"><span class="tutorial-mock-label">나의 문장</span>${paperLines}<div class="tutorial-polish-note"><span>말투는 살리고</span><strong>군더더기는 덜고</strong></div></div><span class="tutorial-token">원고에 맞춘 윤문</span>`,
    connect: `<div class="tutorial-connection"><span class="tutorial-app-mark">f</span><span class="tutorial-connector">↔</span><span class="tutorial-google-mark">G</span></div><div class="tutorial-connection-names"><span>Folio</span><span>Google Gemini</span></div><span class="tutorial-token">내 키로 연결</span>`,
    design: `<div class="tutorial-book tutorial-book-art"><span class="tutorial-mock-label">COVER & ART</span><strong>글에 어울리는<br>한 장의 그림</strong><span class="tutorial-art-shape"></span></div><div class="tutorial-swatches"><i></i><i></i><i></i></div>`,
    export: `<div class="tutorial-sheet"><span class="tutorial-mock-label">나의 전자책</span><strong class="tutorial-sheet-title">한 권으로<br>묶었습니다.</strong>${paperLines}</div><div class="tutorial-formats"><span>EPUB</span><span>PDF</span><span>JSON</span></div>`
  };
  return `<div class="tutorial-visual tutorial-visual-${id}" aria-hidden="true">${visuals[id]}</div>`;
}

export function renderTutorialStep(index = 0) {
  const current = indexWithinSteps(index);
  const step = TUTORIAL_STEPS[current];
  const last = current === TUTORIAL_STEPS.length - 1;
  return `<div class="tutorial" data-tutorial-step="${step.id}">
    <div class="tutorial-progress">
      <p class="tutorial-progress-label" role="status">${current + 1} / ${TUTORIAL_STEPS.length} · ${escapeHTML(step.shortTitle)}</p>
      <progress max="${TUTORIAL_STEPS.length}" value="${current + 1}" aria-label="사용 안내 진행"></progress>
    </div>
    <ol class="tutorial-steps" aria-label="전자책 만들기 안내 단계">${TUTORIAL_STEPS.map((item, i) => `<li><button type="button" class="tutorial-step-link" data-action="tutorial-jump" data-index="${i}"${i === current ? ' aria-current="step"' : ''} aria-label="${i + 1}단계: ${escapeHTML(item.title)}"><span class="tutorial-step-number">${i + 1}</span><span class="tutorial-step-name">${escapeHTML(item.shortTitle)}</span></button></li>`).join('')}</ol>
    <div class="tutorial-body">
      ${renderVisual(step.id)}
      <div class="tutorial-copy">
        <h3>${escapeHTML(step.title)}</h3>
        <p class="tutorial-summary">${escapeHTML(step.summary)}</p>
        <ol class="tutorial-instructions">${step.instructions.map(instruction => `<li>${escapeHTML(instruction)}</li>`).join('')}</ol>
      </div>
    </div>
    <p class="tutorial-tip">${escapeHTML(step.tip)}</p>
    <div class="tutorial-actions">
      <button type="button" class="button secondary" data-action="tutorial-prev"${current === 0 ? ' disabled' : ''}>이전</button>
      <button type="button" class="button soft tutorial-try" data-action="tutorial-try" data-index="${current}">${escapeHTML(step.label)}</button>
      <button type="button" class="button primary" data-action="${last ? 'tutorial-finish' : 'tutorial-next'}">${last ? '둘러보기 마치기' : '다음'}</button>
    </div>
    <p class="tutorial-footnote">화면만 둘러보는 동안에는 원고가 바뀌거나 AI 생성이 시작되지 않습니다.</p>
  </div>`;
}

export function renderHelpOverview({started=false}={}) {
  return `<div class="help-overview">
    <p class="lead">처음부터 따라가거나, 지금 필요한 부분부터 살펴보세요.</p>
    <div class="inline-actions"><button type="button" class="button primary" data-action="tutorial-resume">${started?'사용 안내 이어 보기':'6단계 안내 시작'}</button><button type="button" class="button secondary" data-action="tutorial-start">처음부터 보기</button></div>
    <div class="help-step-grid">${TUTORIAL_STEPS.map((step, i) => `<button type="button" class="help-step" data-action="tutorial-jump" data-index="${i}"><span class="help-step-number">${String(i + 1).padStart(2, '0')}</span><strong>${escapeHTML(step.title)}</strong><small>${escapeHTML(step.summary)}</small></button>`).join('')}</div>
    <section class="help-section" aria-labelledby="help-shortcuts-title">
      <h3 id="help-shortcuts-title">자주 쓰는 단축키</h3>
      <dl class="shortcut-list">
        <div><dt><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>S</kbd></dt><dd>현재 작업 저장</dd></div>
        <div><dt><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd></dt><dd>서재의 모든 책에서 원고 검색</dd></div>
        <div><dt><kbd>Esc</kbd></dt><dd>열린 창 닫기 · 집중 모드 종료 · 생성은 중지 버튼 사용</dd></div>
      </dl>
    </section>
    <section class="help-section help-faq" aria-labelledby="help-faq-title">
      <h3 id="help-faq-title">자주 묻는 질문</h3>
      <details><summary>PC 프로그램을 조작해서 실습 화면을 만들 수 있나요?</summary><p>상단의 컴퓨터로 예제 만들기를 여세요. Windows PC에서 연결 도우미를 내려받아 실행하고, 같은 PC의 브라우저에 연결 코드를 입력합니다. 메이플스토리 월드 에디터처럼 작업할 창을 고른 뒤 만들 예제를 적고 작업을 시작하세요. 선택한 창의 화면을 연결된 AI에 전달하며 클릭·입력·촬영을 순서대로 진행합니다. 프로그램 로그인과 프로젝트 열기는 직접 준비해 주세요. 도우미가 실행되는 동안 F8로 즉시 조작을 중지할 수 있습니다.</p><p>보관한 화면의 제목·설명을 확인한 뒤 본문 반영을 누르면 현재 장 끝에 설명과 스크린샷을 추가합니다. 이미지 참조 줄을 옮겨 본문 위치를 바꿀 수 있으며, 읽기 모드·EPUB·HTML·PDF에 함께 표시됩니다. JSON 백업에는 원본 화면과 기록도 남습니다. 연결 도우미 없이 PNG 스크린샷을 직접 올려도 됩니다. 모바일에서 다른 PC를 원격 조작하는 기능은 아닙니다.</p><button type="button" class="button secondary" data-action="computer-studio">컴퓨터 실습 작업 열기</button></details>
      <details><summary>Google API 키는 어디에 입력하나요?</summary><p>상단의 AI 연결 및 설정을 열어 Google Gemini를 선택하세요. <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>에서 발급한 Gemini API 키를 입력하고 연결 확인 후 사용을 누릅니다. 키는 현재 탭에만 남고 새로고침하면 지워집니다. 생성한 글이나 이미지는 원고와 함께 기기에 저장됩니다.</p></details>
      <details><summary>AI 없이도 책을 만들 수 있나요?</summary><p>원고 편집, 기본 교정, 디자인 삽화, 이미지 업로드, 모든 내보내기는 API 키 없이 사용할 수 있습니다. 조건으로 책 만들기에서도 주제·원시 MD·집필 지시·목표 분량을 먼저 저장할 수 있습니다. AI를 연결한 뒤 제작 시작을 누르면 자료를 읽고 장별 분량에 맞춰 씁니다. 목표와 실제 글자 수는 제작 현황에서 확인하며, 목표의 ±10%를 벗어난 부분은 검토 대상으로 남깁니다. AI 집필·윤문·이미지 생성에는 연결한 제공자의 API 비용이 발생할 수 있습니다. 연결 확인은 글쓰기 모델만 확인하므로 이미지 생성 권한은 첫 생성 때 확인됩니다.</p></details>
      <details><summary>도표는 언제 만들어지나요?</summary><p>조건으로 책 만들기의 설명에 필요한 도표를 자동 판단으로 두면, 집필 중 비교·절차·수치 설명에 도움이 되는 곳에만 넣습니다. 이미 쓴 원고는 원고 편집의 도표 보강으로 검토하세요. 한 번에 도표 하나까지 추가하며, 필요 없으면 원고를 유지합니다. 수치 차트는 입력한 자료의 항목·값·단위와 일치하는 근거를 확인합니다. 자료 자체의 정확성이나 이미지 분석 결과는 직접 검토해 주세요. 별도 이미지 생성 없이 만들며, 읽기 모드·EPUB·HTML·PDF에 반영됩니다. JSON 백업과 Markdown에도 도표 자료가 남습니다.</p></details>
      <details><summary>원고는 어디에 저장되나요?</summary><p>현재 기기의 브라우저에 자동 저장됩니다. 다른 기기로 자동 동기화되지는 않습니다. 출판 · 내보내기의 현재 책 백업 · JSON을 보관하고 다른 기기에서 작업 가져오기로 여세요. 설정의 서재 전체 백업에는 모든 책과 최근 수정 이력도 포함됩니다.</p></details>
      <details><summary>다듬기 전 원고로 돌아갈 수 있나요?</summary><p>자동 교정·AI 작업·편집 제안 적용 전 상태는 수정 이력에 남습니다. 원고 편집 도구 모음의 수정 이력에서 복원하세요. 최근 8개 상태만 보관하므로 오래 보관할 원고는 JSON 백업도 남겨 두세요. AI가 바꾼 사실·수치·인용은 직접 검토해야 합니다.</p></details>
      <details><summary>EPUB과 PDF는 어떻게 다른가요?</summary><p>EPUB은 전자책 리더에서 글자 크기를 바꾸며 읽는 형식입니다. PDF는 인쇄할 때의 페이지 모양을 유지합니다. PDF로 저장을 누르면 브라우저 인쇄 창이 열립니다. 대상에서 PDF로 저장을 고르고 배경 그래픽을 켜고 머리글·바닥글을 꺼 주세요. 출력 파일과 별도로 JSON을 보관하면 다시 편집하기 쉽습니다.</p></details>
      <details><summary>저장 중지 안내가 뜨면 어떻게 하나요?</summary><p>다른 탭과 저장이 충돌하거나 저장 데이터를 읽지 못하면 덮어쓰기를 멈춥니다. 안내의 현재 작업 전체 백업을 먼저 받고, 보관 데이터 받기가 있으면 그 파일도 보관하세요. 작업 중인 다른 탭을 정리한 뒤 다시 열기를 눌러 저장된 원고를 확인하세요.</p></details>
    </section>
  </div>`;
}
