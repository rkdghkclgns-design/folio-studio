import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeProject, localCopyedit, splitManuscript, applyEditorialSuggestion, generateIllustrationSVG, sampleProject } from './dist/editorial.js';

test('copyediting corrects clear Korean errors and reports its exact changes', () => {
  const source = '몇일 뒤면 할수있어요. 안되요 라고 말했지만 금새 마음이 달라졌어요. 내일 갈께요.';
  const result = localCopyedit(source);
  assert.equal(result.text, '며칠 뒤면 할 수 있어요. 안 돼요 라고 말했지만 금새 마음이 달라졌어요. 내일 갈게요.');
  assert.ok(result.changes.length >= 4);
  assert.ok(result.changes.every(change => change.before !== change.after && change.reason.length > 8));
  assert.equal(localCopyedit(result.text).changes.length, 0);
});

test('copyediting retains paragraph structure and leaves stylistic decisions to the author', () => {
  const original = '나는 나무를 오래 바라보았다.\n\n  그늘은 천천히 자리를 옮겼다.\n\n그것이 오늘의 전부였다.';
  assert.deepEqual(localCopyedit(original), { text: original, changes: [] });
  assert.equal(localCopyedit('안녕 ,반가워요.  오랜만이에요.').text, '안녕, 반가워요. 오랜만이에요.');
  assert.equal(localCopyedit('3.14, 1,000원, v2.0').text, '3.14, 1,000원, v2.0');
});

test('copyediting preserves fenced code, inline code, and web addresses', () => {
  const protectedText = '```js\nconst 몇일 = "안되요  문자열";\n```\n`몇일` https://example.com/몇일?q=됬';
  assert.equal(localCopyedit(protectedText).text, protectedText);
  const tilde = '~~~text\n몇일 안되요\n~~~';
  assert.equal(localCopyedit(tilde).text, tilde);
  assert.equal(localCopyedit('```text\n몇일 안되요').text, '```text\n몇일 안되요');
});

test('copyediting is safe for missing input and does not invent prose', () => {
  assert.deepEqual(localCopyedit(), { text: '', changes: [] });
  assert.deepEqual(localCopyedit(null), { text: '', changes: [] });
  const source = '마음에 남은 일.';
  assert.equal(localCopyedit(source).text, source);
});

test('Markdown chapter splitting keeps introductions and titles', () => {
  const chapters = splitManuscript('책 앞에 남긴 인사.\n\n# 처음의 마음\n첫 번째 내용.\n\n## 작은 연습\n두 번째 내용.');
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].title, '들어가는 글');
  assert.equal(chapters[0].content, '책 앞에 남긴 인사.');
  assert.equal(chapters[1].title, '처음의 마음');
  assert.equal(chapters[2].content, '두 번째 내용.');
  assert.equal(new Set(chapters.map(chapter => chapter.id)).size, 3);
});

test('book title heading is skipped only when a matching title is supplied', () => {
  const source = '# 느리게, 단단하게\n\n## 나만의 속도\n본문입니다.';
  assert.equal(splitManuscript(source, '느리게, 단단하게').length, 1);
  assert.equal(splitManuscript(source, '느리게, 단단하게')[0].title, '나만의 속도');
  assert.equal(splitManuscript(source).length, 2);
});

test('Korean chapter forms are recognized without mistaking ordinary prose for headings', () => {
  const source = '제1장. 나의 속도\n이것은 1장에서는 하지 않은 이야기다.\n\n2장 두 번째 이야기\n다음 본문.\n\n제 3 장: 마지막\n끝.';
  const chapters = splitManuscript(source);
  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map(chapter => chapter.title), ['제1장 나의 속도', '제2장 두 번째 이야기', '제3장 마지막']);
  assert.match(chapters[0].content, /1장에서는/);
});

test('chapter splitting preserves code blocks, CRLF text, and empty named chapters', () => {
  const chapters = splitManuscript('\uFEFF# 첫 장\r\n```md\r\n# 이 줄은 코드\r\n```\r\n# 빈 장');
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].content, '```md\n# 이 줄은 코드\n```');
  assert.equal(chapters[1].title, '빈 장');
  assert.equal(chapters[1].content, '');
  assert.deepEqual(splitManuscript('   '), []);
  assert.equal(splitManuscript('제목 없는 원고', '나의 책')[0].title, '나의 책');
});

test('chapter cap preserves all text beyond the thousandth chapter', () => {
  const source = Array.from({ length: 1008 }, (_, i) => `# 장 ${i + 1}\n본문 ${i + 1}`).join('\n\n');
  const chapters = splitManuscript(source);
  assert.equal(chapters.length, 1000);
  assert.match(chapters[999].content, /# 장 1001/);
  assert.match(chapters[999].content, /본문 1008/);
  for (let i = 1; i <= 1008; i++) assert.ok(chapters.some(chapter => chapter.content.includes(`본문 ${i}`)));
});

test('readiness analysis explains blank author, absent alt text, repeated titles, and typographic corrections', () => {
  const project = sampleProject();
  project.chapters[1].title = project.chapters[0].title;
  project.chapters[0].content += '\n\n몇일 후에 다시 만나요.';
  project.chapters[0].image.alt = '';
  const result = analyzeProject(project);
  const status = id => result.checks.find(check => check.id === id).status;
  assert.equal(status('author'), 'warn');
  assert.equal(status('headings'), 'warn');
  assert.equal(status('copy'), 'warn');
  assert.equal(status('accessibility'), 'warn');
  assert.ok(result.totalChars > 3500);
  assert.equal(result.readingMinutes, Math.ceil(result.totalChars / 500));
  const suggestion = result.suggestions.find(item => item.before === '몇일');
  assert.equal(suggestion.after, '며칠');
  assert.equal(suggestion.chapterId, project.chapters[0].id);
  assert.equal(suggestion.kind, '교정');
  assert.ok(result.score >= 0 && result.score <= 100);
});

test('readiness suggestions can be applied in order using exact original substrings', () => {
  const project = { chapters: [{ id: 'c1', title: '하루', content: '몇일 후에 할수있어요. 미리 사전에 준비했어요 .' }] };
  const original = project.chapters[0].content;
  const result = analyzeProject(project);
  let content = original;
  for (const suggestion of [...result.suggestions].sort((a, b) => b.start - a.start)) {
    assert.equal(content.slice(suggestion.start, suggestion.end), suggestion.before);
    content = applyEditorialSuggestion(content, suggestion);
  }
  assert.equal(content, '며칠 후에 할 수 있어요. 미리 준비했어요.');
  assert.equal(project.chapters[0].content, original, 'analysis must never mutate the manuscript');
});

test('long paragraphs receive an optional sentence-boundary break with words preserved', () => {
  const paragraph = '작은 걸음으로 하루의 시간을 돌보는 연습을 이어 간다. '.repeat(35).trim();
  const result = analyzeProject({ chapters: [{ id: 'c1', title: '긴 글', content: paragraph }] });
  const suggestion = result.suggestions.find(item => item.kind === '구성');
  assert.ok(suggestion);
  assert.match(suggestion.after, /\n\n/);
  assert.equal(suggestion.before.replace(/\s/g, ''), suggestion.after.replace(/\s/g, ''));
  assert.equal(result.checks.find(check => check.id === 'paragraphs').status, 'warn');
});

test('empty project analysis is honest about missing manuscript and zero reading time', () => {
  const result = analyzeProject();
  assert.equal(result.totalChars, 0);
  assert.equal(result.readingMinutes, 0);
  assert.equal(result.checks.find(check => check.id === 'completeness').status, 'warn');
  assert.deepEqual(result.suggestions, []);
});

test('SVG illustrations are deterministic, theme-aware, accessible, and self-contained', () => {
  const sage = generateIllustrationSVG('sage', 'same-seed');
  assert.equal(sage, generateIllustrationSVG('sage', 'same-seed'));
  assert.notEqual(sage, generateIllustrationSVG('sage', 'another-seed'));
  assert.notEqual(sage, generateIllustrationSVG('ocean', 'same-seed'));
  assert.equal(sage, generateIllustrationSVG('unknown', 'same-seed'));
  assert.match(sage, /viewBox="0 0 1000 700"/);
  assert.match(sage, /<title[^>]*>.+<\/title>/);
  assert.match(sage, /role="img"/);
  assert.doesNotMatch(sage, /(?:href|src)=["']https?:/);
  assert.doesNotMatch(sage, /<script|foreignObject|onload=/i);
  assert.notEqual(sage, generateIllustrationSVG('sage', 'same-seed', 'landscape'));
  assert.notEqual(sage, generateIllustrationSVG('sage', 'same-seed', 'abstract'));
});

test('sample book is complete original prose with balanced chapters and usable illustrations', () => {
  const sample = sampleProject();
  assert.equal(sample.title, '느리게, 단단하게');
  assert.equal(sample.subtitle, '나만의 속도로 삶을 가꾸는 연습');
  assert.equal(sample.language, 'ko');
  assert.equal(sample.chapters.length, 6);
  assert.equal(sample.chapters[0].title, '나만의 속도를 찾는 일');
  for (const chapter of sample.chapters) {
    const paragraphs = chapter.content.split(/\n\s*\n/);
    assert.ok(paragraphs.length >= 4 && paragraphs.length <= 7);
    assert.ok(chapter.content.length > 500);
    assert.doesNotMatch(chapter.content, /TODO|Lorem ipsum|여기에 입력/);
  }
  assert.ok(sample.chapters.filter(chapter => chapter.image).length >= 2);
  for (const chapter of sample.chapters.filter(chapter => chapter.image)) {
    assert.match(chapter.image.src, /^data:image\/svg\+xml/);
    assert.ok(chapter.image.alt && chapter.image.caption);
  }
  const score = analyzeProject(sample);
  assert.equal(score.checks.filter(check => check.status === 'warn').length, 1);
  assert.equal(score.checks.find(check => check.status === 'warn').id, 'author');
});

test('quotations and block quotations preserve an author’s exact wording', () => {
  const protectedText = '“안되요. 몇일 기다릴께요.”\n‘몇일’ 「안되요」 『됬다』 《몇일》\n"안되요\n몇일" \'몇일\'\n> 몇일 뒤에는 안되요.\n';
  assert.equal(localCopyedit(protectedText).text, protectedText);
  assert.equal(localCopyedit(`${protectedText}몇일 뒤에 갈께요.`).text, `${protectedText}며칠 뒤에 갈게요.`);
});

test('copyediting preserves technical text and destinations outside HTTP links', () => {
  const source = '    const 몇일 = 안되요;\nconst 몇일 = 안되요;\n몇일 = 안되요;\nmailto:몇일@example.com ftp://example.com/몇일 www.example.com/됬\n몇일@example.com /몇일.md foo몇일 몇일Value\n[몇일](./안되요.md "몇일") <span data-title="몇일">\n<pre>몇일 안되요</pre>\n몇일: 안되요\n| 몇일 | 안되요 |\n몇일\t안되요';
  assert.equal(localCopyedit(source).text, source);
});

test('copyediting preserves multi-backtick spans and the entire longer fenced block', () => {
  const span = '`` 안되요 ` 몇일 ``';
  assert.equal(localCopyedit(`${span} 몇일 뒤.`).text, `${span} 며칠 뒤.`);
  const block = '````md\n```\n안되요 몇일\n``` not-a-close\n````';
  assert.equal(localCopyedit(`${block}\n몇일 뒤.`).text, `${block}\n며칠 뒤.`);
  assert.equal(localCopyedit('~~~text\n안되요\n~~\n몇일').text, '~~~text\n안되요\n~~\n몇일');
});

test('unknown names and words with valid alternative meanings are not silently changed', () => {
  const source = '몇일식당과 안되요법, 됬캐릭터, 왠만주식회사. 금새를 묻자 금새 라고 답했다. 웬지 씨를 만났다.';
  assert.equal(localCopyedit(source).text, source);
  const suggestions = analyzeProject({ chapters: [{ id: 'c', content: '금새 돌아왔다. 웬지 웃었다.' }] }).suggestions;
  assert.equal(suggestions.length, 2);
  assert.ok(suggestions.every(s => s.kind === '윤문' && /뜻이라면/.test(s.reason)));
});

test('safe suggestion application edits the intended occurrence after protected text', () => {
  const source = '😀 `몇일` “몇일” https://example.com/몇일 몇일 뒤.';
  const suggestion = analyzeProject({ chapters: [{ id: 'c', content: source }] }).suggestions.find(s => s.after === '며칠');
  assert.equal(source.slice(suggestion.start, suggestion.end), '몇일');
  assert.equal(applyEditorialSuggestion(source, suggestion), '😀 `몇일` “몇일” https://example.com/몇일 며칠 뒤.');
  assert.equal(source, '😀 `몇일` “몇일” https://example.com/몇일 몇일 뒤.');
});

test('style suggestions respect quotes, code and addresses, including duplicate phrases', () => {
  const source = '“미리 사전에” `다시 재차`\n> 서로 상호\n\n미리 사전에 준비했다.';
  const suggestions = analyzeProject({ chapters: [{ id: 'c', content: source }] }).suggestions;
  assert.equal(suggestions.length, 1);
  assert.equal(applyEditorialSuggestion(source, suggestions[0]), '“미리 사전에” `다시 재차`\n> 서로 상호\n\n미리 준비했다.');
});

test('suggestions reject stale, invalid and protected source positions', () => {
  const source = '몇일 뒤.';
  const suggestion = analyzeProject({ chapters: [{ id: 'c', content: source }] }).suggestions[0];
  assert.throws(() => applyEditorialSuggestion(`새 문장 ${source}`, suggestion), /원고가 바뀌어/);
  assert.throws(() => applyEditorialSuggestion(source, { ...suggestion, start: -1 }), /원고가 바뀌어/);
  assert.throws(() => applyEditorialSuggestion(source, { before: '몇일', after: '며칠' }), /원고가 바뀌어/);
  assert.throws(() => applyEditorialSuggestion('`몇일`', { ...suggestion, start: 1, end: 3 }), /인용문·코드·주소/);
});

test('suggestions remain independent in original-source coordinates', () => {
  const source = '몇일 뒤에 할수있어요. 몇일 뒤에 갈께요.';
  const suggestions = analyzeProject({ chapters: [{ id: 'c', content: source }] }).suggestions;
  assert.equal(suggestions.filter(s => s.before === '몇일').length, 2);
  for (const s of suggestions) assert.equal(source.slice(s.start, s.end), s.before);
  let result = source;
  for (const suggestion of [...suggestions].sort((a, b) => b.start - a.start)) result = applyEditorialSuggestion(result, suggestion);
  assert.equal(result, localCopyedit(source).text);
});

test('chapter splitting retains literal trailing hashes and empty heading markers', () => {
  const chapters = splitManuscript('# C#\n내용\n## F# ##\n다음\n# ##\n끝\n###### 부록\n자료');
  assert.deepEqual(chapters.map(c => c.title), ['C#', 'F#', '부록']);
  assert.equal(chapters[1].content, '다음\n# ##\n끝');
  assert.equal(splitManuscript('#\n내용')[0].content, '#\n내용');
});

test('chapter splitting recognizes only valid closing fences and preserves code indentation', () => {
  const code = '````md\n```\n# still code\n```` with-info\n# also code\n````';
  const chapters = splitManuscript(`${code}\n# Real\n    Chapter 2 is code\n    # indented code\n    few  spaces  `);
  assert.equal(chapters.length, 2);
  assert.equal(chapters[0].content, code);
  assert.equal(chapters[1].content, '    Chapter 2 is code\n    # indented code\n    few  spaces  ');
});

test('matching book title alone does not produce an empty chapter array', () => {
  assert.deepEqual(splitManuscript('# 책', '책').map(c => [c.title, c.content]), [['책', '']]);
  assert.equal(splitManuscript('# 가\n# 본문\n내용', '가')[0].title, '본문');
  assert.equal(splitManuscript('# 책\n# 책\n내용', '책')[0].title, '책');
});

test('empty or malformed projects have zero manuscript readiness without throwing', () => {
  for (const project of [null, {}, { title: '책', author: '작가', description: '소개'.repeat(50), chapters: [] }, { chapters: [null, false] }]) {
    const result = analyzeProject(project);
    assert.equal(result.score, 0);
    assert.equal(result.readingMinutes, 0);
    assert.deepEqual(result.suggestions, []);
  }
  assert.equal(analyzeProject({ author: ' 나의 이름 ', chapters: [] }).checks.find(c => c.id === 'author').status, 'warn');
});

test('long quoted and technical paragraphs do not receive destructive layout suggestions', () => {
  const quote = `“${'그는 몇일 뒤에 온다고 했다. '.repeat(80)}”`;
  const content = `${quote}\n\n\`\`\`text\n${'안되요. '.repeat(200)}\n\`\`\``;
  assert.deepEqual(analyzeProject({ chapters: [{ id: 'c', content }] }).suggestions, []);
});

test('large plain tokens and repeated corrections retain deterministic text', () => {
  const text = `${'a'.repeat(100000)}\n${'가'.repeat(100000)}\n${'몇일 '.repeat(10000)}`;
  assert.equal(localCopyedit(text).text, `${'a'.repeat(100000)}\n${'가'.repeat(100000)}\n${'며칠 '.repeat(10000)}`);
});
