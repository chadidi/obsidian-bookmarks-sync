/**
 * Firefox stores bookmark backups as "mozlz4": an 8-byte magic ("mozLz40\0"), a little-endian
 * uint32 with the decompressed size, then one raw LZ4 *block*. This is a small, dependency-free
 * block decoder, which is all that is needed.
 */
const MAGIC = [0x6d, 0x6f, 0x7a, 0x4c, 0x7a, 0x34, 0x30, 0x00];
const MAX_OUTPUT = 512 * 1024 * 1024;

export function decodeMozLz4(input: Uint8Array): Uint8Array {
  if (input.length < 12 || MAGIC.some((b, i) => input[i] !== b)) {
    throw new Error("not a mozlz4 file (bad magic header)");
  }
  const size = new DataView(input.buffer, input.byteOffset, input.byteLength).getUint32(8, true);
  if (size > MAX_OUTPUT) throw new Error(`implausible decompressed size (${size} bytes)`);
  return decodeLz4Block(input.subarray(12), size);
}

export function decodeLz4Block(src: Uint8Array, outputSize: number): Uint8Array {
  const dst = new Uint8Array(outputSize);
  let s = 0;
  let d = 0;

  while (s < src.length) {
    const token = src[s++];

    let literalLength = token >> 4;
    if (literalLength === 15) {
      let b: number;
      do {
        if (s >= src.length) throw new Error("corrupt LZ4 data (truncated literal length)");
        b = src[s++];
        literalLength += b;
      } while (b === 255);
    }
    if (s + literalLength > src.length || d + literalLength > outputSize) {
      throw new Error("corrupt LZ4 data (literal run out of bounds)");
    }
    dst.set(src.subarray(s, s + literalLength), d);
    s += literalLength;
    d += literalLength;

    if (s >= src.length) break; // the last sequence has literals only

    const offset = src[s] | (src[s + 1] << 8);
    s += 2;
    if (offset === 0 || offset > d) throw new Error("corrupt LZ4 data (invalid match offset)");

    let matchLength = token & 15;
    if (matchLength === 15) {
      let b: number;
      do {
        if (s >= src.length) throw new Error("corrupt LZ4 data (truncated match length)");
        b = src[s++];
        matchLength += b;
      } while (b === 255);
    }
    matchLength += 4;
    if (d + matchLength > outputSize) throw new Error("corrupt LZ4 data (match out of bounds)");

    // Byte-by-byte on purpose: matches may overlap their own output.
    let from = d - offset;
    for (let i = 0; i < matchLength; i++) dst[d++] = dst[from++];
  }

  if (d !== outputSize) throw new Error(`corrupt LZ4 data (expected ${outputSize} bytes, got ${d})`);
  return dst;
}
