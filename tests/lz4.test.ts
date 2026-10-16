import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeMozLz4, decodeLz4Block } from '../src/sources/lz4';

test('decodeMozLz4 validates magic header and decompresses simple block', () => {
  // Construct a valid mozlz4 buffer
  // Uncompressed text: "Hello World!" (12 bytes)
  const text = 'Hello World!';
  const textBytes = Buffer.from(text, 'utf8');

  // In LZ4 block:
  // token: literal length 12 (12 << 4 = 192 = 0xc0), match length 0
  const lz4Block = Buffer.concat([
    Buffer.from([0xc0]), // 12 literals, 0 match
    textBytes,
  ]);

  const magic = Buffer.from([0x6d, 0x6f, 0x7a, 0x4c, 0x7a, 0x34, 0x30, 0x00]);
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32LE(textBytes.length, 0);

  const mozlz4 = Buffer.concat([magic, sizeBuf, lz4Block]);

  const decompressed = decodeMozLz4(mozlz4);
  assert.equal(Buffer.from(decompressed).toString('utf8'), text);
});

test('decodeMozLz4 rejects invalid magic header or truncated input', () => {
  assert.throws(() => decodeMozLz4(Buffer.from('short')), /not a mozlz4 file \(bad magic header\)/);

  const badMagic = Buffer.alloc(16);
  assert.throws(() => decodeMozLz4(badMagic), /not a mozlz4 file \(bad magic header\)/);
});

test('decodeLz4Block handles literal length extensions (>14 bytes)', () => {
  // 20 literals: "01234567890123456789"
  // token: (15 << 4) = 0xf0, extra byte: 20 - 15 = 5
  const text = '01234567890123456789';
  const textBytes = Buffer.from(text, 'utf8');

  const lz4Block = Buffer.concat([Buffer.from([0xf0, 5]), textBytes]);

  const output = decodeLz4Block(lz4Block, 20);
  assert.equal(Buffer.from(output).toString('utf8'), text);
});

test('decodeLz4Block handles match repetition (back-references)', () => {
  // Text: "abcdeabcde" (10 bytes)
  // Literals: "abcde" (5 bytes)
  // Match: offset = 5, match length = 5 (token match length = 5 - 4 = 1)
  // token: (5 << 4) | 1 = 0x51
  // offset (2 bytes LE): 5 = 0x0005 -> [0x05, 0x00]
  const lz4Block = Buffer.concat([
    Buffer.from([0x51]),
    Buffer.from('abcde', 'utf8'),
    Buffer.from([0x05, 0x00]),
  ]);

  const output = decodeLz4Block(lz4Block, 10);
  assert.equal(Buffer.from(output).toString('utf8'), 'abcdeabcde');
});

test('decodeLz4Block detects corrupted data', () => {
  // Truncated data
  assert.throws(() => decodeLz4Block(Buffer.from([0xf0]), 20), /corrupt LZ4 data/);

  // Offset out of bounds (offset 0)
  assert.throws(
    () => decodeLz4Block(Buffer.from([0x11, 0x61, 0x00, 0x00]), 10),
    /corrupt LZ4 data \(invalid match offset\)/,
  );
});
