/** Read-only publishing guidance shared by the checklist and its downloadable guide. */
export const PUBLISHING_HELP_REVIEW_DATE = '2026-10-21';
export const PUBLISHING_HELP_LINKS = Object.freeze({
  isbn: { label: '국립중앙도서관 ISBN·납본', url: 'https://www.nl.go.kr/seoji/' },
  publisherNumber: { label: 'ISBN 발행자번호 신청 안내', url: 'https://www.nl.go.kr/seoji/contents/S30101000000.do' },
  bookISBN: { label: '개별 도서 ISBN 신청 안내', url: 'https://www.nl.go.kr/seoji/contents/S30201000000.do' },
  deposit: { label: '전자책 납본 절차', url: 'https://www.nl.go.kr/seoji/contents/S50102010000.do' },
  upaper: { label: '유페이퍼 판권 안내', url: 'https://help.upaper.kr/read/1021795' },
  upaperFiles: { label: '유페이퍼 파일 등록 정책', url: 'https://help.upaper.kr/read/1021609' },
  kyobo: { label: '교보문고 전자책 제휴', url: 'https://store.kyobobook.co.kr/pod/introduce?tab=ebook_publishing' },
  kdp: { label: 'KDP 도서 등록 절차', url: 'https://kdp.amazon.com/en_US/help/topic/GHKDSCW2KQ3K4UU4' },
  kdpISBN: { label: 'KDP 전자책 ISBN 안내', url: 'https://kdp.amazon.com/en_US/help/topic/G7DMSKCM9DVS65TC' },
  languages: { label: 'KDP 지원 언어 확인', url: 'https://kdp.amazon.com/en_US/help/topic/G200673300' },
  kdpAI: { label: 'KDP AI 콘텐츠 정책', url: 'https://kdp.amazon.com/en_US/help/topic/G200672390' },
  kdpCover: { label: 'KDP 표지 파일 규격', url: 'https://kdp.amazon.com/en_US/help/topic/G200645690' },
  epubcheck: { label: 'EPUBCheck 설치 안내', url: 'https://www.w3.org/publishing/epubcheck/docs/installation/' },
  reader: { label: '무료 EPUB 리더 Thorium', url: 'https://www.edrlab.org/software/thorium-reader/' },
  copyright: { label: '공유마당 저작물 검색', url: 'https://gongu.copyright.or.kr/gongu/main/main.do' },
  cc: { label: 'Creative Commons 라이선스 설명', url: 'https://creativecommons.org/share-your-work/cclicenses/' },
  kogl: { label: '공공누리 유형별 이용 조건', url: 'https://www.mcst.go.kr/site/s_open/kogl/koglType.jsp' },
  ccBy: { label: 'CC BY 4.0 이용 조건', url: 'https://creativecommons.org/licenses/by/4.0/' },
  chatgptImages: { label: 'ChatGPT 이미지 기능 안내', url: 'https://help.openai.com/en/articles/11084440-images-in-chatgpt' },
  codexImages: { label: 'Codex 이미지 생성 안내', url: 'https://learn.chatgpt.com/docs/image-generation' },
  claudeImages: { label: 'Claude 이미지·도표 지원 안내', url: 'https://support.claude.com/en/articles/9002504-can-claude-produce-images' },
  claudeCredits: { label: 'Claude 플랜별 API 크레딧 확인', url: 'https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans' },
  gov24: { label: '정부24 민원 검색', url: 'https://www.gov.kr/' },
  publisherReport: { label: '정부24 출판사 신고 안내', url: 'https://m.gov.kr/mw/AA020InfoCappView.do?CappBizCD=13700000045&HighCtgCD=A07002&tp_seq=02' },
  hometax: { label: '홈택스 사업자등록·세금 신고', url: 'https://www.hometax.go.kr/' },
  registration: { label: '국세청 사업자등록 정정 안내', url: 'https://d.nts.go.kr/nts/cm/cntnts/cntntsView.do?cntntsId=7779&mi=2446' },
  electronicBook: { label: '문체부 면세 전자출판물 기준', url: 'https://www.mcst.go.kr/site/s_data/ordinance/instruction/instructionView.jsp?pSeq=3539' },
  ecommerce: { label: '정부24 통신판매업 신고 안내', url: 'https://www.gov.kr/mw/AA020InfoCappView.do?CappBizCD=11300000006&tp_seq=01' },
});

const help = (term, meaning, where, action, links = []) => ({ term, meaning, where, action, links });
const COMMON_HELP = {
  title: help('도서정보', '제목·저자처럼 서점에서 책을 식별하고 소개하는 정보입니다.', 'Folio의 책 정보 → 제목·저자', '표지와 원고, 판매 페이지에 같은 이름을 쓰세요.'),
  manuscript: help('본문 원고', '독자가 읽는 각 장의 내용입니다. 시작말과 맺음말도 포함합니다.', 'Folio의 원고 편집 → 해당 장', '빈 장을 작성하거나 사용하지 않는 장을 정리하고 프리뷰로 읽어 보세요.'),
  description: help('책 소개', '어떤 독자에게 어떤 도움을 주는 책인지 설명하는 판매용 소개글입니다.', 'Folio의 책 정보 → 책 소개', '주제·대상 독자·읽고 얻을 내용을 간결하게 적으세요.'),
  category: help('도서 분류', '서점에서 책을 배치할 주제별 책장입니다. 예: 컴퓨터·IT, 게임 개발.', '이 화면의 분류 / 제출처의 분류 선택 화면', '원고의 핵심 주제에 맞는 분류를 고르세요. Folio에 적은 문구는 제출처의 실제 분류 항목에 맞춰 옮깁니다.'),
  keywords: help('검색 키워드', '독자가 책을 찾을 때 입력할 만한 단어입니다.', '이 화면의 검색 키워드 / 제출처의 키워드 입력 화면', '실제 내용과 관련된 단어를 적고, 제출처의 개수·길이 제한에 맞춰 입력하세요.'),
  publisher: help('발행처·판권', '발행처는 책을 내는 주체입니다. 판권 페이지에는 저자·발행처·출판일·권리 고지 등을 모읍니다.', '이 화면의 발행처·출판 예정일 / 계약한 유통사', '대행 출판이면 계약상 발행처를 확인하세요. 직접 출판사를 운영할 때는 출판사 신고와 사업자등록 정정 대상인지 따로 확인하세요.', ['upaper', 'publisherReport', 'hometax']),
  price: help('정가·정산액', '정가는 독자에게 표시하는 책값입니다. 수수료 등을 뺀 정산액과는 다릅니다.', '이 화면의 정가·통화 / 유통사의 판매 조건', '무료 배포는 0을 입력하세요. 유통 수수료와 파일 등록 비용은 선택한 서비스에서 확인하세요.', ['upaperFiles']),
  isbn: help('ISBN', '책의 판형·형태 등을 구별하는 국제표준도서번호입니다. 저작권 등록번호는 아닙니다.', '국립중앙도서관 ISBN·납본 시스템 / 계약 유통사', '직접 발행하면 발행자번호를 받은 뒤 개별 도서 ISBN을 신청합니다. 대행 경로는 처리 담당을 먼저 확인하세요. 임의로 번호를 만들지 마세요.', ['publisherNumber', 'bookISBN']),
  placeholders: help('미완성 표시', 'TODO·TBD·작성 예정처럼 나중에 채우겠다는 흔적입니다.', 'Folio의 원고 편집 → 해당 문구 찾기', '본문에 남길 예시인지 실제 미작성 부분인지 확인한 뒤 수정하세요.'),
  figures: help('이미지 등록과 참조', '본문의 이미지 표시와 실제 저장된 그림 파일이 연결되어야 내보내기에도 포함됩니다.', 'Folio의 원고 에디터 → 이미지 붙여넣기·등록', '사용 권한을 확인한 파일을 등록하세요. 인터넷 주소만 붙인 뒤 출력에 포함됐다고 가정하지 말고 EPUB·HTML에서 확인하세요.', ['copyright', 'cc', 'kogl']),
  diagrams: help('도표 문법', '흐름도·표 등을 그리기 위한 작성 규칙입니다.', 'Folio의 원고 편집 → 도표 블록', '오류가 표시된 도표를 수정하고 프리뷰와 최종 파일에서 글자·연결선·잘림을 확인하세요.'),
  language: help('유통 언어', '판매 서비스가 실제로 지원하는 원고의 언어입니다.', '선택한 유통사의 지원 언어 안내', '원고의 실제 언어를 입력하세요. 지원 여부를 통과하려고 다른 언어로 표시하면 안 됩니다.', ['languages']),
  ai: help('AI 생성·AI 보조', 'AI가 실제 본문·번역·이미지를 만든 경우와, 사람이 만든 내용의 교정 등에 활용한 경우를 구별합니다.', '이 화면의 소개와 권리·AI 사용 내역 / 유통사 제출 화면', '사용한 도구와 용도를 적고 제출처의 신고 기준에 따라 표시하세요.', ['kdpAI']),
  rights: help('상업 이용 허락·라이선스', '이미지를 유료 전자책에 넣고 배포할 수 있는지 정한 조건입니다. 출처 표기만으로 이용 허락이 생기지는 않습니다.', '이미지 원본 상세 페이지의 이용 조건 / 이 화면의 권리·인용·라이선스 고지', '작가·원본 URL·라이선스 종류와 버전·변경 내용을 기록하고 허락 증빙을 보관하세요. 무료 이미지도 각 파일의 상업 이용·편집 조건을 확인하세요.', ['copyright', 'cc', 'kogl']),
  proofread: help('교정·사실 확인', '맞춤법뿐 아니라 수치·설명·인용이 정확한지 원문과 대조하는 작업입니다.', 'Folio의 원고 편집·프리뷰 / 인용한 원자료', 'AI가 작성한 문장과 출처도 직접 확인한 뒤 저자 확인 체크를 하세요.'),
  devices: help('리더기 검수', 'EPUB을 실제로 여는 프로그램이나 휴대폰에서 읽어 보는 작업입니다.', '출판 ZIP을 푼 뒤 book.epub → EPUB 리더에서 열기', '목차·한글·글자 확대·표·이미지·링크를 확인하세요. HTML 책 넘김과 EPUB의 표시 방식은 다를 수 있습니다.', ['reader']),
  epubcheck: help('EPUB·EPUBCheck', 'EPUB은 전자책 파일 형식이고 EPUBCheck는 그 파일의 구조 규칙을 검사하는 무료 도구입니다. 맞춤법이나 저작권은 검사하지 않습니다.', '내 컴퓨터 → ZIP의 validate-epub.ps1 또는 validate-epub.sh', 'Java와 공식 EPUBCheck를 설치하고 절차서의 명령을 실행하세요. 생성된 epubcheck-report.json의 오류·경고를 확인하세요.', ['epubcheck']),
  submission: help('유통 심사·납본', '유통 심사는 서점의 판매 검토입니다. 납본은 발행 자료를 국립중앙도서관에 제출·보존하는 절차입니다.', '계약한 유통사 / 국립중앙도서관 ISBN·납본 시스템', '계정·계약·정산 정보를 등록하고 파일을 제출하세요. ISBN·납본은 본인과 대행사 중 누가 처리하는지 확인해 이력에 기록하세요.', ['upaper', 'kyobo', 'deposit']),
  'cover-file': help('JPG·RGB·px', 'JPG는 이미지 파일 형식, RGB는 화면용 색 표현, px는 이미지 가로·세로의 픽셀 수입니다.', '이 화면의 판매용 표지 JPG / 유통사 표지 규격', '표지를 내려받아 작은 글자까지 읽히는지 확인하세요. Folio 기본 크기가 모든 유통사의 의무 규격은 아닙니다.', ['kdpCover']),
  'isbn-tracking': help('ISBN 발급 기록', 'ISBN 신청과 실제 발급 완료는 서로 다른 상태입니다.', '이 화면의 판본·유통·ISBN·납본 이력', '발급 확인 상태에는 실제로 받은 ISBN을 입력하고 담당자·증빙을 기록하세요.', ['isbn']),
  'reference-url': help('증빙 링크', '실제 접수·승인 등을 확인한 자료의 주소입니다.', '이 화면의 판본·유통·ISBN·납본 이력 → 진행 증빙 링크', 'https 주소를 입력하세요. 비밀번호·접속 토큰·주민번호 등이 포함된 주소는 저장하지 마세요.'),
};
const fieldHelp = {
  author: 'title', publicationDate: 'publisher', aiDisclosure: 'ai',
};

export function publicationCheckHelp(id, channel = 'domestic') {
  let key = String(id).replace(/^field-/, '');
  key = fieldHelp[key] || key;
  let result = COMMON_HELP[key];
  if (['submissionDate', 'approvedDate', 'depositDate'].includes(key)) result = help('확인일', '예정일이 아니라 실제 접수·승인·납본을 확인한 날짜입니다.', '이 화면의 판본·유통·ISBN·납본 이력', '기관의 접수 내역을 확인한 날짜를 기록하세요. 날짜를 입력해도 외부 신청이 실행되지는 않습니다.', ['isbn']);
  if (!result) return null;
  if (channel === 'kdp' && key === 'isbn') result = help('KDP 전자책 ISBN', 'KDP 전자책에는 ISBN이 필수가 아닙니다. 종이책과는 기준이 다릅니다.', 'Amazon KDP 도서 등록 화면', '공식 안내에서 전자책 기준을 확인하세요. 다른 유통 경로의 ISBN 필요 여부는 별도로 확인합니다.', ['kdpISBN']);
  if (channel === 'kdp' && key === 'submission') result = help('KDP 제출·심사', 'KDP에 도서정보·파일·권리·AI 사용 내역을 제출하고 판매 심사를 받는 단계입니다.', 'Amazon KDP 도서 등록 화면', '실제 원고의 지원 언어와 계정·세금·정산 정보를 먼저 확인하세요. 국내 ISBN·납본 적용 여부는 별도 확인합니다.', ['kdp', 'languages', 'kdpAI']);
  if (channel !== 'kdp' && key === 'language') result = { ...result, where: '계약한 국내 유통사의 등록 화면', links: ['kyobo', 'upaper'] };
  if (channel !== 'kdp' && key === 'cover-file') result = { ...result, links: ['upaperFiles', 'kyobo'] };
  if (channel === 'direct' && key === 'submission') result = help('직접 배포·판매', '자체 웹페이지나 다운로드 경로에서 독자에게 책을 제공하는 방식입니다.', '직접 운영하는 배포 페이지 / 관련 민원·신고 기관', '무료 배포와 직접 판매를 구분하세요. 판매한다면 사업자·통신판매업 신고 대상, 결제·환불·개인정보 처리와 ISBN·납본 담당을 확인하세요.', ['gov24', 'hometax', 'isbn']);
  return { ...result, links: result.links.map(key => ({ ...PUBLISHING_HELP_LINKS[key] })) };
}

export const PUBLICATION_GLOSSARY = Object.freeze([
  ['판권', '책에 저자·발행처·출판일·권리 고지를 모아 적은 부분입니다.'],
  ['ISBN', '책의 형태·판본을 식별하는 국제표준도서번호입니다. 저작권 등록과는 별개입니다.'],
  ['납본', '발행 자료를 국립중앙도서관에 제출해 보존하는 절차입니다. 처리 대상과 담당자를 확인하세요.'],
  ['메타데이터', '제목·저자·소개·가격·분류처럼 서점 등록에 쓰는 도서정보입니다.'],
  ['판본', '초판 1.0, 개정판 2.0처럼 어느 내용의 책인지 구별하는 버전입니다.'],
  ['EPUB / HTML / PDF', 'EPUB은 전자책 리더용, HTML은 웹브라우저용, PDF는 쪽 배치를 고정한 문서입니다. 책 넘김 효과는 HTML에서 제공합니다.'],
  ['EPUBCheck', 'EPUB 파일 구조를 검사하는 무료 도구입니다. 판매 승인이나 내용의 정확성을 보증하지는 않습니다.'],
  ['라이선스', '저작물을 어디에, 어떤 조건으로 사용할 수 있는지 정한 이용 허락입니다.'],
]);

export const PUBLICATION_IMAGE_OPTIONS = Object.freeze([
  { title: '이용 조건이 맞는 무료 이미지', cost: '이미지 사용료 $0 / 0원', text: 'CC0·CC BY·공공누리 제1유형 등을 우선 확인하세요. CC BY는 저작자·출처·라이선스 링크와 변경 내용을 표시합니다. NC·공공누리 제2·4유형은 상업 이용 제한, ND·제3유형은 변경 제한이 있으므로 유료 출판·편집 방식에 맞는지 확인하세요. 인물·상표 등 별도 권리도 확인합니다.', links: ['copyright', 'ccBy', 'kogl'] },
  { title: '이미 사용 중인 ChatGPT·Codex의 이미지 기능', cost: '포함 사용량 안이면 추가 $0 / 0원', text: '현재 플랜에서 제공되는 이미지 생성 기능으로 만들고 파일을 내려받아 Folio 에디터에 붙여넣거나 등록하세요. 구독료는 별도이며 생성 한도와 추가 사용 요금은 해당 계정에서 확인합니다.', links: ['chatgptImages', 'codexImages'] },
  { title: 'Claude로 설명 도표·SVG 만들기', cost: '포함 사용량 안이면 추가 $0 / 0원', text: '게임 기획의 상태 전이도·흐름도·비교표처럼 내용을 설명하는 그림은 Claude로 도표·SVG 코드를 만들 수 있습니다. 결과물을 검수해 Folio에서 지원하는 이미지 파일로 등록하거나 도표 기능으로 옮기세요. 구독료와 사용 한도는 별도입니다.', links: ['claudeImages'] },
]);

export const PUBLICATION_BUSINESS_HELP = Object.freeze({
  title: '직접 출판사를 운영할 때 확인할 곳',
  text: '개인 저자의 유통 대행과 직접 출판사 운영은 절차가 다릅니다. 대행 계약에서는 발행처·ISBN·납본 담당을 먼저 정하세요. 직접 출판사를 운영하면 관할 시·군·구의 출판사 신고, 기존 사업자의 업종 추가·정정 여부를 확인합니다. 출판사 신고와 사업자등록은 서로 다른 절차입니다.',
  tax: '출판업 추가만으로 간이과세자가 자동으로 일반과세자로 바뀌는 것은 아닙니다. 간이·일반은 과세사업의 과세 방식이며 도서의 면세 여부는 별도입니다. 기존 과세상품과 면세도서를 함께 팔면 겸영, 면세도서만 팔면 면세사업자 정정 여부를 확인하세요. 모든 PDF가 자동으로 면세 전자출판물이 되는 것은 아닙니다.',
  action: '정부24에서 “출판사 신고”, 홈택스에서 “사업자등록 정정”을 찾으세요. 직접 온라인 판매한다면 통신판매업 신고 대상인지도 확인하세요.',
  links: ['publisherReport', 'registration', 'hometax', 'electronicBook', 'ecommerce', 'publisherNumber'],
});

export function publicationHelpMarkdown(checks, channel = 'domestic') {
  const sections = checks.map(check => {
    const info = publicationCheckHelp(check.id, channel);
    if (!info) return '';
    return `### ${check.label}\n\n- 뜻: ${info.meaning}\n- 진행 위치: ${info.where}\n- 할 일: ${info.action}${info.links.length ? '\n- 안내: ' + info.links.map(link => `[${link.label}](${link.url})`).join(' · ') : ''}`;
  }).filter(Boolean);
  const links = keys => keys.map(key => `[${PUBLISHING_HELP_LINKS[key].label}](${PUBLISHING_HELP_LINKS[key].url})`).join(' · ');
  const business = PUBLICATION_BUSINESS_HELP;
  return `## 점검 항목별 뜻과 진행 위치\n\n${sections.join('\n\n')}\n\n## 쉬운 출판 용어\n\n${PUBLICATION_GLOSSARY.map(([term, meaning]) => `- **${term}**: ${meaning}`).join('\n')}\n\n## ${business.title}\n\n${business.text}\n\n${business.tax}\n\n${business.action}\n\n${links(business.links)}\n\n## 삽화를 무료·기존 구독 범위에서 준비하기\n\n출처 표기만으로 이용 허락이 생기지는 않습니다. 무료 이미지도 파일별 조건과 허락 증빙을 확인하세요.\n\n${PUBLICATION_IMAGE_OPTIONS.map(option => `### ${option.title}\n\n${option.cost}. ${option.text}\n\n${links(option.links)}`).join('\n\n')}\n\nFolio에서 외부 API 키로 호출하는 생성은 해당 API 요금 체계를 따릅니다. 구독 사용량과 자동으로 합산되지는 않습니다. 일부 플랜의 API 크레딧은 계정의 적용 조건을 확인하세요. ${links(['claudeCredits'])}\n\n도움말 확인일: ${PUBLISHING_HELP_REVIEW_DATE}`;
}
