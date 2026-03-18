/**
 * Chase Bank Adapter — CSS selectors and extraction config for chase.com
 */

import type { BankAdapterConfig } from '../types';

export const chaseAdapter: BankAdapterConfig = {
  bankId: 'chase',
  name: 'Chase',
  loginUrl: 'https://secure.chase.com/web/auth/dashboard#/logon/existing',
  logoUrl: 'https://www.chase.com/etc/designs/chase-ux/favicon-152.png',

  selectors: {
    login: {
      usernameInput: '#userId-text-input-field',
      passwordInput: '#password-text-input-field',
      submitButton: '#signin-button',
      rememberMeCheckbox: '#rememberMe-checkbox-input-field',
      errorMessage: '.error-message, .alert-error, [data-testid="error-message"]',
    },
    mfa: {
      codeInput: '#otpcode_input-input-field',
      submitButton: '#log_on_to_landing_page-next',
      promptContainer: '.mfa-container, .verification-container',
      resendCodeButton: '.resend-code-link, [data-testid="resend-code"]',
      alternateMethodLink: '.try-another-way, [data-testid="alternate-method"]',
    },
    accountPage: {
      accountsList: '.accounts-container, #accountTileList',
      accountItem: '.account-tile, [data-testid="account-tile"]',
      accountName: '.account-name, .tile-accountName',
      accountNumber: '.account-number, .mask-number',
      accountBalance: '.account-balance, .tile-amount',
      accountType: '.account-type',
    },
    transactionTable: {
      transactionsList: '.transaction-list, #transaction-list',
      transactionRow: '.transaction-row, [data-testid="transaction-row"]',
      transactionDate: '.transaction-date, .trans-date',
      transactionDescription: '.transaction-description, .trans-desc',
      transactionAmount: '.transaction-amount, .trans-amount',
      transactionStatus: '.transaction-status, .pending-label',
      loadMoreButton: '.show-more-transactions, [data-testid="load-more"]',
      dateRangeFilter: '.date-range-selector, [data-testid="date-filter"]',
    },
  },

  extractors: {
    accounts: {
      readySelector: '.accounts-container, #accountTileList',
      readyTimeoutMs: 15000,
      fields: [
        { fieldName: 'accountName', selector: '.account-name, .tile-accountName', strategy: { type: 'textContent' }, transform: 'trim', required: true },
        { fieldName: 'accountNumber', selector: '.account-number, .mask-number', strategy: { type: 'textContent' }, transform: 'trim', required: false },
        { fieldName: 'balance', selector: '.account-balance, .tile-amount', strategy: { type: 'textContent' }, transform: 'parseAmount', required: true },
        { fieldName: 'accountType', selector: '.account-type', strategy: { type: 'textContent' }, transform: 'lowercase', required: false },
      ],
    },
    transactions: {
      readySelector: '.transaction-list, #transaction-list',
      readyTimeoutMs: 10000,
      fields: [
        { fieldName: 'date', selector: '.transaction-date, .trans-date', strategy: { type: 'textContent' }, transform: 'parseDate', required: true },
        { fieldName: 'description', selector: '.transaction-description, .trans-desc', strategy: { type: 'textContent' }, transform: 'trim', required: true },
        { fieldName: 'amount', selector: '.transaction-amount, .trans-amount', strategy: { type: 'textContent' }, transform: 'parseAmount', required: true },
        { fieldName: 'status', selector: '.transaction-status, .pending-label', strategy: { type: 'textContent' }, transform: 'lowercase', required: false },
      ],
    },
  },

  mfaDetector: {
    detectionTimeoutMs: 8000,
    successIndicator: '.accounts-container, #accountTileList, .dashboard-container',
    failureIndicator: '.error-message, .alert-error, [data-testid="error-message"]',
    rules: [
      { selector: '#otpcode_input-input-field', challengeType: 'sms_code', contextSelector: '.phone-mask, .masked-phone', priority: 10 },
      { selector: '.email-verification, [data-testid="email-otp"]', challengeType: 'email_code', contextSelector: '.email-mask, .masked-email', priority: 20 },
      { selector: '.security-question, [data-testid="security-question"]', challengeType: 'security_questions', contextSelector: '.question-text', priority: 30 },
      { selector: '.push-notification-prompt, [data-testid="push-verify"]', challengeType: 'push_notification', contextSelector: '.device-name', priority: 40 },
    ],
  },
} as const;
