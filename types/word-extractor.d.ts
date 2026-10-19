declare module "word-extractor" {
  interface ExtractedDocument {
    getBody(): string;
    getFootnotes(): string;
    getEndnotes(): string;
  }
  export default class WordExtractor {
    extract(source: string | Buffer): Promise<ExtractedDocument>;
  }
}
