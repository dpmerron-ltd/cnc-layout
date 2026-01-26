declare module 'dxf-parser' {
  interface ParserOptions {
    tolerantMode?: boolean;
  }

  export default class DxfParser {
    constructor(options?: ParserOptions);
    parseSync(source: string | ArrayBuffer): any;
  }
}
