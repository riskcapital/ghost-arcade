// pngjs ships no types and is only a transitive dependency; the compositor bench
// uses just enough of it to dump frames as PNGs.
declare module 'pngjs' {
  export class PNG {
    constructor(options: { width: number; height: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: { write(png: PNG): Buffer; read(buffer: Buffer): PNG };
  }
}
