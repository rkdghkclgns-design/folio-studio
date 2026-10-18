import test from 'node:test';
import assert from 'node:assert/strict';
import { readSourceFiles } from './dist/source-files.js';
import { validateSourceImage } from './dist/source-images.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==', 'base64');
const WEBP = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v02aAA=', 'base64');

function riffChunk(kind, data) {
  const chunk = Buffer.alloc(8 + data.length + data.length % 2);
  chunk.write(kind);
  chunk.writeUInt32LE(data.length, 4);
  data.copy(chunk, 8);
  return chunk;
}

// A valid RIFF envelope previously hid an impossible ANMF frame: a 1×1
// canvas, a 16,777,215×16,777,215 frame and no encoded frame pixels.
function malformedAnimation() {
  const canvas = Buffer.alloc(10);
  canvas[0] = 2;
  const frame = Buffer.alloc(24);
  frame.writeUIntLE(16777214, 6, 3);
  frame.writeUIntLE(16777214, 9, 3);
  const body = Buffer.concat([
    Buffer.from('WEBP'), riffChunk('VP8X', canvas),
    riffChunk('ANIM', Buffer.alloc(6)), riffChunk('ANMF', frame),
  ]);
  const header = Buffer.alloc(8);
  header.write('RIFF');
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

function file(path, bytes) {
  const result = new File([bytes], path.split('/').at(-1));
  Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}

function sourceImage(bytes) {
  return {
    path: '자료/사진.webp', mimeType: 'image/webp', bytes: bytes.length,
    src: `data:image/webp;base64,${bytes.toString('base64')}`,
  };
}

test('source audit: malformed animated WebP aborts a mixed recursive folder without reporting completion', async () => {
  const progress = [];
  await assert.rejects(readSourceFiles([
    file('책/1.md', '# 원본 원고'), file('책/하위/2.png', PNG),
    file('책/하위/더깊이/3.webp', malformedAnimation()),
  ], { onProgress: value => progress.push(value) }), { code: 'SOURCE_IMAGE_CORRUPT' });
  assert.deepEqual(progress.map(value => value.completed), [0, 1, 2]);
  assert(progress.every(value => value.total === 3));
});

test('source audit: valid cached WebP cannot be replaced by a malformed animation with matching declared bytes', () => {
  const input = sourceImage(WEBP);
  const prior = validateSourceImage(input);
  assert.deepEqual(validateSourceImage(input), prior);
  Object.assign(input, sourceImage(malformedAnimation()));
  assert.throws(() => validateSourceImage(input), { code: 'SOURCE_IMAGE_CORRUPT' });
  assert.deepEqual(validateSourceImage(prior), sourceImage(WEBP));
});
