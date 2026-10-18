/** Keep captured sources and their positions together without replacing a manuscript. */
import {validateComputerResearch} from './computer.js';
import {validateChapterFigures} from './export.js';

const label = value => String(value).replace(/[\r\n]+/g, ' ').replace(/[\\[\]`*_<>]/g, ' ').trim();

export function appendComputerRecords(chapter, records, research) {
  const source = validateComputerResearch(research);
  if (!chapter || typeof chapter.content !== 'string' || !Array.isArray(records) || !records.length || records.length > 20 || !source) {
    throw new Error('본문에 반영할 캡처를 선택해 주세요.');
  }
  const selected = records.map(record => source.records.find(item => item.id === record?.id));
  if (selected.some(record => !record) || new Set(selected.map(record => record.id)).size !== selected.length) {
    throw new Error('보관한 캡처와 선택한 자료가 일치하지 않습니다. 다시 선택해 주세요.');
  }
  const figures = validateChapterFigures(chapter.figures), ids = new Set(figures.map(figure => figure.id));
  const additions = selected.filter(record => !ids.has(`pc-${record.id}`));
  if (!additions.length) throw new Error('선택한 캡처는 이미 이 장에 반영되어 있습니다.');
  const nextFigures = validateChapterFigures([...figures, ...additions.map(record => ({
    id: `pc-${record.id}`, src: record.src, alt: record.title, caption: record.caption,
  }))]);
  const blocks = additions.map(record => `### ${label(record.title) || '실습 화면'}\n\n${record.extractedText.trim() ? record.extractedText.trim() + '\n\n' : ''}![${label(record.title) || '실습 화면'}](folio-asset:pc-${record.id})`);
  const content = chapter.content + (chapter.content.trim() ? '\n\n' : '') + blocks.join('\n\n');
  if (content.length > 500000) throw new Error('장 원고가 500,000자를 넘습니다. 새 장에서 캡처를 반영해 주세요.');
  return {content, figures: nextFigures, added: additions.length};
}
