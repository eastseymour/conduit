/**
 * Bank Adapter Validation — ensures adapter configs are correct by construction.
 *
 * All validation runs at registration time so that invalid adapters
 * are rejected early, not discovered at runtime during a user session.
 */

import type {
  BankAdapterConfig,
  BankSelectors,
  LoginSelectors,
  MfaDetector,
  MfaDetectionRule,
  BankExtractors,
  PageExtractorConfig,
  FieldExtractor,
  ExtractionStrategy,
  MfaSelectors,
  AccountPageSelectors,
  TransactionTableSelectors,
} from './types';

// ─── Validation Result ───────────────────────────────────────────────

export interface AdapterValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────

const BANK_ID_PATTERN = /^[a-z][a-z0-9_]{0,49}$/;

function isValidBankId(bankId: string): boolean {
  return BANK_ID_PATTERN.test(bankId);
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateSelector(
  selector: string | undefined,
  fieldPath: string,
  required: boolean,
  errors: string[],
  warnings: string[],
): void {
  if (required) {
    if (!isNonEmptyString(selector)) {
      errors.push(`${fieldPath} is required and must be a non-empty string`);
    }
  } else if (selector !== undefined && !isNonEmptyString(selector)) {
    warnings.push(`${fieldPath} is defined but empty — consider removing it`);
  }
}

// ─── Login Selectors ─────────────────────────────────────────────────

function validateLoginSelectors(
  selectors: LoginSelectors,
  errors: string[],
  warnings: string[],
): void {
  const p = 'selectors.login';
  validateSelector(selectors.usernameInput, `${p}.usernameInput`, true, errors, warnings);
  validateSelector(selectors.passwordInput, `${p}.passwordInput`, true, errors, warnings);
  validateSelector(selectors.submitButton, `${p}.submitButton`, true, errors, warnings);
  validateSelector(selectors.rememberMeCheckbox, `${p}.rememberMeCheckbox`, false, errors, warnings);
  validateSelector(selectors.errorMessage, `${p}.errorMessage`, false, errors, warnings);
}

// ─── MFA Selectors ───────────────────────────────────────────────────

function validateMfaSelectors(
  selectors: MfaSelectors,
  _errors: string[],
  warnings: string[],
): void {
  const p = 'selectors.mfa';
  const fields: (keyof MfaSelectors)[] = [
    'codeInput', 'submitButton', 'securityQuestionText', 'securityQuestionInput',
    'resendCodeButton', 'alternateMethodLink', 'promptContainer',
  ];
  for (const field of fields) {
    if (selectors[field] !== undefined && !isNonEmptyString(selectors[field])) {
      warnings.push(`${p}.${field} is defined but empty`);
    }
  }
}

// ─── Account Page Selectors ──────────────────────────────────────────

function validateAccountPageSelectors(
  selectors: AccountPageSelectors,
  errors: string[],
  warnings: string[],
): void {
  const p = 'selectors.accountPage';
  validateSelector(selectors.accountsList, `${p}.accountsList`, true, errors, warnings);
  validateSelector(selectors.accountItem, `${p}.accountItem`, true, errors, warnings);
  validateSelector(selectors.accountName, `${p}.accountName`, true, errors, warnings);
  validateSelector(selectors.accountBalance, `${p}.accountBalance`, true, errors, warnings);
  validateSelector(selectors.accountNumber, `${p}.accountNumber`, false, errors, warnings);
  validateSelector(selectors.accountType, `${p}.accountType`, false, errors, warnings);
}

// ─── Transaction Table Selectors ─────────────────────────────────────

function validateTransactionTableSelectors(
  selectors: TransactionTableSelectors,
  errors: string[],
  warnings: string[],
): void {
  const p = 'selectors.transactionTable';
  validateSelector(selectors.transactionsList, `${p}.transactionsList`, true, errors, warnings);
  validateSelector(selectors.transactionRow, `${p}.transactionRow`, true, errors, warnings);
  validateSelector(selectors.transactionDate, `${p}.transactionDate`, true, errors, warnings);
  validateSelector(selectors.transactionDescription, `${p}.transactionDescription`, true, errors, warnings);
  validateSelector(selectors.transactionAmount, `${p}.transactionAmount`, true, errors, warnings);
  validateSelector(selectors.transactionStatus, `${p}.transactionStatus`, false, errors, warnings);
  validateSelector(selectors.transactionCategory, `${p}.transactionCategory`, false, errors, warnings);
  validateSelector(selectors.loadMoreButton, `${p}.loadMoreButton`, false, errors, warnings);
  validateSelector(selectors.dateRangeFilter, `${p}.dateRangeFilter`, false, errors, warnings);
}

// ─── Selectors ───────────────────────────────────────────────────────

function validateSelectors(
  selectors: BankSelectors,
  errors: string[],
  warnings: string[],
): void {
  if (!selectors.login) {
    errors.push('selectors.login is required');
    return;
  }
  validateLoginSelectors(selectors.login, errors, warnings);
  if (selectors.mfa) {
    validateMfaSelectors(selectors.mfa, errors, warnings);
  }
  if (selectors.accountPage) {
    validateAccountPageSelectors(selectors.accountPage, errors, warnings);
  }
  if (selectors.transactionTable) {
    validateTransactionTableSelectors(selectors.transactionTable, errors, warnings);
  }
}

// ─── MFA Detector ────────────────────────────────────────────────────

function validateMfaDetector(
  detector: MfaDetector,
  errors: string[],
  warnings: string[],
): void {
  if (!detector.rules || detector.rules.length === 0) {
    errors.push('mfaDetector.rules must contain at least one detection rule');
    return;
  }

  const seenSelectors = new Set<string>();
  for (let i = 0; i < detector.rules.length; i++) {
    const rule: MfaDetectionRule | undefined = detector.rules[i];
    if (!rule) continue;
    const prefix = `mfaDetector.rules[${i}]`;

    if (!isNonEmptyString(rule.selector)) {
      errors.push(`${prefix}.selector must be a non-empty string`);
    } else if (seenSelectors.has(rule.selector)) {
      warnings.push(`${prefix}.selector "${rule.selector}" is duplicated`);
    } else {
      seenSelectors.add(rule.selector);
    }

    if (!isNonEmptyString(rule.challengeType)) {
      errors.push(`${prefix}.challengeType must be a non-empty string`);
    }

    if (rule.contextSelector !== undefined && !isNonEmptyString(rule.contextSelector)) {
      warnings.push(`${prefix}.contextSelector is defined but empty`);
    }

    if (rule.priority !== undefined && (rule.priority < 0 || !Number.isFinite(rule.priority))) {
      errors.push(`${prefix}.priority must be a non-negative finite number`);
    }
  }

  if (
    detector.detectionTimeoutMs !== undefined &&
    (detector.detectionTimeoutMs <= 0 || !Number.isFinite(detector.detectionTimeoutMs))
  ) {
    errors.push('mfaDetector.detectionTimeoutMs must be a positive finite number');
  }
}

// ─── Extractors ──────────────────────────────────────────────────────

function validateExtractionStrategy(
  strategy: ExtractionStrategy,
  prefix: string,
  errors: string[],
): void {
  switch (strategy.type) {
    case 'textContent':
    case 'innerText':
    case 'value':
      break;
    case 'attribute':
      if (!isNonEmptyString(strategy.attributeName)) {
        errors.push(`${prefix}.strategy.attributeName must be a non-empty string`);
      }
      break;
    case 'regex':
      if (!isNonEmptyString(strategy.pattern)) {
        errors.push(`${prefix}.strategy.pattern must be a non-empty string`);
      } else {
        try {
          new RegExp(strategy.pattern);
        } catch {
          errors.push(`${prefix}.strategy.pattern is not a valid regex: "${strategy.pattern}"`);
        }
      }
      if (
        strategy.groupIndex !== undefined &&
        (strategy.groupIndex < 0 || !Number.isInteger(strategy.groupIndex))
      ) {
        errors.push(`${prefix}.strategy.groupIndex must be a non-negative integer`);
      }
      break;
    default: {
      const _exhaustive: never = strategy;
      errors.push(`${prefix}.strategy has unknown type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

function validateFieldExtractor(
  field: FieldExtractor,
  prefix: string,
  errors: string[],
  warnings: string[],
): void {
  if (!isNonEmptyString(field.fieldName)) {
    errors.push(`${prefix}.fieldName must be a non-empty string`);
  }
  validateSelector(field.selector, `${prefix}.selector`, true, errors, warnings);
  if (!field.strategy) {
    errors.push(`${prefix}.strategy is required`);
  } else {
    validateExtractionStrategy(field.strategy, prefix, errors);
  }
}

function validatePageExtractorConfig(
  config: PageExtractorConfig,
  name: string,
  errors: string[],
  warnings: string[],
): void {
  const prefix = `extractors.${name}`;
  if (!isNonEmptyString(config.readySelector)) {
    errors.push(`${prefix}.readySelector must be a non-empty string`);
  }
  if (
    config.readyTimeoutMs !== undefined &&
    (config.readyTimeoutMs <= 0 || !Number.isFinite(config.readyTimeoutMs))
  ) {
    errors.push(`${prefix}.readyTimeoutMs must be a positive finite number`);
  }
  if (!config.fields || config.fields.length === 0) {
    warnings.push(`${prefix}.fields is empty — no data will be extracted`);
  } else {
    const fieldNames = new Set<string>();
    for (let i = 0; i < config.fields.length; i++) {
      const field = config.fields[i];
      if (!field) continue;
      validateFieldExtractor(field, `${prefix}.fields[${i}]`, errors, warnings);
      if (field.fieldName && fieldNames.has(field.fieldName)) {
        warnings.push(`${prefix}.fields[${i}].fieldName "${field.fieldName}" is duplicated`);
      }
      fieldNames.add(field.fieldName);
    }
  }
}

function validateExtractors(
  extractors: BankExtractors,
  errors: string[],
  warnings: string[],
): void {
  if (extractors.accounts) {
    validatePageExtractorConfig(extractors.accounts, 'accounts', errors, warnings);
  }
  if (extractors.transactions) {
    validatePageExtractorConfig(extractors.transactions, 'transactions', errors, warnings);
  }
  if (extractors.accountDetails) {
    validatePageExtractorConfig(extractors.accountDetails, 'accountDetails', errors, warnings);
  }
}

// ─── Top-Level Validation ────────────────────────────────────────────

/**
 * Validate a complete bank adapter configuration.
 */
export function validateBankAdapterConfig(config: BankAdapterConfig): AdapterValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isNonEmptyString(config.bankId)) {
    errors.push('bankId must be a non-empty string');
  } else if (!isValidBankId(config.bankId)) {
    errors.push(
      `bankId "${config.bankId}" must be lowercase alphanumeric + underscores, starting with a letter, max 50 chars`,
    );
  }

  if (!isNonEmptyString(config.name)) {
    errors.push('name must be a non-empty string');
  }

  if (!isNonEmptyString(config.loginUrl)) {
    errors.push('loginUrl must be a non-empty string');
  } else if (!isValidUrl(config.loginUrl)) {
    errors.push(`loginUrl "${config.loginUrl}" is not a valid URL`);
  }

  if (config.logoUrl !== undefined) {
    if (!isNonEmptyString(config.logoUrl)) {
      warnings.push('logoUrl is defined but empty');
    } else if (!isValidUrl(config.logoUrl)) {
      warnings.push(`logoUrl "${config.logoUrl}" is not a valid URL`);
    }
  }

  if (!config.selectors) {
    errors.push('selectors is required');
  } else {
    validateSelectors(config.selectors, errors, warnings);
  }

  if (!config.extractors) {
    errors.push('extractors is required');
  } else {
    validateExtractors(config.extractors, errors, warnings);
  }

  if (!config.mfaDetector) {
    errors.push('mfaDetector is required');
  } else {
    validateMfaDetector(config.mfaDetector, errors, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Assert that a bank adapter config is valid. Throws if validation fails.
 */
export function assertValidBankAdapterConfig(config: BankAdapterConfig): void {
  const result = validateBankAdapterConfig(config);
  if (!result.valid) {
    throw new Error(
      `Invalid bank adapter config for "${config.bankId}": ${result.errors.join('; ')}`,
    );
  }
}
