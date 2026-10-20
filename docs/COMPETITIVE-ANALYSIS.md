# Folio Studio와 전자책 제작 오픈소스 비교

조사일: 2026-10-19. 비교 범위는 공식 저장소·매뉴얼과 이 프로젝트의 소스 코드다. 사용자 수, 판매 전환율, 생성 원고 품질을 실험한 결과는 아니다. 경쟁 도구의 확장 플러그인 전체에 대해 기능 부재를 단정하지 않는다.

Folio의 적합한 포지션은 **한국어 원시 자료를 바탕으로 초안을 집필하고, 검토·편집·책 미리보기·출판 준비를 연결하는 개인 저자용 작업실**이다. 완성 EPUB을 정밀 수정하거나 전문 인쇄 데이터를 만드는 기능에서는 성숙한 도구를 보완 도구로 쓰는 편이 적절하다.

| 비교 대상 | 공식적으로 확인한 강점 | Folio가 더 편리할 수 있는 작업 | Folio의 부족한 부분 |
|---|---|---|---|
| [calibre 저장소](https://github.com/kovidgoyal/calibre) | 다양한 전자책 형식 변환, 서지정보·서재 관리, 기기 전송, EPUB 편집, 뷰어와 플러그인 | 설치 없이 한국어 자료 등록 → 집필 조건 → 비용 승인 → 초안·교정·표지 작업을 하나의 화면 흐름으로 진행 | 기존 EPUB 가져오기·재편집, 광범위한 형식 변환, 기기 전송, 대형 서재 관리에 미달 |
| [Sigil 저장소](https://github.com/Sigil-Ebook/Sigil) | EPUB 2/3 편집, 목차·메타데이터, XHTML/CSS 점검·리포트, Python 플러그인, PageEdit 연계 | XHTML 구조를 몰라도 원고를 작성하고 책 형태로 확인. 원시 자료와 집필 이력을 작업 파일에 보존 | EPUB 내부 파일·OPF·CSS 직접 편집, 정밀 구조 수정·플러그인 검증 기능에 미달 |
| [Pandoc 저장소](https://github.com/jgm/pandoc) | Markdown 등 여러 형식 입력, EPUB 생성, 지역 이미지 포함, CSS·폰트 설정, 메타데이터·필터 기반 자동화 | 명령행 없이 한국어 저자가 프리뷰와 편집을 오가며 AI 집필을 승인·재개 | DOCX 등 입력 형식, 각주·수학·인용 처리, 템플릿·Lua 필터·CI 변환 기능에 미달 |
| [Vivliostyle CLI 저장소](https://github.com/vivliostyle/vivliostyle-cli) | HTML/CSS 조판, Markdown에서 PDF·EPUB·Web Publication 생성, 미리보기, 출판용 CSS 제어 | 자료에서 책 내용 생성까지 연결하고, 독립 HTML에 책 넘김 경험 제공 | 정밀한 페이지 분할·금칙·머리말·꼬리말·인쇄 색상·출력 일관성은 전문 조판 엔진 수준이 아님 |

위 표의 경쟁 도구 기능 근거: [calibre 기능 소개](https://calibre-ebook.com/about), [calibre 편집 매뉴얼](https://manual.calibre-ebook.com/edit.html), [Sigil 공식 README](https://github.com/Sigil-Ebook/Sigil#readme), [Pandoc EPUB 제작](https://pandoc.org/epub.html), [Pandoc 사용자 안내](https://pandoc.org/MANUAL.html), [Vivliostyle CLI 문서](https://docs.vivliostyle.org/en/cli/), [Vivliostyle 출력 설정](https://github.com/vivliostyle/vivliostyle-cli/blob/main/docs/config.md). 별 수나 인기 순위를 경쟁력 점수로 사용하지 않았다.

## 코드로 확인한 Folio의 강점

1. **자료에서 집필까지의 연결**: `dist/source-files.js`, `dist/source-images.js`, `dist/production.js`가 원시 Markdown·이미지 자료의 수집, 계획, 장별 작성, 재시도·재개를 담당한다. 챕터 단위 복구가 있어 실패 시 전부 다시 만드는 부담을 줄인다.
2. **한국어 저자의 작업 흐름**: `dist/editorial.js`의 설명 가능한 한국어 교정 규칙, `dist/production-ui.js`의 조건 입력, `dist/app.js`의 원고·디자인·내보내기 화면이 한 작업 안에 있다. 한글 맞춤법 전반의 정확도를 보증하는 전문 교정기는 아니다.
3. **자료를 보존하는 로컬 작업**: `dist/storage.js`의 IndexedDB 저장과 복구, 작업 JSON 백업·이력이 있다. API 키는 세션에서 사용한다. AI 실행 시 선택된 내용은 해당 제공자에게 전송되므로 모든 기능이 오프라인인 것은 아니다.
4. **실행 전에 이해할 수 있는 안내**: 이번 개선은 글자 수의 책 분량 환산, 시간·비용 추정, 명시적 집필 승인, 진행률을 연결한다. 추정 정확도와 비용 절감 효과는 실제 여러 권을 집필한 뒤 평가해야 한다.
5. **독자 관점의 확인과 전달**: 이번 개선의 `dist/book-preview.js` 및 HTML 내보내기는 페이지 넘김을 제공한다. EPUB/PDF의 페이지 전환은 뷰어가 결정하며, 애니메이션이 모든 전자책 판매 플랫폼에서 유지된다고 주장하지 않는다.
6. **출판 준비를 반복 가능한 절차로 구성**: `dist/publication.js`가 도서정보, 판권 초안, 점검표와 EPUBCheck 실행 도우미를 묶는다. 실제 유통사의 승인이나 계약·권리 판단을 대신하지 않는다.

## 격차와 우선순위

| 우선순위 | 격차 | 이번 대응 | 다음 구현과 완료 기준 |
|---|---|---|---|
| P0 | EPUB 표준 검증의 독립성 | 로컬 사전점검을 정식 검증과 구분하고 EPUBCheck 스크립트 제공 | 대표 문서·표·도표·그림 회귀 자료를 EPUBCheck CI에서 검사. 오류 0, 경고 검토 기록 |
| P0 | 판매자가 요구하는 표지와 메타데이터 | 발행처·날짜·정가·ISBN·권리·AI 내역 및 판권 생성 | 채널별 별도 JPG 표지 규격 검사·생성, 필수 입력 매핑과 제출 전 체크 |
| P1 | 입력 형식과 기존 EPUB 수정 | 현재 지원하는 원문 형식을 명시 | DOCX/EPUB 가져오기에서 제목·장·이미지·각주 보존을 검증. 실패 시 원문 보존 |
| P1 | 전문 조판·접근성 | 웹 책 프리뷰와 인쇄용 HTML 제공 | Vivliostyle 등 선택형 출력 엔진, 실제 화면낭독기·글자 확대·긴 표 검수 |
| P1 | 원고 정확도와 출처 확인 | 원문 보존, 저자 교정·권리 확인 체크 | 인용별 원문 위치 연결, 근거 없는 주장 탐지 보조와 저자 승인 기록 |
| P1 | 출판 운영 | 준비 ZIP과 공식 절차 안내 | 유통 상태·판본·ISBN·납본 기록 저장, 변경된 책만 다시 검수 |
| P2 | 협업·교차 기기 | 로컬 저장·JSON 백업 | 명시적 동의 기반 동기화, 역할·검토 의견·병합 충돌 해결 |

## 제안하는 검증 방법

같은 원시 자료로 3만 자의 한국어 실용서, 이미지가 많은 설명서, 표·도표가 있는 교육서를 각각 준비한다. Folio로 집필·1차 편집하고, Sigil/calibre로 최종 EPUB 점검, 필요하면 Vivliostyle로 인쇄본을 조판한다. 준비 시간, EPUBCheck 오류·경고, 잘린 표·그림, 한글 렌더링, 원문 추적 가능성, 저자가 수정한 사실 오류 수를 기록한다. 이 결과가 나오기 전에는 “원고 품질·생산성이 경쟁 도구보다 우수하다”는 정량 주장을 하지 않는다.

Folio는 생성과 검토의 진입 장벽을 낮추는 데 집중하고, 검증·변환·조판에서 성숙한 도구와 연결하는 전략이 현실적이다.
