import type { DocumentClassification } from '../types';

export interface ILayoutClassifier {
  classify(image: Buffer): Promise<DocumentClassification>;
}
