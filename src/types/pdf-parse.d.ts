declare module "pdf-parse" {
  interface PDFParseOptions {
    url?: string;
    data?: Uint8Array | ArrayBuffer;
  }

  interface PDFParseResult {
    text: string;
  }

  class PDFParse {
    constructor(options: PDFParseOptions);
    getText(): Promise<PDFParseResult>;
  }

  export { PDFParse };
}
