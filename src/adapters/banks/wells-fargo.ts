/**
 * Wells Fargo Adapter — CSS selectors and extraction config for wellsfargo.com
 */

import type { BankAdapterConfig } from '../types';

export const wellsFargoAdapter: BankAdapterConfig = {
  bankId: 'wells_fargo',
  name: 'Wells Fargo',
  loginUrl: 'https://connect.secure.wellsfargo.com/auth/login/present',
  logoUrl: 'https://www.wellsfargo.com/assets/images/icons/favicon.ico',

  selectors: {
    login: {
      usernameInput: '#j_username',
      passwordInput: '#j_password',
      submitButton: '#btnSignon',
      rememberMeCheckbox: '#rememberUser',
      errorMessage: '.error-text, .errormessage, #error-message',
    },
    mfa: {
      codeInput: '#otp, #verificationCode, input[name="otp"]',
      submitButton: '#btnSubmit, .btn-primary[type="submit"]',
      securityQuestionText: '.challenge-question, #challengeQuestion',
      securityQuestionInput: '#challengeAnswer, input[name="answer"]',
      promptContainer: '.verification-wrapper, #mfa-container',
      resendCodeButton: '.resend-btn, #resendCode',
      alternateMethodLink: '.alt-method-link, #tryAnotherWay',
    },
    accountPage: {
      accountsList: '#accountTable, .account-summary',
      accountItem: '.account-row, tr.account',
      accountName: '.account-name, .acct-name',
      accountNumber: '.account-number, .acct-number',
      accountBalance: '.account-balance, .available-balance',
      accountType: '.acct-type',
    },
    transactionTable: {
      transactionsList: '#DDA-content, .transaction-table',
      transactionRow: '.transaction-row, tr.activity-row',
      transactionDate: '.trans-date, td.date',
      transactionDescription: '.trans-description, td.description',
      transactionAmount: '.trans-amount, td.amount',
      transactionStatus: '.trans-status, .pending-text',
      loadMoreButton: '.view-more, #loadMoreTransactions',
      dateRangeFilter: '.date-range, #dateRangeSelector',
    },
  },

  extractors: {
    accounts: {
      readySelector: '#accountTable, .account-summary',
      readyTimeoutMs: 15000,
      fields: [
        { fieldName: 'accountName', selector: '.account-name, .acct-name', strategy: { type: 'textContent' }, transform: 'trim', required: true },
        { fieldName: 'accountNumber', selector: '.account-number, .acct-number', strategy: { type: 'textContent' }, transform: 'trim', required: false },
        { fieldName: 'balance', selector: '.account-balance, .available-balance', strategy: { type: 'textContent' }, transform: 'parseAmount', required: true },
        { fieldName: 'accountType', selector: '.acct-type', strategy: { type: 'textContent' }, transform: 'lowercase', required: false },
      ],
    },
    transactions: {
      readySelector: '#DDA-content, .transaction-table',
      readyTimeoutMs: 10000,
      fields: [
        { fieldName: 'date', selector: '.trans-date, td.date', strategy: { type: 'textContent' }, transform: 'parseDate', required: true },
        { fieldName: 'description', selector: '.trans-description, td.description', strategy: { type: 'textContent' }, transform: 'trim', required: true },
        { fieldName: 'amount', selector: '.trans-amount, td.amount', strategy: { type: 'textContent' }, transform: 'parseAmount', required: true },
        { fieldName: 'status', selector: '.trans-status, .pending-text', strategy: { type: 'textContent' }, transform: 'lowercase', required: false },
      ],
    },
    accountDetails: {
      readySelector: '.account-details, #accountDetailsPanel',
      readyTimeoutMs: 10000,
      fields: [
        { fieldName: 'fullAccountNumber', selector: '.full-account-number, #fullAcctNumber', strategy: { type: 'textContent' }, transform: 'stripWhitespace', required: true },
        { fieldName: 'routingNumber', selector: '.routing-number, #routingNumber', strategy: { type: 'textContent' }, transform: 'stripWhitespace', required: true },
      ],
    },
  },

  mfaDetector: {
    detectionTimeoutMs: 10000,
    successIndicator: '#accountTable, .account-summary, .dashboard-overview',
    failureIndicator: '.error-text, .errormessage, #error-message',
    rules: [
      { selector: '#otp, input[name="otp"]', challengeType: 'sms_code', contextSelector: '.phone-display, .masked-phone', priority: 10 },
      { selector: '.email-verification-form, #emailOTP', challengeType: 'email_code', contextSelector: '.email-display, .masked-email', priority: 20 },
      { selector: '#challengeQuestion, .challenge-question', challengeType: 'security_questions', contextSelector: '.challenge-question, #challengeQuestion', priority: 30 },
      { selector: '.push-notification, #pushAuthPrompt', challengeType: 'push_notification', contextSelector: '.device-display', priority: 40 },
    ],
  },
} as const;
