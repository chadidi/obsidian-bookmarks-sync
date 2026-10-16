declare module 'bplist-parser' {
  interface BplistParser {
    /** Parses a binary plist. Returns an array whose first element is the root object. */
    parseBuffer(buffer: Uint8Array): unknown[];
    /** Safety limits; the library default (32 768 objects) is too small for large bookmark libraries. */
    maxObjectCount: number;
    maxObjectSize: number;
  }
  const bplist: BplistParser;
  export default bplist;
}
