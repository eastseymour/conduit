/**
 * Extractors module — data extraction from bank DOM pages.
 */

export {
  applyTransform,
  parseAmount,
  maskAccountNumber,
  inferAccountType,
  extractFieldValue,
  assembleAccount,
  extractAccountsFromRawData,
  buildExtractionScript,
} from './account-extractor';

export type {
  RawAccountFields,
  AccountExtractionResult,
  AccountExtractionConfig,
} from './account-extractor';
