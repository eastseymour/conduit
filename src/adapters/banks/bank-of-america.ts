/**
 * Bank of America Adapter — CSS selectors and extraction config for bankofamerica.com
 */

import type { BankAdapterConfig } from '../types';

export const bankOfAmericaAdapter: BankAdapterConfig = {
  bankId: 'bofa',
  name: 'Bank of America',
  loginUrl: 'https://www.bankofamerica.com/smallbusiness/online-banking/sign-in/',
  logoUrl: 'https://www.bankofamerica.com/favicon.ico',

  selectors: {
    login: {
      usernameInput: '#onlineId1',
      passwordInput: '#passcode1',
      submitButton: '#signIn',
      rememberMeCheckbox: '#hp-save-online-id',
      errorMessage: '.error-message, #error-container, .alert-message-container',
    },
    mfa: {
      codeInput: '#tlpvt-challenge-answer, #VerifyOTPForm input[type="text"]',
      submitButton: '#verify-cta-submit, .btn-submit',
      securityQuestionText: '.question-text, #challenge-question',
      securityQuestionInput: '#tlpvt-challenge-answer',
      promptContainer: '.challenge-container, #VerifyOTPForm',
      resendCodeButton: '.resend-link, [data-testid="resend"]',
      alternateMethodLink: '.try-another-link, #try-another-way',
    },
    accountPage: {
      accountsList: '#traditional-balances, .balances-container',
      accountItem: '.AccountItem, .account-row',
      accountName: '.AccountName, .account-name-mask',
      accountNumber: '.AccountNumber, .account-number',
      accountBalance: '.AccountBalance, .balance-value',
      accountType: '.account-type-label',
    },
    transactionTable: {
      transactionsList: '#transactions-table, .transaction-records',
      transactionRow: '.transaction-record, tr.record',
      transactionDate: '.trans-date-col, td.date-col',
      transactionDescription: '.trans-desc-col, td.desc-col',
      transactionAmount: '.trans-amount-col, td.amount-col',
      transactionStatus: '.trans-status, .pending-indicator',
      transactionCategory: '.trans-category',
      loadMoreButton: '.view-more-transactions, #showMore',
      dateRangeFilter: '.date-range-picker, #date-filter',
    },
  },

  extractors: {
    accounts: {
      readySelector: '#traditional-balances, .balances-container',
      readyTimeoutMs: 15000,
      fields: [
        {
          fieldName: 'accountName',
          selector: '.AccountName, .account-name-mask',
          strategy: { type: 'textContent' },
          transform: 'trim',
          required: true,
        },
        {
          fieldName: 'accountNumber',
          selector: '.AccountNumber, .account-number',
          strategy: { type: 'textContent' },
          transform: 'trim',
          required: false,
        },
        {
          fieldName: 'balance',
          selector: '.AccountBalance, .balance-value',
          strategy: { type: 'textContent' },
          transform: 'parseAmount',
          required: true,
        },
        {
          fieldName: 'accountType',
          selector: '.account-type-label',
          strategy: { type: 'textContent' },
          transform: 'lowercase',
          required: false,
        },
      ],
    },
    transactions: {
      readySelector: '#transactions-table, .transaction-records',
      readyTimeoutMs: 10000,
      fields: [
        {
          fieldName: 'date',
          selector: '.trans-date-col, td.date-col',
          strategy: { type: 'textContent' },
          transform: 'parseDate',
          required: true,
        },
        {
          fieldName: 'description',
          selector: '.trans-desc-col, td.desc-col',
          strategy: { type: 'textContent' },
          transform: 'trim',
          required: true,
        },
        {
          fieldName: 'amount',
          selector: '.trans-amount-col, td.amount-col',
          strategy: { type: 'textContent' },
          transform: 'parseAmount',
          required: true,
        },
        {
          fieldName: 'status',
          selector: '.trans-status, .pending-indicator',
          strategy: { type: 'textContent' },
          transform: 'lowercase',
          required: false,
        },
        {
          fieldName: 'category',
          selector: '.trans-category',
          strategy: { type: 'textContent' },
          transform: 'trim',
          required: false,
        },
      ],
    },
  },

  mfaDetector: {
    detectionTimeoutMs: 8000,
    successIndicator: '#traditional-balances, .balances-container, .accounts-overview',
    failureIndicator: '.error-message, #error-container, .alert-message-container',
    rules: [
      {
        selector: '#VerifyOTPForm, .sms-challenge',
        challengeType: 'sms_code',
        contextSelector: '.masked-phone, .phone-hint',
        priority: 10,
      },
      {
        selector: '.email-otp-challenge, [data-testid="email-challenge"]',
        challengeType: 'email_code',
        contextSelector: '.masked-email, .email-hint',
        priority: 20,
      },
      {
        selector: '#challenge-question, .security-question-form',
        challengeType: 'security_questions',
        contextSelector: '.question-text, #challenge-question',
        priority: 30,
      },
      {
        selector: '.push-auth-prompt, .device-verification',
        challengeType: 'push_notification',
        contextSelector: '.device-info',
        priority: 40,
      },
    ],
  },
} as const;
