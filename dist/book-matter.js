/** Opening and closing sections live outside production chapter indices. */
const ROLES = ['preface', 'afterword'];
const TITLES = { preface: '시작말', afterword: '맺음말' };
const ALIASES = {
  preface: new Set(['시작말', '머리말', '서문', '여는말', '들어가며', '프롤로그', 'preface', 'foreword', 'prologue']),
  afterword: new Set(['맺음말', '맺으며', '마치며', '나가며', '끝맺음', '에필로그', 'afterword', 'epilogue']),
};
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit, label) => {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label}의 형식 또는 길이를 확인하세요. 원문을 자르지 않았습니다.`);
  return value;
};
const aliasKey = title => String(title || '').normalize('NFKC').trim().replace(/\s+/g, '').toLowerCase();
function roleOf(chapter) {
  if (ROLES.includes(chapter?.kind)) return chapter.kind;
  const key = aliasKey(chapter?.title);
  return ROLES.find(role => ALIASES[role].has(key));
}
function nextId(role, used) {
  let id = `folio-${role}`, suffix = 2;
  while (used.has(id)) id = `folio-${role}-${suffix++}`;
  used.add(id); return id;
}

/** Media validators are injected by the importer to avoid a render/export cycle. */
export function normalizeBookMatter(value, { chapterIds = [], validateImage, validateFigures, remapIds = false } = {}) {
  if (value === undefined) return undefined;
  if (!object(value) || Object.keys(value).some(key => !ROLES.includes(key))) throw new Error('시작말·맺음말의 형식이 올바르지 않습니다.');
  const used = new Set(chapterIds), result = {};
  for (const role of ROLES) {
    if (value[role] === undefined) continue;
    const source = value[role];
    if (!object(source)) throw new Error('시작말·맺음말의 원고 형식이 올바르지 않습니다.');
    const originalId = text(source.id, 200, '원고 식별자');
    if (originalId && /[\u0000-\u001f\u007f]/u.test(originalId)) throw new Error('원고 식별자의 형식이 올바르지 않습니다.');
    if (!remapIds && originalId && used.has(originalId)) throw new Error('시작말·맺음말과 본문의 식별자가 중복되었습니다.');
    const id = remapIds || !originalId ? nextId(role, used) : originalId;
    used.add(id);
    const chapter = { id, title: text(source.title, 200, '제목') || TITLES[role], content: text(source.content, 500000, '원고'), kind: role };
    if (source.editorialNotes !== undefined) {
      if (!Array.isArray(source.editorialNotes) || source.editorialNotes.length > 20) throw new Error('편집 메모 형식을 확인하세요.');
      chapter.editorialNotes = source.editorialNotes.map(note => text(note, 4000, '편집 메모'));
    }
    if (source.imagePrompt !== undefined) chapter.imagePrompt = text(source.imagePrompt, 12000, '삽화 설명');
    if (source.image != null) {
      if (typeof validateImage !== 'function') throw new Error('시작말·맺음말의 이미지를 검증할 수 없습니다.');
      chapter.image = validateImage(source.image);
    }
    if (source.figures !== undefined) {
      if (typeof validateFigures !== 'function') throw new Error('시작말·맺음말의 본문 이미지를 검증할 수 없습니다.');
      chapter.figures = validateFigures(source.figures);
    }
    result[role] = chapter;
  }
  return result;
}

const draftLabel = (value, limit = 200) => String(value || '').replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, limit).replace(/[\\`*_{}[\]<>#!|]/g, '\\$&');
function draftContent(project, role, body) {
  const title = draftLabel(project.title) || '이 책';
  const description = draftLabel(project.description, 600);
  const first = draftLabel(body[0]?.title), last = draftLabel(body.at(-1)?.title);
  if (role === 'preface') return [
    `『${title}』를 펼친 독자에게 이 책의 길잡이를 전합니다.`,
    description ? `책 소개에 담긴 방향은 다음과 같습니다.\n\n> ${description}` : '본문에 담긴 주제와 설명을 차례로 살펴보며, 자신의 질문과 연결해 읽어 보세요.',
    first ? `첫 본문인 「${first}」에서 출발해 각 장의 흐름을 따라가거나, 목차에서 지금 필요한 주제를 먼저 찾아 읽어도 좋습니다.` : '목차에서 관심 있는 주제를 고르고, 앞뒤 내용을 함께 살펴보세요.',
    '읽는 동안 떠오르는 질문과 더 확인하고 싶은 내용을 기록해 두면, 다시 펼쳤을 때 생각을 이어 가는 데 도움이 됩니다.',
  ].join('\n\n');
  return [
    `『${title}』의 마지막에 이르렀습니다. 잠시 책을 덮기 전에, 본문에서 자신에게 남은 질문과 생각을 돌아보세요.`,
    last ? `마지막 본문인 「${last}」를 읽으며 앞선 장들과 어떤 연결을 발견했는지 정리해 보아도 좋겠습니다.` : '서로 연결되는 내용을 되짚고, 더 살펴보고 싶은 주제를 골라 보세요.',
    '모든 내용을 한 번에 기억할 필요는 없습니다. 필요한 장으로 돌아가 중요한 대목을 다시 읽고, 자신의 상황에 맞는 다음 질문을 찾아보세요.',
    '이 책이 다음 생각과 탐색을 시작하는 계기가 되기를 바랍니다.',
  ].join('\n\n');
}

/** Exact legacy boilerplate is removed; authored captions and manuscript text stay intact. */
export function cleanDefaultIllustrationCaptions(project) {
  let changed = false;
  const chapters = [...(project.chapters || []), ...ROLES.map(role => project.bookMatter?.[role]).filter(Boolean)];
  for (const chapter of chapters) for (const image of [chapter.image, ...(chapter.figures || [])]) {
    if (image && typeof image.caption === 'string' && image.caption.trim() === 'AI 생성 삽화') { image.caption = ''; changed = true; }
  }
  return changed;
}

/** Idempotent migration for saved books; production plans and body chapters never move. */
export function ensureBookMatter(project) {
  if (!object(project) || !Array.isArray(project.chapters)) throw new Error('책의 원고 목록을 확인하세요.');
  let changed = cleanDefaultIllustrationCaptions(project);
  const matter = project.bookMatter || {}, used = new Set([...project.chapters.map(chapter => chapter.id), ...ROLES.map(role => matter[role]?.id).filter(Boolean)]);
  const body = project.chapters.filter(chapter => !roleOf(chapter) && chapter.kind !== 'folio-publication-colophon');
  for (const role of ROLES) if (!matter[role] && !project.chapters.some(chapter => roleOf(chapter) === role)) {
    matter[role] = { id: nextId(role, used), title: TITLES[role], content: draftContent(project, role, body), kind: role };
    changed = true;
  }
  if (ROLES.some(role => matter[role]) && project.bookMatter !== matter) project.bookMatter = matter;
  return changed;
}

/** Reading order only. Original chapters and production indices remain unchanged. */
export function getReadingChapters(project) {
  const chapters = Array.isArray(project?.chapters) ? project.chapters : [];
  const entries = [...chapters];
  for (const role of ROLES) {
    const item = project?.bookMatter?.[role];
    if (!item) continue;
    // A normalized export may already have these sections in its chapter list.
    if (entries.some(chapter => chapter.id === item.id)) continue;
    entries.push({ ...item, kind: role });
  }
  const grouped = { preface: [], body: [], afterword: [], colophon: [] };
  for (const chapter of entries) {
    const role = roleOf(chapter);
    if (chapter.kind === 'folio-publication-colophon') grouped.colophon.push(chapter);
    else if (role) grouped[role].push(chapter.kind === role ? chapter : { ...chapter, kind: role });
    else grouped.body.push(chapter);
  }
  return [...grouped.preface, ...grouped.body, ...grouped.afterword, ...grouped.colophon];
}
