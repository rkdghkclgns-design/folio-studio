# Folio red-team review · 2026-10-18

Six independent reviewers examined security, persistence/recovery, AI requests and results, Korean editing, EPUB exports, and UI interactions. Confirmed failures were reproduced locally, repaired, and retested. Root integrated and reviewed the changes. This report describes tested behavior, not a guarantee that all defects have been found.

## Repairs and evidence

| Area | Reproduced failure | Repair and regression evidence |
| --- | --- | --- |
| Storage integrity | Damaged workspaces could be replaced with the sample; localStorage work could be ignored after IndexedDB became available. | Failed reads lock writes and preserve original records. Fallback migration commits before removal. Recovery download retains both records when they conflict. |
| Concurrent tabs | A stale tab could replace newer saved manuscripts. | Compare-and-write inside an IndexedDB transaction; Web Locks plus source comparison for fallback storage. A stale writer stops and offers full workspace backup. Tested with two app instances. |
| Unsaved work | A final debounced edit could close without warning; a failed save could still show success. | Dirty state stays active until a successful latest save. Closing warns; Ctrl-S awaits the result. Quota failures preserve disk source and current in-memory work. |
| Import/recovery | Large chapters were silently truncated and audience/editorial notes/image prompts were dropped. | Explicit rejection instead of truncation, preservation of supported metadata, whole-library backups and history restoration under new IDs. JSON limit is 128MiB; oversized downloads clearly state the import limit. |
| Async images | Delayed images could land on another book or chapter; older uploads could overwrite newer choices. | Capture the original objects, reject deleted/restored targets, and compare per-target upload tokens. Unrelated upload completion preserves active typing and cursor. |
| Privacy and input handling | Imported external images could initiate tracking requests; old saved remote images could still be fetched during export. | Preview, import, AI image responses, and export share embedded-image validation. External image references are rejected without fetching. HTML and unsupported Markdown schemes stay inert. |
| Export robustness | Malformed SVG numeric values and long unmatched Markdown links could block processing. Raster signatures alone accepted damaged files. | Bounded linear parsing, PNG chunk/CRC checks, JPEG/WebP structure and dimension checks, SVG reconstruction/ID checks. 12MiB and 50M pixels per image; 128MiB aggregate output image budget. |
| Editorial precision | A suggested change could modify an earlier quotation or code occurrence; ambiguous words were changed automatically. | Exact original offsets with stale-source checks. Quoted, technical and link spans are preserved. Ambiguous 금새/웬지 are review suggestions. C#/F# titles and code fences survive splitting and export. |
| AI request safety | Oversized responses were checked only after allocation; malformed model metadata could count as a connection. | Stream-time byte limits and cancellation, exact model metadata checks, fixed provider endpoints, keys kept only in tab memory. |
| AI source preservation | Excessively shortened rewrites could replace the original, and numeric/quotation comparison notes were hidden. | For source >=500 characters, results outside 60–200% length are rejected. Rewrites accept <=12,000 characters with adjusted output budget. Numeric/quotation changes appear beside the manuscript and in review. Full-book runs preflight length before requesting work. |
| AI cancellation and failures | Cancellation during final storage could report ordinary success. | Abort recheck after the final save. Failure keeps generated work in memory, disk source intact, and recovery controls visible. |
| Interaction | Modal rerenders lost focus; pending AI work accepted background edits; language label was fixed to Korean. | Inert dialog background plus input guards, duplicate-request guard, focus restoration after rendering, language-aware footer, selection semantics and visible editor focus. |

## Verification

- `npm test`: **171 tests passed**, 0 failed. Includes existing tests and five new regression files.
- UI scenarios run in happy-dom; persistence scenarios use fake-indexeddb and multiple real app module instances. These are not browser rendering tests.
- Provider tests use synthetic responses only. No real Google or OpenAI credential or paid generation was used.
- Official EPUBCheck **5.2.1**: a sample book with SVG artwork and a PNG-cover book with Unicode, code fences and an empty chapter both passed with **0 fatal errors, 0 errors, 0 warnings**.
- Export tests also verify ZIP CRC/XML, 1,000 chapters with matching navigation/manifest/spine, and rejection of malformed image data.
- `git diff --check` passed.

## Verification limits

Actual model writing quality, factual accuracy, live model entitlement, browser print/PDF rendering, reader appearance, WebP canvas conversion, and native file-picker/storage behavior were not exercised. Numeric/quotation comparison is a review aid and cannot establish factual correctness or detect all meaning changes. Image checks inspect structure; they are not a complete pixel decoder.

IndexedDB comparison is atomic. If fallback storage is used in a browser without Web Locks, its synchronous source comparison is best effort across separate browser processes. Backups remain necessary. The raw storage recovery envelope preserves damaged/conflicting originals for inspection; it is not the ordinary reimportable workspace format.

The site remains owner-private. API keys, private manuscripts, credentials and runtime storage are excluded from deployment source.

## Source-driven production follow-up

Four parallel workstreams covered the generation engine, Google/OpenAI adapter, UI/tutorial, and independent UI integration. Cross-module review found and repaired a missing chapter identifier, stale target-length labels, an unconnected progress button, and artwork-resume visibility. Final suite: **252 tests passed, 0 failed**.

- Raw Markdown remains separate from generated text. Upload checks preserve UTF-8 BOM, CRLF, indentation and leading newlines; stale reads, invalid UTF-8 and oversized files cannot replace accepted input. The original upload string is retained outside textarea/FormData normalization until the user edits it.
- Source analysis, planning and small-section writing are saved individually. Cancellation, reload, quota failure and retry scenarios preserve completed text and avoid repeated completed requests.
- Target allocations up to 300,000 non-whitespace Unicode characters are tested. Each out-of-range section receives one automatic revision; unresolved lengths remain visible as `needs_review`, and an explicit retry revises only flagged sections.
- Stored source, instructions and progress survive project backup/import under new chapter IDs. Manual manuscript changes prevent automatic overwriting. Failed image work resumes independently of finished text.
- The form, summary, estimated page conversion, provider connection handoff and tutorial preserve existing workflows. All production text is escaped before rendering.

New evidence is in `production-tests.mjs` (21), `production-ai-tests.mjs` (12), `production-ui-tests.mjs` (8), and `production-integration-tests.mjs` (19). These use synthetic provider responses and happy-dom. No live paid generation or native browser rendering was performed; page counts remain estimates and the writing prompts do not establish factual or literary quality.

## Cover and background follow-up

Title/content-based cover generation now plans a visual brief from bounded, balanced manuscript excerpts before requesting an image. Independent AI, export and UI review covered this path and custom backgrounds. Final suite: **289 tests passed, 0 failed**.

- Shared validated cover settings restrict source, image fit, focal position, shade strength, text color and title placement. Imported remote/active image sources remain rejected without fetching.
- User backgrounds remain separate from cover artwork. Upload order, a newer source choice, reset/removal, deleted books and active-book changes are checked before applying asynchronous results.
- Manual cover regeneration preserves the custom background; automatic book generation preserves its selected source. Cancelled or failed briefing leaves prior images intact.
- Backup/import and history retain both images and settings. An independently identified no-image title-layout export mismatch was repaired and tested.
- New tests: `cover-ai-tests.mjs` (10), `cover-export-tests.mjs` (13), `cover-integration-tests.mjs` (14). Provider tests use mocked Google/OpenAI responses; UI tests use happy-dom.
- Official EPUBCheck 5.2.1: custom PNG background, safe SVG artwork and text-only cover samples each passed with **0 errors and 0 warnings**. New composed EPUB cover images include title, subtitle and author.

Actual generated artwork and native browser rendering were not evaluated with a paid API or browser session. The content samples guide generation; they do not guarantee semantic accuracy or aesthetic quality.

## 300-chapter writing and API-test follow-up

Parallel engine, provider-adapter and independent UI review covered manual settings through 300 chapters. Final suite: **321 tests passed, 0 failed**. `git diff --check` passed.

- Manual chapter counts accept 2–300; automatic allocation keeps the existing 40-chapter cap for saved-book compatibility. Each chapter needs at least 500 characters. The form explains the 150,000-character / 188-estimated-page minimum for 300 chapters and changes the target only through an explicit button.
- Books over 40 chapters plan 20 outlines per request, save each batch and resume at the first missing batch. Batch count, IDs, Unicode-normalized title collisions, source references and backup integrity are checked. A checkpoint saved after the final batch can resume without another planning request.
- A complete 300-chapter, 150,000-character run passed with synthetic responses: one source digest, 15 outline batches and 300 section requests. Backup/import and reload preserved every chapter and the original source. Interrupted batches resumed after import.
- Long-book section requests include all chapter titles plus at most five nearby detailed outlines. Earlier books retain their existing ID and title rules, including repeated titles, so the new validation does not block legacy writing/revision.
- Settings now offers one explicit short text-generation test. Provider tests cover Google and OpenAI; DOM tests cover success, failure, cancellation, duplicate actions, pending validation and provider changes. It sends no manuscript and does not mutate the book or persist the key. Results escape provider text and show the actual selected model.
- New evidence: `chapters-engine-tests.mjs` (8), `chapters-ai-tests.mjs` (14), `chapters-integration-tests.mjs` (10). The UI suite uses happy-dom, and all provider responses are mocked.

The user's entered key exists only in their browser tab, which this session could not access through a Browser tool. No live generation, paid API entitlement, native browser rendering or 300-chapter literary quality was verified. The in-app generation test allows the user to check a short real request; it does not claim to test image access or an entire book.

## Recursive Markdown folder follow-up

Parallel file-reader implementation and independent DOM review covered folder selection, source preservation and production handoff. Final suite: **348 tests passed, 0 failed**. `git diff --check` passed.

- Directory selection uses the browser's recursive `webkitdirectory` FileList. All `.md` / `.markdown` descendants are collected, with a multiple-file fallback for browsers without directory support. Other formats are never opened and their excluded count is displayed.
- Full relative paths distinguish identical basenames. Stable numeric path sorting, escaped Markdown boundaries and exact BOM/CRLF/body preservation produce one raw-source document. A saved manifest retains each path, character count, byte count and body offsets.
- Aggregate limits are 500 Markdown files, 1 MiB and 120,000 UTF-16 characters including boundaries. Invalid paths, duplicate paths, malformed UTF-8, binary NULs, inconsistent reads, empty collections and overflow fail atomically without changing prior source. Declared sizes are snapshotted before reading.
- Cancellation, later selection, direct editing and closing the form prevent stale reads from replacing accepted content. Submission waits until reading finishes. Direct edits and single-file replacement clear the previous collection manifest.
- Saved manifests are validated against canonical boundaries, ordered paths, exact body ranges and UTF-8 sizes. Conditions, backup/import, reload and raw-MD download preserve the collection. The optional manifest field is omitted from legacy briefs so their fingerprints remain compatible.
- New evidence: `folder-source-tests.mjs` (14) and `folder-integration-tests.mjs` (13). Tests include unsafe filenames/HTML, tampered backups and explicit mocked production receiving nested source content. Importing a folder itself makes no API request.

The native OS directory chooser and browser layout were not directly exercised because no Browser tool was available. DOM tests use simulated FileLists in happy-dom. A folder is read at selection time; no background directory access or automatic synchronization is claimed.

## Image sources inside folders

Parallel reader, production-engine, provider-adapter and independent UI review extended recursive folder input to original PNG/JPEG/WebP references. Final suite: **402 tests passed, 0 failed**. Syntax checks and `git diff --check` passed.

- Mixed and image-only folders work without discarding nested originals. Image bounds are 50 files, 8 MiB each and 32 MiB in total. Extension, MIME, byte length, raster structure, pixel limit, duplicate paths and unsafe paths are checked. Remote URLs, SVG and mismatched/corrupt images cannot enter saved source data. Other unsupported extensions are counted as excluded files.
- Selection is local and atomic. The UI shows thumbnails and paths, allows individual/all-image removal and preserves image references when only Markdown is edited or replaced. A new folder/multiple-file selection replaces both sets. Original images and analysis records survive JSON backup/import and reload.
- Explicit production sends each image once to the selected writing model: Google inlineData or OpenAI image_url content parts. No image-generation endpoint is used for source analysis. Each completed digest is saved, and cancellation or later failure resumes at the first unfinished source.
- Image digests distinguish observations from uncertain/unreadable content and cannot contain supposedly verified direct quotations. Planning and writing receive bounded text digests and sanitized source ID/path mappings; original image data is excluded from those requests. Embedded instructions in pictures are treated as source material, not commands.
- Optional source-image fields leave legacy book fingerprints unchanged. Image records, digest bounds, source IDs, citations and raw-image ownership are validated on backup/import and resume. Malicious paths and provider text stay escaped in the UI.
- Initial performance review found repeated decoding/hashing of large immutable image strings. Object-scoped WeakMap caches now compare every relevant primitive before reuse, and compact content fingerprints still detect valid-image replacement and array order changes. Independent adversarial review found no bypass through original objects, returned objects, cached clones or JSON restoration. In a Node benchmark, 10 progress reads for a 1 MiB PNG fell from 944 ms to 2.3 ms; a roughly 31 MiB collection also took 2.3 ms after initial validation. These are engine measurements, not browser rendering or storage timings.
- New regression evidence: `image-source-files-tests.mjs` (15), `image-source-engine-tests.mjs` (16), `image-source-ai-tests.mjs` (9), `image-source-integration-tests.mjs` (14). Existing ignored-PNG fixtures now use PDF because PNG is supported source material. Image-only forms rely on source-aware validation when saving instead of requiring a topic.

Provider requests were mocked; no live paid image understanding or OCR accuracy was evaluated. The native folder picker and browser rendering were not directly exercised because no Browser tool was available. Images add storage volume; existing quota failure handling and JSON backup-size guidance still apply. Source images support writing analysis and are retained in JSON backups; the raw Markdown download contains text only.

## Contextual diagrams in manuscripts

Final suite: **484 tests passed, 0 failed**. Syntax checks and `git diff --check` passed.

Parallel core, AI-adapter, production-engine, export and independent UI review added contextual tables, flow diagrams and numeric bar/line charts. Generation remains inside existing writing/revision requests; the explicit **도표 보강** action uses one text request. The automatic mode can be disabled independently of illustrations.

- Only bounded, schema-validated data is rendered. Authored strings are escaped; charts use fixed SVG primitives without external images, scripts or generated markup. Real top-level `folio-diagram` fences are distinguished from code examples. Invalid manual blocks remain visible with their original data and a notice.
- Numeric data requires an exact quote from an independent input containing its own category and associated amount/unit. Diagrams and newly generated prose cannot establish their own evidence. Production backup validation uses durable raw Markdown, source digests, topic and instructions; the AI adapter uses the supplied source excerpt and digests. Quotes cannot span two joined inputs. Image-analysis digests remain observations, not verified OCR or facts.
- Red-team follow-ups tightened cross-category swaps, numbers embedded in labels, wrong magnitude/unit tokens and mixed-metric quotes. Revision equality uses semantic fields so reordered JSON keys neither remove valid diagrams nor bypass duplicate checks. Production revisions cannot silently change or remove an existing diagram.
- A section can contain one diagram and a chapter at most twelve. Writing targets and editor counts use visible diagram text rather than JSON syntax or repeated evidence. Chart axes include zero; signed/zero values, accessible full data tables, short-axis labeling and source quotations are retained.
- Manual insertion checks a unique original paragraph and unchanged manuscript before creating a checkpoint. No-op, invalid result and cancellation preserve the original. Inline data survives local saves, JSON backup/import, Markdown export and basic copyediting. The same Markdown renderer and styles serve reading mode, preview and output.
- New regression suites: `diagram-core-tests.mjs`, `diagram-ai-tests.mjs`, `diagram-engine-tests.mjs`, `diagram-export-tests.mjs`, `diagram-integration-tests.mjs`. Official EPUBCheck 5.2.1 accepted a book containing all four diagram types with **0 errors and 0 warnings**; actual SVG chapters carry the required manifest property.

Provider requests use mocked responses, and UI tests use happy-dom. No live Google/OpenAI call, native browser layout, PDF print dialog or visual EPUB-reader behavior was tested in this session. Source matching cannot establish factual accuracy, and qualitative table/flow meaning still needs editorial review. No Browser tool was available.


## Google HTTP 400 during book planning

Final suite: **507 tests passed, 0 failed**. Syntax checks and `git diff --check` passed.

The reported screen showed one planning failure repeated by progress, failure-save and dialog handlers. Investigation identified two actual REST contract errors: `responseFormat.text.mimeType` sent the MIME string `application/json` instead of enum `APPLICATION_JSON`; `responseFormat.image.aspectRatio` sent `2:3` instead of enum `ASPECT_RATIO_TWO_BY_THREE`.

- Checked the official [REST reference](https://ai.google.dev/api/generate-content#TextResponseFormat) and [v1beta discovery](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta). A public synthetic request without an API key reproduced HTTP 400 / INVALID_ARGUMENT at each old field. Replacing only its enum advanced the response to HTTP 403 for missing identity, confirming that the corrected payload passes wire parsing. No user manuscript, user API key or paid generation was used. Some task-guide examples conflict with these definitions; the actual parser agrees with the REST enum contract.
- The current default model `gemini-3.8-flash` and its 65,536-token output limit were confirmed in the official model reference. Default output budgets and the shallow planning schema were not the cause. No blind retry, model switch or schema removal was added.
- Added a small retained discovery fixture and independent contract tests for the text-generation test, a 40-chapter plan and image generation. Existing mocks had asserted the incorrect values and therefore failed to detect this defect in the prior 484-test suite.
- Google HTTP 400 diagnostics now read at most 64 KiB for at most 1.5 seconds. Recognized causes map only to locally authored messages and fixed reason codes. Raw provider messages, metadata, keys and URLs never enter exceptions, UI or stored production records. Malformed, oversized and stalled bodies fall back to the original HTTP error; user cancellation remains cancellable. Other Google errors and OpenAI errors still cancel unread bodies.
- Production logs collapse consecutive duplicates. Failure has one clear notice, a stopped title, API settings and saved-production recovery actions. Reconnection returns to the same book; generation resumes only after an explicit start. Mid-book completed content and settings remain intact.

New suites: `google-contract-tests.mjs`, `google-error-tests.mjs`, `google-progress-tests.mjs`. Authenticated generation with the user's key and native browser rendering remain untested; API parser checks, mocked provider responses and happy-dom integration cover the changes.

## Independent adversarial audit — 2026-10-18

Six independent reviewers covered API contracts, production recovery, storage, recursive sources, export/diagrams and UI state. The coordinating reviewer additionally checked editorial preservation and long Markdown import. Findings below were reproduced before the corresponding fixes; they are medium-severity correctness or validation defects, not evidence of remote code execution.

| Area | Reproduced failure and repair |
| --- | --- |
| Google model limits | Connection validation accepted a custom model with an 8,192-token output limit, while subsequent requests demanded at least 16,384. Requests now respect validated model metadata. Key/model/provider changes clear the limit; stale connection responses cannot overwrite it. |
| Storage migration | A failed legacy localStorage cleanup after an IndexedDB commit was reported as success and caused a conflict after reload. Cleanup failure now remains visible and retryable. A concurrent fallback edit is captured in the recovery export instead of retaining only its obsolete initial value. |
| Production resume | Explicit correction of a failed mixed-state project could mark unwritten sections complete. Finalization now keeps unfinished projects paused and resumable. This path is available through the engine API; the current UI does not directly offer it for failed projects. |
| Cancellation | Stopping after the draft checkpoint or during the correction-marker save consumed a correction attempt before any API call. Preflight cancellation now retains that attempt. Once the API is invoked, the marker remains consumed to avoid duplicate automatic paid retries after a lost response. |
| Editor consistency | Saving production conditions under storage failure changed the selected project without refreshing the editor underneath the modal. Closing the modal could edit a different book from the one displayed. The visible editor now follows the retained in-memory draft, with the save failure still shown. |
| Diagram parsing | CR-only lines and hidden XML control characters made a diagram invisible to strict validation but visible to export rendering. Fence recognition now matches renderer cleanup while preserving raw source offsets. Google/OpenAI adapters and production tests confirm that grounding and disabled-diagram checks cannot be bypassed by these inputs. |
| Numeric evidence | Typographic minus signs could support a positive value; compound units such as m² or 원/인 could support a truncated unit. Numeric matching now preserves the sign and rejects truncated compound units. This remains source matching, not a factual or semantic verifier. |
| Raster structure | Animated WebP frames could claim dimensions beyond the canvas or omit real pixel chunks; header-only still-image chunks and indexed PNGs without valid palettes also passed. Validation now checks frame bounds, nested pixel dimensions, required pixel bytes, palettes and consecutive PNG image data. Valid independently encoded animated WebP remains accepted. |
| Protected text | Copyediting could alter literal examples in CR-only fenced code. All three line-ending styles and unclosed fences retain their source ranges and literal text. |
| Long Markdown | The old 50-chapter import cap merged chapters 51 onward into chapter 50. Import now supports up to the existing 1,000-chapter project validation limit. A 300-chapter manuscript preserves every title/body, including after Markdown export; exceeding the cap retains the remaining text in the last chapter. Markdown import is not a full metadata/production round trip. |

New regression files: `audit-api-tests.mjs` (10), `audit-engine-tests.mjs` (4), `audit-storage-tests.mjs` (3), `audit-source-tests.mjs` (2), `audit-export-tests.mjs` (11), `audit-ux-tests.mjs` (3), `audit-editorial-tests.mjs` (4). The existing chapter-cap test now exercises the 1,000-chapter boundary. Source regressions also cover atomic mixed-folder rejection and revalidation after mutation of a cached image object.

Final aggregate: **544 tests passed, 0 failed, 0 skipped** (37 new tests). Runtime syntax checks and `git diff --check` passed. EPUBCheck 5.2.1 validated the generated audit book against EPUB 3.3 with **0 fatal errors, errors or warnings**. Offline HTML export made no network requests in the regression test.

All provider responses in this audit were mocked. Model metadata was checked against Google's public contract; no user API key or paid request was used. UI/storage integration uses happy-dom and fake-indexeddb. Native browser/mobile layout, browser decoding/memory pressure, OS file selection, printing, live generation quality and EPUB-reader appearance were not directly tested. Raster checks validate bounded structure rather than fully decoding each compressed image. No Browser tool was available. The existing owner-private site audience is preserved for publication.

## Computer-assisted examples and captured evidence

Implemented a Windows companion and an explicit **컴퓨터로 예제 만들기** workflow. A visitor can select an open application window, specify an example for the current chapter, delegate bounded screen-based actions to their configured Google/OpenAI model, retain captures with descriptions, and insert selected evidence into the manuscript. MapleStory Worlds is a task preset, not a hard-coded integration or a claim that its editor was exercised here.

- The companion listens only on `127.0.0.1:8765`. Every data/action request requires the exact hosted Site Origin, loopback Host and a random per-process 256-bit pairing secret. Anonymous OPTIONS permits only the required exact-origin preflight. Bodies, action types, keys, coordinates, frame age and response sizes are bounded. The token remains in tab memory and never enters the project, provider request, log or packaged source.
- Selection binds one window. Captures use its client surface through PrintWindow in a bounded worker, not a desktop screenshot. Observation never steals focus. Actions require the same foreground window, process identity, bounds, session and single-use frame within 120 seconds. Occluded target points and physically held modifier keys are rejected. The explicit selection flow handles Windows foreground restrictions without granting background input to another window.
- F8 and the stop endpoint revoke the active generation. Native input emission and stop acknowledgement share a lease lock. Absolute pointer movement and its click/wheel event use one native input batch so an intervening pointer movement cannot redirect a click. Text uses Unicode input, including surrogate pairs, without clipboard access; partial input failures release only the helper's pressed keys. An operating system focus change cannot be made fully atomic with another process's input; this is documented, and native operation remains unverified here.
- The UI explicitly states that selected-window screenshots go to the connected AI provider and that each decision incurs provider usage. The model receives one current image, a bounded chapter excerpt and at most 20 recent steps. Window/frame/session IDs and unrelated project fields are excluded. Visible instructions are untrusted data. The prompt delegates login, payment, publication, deletion, permission dialogs and shell execution to the user. Semantic action intent is model-guided; the native helper enforces the narrower structural action/window boundary, not perfect recognition of every application's buttons.
- The runner makes one decision and one action at a time, never automatically repeats a failed request, caps a run at 50 steps (UI choices 10/20/40), and stops on cancellation, uncertainty, storage failure or the configured step limit. Captures use the actual observed image and observation timestamp. Completed captures must save before the next action. Manual capture preserves the image if AI description fails. PNG upload works without an AI connection or native helper.
- Durable evidence is limited to 20 records and 32 MiB per book, with 8 MiB/PNG bounds and strict metadata validation. Caption edits are marked unsaved, protected on page exit and staged into project memory when the dialog closes. Storage failures retain the in-memory capture for recovery. Backups, import and reload retain research records and chapter figures; connection/session credentials are excluded.
- Inline `folio-asset` references resolve only to validated chapter figures, with at most 20 figures per chapter. Plain metadata is escaped, remote paths and SVG are rejected for these figures, code examples stay literal and missing references show a notice. Assets join the existing 128 MiB export budget/cache. Reading mode, preview, EPUB, HTML and PDF print output preserve placement. Markdown carries references/text; JSON carries the actual image bytes. AI rewrite/draft responses cannot drop, duplicate, change or hide an existing displayed image reference in a code block or paragraph.
- Independent cross-review fixed stop/input and pointer races, scroll direction and pane targeting, inconsistent record IDs, stop-during-save insertion, a wrong launcher filename, unsaved caption loss and unconstrained reading-mode image size. The companion ZIP contains only five explicit runtime/help files and is checked against the source with CRLF normalization for the Windows launcher.

New Node suites: `computer-core-tests.mjs` (21), `computer-ai-tests.mjs` (11), `computer-ui-tests.mjs` (12), `computer-book-tests.mjs` (3), `computer-export-tests.mjs` (9), `computer-integration-tests.mjs` (3). Full Node suite: **603 passed, 0 failed, 0 skipped**. Companion policy, concurrency and native API stub tests: **35 passed**, including a bounded eight-second manual-focus fallback that stays cancellable without holding the stop lock. Run them separately with `python3 -m unittest discover -s companion -p 'test_*.py'`. The final focus instruction change also passed all 15 workshop UI/integration tests. Runtime JavaScript/Python syntax and diff checks passed. EPUBCheck 5.2.1 accepted a generated book with inline captures and a missing-reference notice with **0 errors or warnings**.

This environment has no connected desktop-control or Browser tool. No actual Windows window, MapleStory Worlds editor, live vision API, local-network browser permission prompt, native PDF printing or EPUB-reader appearance was tested. Python tests use a fake desktop and Win32 API stubs; browser integration uses happy-dom. PrintWindow can fail on hardware-accelerated applications, in which case the UI preserves the error and offers direct PNG upload. The Windows helper must be run by the user on the same PC as the browser. The hosted Site's owner-only audience remains unchanged.
