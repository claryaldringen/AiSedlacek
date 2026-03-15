import type { DocumentClassification } from '../types.js';

export interface ILayoutClassifier {
  classify(image: Buffer): Promise<DocumentClassification>;
}
