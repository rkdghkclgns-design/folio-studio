/**
 * Dependency-free reader shared by the editor and standalone HTML books.
 * sections[].html MUST be produced by Folio's safe Markdown/export renderer.
 * mountBookPreview(host, {title, sections, page?, onPageChange?}) returns
 * {next, prev, goTo, goToSection, refresh, destroy, getState, ready}.
 * Page indices are zero-based; getState().pageNumber is human-facing.
 * The CSS string is also checked in as book-preview.css for the application.
 */
export const BOOK_PREVIEW_CSS = `
.folio-book-reader{--book-paper:#fffef9;--book-ink:#29382e;--book-edge:#d9d4c7;position:relative;width:100%;color:var(--book-ink);font-family:'Pretendard','Malgun Gothic',sans-serif;outline:none}
.folio-book-reader *{box-sizing:border-box}
.folio-book-reader:focus-visible{outline:2px solid #476052;outline-offset:5px;border-radius:6px}
.folio-book-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 14px;font-size:12px}
.folio-book-toolbar label{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
.folio-book-toolbar select{border:1px solid #d8dfd2;background:#fffef9;border-radius:6px;padding:7px 9px;color:inherit;font:inherit;max-width:310px;min-width:80px;width:100%;text-overflow:ellipsis}
.folio-book-hint{font-size:11px;color:#657160;line-height:1.7;margin:10px 0 0;text-align:center}
.folio-book-stage{display:flex;justify-content:center;align-items:stretch;position:relative;perspective:1800px;isolation:isolate;padding:16px 0 20px;gap:1px;touch-action:pan-y;min-height:180px}
:is(.folio-book-page,.folio-book-turn-page){position:relative;flex:none;width:var(--book-page-width,360px);height:var(--book-page-height,510px);padding:26px 28px 22px;background:var(--book-paper);color:var(--book-ink);box-shadow:0 6px 18px #24302715,3px 3px 0 var(--book-edge),5px 5px 0 #eeeadd,7px 7px 0 var(--book-edge);border:1px solid #e2dfd3;display:flex;flex-direction:column;text-align:left;overflow:hidden;font:15px/1.85 'Noto Serif KR','Nanum Myeongjo','Batang',Georgia,serif;word-break:keep-all;overflow-wrap:anywhere}
:is(.folio-book-page,.folio-book-turn-page).is-left{background:linear-gradient(90deg,var(--book-paper) 92%,#ece9df)}
:is(.folio-book-page,.folio-book-turn-page).is-right{background:linear-gradient(90deg,#e9e6dd,var(--book-paper) 9%)}
:is(.folio-book-page-header,.folio-book-turn-page-header){font:10px/1.6 'Pretendard','Malgun Gothic',sans-serif;letter-spacing:.08em;color:#7b806f;padding-bottom:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:none}
:is(.folio-book-page-body,.folio-book-turn-page-body){flex:1;min-height:0;overflow:hidden;display:flow-root;word-break:keep-all;overflow-wrap:anywhere;line-break:strict}
:is(.folio-book-page-body,.folio-book-turn-page-body)>:first-child{margin-top:0}
:is(.folio-book-page-body,.folio-book-turn-page-body) h1,:is(.folio-book-page-body,.folio-book-turn-page-body) h2,:is(.folio-book-page-body,.folio-book-turn-page-body) h3,:is(.folio-book-page-body,.folio-book-turn-page-body) h4,:is(.folio-book-page-body,.folio-book-turn-page-body) h5,:is(.folio-book-page-body,.folio-book-turn-page-body) h6{font-family:inherit;font-weight:600;line-height:1.5;letter-spacing:-.025em;break-after:avoid;page-break-after:avoid}
:is(.folio-book-page-body,.folio-book-turn-page-body) h1{font-size:1.8em;margin:0 0 1.2em}:is(.folio-book-page-body,.folio-book-turn-page-body) h2{font-size:1.4em;margin:1.6em 0 .7em}:is(.folio-book-page-body,.folio-book-turn-page-body) h3{font-size:1.15em;margin:1.4em 0 .6em}
:is(.folio-book-page-body,.folio-book-turn-page-body) p{margin:0 0 1em;line-height:inherit}:is(.folio-book-page-body,.folio-book-turn-page-body) ul,:is(.folio-book-page-body,.folio-book-turn-page-body) ol{padding-left:1.4em;margin:0 0 1em}:is(.folio-book-page-body,.folio-book-turn-page-body) li{margin:.3em 0}
:is(.folio-book-page-body,.folio-book-turn-page-body) a{color:inherit;text-decoration:underline;text-underline-offset:.15em}:is(.folio-book-page-body,.folio-book-turn-page-body) blockquote{margin:1em 0;padding:.2em 0 .2em 1em;border-left:2px solid #a4b29a;color:#586353}
:is(.folio-book-page-body,.folio-book-turn-page-body) pre{white-space:pre-wrap;font-size:.8em;line-height:1.6;background:#f2f3ee;padding:1em;margin:1em 0;overflow-wrap:anywhere}:is(.folio-book-page-body,.folio-book-turn-page-body) code{font-family:monospace;font-size:.9em}
:is(.folio-book-page-body,.folio-book-turn-page-body) hr{border:0;border-top:1px solid #d9dfd5;width:30%;margin:1.8em auto}:is(.folio-book-page-body,.folio-book-turn-page-body) figure{margin:1em 0}:is(.folio-book-page-body,.folio-book-turn-page-body) figure img{display:block;max-width:100%;width:100%;height:auto;max-height:280px;object-fit:contain}:is(.folio-book-page-body,.folio-book-turn-page-body) figcaption{font:11px/1.6 'Malgun Gothic',sans-serif;text-align:center;color:#687263;margin-top:.6em}
:is(.folio-book-page-body,.folio-book-turn-page-body) .chapter-number{font:10px/1.6 'Malgun Gothic',sans-serif;letter-spacing:.15em;color:#76836b}:is(.folio-book-page-body,.folio-book-turn-page-body) .book-subtitle{font-size:1em;color:#63715d}:is(.folio-book-page-body,.folio-book-turn-page-body) .book-author{font-size:.85em}
:is(.folio-book-page-body,.folio-book-turn-page-body).toc{padding:0}
:is(.folio-book-page-body,.folio-book-turn-page-body).toc ol{padding:0;list-style:none}:is(.folio-book-page-body,.folio-book-turn-page-body).toc li{padding:.65em 0;border-bottom:1px solid #e3e6da}:is(.folio-book-page-body,.folio-book-turn-page-body).toc a{text-decoration:none}
:is(.folio-book-page-footer,.folio-book-turn-page-footer){font:10px/1.5 'Malgun Gothic',sans-serif;color:#7b806f;text-align:center;padding-top:14px;flex:none}
:is(.folio-book-page,.folio-book-turn-page).is-cover{padding:0;background:#e9eee5}:is(.folio-book-page,.folio-book-turn-page).is-cover :is(.folio-book-page-header,.folio-book-turn-page-header),:is(.folio-book-page,.folio-book-turn-page).is-cover :is(.folio-book-page-footer,.folio-book-turn-page-footer){display:none}:is(.folio-book-page,.folio-book-turn-page).is-cover :is(.folio-book-page-body,.folio-book-turn-page-body){height:100%}
:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-page{height:100%;padding:0;margin:0;border:0}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-page>img{width:100%;height:100%;max-height:none;object-fit:contain;display:block}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-frame{position:relative;width:100%;height:100%;padding:0;overflow:hidden;text-align:left}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-frame>img{position:absolute;inset:0;display:block;width:100%;height:100%;max-height:none;object-fit:cover}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-shade{position:absolute;inset:0}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-copy{position:absolute;inset:0;display:flex;flex-direction:column;padding:11% 9% 9%}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-heading{flex:1;display:flex;flex-direction:column;padding:8% 0;min-height:0}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-copy h1{font:600 2em/1.45 'Batang',Georgia,serif;margin:0 0 .45em}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-overline{font:8px/1.6 sans-serif;letter-spacing:.2em}:is(.folio-book-page-body,.folio-book-turn-page-body) .cover-author{font:12px/1.6 sans-serif;margin:0}
:is(.folio-book-page-body,.folio-book-turn-page-body).has-overflow{overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}:is(.folio-book-page-body,.folio-book-turn-page-body).has-overflow:focus-visible{outline:2px solid #476052;outline-offset:-2px}.folio-book-overflow-note{color:#766548;font:10px/1.6 sans-serif;margin:4px 0 0}
.folio-book-navigation{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;margin:4px 0 0}.folio-book-navigation button{padding:8px 16px;border:1px solid #becbb7;background:#fbfcf7;border-radius:6px;font:12px/1.6 'Malgun Gothic',sans-serif;color:#36513e;cursor:pointer;min-height:36px}.folio-book-navigation button:disabled{opacity:.4;cursor:default}.folio-book-navigation button:focus-visible,.folio-book-toolbar select:focus-visible{outline:2px solid #476052;outline-offset:3px}.folio-book-position{min-width:112px;text-align:center;font-size:12px;font-variant-numeric:tabular-nums}.folio-book-progress{display:block;width:100%;height:5px;accent-color:#637e58;margin:15px 0 0;border:0}
.folio-book-measure{position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;z-index:-1}.folio-book-measure :is(.folio-book-page,.folio-book-turn-page){box-shadow:none}

/* One physical leaf has two independently readable faces and pivots at the spine. */
.folio-book-stage.has-spread::after{content:'';position:absolute;left:calc(50% - 1px);top:16px;width:3px;height:var(--book-page-height,510px);background:linear-gradient(90deg,#26302330,#fff8,#26302324);pointer-events:none;z-index:1}
.folio-book-blank{flex:none;width:var(--book-page-width,360px);height:var(--book-page-height,510px);background:linear-gradient(90deg,#e9e6dd,var(--book-paper) 9%);border:1px solid #e2dfd3;box-shadow:3px 3px 0 var(--book-edge),5px 5px 0 #eeeadd,7px 7px 0 var(--book-edge)}
.folio-book-stage.is-turning>.folio-book-page,.folio-book-stage.is-turning>.folio-book-blank{opacity:0;pointer-events:none}
.folio-book-stage.is-single-turn{overflow:clip}
.folio-book-turn{position:absolute;inset:0;z-index:3;pointer-events:none;perspective:2000px;perspective-origin:50% 50%;transform-style:preserve-3d;--book-turn-duration:680ms;--book-turn-ease:cubic-bezier(.42,.04,.25,1)}
.folio-book-underlay{position:absolute!important;margin:0!important;pointer-events:none}
.folio-book-underlay.is-moving{animation:folio-underlay-travel var(--book-turn-duration) var(--book-turn-ease) both}
.folio-book-leaf-track{position:absolute;transform-style:preserve-3d;animation:folio-leaf-travel var(--book-turn-duration) var(--book-turn-ease) both}
.folio-book-leaf{position:relative;width:100%;height:100%;transform-style:preserve-3d;will-change:transform;animation-duration:var(--book-turn-duration);animation-timing-function:var(--book-turn-ease);animation-fill-mode:both}
.folio-book-turn[data-direction="next"] .folio-book-leaf{transform-origin:left center;animation-name:folio-leaf-next}
.folio-book-turn[data-direction="prev"] .folio-book-leaf{transform-origin:right center;animation-name:folio-leaf-prev}
.folio-book-leaf-face{position:absolute!important;inset:0;margin:0!important;width:100%!important;height:100%!important;backface-visibility:hidden;-webkit-backface-visibility:hidden;box-shadow:0 0 1px 1px #a9a18b66,0 8px 18px #1723181f;pointer-events:none}
.folio-book-leaf-face[data-book-face="front"]{transform:translateZ(.5px)}
.folio-book-leaf-face[data-book-face="back"]{transform:rotateY(180deg) translateZ(.5px)}
.folio-book-leaf-face::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:4;background:linear-gradient(90deg,#16211738,transparent 16%,#fff9 43%,transparent 64%,#16211722);animation:folio-paper-light var(--book-turn-duration) var(--book-turn-ease) both}
.folio-book-leaf-face[data-book-face="back"]::after{background:linear-gradient(90deg,#16211722,transparent 36%,#fff8 57%,transparent 84%,#16211738);animation-direction:reverse}
.folio-book-turn-shadow{position:absolute;pointer-events:none;background:linear-gradient(90deg,transparent,#17231655);transform-origin:right center;animation:folio-cast-shadow var(--book-turn-duration) var(--book-turn-ease) both}
.folio-book-turn[data-direction="prev"] .folio-book-turn-shadow{background:linear-gradient(90deg,#17231655,transparent);transform-origin:left center}
@keyframes folio-leaf-next{from{transform:rotateY(0deg)}to{transform:rotateY(-180deg)}}
@keyframes folio-leaf-prev{from{transform:rotateY(0deg)}to{transform:rotateY(180deg)}}
@keyframes folio-leaf-travel{from{transform:translate3d(0,0,0)}to{transform:translate3d(var(--book-travel-x,0px),0,0)}}
@keyframes folio-underlay-travel{from{transform:translateX(var(--book-underlay-shift,0px))}to{transform:translateX(0)}}
@keyframes folio-paper-light{0%,100%{opacity:.04}42%,58%{opacity:.72}}
@keyframes folio-cast-shadow{0%,100%{opacity:0;transform:scaleX(.08)}45%,55%{opacity:.65;transform:scaleX(.88)}}
@media(prefers-reduced-motion:reduce){.folio-book-turn{display:none}.folio-book-stage.is-turning>.folio-book-page,.folio-book-stage.is-turning>.folio-book-blank{opacity:1;pointer-events:auto}.folio-book-leaf,.folio-book-leaf-track,.folio-book-underlay.is-moving,.folio-book-leaf-face::after,.folio-book-turn-shadow{animation:none!important}}
@media(max-width:520px){:is(.folio-book-page,.folio-book-turn-page){padding:22px 23px 18px;font-size:14px}.folio-book-toolbar{font-size:11px}.folio-book-hint{font-size:10px}.folio-book-navigation{gap:8px}.folio-book-navigation button{padding:8px 12px}}
@media print{.folio-book-reader{display:none!important}}
`;

/** Self-contained so the exact same audited runtime can be embedded offline. */
export function mountBookPreview(host, options = {}) {
  if (!host?.ownerDocument) throw new TypeError('책 미리보기를 표시할 요소가 필요합니다.');
  const doc = host.ownerDocument, win = doc.defaultView;
  const sections = Array.isArray(options.sections) ? options.sections : [];
  const title = String(options.title || '나의 책');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let pages = [], current = 0, spread = 1, destroyed = false, observer, resizeTimer, width = 0;
  let activeTurn = null;
  const motionPreference = win.matchMedia?.('(prefers-reduced-motion: reduce)');
  let pointerStart = null, refreshing = false, originalPage = Math.max(0, Math.floor(Number(options.page) || 0));
  host.classList.add('folio-book-reader');
  host.setAttribute('role', 'region'); host.setAttribute('aria-label', title + ' 책 미리보기'); host.tabIndex = 0;
  host.innerHTML = `<div class="folio-book-toolbar"><label>책갈피 <select data-book-section aria-label="장으로 이동">${sections.map((s, i) => `<option value="${i}">${escape(s.title || `${i + 1}장`)}</option>`).join('')}</select></label><span>책장 넘기기</span></div><div class="folio-book-stage" data-book-stage></div><div class="folio-book-navigation"><button type="button" data-book-prev aria-label="이전 책장">← 이전</button><span class="folio-book-position" data-book-position role="status" aria-live="polite" aria-atomic="true"></span><button type="button" data-book-next aria-label="다음 책장">다음 →</button></div><progress class="folio-book-progress" data-book-progress max="1" value="0" aria-label="독서 진행률"></progress><p class="folio-book-hint">← → 키 또는 좌우로 쓸어 책장을 넘기세요. 화면 크기에 따라 쪽수가 달라집니다.</p>`;
  const stage = host.querySelector('[data-book-stage]'), position = host.querySelector('[data-book-position]');
  const select = host.querySelector('[data-book-section]'), progress = host.querySelector('[data-book-progress]');
  const previous = host.querySelector('[data-book-prev]'), next = host.querySelector('[data-book-next]');
  const measure = doc.createElement('div'); measure.className = 'folio-book-measure'; measure.setAttribute('aria-hidden', 'true'); measure.inert = true; host.append(measure);
  const pageElement = (page, index, side = '') => {
    const element = doc.createElement('article');
    element.className = `folio-book-page ${page.kind === 'cover' ? 'is-cover' : ''} ${side}`;
    element.setAttribute('aria-label', `${index + 1}쪽 · ${page.title}`);
    element.innerHTML = `<div class="folio-book-page-header">${escape(page.title)}</div><div class="folio-book-page-body ${page.kind === 'toc' ? 'toc' : ''}${page.overflow ? ' has-overflow' : ''}">${page.html}</div>${page.overflow ? '<p class="folio-book-overflow-note">긴 도표·문단은 이 페이지 안에서 스크롤할 수 있습니다.</p>' : ''}<div class="folio-book-page-footer">${index + 1}</div>`;
    if (page.overflow) { const body = element.querySelector('.folio-book-page-body'); body.tabIndex = 0; body.setAttribute('role', 'region'); body.setAttribute('aria-label', '긴 도표 또는 문단 전체 보기'); }
    return element;
  };
  const visibleCount = () => pages[current]?.kind === 'cover' ? 1 : spread;
  const getState = () => ({ page: current, pageNumber: current + 1, pageCount: pages.length, spread: visibleCount(), section: pages[current]?.section ?? 0 });
  // The destination pages are always the canonical DOM. Animation snapshots are
  // decorative only, so screen readers, search and export never read duplicate text.
  const finishTurn = () => {
    if (!activeTurn) return;
    const turn = activeTurn; activeTurn = null;
    win.clearTimeout(turn.timer);
    turn.leaf.removeEventListener('animationend', turn.end);
    turn.layer.remove();
    stage.classList.remove('is-turning', 'is-single-turn');
    turn.targets.forEach(({ node, inert }) => { node.inert = inert; });
  };
  const snapshotSpread = () => {
    const stageRect = stage.getBoundingClientRect();
    const nodes = [...stage.children].filter(node => node.classList.contains('folio-book-page') || node.classList.contains('folio-book-blank'));
    if (!(stageRect.width > 0) || !nodes.length) return null;
    const snapshots = nodes.map(node => {
      const rect = node.getBoundingClientRect();
      return { node: node.cloneNode(true), x: rect.left - stageRect.left, y: rect.top - stageRect.top, width: rect.width, height: rect.height, scroll: [...node.querySelectorAll('.has-overflow')].map(region => ({ top: region.scrollTop, left: region.scrollLeft })) };
    });
    return snapshots.every(item => item.width > 0 && item.height > 0 && Number.isFinite(item.x) && Number.isFinite(item.y)) ? snapshots : null;
  };
  const decorativePage = snapshot => {
    const node = snapshot.node.cloneNode(true);
    [node, ...node.querySelectorAll('*')].forEach(element => {
      element.removeAttribute('id'); element.removeAttribute('autofocus');
      if (element.matches('a,button,input,select,textarea,[tabindex],[contenteditable]')) element.setAttribute('tabindex', '-1');
      [...element.classList].filter(name => /^folio-book-page(?:-|$)/.test(name)).forEach(name => {
        element.classList.replace(name, name.replace('folio-book-page', 'folio-book-turn-page'));
      });
    });
    return node;
  };
  const animateTurn = (before, direction) => {
    if (!before || motionPreference?.matches) return;
    const after = snapshotSpread();
    if (!after) return;
    const scrollCopies = [];
    const copy = snapshot => { const node = decorativePage(snapshot); scrollCopies.push({ node, positions: snapshot.scroll }); return node; };
    const single = spread === 1;
    const front = direction > 0 ? before.at(-1) : before[0];
    const back = direction > 0 ? after[0] : after.at(-1);
    // A narrow viewport reveals the next page below the turning leaf. On a
    // spread, its back lands on the opposite side of the same center binding.
    const travel = single ? 0 : direction > 0 ? back.x + back.width - front.x : back.x - front.x - front.width;
    const layer = doc.createElement('div');
    layer.className = 'folio-book-turn'; layer.setAttribute('data-book-turn', '');
    layer.setAttribute('data-direction', direction > 0 ? 'next' : 'prev');
    layer.setAttribute('aria-hidden', 'true'); layer.inert = true;
    const underlay = (snapshot, shift = 0) => {
      const page = copy(snapshot); page.classList.add('folio-book-underlay');
      Object.assign(page.style, { left: snapshot.x + 'px', top: snapshot.y + 'px', width: snapshot.width + 'px', height: snapshot.height + 'px' });
      if (Math.abs(shift) > 1) { page.classList.add('is-moving'); page.style.setProperty('--book-underlay-shift', shift + 'px'); }
      layer.append(page);
    };
    if (single) underlay(after[0]);
    else if (direction > 0) {
      if (before.length === 2) underlay(before[0]);
      if (after.length === 2) underlay(after[1], before.length === 1 ? front.x - after[1].x : 0);
    } else {
      if (after.length === 2) underlay(after[0]);
      if (before.length === 2) {
        const unchanged = before[1];
        // Closing the cover shifts the remaining right stack under its back.
        underlay(after.length === 1 ? { ...unchanged, x: back.x } : unchanged, after.length === 1 ? unchanged.x - back.x : 0);
      }
    }
    const shadow = doc.createElement('div'); shadow.className = 'folio-book-turn-shadow';
    const shadowPage = single ? after[0] : back;
    Object.assign(shadow.style, { left: shadowPage.x + 'px', top: shadowPage.y + 'px', width: shadowPage.width + 'px', height: shadowPage.height + 'px' });
    layer.append(shadow);
    const track = doc.createElement('div'); track.className = 'folio-book-leaf-track';
    Object.assign(track.style, { left: front.x + 'px', top: front.y + 'px', width: front.width + 'px', height: front.height + 'px' });
    track.style.setProperty('--book-travel-x', travel + 'px');
    const leaf = doc.createElement('div'); leaf.className = 'folio-book-leaf';
    for (const [face, snapshot] of [['front', front], ['back', back]]) {
      const page = copy(snapshot); page.classList.add('folio-book-leaf-face');
      page.setAttribute('data-book-face', face); leaf.append(page);
    }
    track.append(leaf); layer.append(track);
    const targets = [...stage.children].map(node => ({ node, inert: node.inert }));
    targets.forEach(({ node }) => { node.inert = true; });
    stage.classList.add('is-turning'); stage.classList.toggle('is-single-turn', single);
    const end = event => { if (event.target === leaf && event.animationName === (direction > 0 ? 'folio-leaf-next' : 'folio-leaf-prev')) finishTurn(); };
    leaf.addEventListener('animationend', end);
    activeTurn = { layer, leaf, end, targets, timer: win.setTimeout(finishTurn, 760) };
    stage.append(layer);
    // cloneNode omits scroll state; apply it only after the faces have layout.
    // A long table must not jump back to its first row as its sheet turns.
    scrollCopies.forEach(({ node, positions }) => {
      [...node.querySelectorAll('.has-overflow')].forEach((region, index) => {
        region.scrollTop = positions[index]?.top || 0; region.scrollLeft = positions[index]?.left || 0;
      });
    });
  };
  const draw = (direction = 0, before = null) => {
    if (destroyed) return;
    stage.replaceChildren();
    const count = visibleCount(), end = Math.min(pages.length, current + count);
    stage.classList.toggle('has-spread', count === 2);
    for (let index = current; index < end; index++) {
      stage.append(pageElement(pages[index], index, count === 2 ? index === current ? 'is-left' : 'is-right' : ''));
    }
    // Keep the final left page beside an empty right leaf, rather than suddenly
    // recentering it and moving the binding during the last page turn.
    if (count === 2 && end - current === 1) {
      const blank = doc.createElement('div'); blank.className = 'folio-book-blank';
      blank.setAttribute('aria-hidden', 'true'); blank.inert = true; stage.append(blank);
    }
    position.textContent = `${current + 1}${end > current + 1 ? '–' + end : ''} / ${pages.length}쪽`;
    previous.disabled = current === 0; next.disabled = end >= pages.length;
    progress.max = pages.length; progress.value = end; select.value = String(pages[current]?.section ?? 0);
    if (direction) animateTurn(before, direction);
    if (typeof options.onPageChange === 'function') options.onPageChange(getState());
  };
  const goTo = page => {
    if (destroyed || !Number.isFinite(Number(page))) return;
    const target = Math.max(0, Math.min(pages.length - 1, Math.floor(Number(page))));
    if (target !== current) {
      // Repeated clicks settle the previous sheet first. There is never a queue
      // of invisible transitions, and navigation/state remain synchronous.
      finishTurn();
      const restoreFocus = stage.contains(doc.activeElement);
      const before = snapshotSpread(), direction = Math.sign(target - current);
      current = target; draw(direction, before);
      if (restoreFocus && !destroyed) host.focus({ preventScroll: true });
    }
  };
  const goToSection = id => {
    const section = typeof id === 'number' ? id : sections.findIndex(s => s.id === id);
    const page = pages.findIndex(p => p.section === section);
    if (page >= 0) goTo(page);
  };
  const turnNext = () => { if (current + visibleCount() < pages.length) goTo(current + visibleCount()); };
  const turnPrevious = () => goTo(current - spread);

  // Split long prose at real DOM text boundaries, preserving inline formatting.
  // Oversized charts/tables retain all content in a labelled scrollable page.
  function splitProse(node, body, roomHeight) {
    if (!['P', 'BLOCKQUOTE', 'PRE', 'UL', 'OL'].includes(node.tagName) || node.textContent.length < 40) return null;
    const walker = doc.createTreeWalker(node, 4), texts = []; let text;
    while ((text = walker.nextNode())) texts.push(text);
    const length = texts.reduce((sum, item) => sum + item.length, 0);
    if (!length) return null;
    const boundary = offset => { for (const item of texts) { if (offset <= item.length) return [item, offset]; offset -= item.length; } return [texts.at(-1), texts.at(-1).length]; };
    const slice = (start, end) => {
      const range = doc.createRange(), result = node.cloneNode(false);
      const [a, from] = boundary(start), [b, to] = boundary(end);
      range.selectNodeContents(node);
      if (start > 0) range.setStart(a, from);
      if (end < length) range.setEnd(b, to);
      result.append(range.cloneContents());
      // Continuations must not duplicate document-wide IDs.
      result.removeAttribute('id'); result.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
      return result;
    };
    let low = 1, high = length - 1, best = 0;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2), candidate = slice(0, middle);
      body.append(candidate);
      const fits = body.scrollHeight <= roomHeight + 1;
      candidate.remove();
      if (fits) { best = middle; low = middle + 1; } else high = middle - 1;
    }
    if (best < 12) return null;
    const content = node.textContent;
    // Prefer the last complete whitespace-delimited word across the whole
    // prefix, including Korean eojeol. Do not cut a normal word just to fill
    // the remaining space below a heading or another paragraph.
    if (!/\s/.test(content[best - 1]) && !/\s/.test(content[best])) {
      const before = content.slice(0, best), gap = before.search(/\s+\S*$/);
      if (gap >= 0) best = gap + before.slice(gap).match(/^\s+/)[0].length;
      else if (body.childNodes.length) return null;
    }
    // An unbroken URL/token longer than one page still needs a fallback.
    // Preserve entire grapheme clusters (emoji and combining marks included).
    if (typeof Intl.Segmenter === 'function') {
      let safe = 0;
      for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(content)) {
        const end = part.index + part.segment.length;
        if (end > best) break;
        safe = end;
      }
      best = safe;
    } else if (best > 0 && /[\uD800-\uDBFF]/.test(content[best - 1])) best--;
    if (best < 1 || best >= length) return null;
    const first = slice(0, best), rest = slice(best, length);
    if (node.tagName === 'OL') {
      const completed = first.querySelectorAll(':scope > li').length - (first.lastElementChild?.textContent === node.children[first.children.length - 1]?.textContent ? 0 : 1);
      rest.start = (Number(node.getAttribute('start')) || 1) + Math.max(0, completed);
    }
    return [first, rest];
  }

  function paginate() {
    if (destroyed || refreshing) return;
    finishTurn();
    refreshing = true;
    const oldSection = pages[current]?.section, oldSectionStart = pages.findIndex(p => p.section === oldSection);
    const oldOffset = oldSectionStart >= 0 ? current - oldSectionStart : 0;
    width = host.getBoundingClientRect().width || host.clientWidth || 760;
    spread = width >= 720 ? 2 : 1;
    const availableHeight = Math.max(300, (win.innerHeight || 900) - 240);
    const pageWidth = Math.max(180, Math.min(430, Math.floor((width - 20) / spread), Math.floor(availableHeight / Math.SQRT2)));
    host.style.setProperty('--book-page-width', `${pageWidth}px`);
    host.style.setProperty('--book-page-height', `${Math.round(pageWidth * Math.SQRT2)}px`);
    pages = [];
    sections.forEach((section, sectionIndex) => {
      const base = { title: String(section.title || title), section: sectionIndex, kind: section.kind || 'chapter' };
      if (base.kind === 'cover') { pages.push({ ...base, html: String(section.html || '') }); return; }
      const template = doc.createElement('template'); template.innerHTML = String(section.html || '');
      const queue = [...template.content.childNodes].filter(node => node.nodeType === 1 || node.textContent.trim());
      const card = pageElement({ ...base, html: '' }, pages.length); measure.replaceChildren(card);
      const body = card.querySelector('.folio-book-page-body');
      // DOM-only tests and background tabs may have no layout. Keep full content.
      const roomHeight = body.clientHeight;
      if (!roomHeight) { pages.push({ ...base, html: String(section.html || '') }); return; }
      const commit = overflow => { if (body.childNodes.length) pages.push({ ...base, html: body.innerHTML, overflow: Boolean(overflow) }); body.replaceChildren(); };
      const isHeading = node => /^H[1-6]$/.test(node?.tagName || '');
      const hasTwoLines = node => {
        const style = win.getComputedStyle(node);
        const lineHeight = parseFloat(style.lineHeight) || (parseFloat(style.fontSize) || 15) * 1.85;
        const height = node.getBoundingClientRect().height;
        // Real layout measures the lead fragment, not the whole paragraph. DOM-only
        // surrogates have no rectangles; a conservative text floor keeps them usable.
        return height > 0 ? height + 1 >= lineHeight * 2 : node.textContent.trim().length >= 24;
      };
      while (queue.length) {
        const node = queue.shift();
        if (isHeading(node)) {
          // Consecutive headings belong to the following content. Keep the small
          // chapter-number marker with its opener as well, never on an empty page.
          const headings = [node];
          while (isHeading(queue[0])) headings.push(queue.shift());
          if (body.childNodes.length === 1 && body.firstElementChild?.classList.contains('chapter-number')) headings.unshift(body.firstElementChild);
          headings.forEach(heading => heading.remove());
          const preceding = body.childNodes.length;
          body.append(...headings);
          const following = queue[0];
          if (following) body.append(following);
          const fitsTogether = body.scrollHeight <= roomHeight + 1;
          if (following) following.remove();
          if (fitsTogether) continue;
          const split = following && splitProse(following, body, roomHeight);
          if (split) body.append(split[0]);
          const usefulLead = split && hasTwoLines(split[0]);
          if (split) split[0].remove();
          if (usefulLead) {
            body.append(split[0]); queue.shift(); commit(false); queue.unshift(split[1]);
          } else if (preceding) {
            headings.forEach(heading => heading.remove());
            commit(false); queue.unshift(...headings);
          } else {
            // The heading group and its first content cannot fit even on a fresh
            // page (e.g. a tall diagram). Keep the group in one accessible scroll
            // region; consuming it guarantees progress without losing any text.
            if (following) { body.append(following); queue.shift(); }
            commit(body.scrollHeight > roomHeight + 1);
          }
          continue;
        }
        body.append(node);
        if (body.scrollHeight <= roomHeight + 1) continue;
        node.remove();
        const split = splitProse(node, body, roomHeight);
        if (split) { body.append(split[0]); commit(false); queue.unshift(split[1]); continue; }
        if (body.childNodes.length) { commit(false); queue.unshift(node); }
        else { body.append(node); commit(true); }
      }
      commit(false);
      if (!pages.some(page => page.section === sectionIndex)) pages.push({ ...base, html: '<p>아직 작성한 본문이 없습니다.</p>' });
    });
    if (!pages.length) pages.push({ title, section: 0, kind: 'chapter', html: '<p>아직 작성한 본문이 없습니다.</p>' });
    measure.replaceChildren();
    const newStart = pages.findIndex(p => p.section === oldSection);
    current = Math.max(0, Math.min(pages.length - 1, newStart >= 0 ? newStart + Math.min(oldOffset, pages.filter(p => p.section === oldSection).length - 1) : originalPage));
    originalPage = 0; refreshing = false; draw();
  }
  const click = event => {
    const link = event.target.closest?.('a[href^="#"]');
    if (link) { const id = link.getAttribute('href').slice(1); if (sections.some(s => s.id === id)) { event.preventDefault(); goToSection(id); } }
    if (event.target.closest?.('[data-book-prev]')) turnPrevious();
    if (event.target.closest?.('[data-book-next]')) turnNext();
  };
  const change = event => { if (event.target === select) goToSection(Number(select.value)); };
  const keydown = event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    // Let arrow keys scroll an oversized table when its accessible region is focused.
    if (event.target.closest?.('.has-overflow')) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); turnNext(); }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); turnPrevious(); }
    if (event.key === 'Home') { event.preventDefault(); goTo(0); }
    if (event.key === 'End') { event.preventDefault(); goTo(pages.length - 1); }
  };
  const pointerdown = event => {
    pointerStart = null;
    if (event.isPrimary === false || (event.button != null && event.button !== 0) || event.target.closest?.('a,button,input,textarea,select,[contenteditable],.has-overflow')) return;
    if (String(win.getSelection?.() || '')) return;
    // Mouse gestures begin at a page edge, preserving ordinary text selection.
    // Touch/pen retain horizontal swipes while touch-action:pan-y keeps scrolling.
    const page = event.target.closest?.('.folio-book-page');
    if (event.pointerType === 'mouse' && page) {
      const bounds = page.getBoundingClientRect();
      if (bounds.width > 0 && event.clientX - bounds.left > 36 && bounds.right - event.clientX > 36) return;
    }
    pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
  };
  const pointerup = event => {
    if (!pointerStart || (pointerStart.id != null && event.pointerId != null && pointerStart.id !== event.pointerId)) return;
    const dx = event.clientX - pointerStart.x, dy = event.clientY - pointerStart.y; pointerStart = null;
    if (String(win.getSelection?.() || '')) return;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) { if (dx < 0) turnNext(); else turnPrevious(); }
  };
  const pointercancel = () => { pointerStart = null; };
  const motionChange = () => { if (motionPreference?.matches) finishTurn(); };
  motionPreference?.addEventListener?.('change', motionChange);
  const refresh = () => { finishTurn(); win.clearTimeout(resizeTimer); resizeTimer = win.setTimeout(paginate, 80); };
  host.addEventListener('click', click); host.addEventListener('change', change); host.addEventListener('keydown', keydown);
  stage.addEventListener('pointerdown', pointerdown); stage.addEventListener('pointerup', pointerup); stage.addEventListener('pointercancel', pointercancel);
  paginate();
  if (typeof win.ResizeObserver === 'function') { observer = new win.ResizeObserver(() => { if (Math.abs((host.getBoundingClientRect().width || host.clientWidth || 760) - width) > 2) refresh(); }); observer.observe(host); }
  win.addEventListener('resize', refresh);
  // Decode every image before final pagination; hidden chapters count as well.
  const sources = [...new Set(sections.flatMap(section => { const template = doc.createElement('template'); template.innerHTML = String(section.html || ''); return [...template.content.querySelectorAll('img')].map(img => img.getAttribute('src')).filter(Boolean); }))];
  const imagePromises = sources.map(src => new Promise(resolve => { const img = new win.Image(); const done = () => { img.onload = null; img.onerror = null; resolve(); }; img.onload = done; img.onerror = done; img.src = src; if (img.complete) done(); }));
  let readinessTimer;
  const ready = Promise.race([Promise.all([doc.fonts?.ready, ...imagePromises]), new Promise(resolve => { readinessTimer = win.setTimeout(resolve, 1600); })]).then(() => { win.clearTimeout(readinessTimer); if (!destroyed) paginate(); return getState(); });
  const destroy = () => { if (destroyed) return; finishTurn(); motionPreference?.removeEventListener?.('change', motionChange); destroyed = true; win.clearTimeout(resizeTimer); win.clearTimeout(readinessTimer); observer?.disconnect(); win.removeEventListener('resize', refresh); host.removeEventListener('click', click); host.removeEventListener('change', change); host.removeEventListener('keydown', keydown); stage.removeEventListener('pointerdown', pointerdown); stage.removeEventListener('pointerup', pointerup); stage.removeEventListener('pointercancel', pointercancel); host.replaceChildren(); host.classList.remove('folio-book-reader'); };
  return { next: turnNext, prev: turnPrevious, goTo, goToSection, refresh, destroy, getState, ready };
}

/** No book/user data is interpolated into executable code. */
export function standaloneReaderScript() {
  return `(() => { const source = document.getElementById('folio-book-source'); const host = document.getElementById('folio-book-reader'); if (!source || !host) return; const sections = Array.from(source.children).map(section => ({ id: section.id, title: section.getAttribute('data-book-title') || '', kind: section.getAttribute('data-book-kind') || 'chapter', html: section.getAttribute('data-book-kind') === 'cover' ? section.outerHTML : section.innerHTML })); try { (${mountBookPreview.toString()})(host, {title: document.title, sections}); document.documentElement.classList.add('folio-reader-enhanced'); } catch (error) { host.remove(); } })();`;
}
