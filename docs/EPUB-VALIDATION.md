# EPUB 표준 검증과 접근성

검증 기준일: 2026-10-20.

## 배포를 막는 실제 표준 검사

`npm run validate:epub`는 브라우저와 동일한 `buildEpub`로 EPUB 6권을 생성한 뒤 W3C EPUBCheck를 실제 실행한다. GitHub Pages 배포 전에 필수 실행되며, 오류 또는 경고가 하나라도 있으면 배포 단계에 도달하지 않는다. 앱 단위 테스트와 별도의 검사다.

- 도구: [W3C EPUBCheck 5.4.0 공식 릴리스](https://github.com/w3c/epubcheck/releases/tag/v5.4.0)
- 고정 SHA-256: `33350c61038e71dfb3d45a76aed04bf5481e6d5500cb780f6e98db8bbd15a28c`
- 다운로드와 캐시 ZIP 모두 해시를 검사한 뒤 압축 해제 및 실행한다.
- Java 21, Node 22+, Python 3.10+가 필요하다. CI는 이 런타임들을 구성한다.
- `--failonwarnings --maxOfEachMessage unlimited --json`으로 검사한다. 진단 등급을 낮추거나 메시지를 숨기지 않는다. [공식 CLI 문서](https://www.w3.org/publishing/epubcheck/docs/cli/)
- `.qa/epubcheck/reports/`에 각 JSON·로그와 `summary.json`이 생성된다. GitHub Actions의 `epubcheck-reports` 아티팩트는 성공·실패 모두 14일 보관한다.

| 검증 EPUB | 포함 내용 |
|---|---|
| sample | 앱에 포함된 실제 한국어 예제와 생성 SVG 삽화 |
| korean-prose | 한국어, 특수문자, 제목, 강조, 인용, 목록, 코드, 외부 링크 |
| tables-diagrams | 마크다운 표, 표·흐름·막대·선 도표와 SVG manifest |
| image-cover | 합성 표지, PNG 삽화, 본문 이미지 참조·설명 |
| publication-metadata | 발행처, 저작권자, 날짜, ISBN, 판권 장 |
| empty-book | 장이 없는 책의 최소 구조와 목차 대체 경로 |

직접 생성한 출판 파일도 동일한 검사기로 확인할 수 있다.

```sh
npm run validate:epub -- path/to/book.epub
```

검사는 로컬에서 실행하며 원고를 외부 검사 서버에 전송하지 않는다. 최초 도구 다운로드에는 인터넷이 필요하다. 다운로드 실패·해시 불일치·Java 실행 실패·결과 누락은 모두 검사 실패다.

## 읽기 구조 개선

EPUB에 본문 `main` 영역, 이름이 연결된 `doc-chapter`, 목차, 읽기 순서, 언어 정보가 포함된다. 메타데이터는 실제 제공하는 목차·읽기 순서·구조 탐색·재배치 가능한 본문을 설명한다. 이미지 대체 텍스트가 정확한지 출판 전에 검토해야 한다는 접근성 요약도 포함된다.

한글은 어절을 우선하는 `word-break: keep-all`과 `line-break: strict`를 적용한다. 페이지 분할도 공백 경계를 우선하고, 한 쪽보다 긴 URL 등은 글자군을 보존하며 분할한다. `overflow-wrap: anywhere`는 한 줄보다 긴 무공백 문자열의 넘침을 방지한다. 원고 내용에 강제 줄바꿈을 삽입하지 않는다.

EPUBCheck는 파일 형식 검사이며 리더기 사용성이나 이미지 설명의 의미를 보증하지 않는다. `WCAG` 적합 인증이나 `certifiedBy` 값을 자동 선언하지 않는다. 실제 책마다 화면 읽기, 목차 이동, 확대, 이미지 설명을 검토해야 한다. [W3C EPUB Accessibility 1.1](https://www.w3.org/TR/epub-a11y-11/)

## 전문 조판 연계

출판 패키지의 정적 HTML은 Vivliostyle에 전달할 수 있다. 원고 내용과 로컬 이미지가 내장된 HTML을 입력으로 사용하고, 판형·여백·출력 PDF는 패키지의 구성 파일과 안내에 따른다. 도구 설치 및 렌더링은 사용자 컴퓨터에서 실행되며, 최종 PDF의 글꼴 포함·재단·인쇄소 규격은 별도 확인한다. [Vivliostyle 구성 파일 문서](https://docs.vivliostyle.org/en/cli/using-config-file/)

대표 원고를 Vivliostyle CLI 11.4.0으로 실제 조판해 A5 PDF 14쪽을 확인했다. 한국어·긴 표·그림·코드의 68개 표식과 페이지 경계 검사를 통과했다. 재현 스크립트, 환경 의존성과 남은 Poppler 경고는 [전문 조판 검증 보고서](TYPESETTING-VALIDATION.md)에 기록했다. 이는 모든 원고·인쇄소 규격의 인증을 뜻하지 않는다.
