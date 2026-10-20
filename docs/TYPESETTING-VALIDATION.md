# 전문 PDF 조판 실행 검증

검증일: 2026-10-20 (한국 시간). 출판 준비 ZIP의 `print.html`과 `vivliostyle.config.json`을 **Vivliostyle CLI 11.4.0으로 실제 컴파일**했다. 사용자의 원고 대신 재현 가능한 합성 원고를 사용했다.

## 확인 결과

| 항목 | 결과 |
| --- | --- |
| 조판 엔진 | Vivliostyle CLI 11.4.0 / Core 2.45.2 |
| 실행 환경 | Windows, Node 24.11.1, Chrome 155.0.8059.80 |
| PDF 판형 | 모든 14쪽 A5, 약 419.527 × 595.276pt (148 × 210mm) |
| 한국어 본문 | 14개 문단의 표식 각각 1회, 추출 가능한 한글 유지 |
| 여러 쪽 표 | 48개 행의 표식 각각 1회, 이어지는 쪽의 표 머리글 반복 확인 |
| 이미지 | 800 × 360px 원본 그림 1개 PDF에 포함, 캡션 확인 |
| 긴 코드 | 줄바꿈과 마지막 `CODE-END` 유지 |
| 누락·중복 | 문단·표·그림 전후·장 끝·책 끝의 총 68개 표식 모두 정확히 1회 |
| 페이지 밖 문자 | pdfplumber 좌표 검사 0건 |
| 시각 검토 | 14쪽 렌더링 확인. 표지의 `검/증` 분절을 발견해 어절 단위 줄바꿈으로 수정한 뒤 다시 컴파일·검사 |
| 마지막 PDF SHA-256 | `38ff537c94e227fff1b18fc32372dd37b5fd9b0aac37bedb0a741b5d2303b378` |

해시는 이 검증 실행의 증거 식별자이다. PDF의 생성 시각, 폰트, 브라우저가 달라지면 해시와 쪽수는 달라질 수 있다. PDF 검사에는 pypdf 6.10.0과 pdfplumber 0.11.9를 사용했다.

## 재현 방법

필수 조건:

- Node.js 22.12.0 이상 및 npm
- Python 3.10 이상, `pypdf`와 `pdfplumber`
- 한국어를 표시할 수 있고 사용 권한이 있는 시스템 글꼴
- PNG 시각 검토를 하려면 Poppler의 `pdftoppm`

검사 라이브러리를 설치해야 하는 환경에서는 별도의 Python 가상환경을 사용한다.

```sh
python -m pip install pypdf==6.10.0 pdfplumber==0.11.9
```

저장소 루트에서 실행:

```sh
node scripts/validate-typesetting.mjs --python python --pdftoppm pdftoppm
```

이 명령은 고정된 `@vivliostyle/cli@11.4.0`을 공식 npm 레지스트리에서 실행한다. 첫 실행은 npm 패키지와 공식 렌더링 브라우저를 다운로드할 수 있다. 앱 원고, 설정, 루트 `package.json`과 잠금 파일은 변경하지 않는다. 기본 `npm test`는 이 명령을 실행하지 않으며 브라우저를 다운로드하지 않는다.

이번 Windows 환경에서는 자동 다운로드 브라우저 실행이 `spawn UNKNOWN`으로 실패했다. 설치된 Chrome을 명시하면 정상 완료했다. 같은 상황에서는 실제 실행 파일 경로를 사용한다.

```sh
node scripts/validate-typesetting.mjs --browser "C:/Program Files/Google/Chrome/Application/chrome.exe" --python python --pdftoppm pdftoppm
```

Python이나 Poppler가 PATH에 없으면 각 옵션에 실행 파일의 절대 경로를 지정한다. 스크립트가 `npm-cli.js`를 찾지 못하면 `--npm-cli /path/to/npm/bin/npm-cli.js`를 추가한다. 출력 폴더는 `--output typesetting-another-run`처럼 지정할 수 있으며 `.qa/` 안의 하위 폴더만 허용한다.

## 생성물과 판정

기본 출력은 `.qa/typesetting-validation/`이다. 같은 출력 폴더로 다시 실행하면 검증용 파일을 갱신한다.

- `fixture.json`: 합성 검증 원고. 한국어 문단, 48행 표, 자체 생성 PNG, 긴 코드 포함
- 출판 준비 패키지의 파일들: `print.html`, `vivliostyle.config.json`, EPUB·HTML·안내문 등
- `book-print.pdf`: 실제 컴파일한 A5 PDF
- `summary.json`: 판형, 표식 수, 한글, 이미지, 문자 좌표, PDF 해시와 실행 정보
- `version.log`, `build.log`, `inspect.log`, `render.log`: 실행 근거와 경고
- `page-01.png` 등: `--pdftoppm`을 지정한 경우 모든 쪽의 100dpi 렌더

컴파일 실패 또는 판형·문자·그림 검사 실패 시 스크립트는 0이 아닌 종료 코드를 반환한다. 검사는 표식 누락뿐 아니라 표식 중복과 물리적 페이지 밖의 문자도 차단한다. `summary.json`의 `visualReview`는 자동으로 검토 완료를 주장하지 않는다. PNG를 열어 별도로 확인한다.

빠른 회귀 테스트:

```sh
node --test typesetting-tests.mjs
```

이 테스트는 합성 원고와 유효한 PNG, 출판 패키지 설정, 고정 버전·오류 복구 안내, 판정기의 실패 조건을 검사한다. 실제 PDF 컴파일은 위의 별도 명령으로 수행한다.

## 확인한 제한

- 이 검증은 대표 합성 원고에 대한 실행 확인이다. 모든 사용자 원고, 복잡한 수식·각주·다단 편집을 인증하지 않는다.
- 일반 RGB PDF를 생성한다. PDF/X, PDF/UA, CMYK 인쇄 승인, EPUBCheck 인증 또는 유통사 심사 통과를 의미하지 않는다.
- 시스템 글꼴과 브라우저에 따라 줄바꿈·쪽수·글리프 모양이 달라진다. 제출할 최종 환경에서 다시 확인해야 한다.
- HTML의 책 넘김 효과는 PDF에 포함되지 않는다.
- 이번 Poppler 실행에는 한글 사용자 경로의 일부 비한국어 문자 매핑 파일 로드 경고와 Type 3 글리프 경계 경고가 남았다. 로그를 보존했으며 14쪽 이미지와 좌표·본문 검사에서 누락·잘림은 발견하지 않았다. 따라서 “모든 렌더러에서 경고 0건”으로 보고하지 않는다.
- 배포 CI의 기본 게이트는 일반 테스트와 EPUBCheck이다. 별도 PDF 검증 명령에는 렌더링 브라우저·한국어 폰트·Python·Poppler가 필요하다.

공식 근거: [Vivliostyle 설정 파일](https://docs.vivliostyle.org/en/cli/using-config-file/), [Vivliostyle CLI 저장소](https://github.com/vivliostyle/vivliostyle-cli).
