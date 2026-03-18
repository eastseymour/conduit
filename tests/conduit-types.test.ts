/**
 * Tests for the core Conduit SDK types: Account, Transaction, BankAdapter,
 * ConduitConfig, LinkSession, and related types.
 */

import {
  AccountType,
  type AccountTypeName,
  type Account,
  type AccountBalance,
  TransactionStatus,
  type TransactionStatusName,
  type Transaction,
  type BankAdapterMetadata,
  type BankAdapter,
  LogLevel,
  type LogLevelName,
  type ConduitConfig,
  assertValidConfig,
  LinkSessionPhase,
  type LinkSessionPhaseName,
  type LinkSession,
  type LinkSessionCreated,
  type LinkSessionSucceeded,
  type LinkSessionFailed,
  type LinkSessionExtracting,
  LinkErrorCode,
  type LinkError,
  isValidLinkTransition,
  assertValidLinkTransition,
} from '../src/types/conduit';

// ─── Account Type Tests ──────────────────────────────────────────────

describe('AccountType', () => {
  it('has all expected account types', () => {
    expect(AccountType.Checking).toBe('checking');
    expect(AccountType.Savings).toBe('savings');
    expect(AccountType.CreditCard).toBe('credit_card');
    expect(AccountType.Loan).toBe('loan');
    expect(AccountType.Investment).toBe('investment');
    expect(AccountType.Mortgage).toBe('mortgage');
    expect(AccountType.LineOfCredit).toBe('line_of_credit');
    expect(AccountType.Other).toBe('other');
  });

  it('values are usable as AccountTypeName', () => {
    const types: AccountTypeName[] = [
      AccountType.Checking,
      AccountType.Savings,
      AccountType.CreditCard,
      AccountType.Loan,
      AccountType.Investment,
      AccountType.Mortgage,
      AccountType.LineOfCredit,
      AccountType.Other,
    ];
    expect(types).toHaveLength(8);
  });
});

describe('Account interface', () => {
  const validAccount: Account = {
    id: 'acc-001',
    name: 'Personal Checking',
    officialName: 'CHECKING PLUS',
    type: AccountType.Checking,
    accountNumber: '****1234',
    routingNumber: '021000021',
    balance: { current: 1500.42, available: 1400.0, limit: undefined },
    currency: 'USD',
    institutionId: 'chase',
  };

  it('constructs a valid Account object', () => {
    expect(validAccount.id).toBe('acc-001');
    expect(validAccount.type).toBe('checking');
    expect(validAccount.balance.current).toBe(1500.42);
    expect(validAccount.routingNumber).toBe('021000021');
  });

  it('allows optional fields to be omitted', () => {
    const minimal: Account = {
      id: 'acc-002',
      name: 'Savings',
      type: AccountType.Savings,
      accountNumber: '****5678',
      balance: { current: 500.0 },
      currency: 'USD',
      institutionId: 'wells_fargo',
    };
    expect(minimal.officialName).toBeUndefined();
    expect(minimal.routingNumber).toBeUndefined();
    expect(minimal.balance.available).toBeUndefined();
    expect(minimal.balance.limit).toBeUndefined();
  });
});

describe('AccountBalance', () => {
  it('requires current, optionally has available and limit', () => {
    const b1: AccountBalance = { current: 100 };
    expect(b1.current).toBe(100);

    const b2: AccountBalance = { current: 100, available: 90 };
    expect(b2.available).toBe(90);

    const b3: AccountBalance = { current: -500, available: 1500, limit: 2000 };
    expect(b3.limit).toBe(2000);
  });
});

// ─── Transaction Type Tests ──────────────────────────────────────────

describe('TransactionStatus', () => {
  it('has pending and posted', () => {
    expect(TransactionStatus.Pending).toBe('pending');
    expect(TransactionStatus.Posted).toBe('posted');
  });

  it('values are usable as TransactionStatusName', () => {
    const statuses: TransactionStatusName[] = [
      TransactionStatus.Pending,
      TransactionStatus.Posted,
    ];
    expect(statuses).toHaveLength(2);
  });
});

describe('Transaction interface', () => {
  const validTransaction: Transaction = {
    id: 'txn-001',
    accountId: 'acc-001',
    amount: -42.5,
    currency: 'USD',
    date: '2024-01-15',
    description: 'AMAZON MARKETPLACE',
    merchantName: 'Amazon',
    category: 'Shopping',
    status: TransactionStatus.Posted,
    transactionType: 'POS',
  };

  it('constructs a valid Transaction object', () => {
    expect(validTransaction.id).toBe('txn-001');
    expect(validTransaction.amount).toBe(-42.5);
    expect(validTransaction.status).toBe('posted');
    expect(validTransaction.merchantName).toBe('Amazon');
  });

  it('supports positive amounts for credits', () => {
    const credit: Transaction = {
      id: 'txn-002',
      accountId: 'acc-001',
      amount: 1000.0,
      currency: 'USD',
      date: '2024-01-16',
      description: 'PAYROLL DEPOSIT',
      status: TransactionStatus.Posted,
    };
    expect(credit.amount).toBeGreaterThan(0);
  });

  it('allows optional fields to be omitted', () => {
    const minimal: Transaction = {
      id: 'txn-003',
      accountId: 'acc-001',
      amount: -10,
      currency: 'USD',
      date: '2024-01-17',
      description: 'ATM WITHDRAWAL',
      status: TransactionStatus.Pending,
    };
    expect(minimal.merchantName).toBeUndefined();
    expect(minimal.category).toBeUndefined();
    expect(minimal.transactionType).toBeUndefined();
  });
});

// ─── BankAdapter Tests ───────────────────────────────────────────────

describe('BankAdapterMetadata', () => {
  it('describes adapter capabilities', () => {
    const meta: BankAdapterMetadata = {
      bankId: 'chase',
      displayName: 'Chase Bank',
      baseUrl: 'https://www.chase.com',
      loginUrl: 'https://www.chase.com/web/auth/login',
      supportsTransactions: true,
      supportsAccountNumbers: true,
      supportsRoutingNumbers: true,
    };
    expect(meta.bankId).toBe('chase');
    expect(meta.supportsTransactions).toBe(true);
  });
});

describe('BankAdapter interface', () => {
  it('can be implemented as a mock', async () => {
    const mockAdapter: BankAdapter = {
      metadata: {
        bankId: 'mock-bank',
        displayName: 'Mock Bank',
        baseUrl: 'https://mock.bank.com',
        loginUrl: 'https://mock.bank.com/login',
        supportsTransactions: true,
        supportsAccountNumbers: true,
        supportsRoutingNumbers: false,
      },
      authenticate: jest.fn().mockResolvedValue(true),
      getAccounts: jest.fn().mockResolvedValue([
        {
          id: 'acc-001',
          name: 'Checking',
          type: AccountType.Checking,
          accountNumber: '****1234',
          balance: { current: 1000 },
          currency: 'USD',
          institutionId: 'mock-bank',
        },
      ]),
      getTransactions: jest.fn().mockResolvedValue([]),
      cleanup: jest.fn().mockResolvedValue(undefined),
    };

    const authenticated = await mockAdapter.authenticate();
    expect(authenticated).toBe(true);

    const accounts = await mockAdapter.getAccounts();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]!.type).toBe('checking');

    const txns = await mockAdapter.getTransactions('acc-001', '2024-01-01', '2024-01-31');
    expect(txns).toEqual([]);

    await mockAdapter.cleanup();
    expect(mockAdapter.cleanup).toHaveBeenCalled();
  });
});

// ─── ConduitConfig Tests ─────────────────────────────────────────────

describe('LogLevel', () => {
  it('has all expected levels', () => {
    expect(LogLevel.None).toBe('none');
    expect(LogLevel.Error).toBe('error');
    expect(LogLevel.Warn).toBe('warn');
    expect(LogLevel.Info).toBe('info');
    expect(LogLevel.Debug).toBe('debug');
  });

  it('values are usable as LogLevelName', () => {
    const levels: LogLevelName[] = [
      LogLevel.None,
      LogLevel.Error,
      LogLevel.Warn,
      LogLevel.Info,
      LogLevel.Debug,
    ];
    expect(levels).toHaveLength(5);
  });
});

describe('ConduitConfig', () => {
  const validConfig: ConduitConfig = {
    clientId: 'client_abc123',
    environment: 'sandbox',
  };

  it('constructs a valid minimal config', () => {
    expect(validConfig.clientId).toBe('client_abc123');
    expect(validConfig.environment).toBe('sandbox');
  });

  it('supports all optional fields', () => {
    const full: ConduitConfig = {
      clientId: 'client_abc',
      secret: 'secret_xyz',
      environment: 'production',
      locale: 'en',
      logLevel: LogLevel.Debug,
      navigationTimeoutMs: 60000,
      mfaTimeoutMs: 600000,
      showPreview: false,
    };
    expect(full.secret).toBe('secret_xyz');
    expect(full.logLevel).toBe('debug');
    expect(full.showPreview).toBe(false);
  });
});

describe('assertValidConfig', () => {
  it('accepts valid config', () => {
    expect(() =>
      assertValidConfig({ clientId: 'abc', environment: 'sandbox' }),
    ).not.toThrow();
  });

  it('rejects empty clientId', () => {
    expect(() =>
      assertValidConfig({ clientId: '', environment: 'sandbox' }),
    ).toThrow('clientId must be a non-empty string');
  });

  it('rejects whitespace-only clientId', () => {
    expect(() =>
      assertValidConfig({ clientId: '   ', environment: 'sandbox' }),
    ).toThrow('clientId must be a non-empty string');
  });

  it('rejects zero navigation timeout', () => {
    expect(() =>
      assertValidConfig({
        clientId: 'abc',
        environment: 'sandbox',
        navigationTimeoutMs: 0,
      }),
    ).toThrow('navigationTimeoutMs must be a positive finite number');
  });

  it('rejects negative navigation timeout', () => {
    expect(() =>
      assertValidConfig({
        clientId: 'abc',
        environment: 'sandbox',
        navigationTimeoutMs: -100,
      }),
    ).toThrow('navigationTimeoutMs must be a positive finite number');
  });

  it('rejects Infinity navigation timeout', () => {
    expect(() =>
      assertValidConfig({
        clientId: 'abc',
        environment: 'sandbox',
        navigationTimeoutMs: Infinity,
      }),
    ).toThrow('navigationTimeoutMs must be a positive finite number');
  });

  it('rejects negative MFA timeout', () => {
    expect(() =>
      assertValidConfig({
        clientId: 'abc',
        environment: 'sandbox',
        mfaTimeoutMs: -1,
      }),
    ).toThrow('mfaTimeoutMs must be a positive finite number');
  });

  it('accepts valid timeouts', () => {
    expect(() =>
      assertValidConfig({
        clientId: 'abc',
        environment: 'sandbox',
        navigationTimeoutMs: 30000,
        mfaTimeoutMs: 300000,
      }),
    ).not.toThrow();
  });
});

// ─── LinkSession Tests ───────────────────────────────────────────────

describe('LinkSessionPhase', () => {
  it('has all expected phases', () => {
    expect(LinkSessionPhase.Created).toBe('created');
    expect(LinkSessionPhase.InstitutionSelected).toBe('institution_selected');
    expect(LinkSessionPhase.Authenticating).toBe('authenticating');
    expect(LinkSessionPhase.MfaRequired).toBe('mfa_required');
    expect(LinkSessionPhase.Extracting).toBe('extracting');
    expect(LinkSessionPhase.Succeeded).toBe('succeeded');
    expect(LinkSessionPhase.Failed).toBe('failed');
    expect(LinkSessionPhase.Cancelled).toBe('cancelled');
  });

  it('values are usable as LinkSessionPhaseName', () => {
    const phases: LinkSessionPhaseName[] = [
      LinkSessionPhase.Created,
      LinkSessionPhase.InstitutionSelected,
      LinkSessionPhase.Authenticating,
      LinkSessionPhase.MfaRequired,
      LinkSessionPhase.Extracting,
      LinkSessionPhase.Succeeded,
      LinkSessionPhase.Failed,
      LinkSessionPhase.Cancelled,
    ];
    expect(phases).toHaveLength(8);
  });
});

describe('LinkSession discriminated union', () => {
  it('can narrow types via switch on phase', () => {
    const sessions: LinkSession[] = [
      { phase: LinkSessionPhase.Created, sessionId: 's1', createdAt: Date.now() },
      {
        phase: LinkSessionPhase.InstitutionSelected,
        sessionId: 's1',
        createdAt: Date.now(),
        institutionId: 'chase',
        institutionName: 'Chase Bank',
      },
      {
        phase: LinkSessionPhase.Authenticating,
        sessionId: 's1',
        createdAt: Date.now(),
        institutionId: 'chase',
      },
      {
        phase: LinkSessionPhase.MfaRequired,
        sessionId: 's1',
        createdAt: Date.now(),
        institutionId: 'chase',
        mfaChallengeType: 'sms_code',
      },
      {
        phase: LinkSessionPhase.Extracting,
        sessionId: 's1',
        createdAt: Date.now(),
        institutionId: 'chase',
        progress: 0.5,
      },
      {
        phase: LinkSessionPhase.Succeeded,
        sessionId: 's1',
        createdAt: Date.now(),
        completedAt: Date.now(),
        institutionId: 'chase',
        accounts: [],
      },
      {
        phase: LinkSessionPhase.Failed,
        sessionId: 's1',
        createdAt: Date.now(),
        failedAt: Date.now(),
        error: { code: LinkErrorCode.AuthenticationFailed, message: 'Bad password' },
      },
      {
        phase: LinkSessionPhase.Cancelled,
        sessionId: 's1',
        createdAt: Date.now(),
        cancelledAt: Date.now(),
      },
    ];

    const phases = sessions.map((s) => {
      switch (s.phase) {
        case 'created':
          return `created:${s.sessionId}`;
        case 'institution_selected':
          return `selected:${s.institutionName}`;
        case 'authenticating':
          return `auth:${s.institutionId}`;
        case 'mfa_required':
          return `mfa:${s.mfaChallengeType}`;
        case 'extracting':
          return `extracting:${s.progress}`;
        case 'succeeded':
          return `ok:${s.accounts.length}`;
        case 'failed':
          return `fail:${s.error.code}`;
        case 'cancelled':
          return `cancel:${s.cancelledAt > 0}`;
      }
    });

    expect(phases).toEqual([
      'created:s1',
      'selected:Chase Bank',
      'auth:chase',
      'mfa:sms_code',
      'extracting:0.5',
      'ok:0',
      'fail:AUTHENTICATION_FAILED',
      'cancel:true',
    ]);
  });
});

describe('LinkSession state variants', () => {
  it('LinkSessionCreated has minimal fields', () => {
    const s: LinkSessionCreated = {
      phase: LinkSessionPhase.Created,
      sessionId: 'sess-001',
      createdAt: Date.now(),
    };
    expect(s.phase).toBe('created');
    expect(s.sessionId).toBe('sess-001');
  });

  it('LinkSessionSucceeded carries accounts', () => {
    const s: LinkSessionSucceeded = {
      phase: LinkSessionPhase.Succeeded,
      sessionId: 'sess-001',
      createdAt: Date.now() - 5000,
      completedAt: Date.now(),
      institutionId: 'chase',
      accounts: [
        {
          id: 'acc-1',
          name: 'Checking',
          type: AccountType.Checking,
          accountNumber: '****1234',
          balance: { current: 1000 },
          currency: 'USD',
          institutionId: 'chase',
        },
      ],
    };
    expect(s.accounts).toHaveLength(1);
    expect(s.completedAt).toBeGreaterThan(s.createdAt);
  });

  it('LinkSessionFailed carries error details', () => {
    const s: LinkSessionFailed = {
      phase: LinkSessionPhase.Failed,
      sessionId: 'sess-002',
      createdAt: Date.now(),
      failedAt: Date.now(),
      error: {
        code: LinkErrorCode.Timeout,
        message: 'Page load timed out',
        institutionId: 'chase',
        displayMessage: 'Something went wrong. Please try again.',
      },
    };
    expect(s.error.code).toBe('TIMEOUT');
    expect(s.error.displayMessage).toBeDefined();
  });

  it('LinkSessionExtracting has progress between 0 and 1', () => {
    const s: LinkSessionExtracting = {
      phase: LinkSessionPhase.Extracting,
      sessionId: 'sess-003',
      createdAt: Date.now(),
      institutionId: 'bofa',
      progress: 0.75,
    };
    expect(s.progress).toBeGreaterThanOrEqual(0);
    expect(s.progress).toBeLessThanOrEqual(1);
  });
});

// ─── LinkError Tests ─────────────────────────────────────────────────

describe('LinkErrorCode', () => {
  it('has all expected error codes', () => {
    expect(LinkErrorCode.InstitutionNotSupported).toBe('INSTITUTION_NOT_SUPPORTED');
    expect(LinkErrorCode.AuthenticationFailed).toBe('AUTHENTICATION_FAILED');
    expect(LinkErrorCode.MfaFailed).toBe('MFA_FAILED');
    expect(LinkErrorCode.MfaTimeout).toBe('MFA_TIMEOUT');
    expect(LinkErrorCode.ExtractionFailed).toBe('EXTRACTION_FAILED');
    expect(LinkErrorCode.Timeout).toBe('TIMEOUT');
    expect(LinkErrorCode.NetworkError).toBe('NETWORK_ERROR');
    expect(LinkErrorCode.InternalError).toBe('INTERNAL_ERROR');
    expect(LinkErrorCode.UserCancelled).toBe('USER_CANCELLED');
  });
});

describe('LinkError', () => {
  it('constructs a valid error', () => {
    const err: LinkError = {
      code: LinkErrorCode.AuthenticationFailed,
      message: 'Invalid credentials',
      institutionId: 'chase',
      displayMessage: 'Please check your username and password.',
    };
    expect(err.code).toBe('AUTHENTICATION_FAILED');
    expect(err.institutionId).toBe('chase');
  });

  it('allows optional fields to be omitted', () => {
    const err: LinkError = {
      code: LinkErrorCode.InternalError,
      message: 'Unexpected error',
    };
    expect(err.institutionId).toBeUndefined();
    expect(err.displayMessage).toBeUndefined();
  });
});

// ─── LinkSession State Machine Tests ─────────────────────────────────

describe('LinkSession state machine', () => {
  describe('valid transitions', () => {
    const validPairs: [string, string][] = [
      ['created', 'institution_selected'],
      ['created', 'cancelled'],
      ['institution_selected', 'authenticating'],
      ['institution_selected', 'cancelled'],
      ['authenticating', 'mfa_required'],
      ['authenticating', 'extracting'],
      ['authenticating', 'failed'],
      ['authenticating', 'cancelled'],
      ['mfa_required', 'authenticating'],
      ['mfa_required', 'failed'],
      ['mfa_required', 'cancelled'],
      ['extracting', 'succeeded'],
      ['extracting', 'failed'],
      ['extracting', 'cancelled'],
    ];

    test.each(validPairs)('%s → %s is valid', (from, to) => {
      expect(
        isValidLinkTransition(from as LinkSessionPhaseName, to as LinkSessionPhaseName),
      ).toBe(true);
    });
  });

  describe('invalid transitions', () => {
    const invalidPairs: [string, string][] = [
      ['created', 'authenticating'],
      ['created', 'extracting'],
      ['created', 'succeeded'],
      ['created', 'failed'],
      ['institution_selected', 'extracting'],
      ['institution_selected', 'succeeded'],
      ['authenticating', 'succeeded'],
      ['authenticating', 'institution_selected'],
      ['extracting', 'authenticating'],
      ['extracting', 'institution_selected'],
      ['succeeded', 'created'],
      ['succeeded', 'failed'],
      ['succeeded', 'cancelled'],
      ['failed', 'created'],
      ['failed', 'succeeded'],
      ['cancelled', 'created'],
      ['cancelled', 'succeeded'],
    ];

    test.each(invalidPairs)('%s → %s is invalid', (from, to) => {
      expect(
        isValidLinkTransition(from as LinkSessionPhaseName, to as LinkSessionPhaseName),
      ).toBe(false);
    });
  });

  describe('terminal states', () => {
    it('succeeded has no valid transitions', () => {
      const allPhases: LinkSessionPhaseName[] = [
        'created', 'institution_selected', 'authenticating', 'mfa_required',
        'extracting', 'succeeded', 'failed', 'cancelled',
      ];
      for (const to of allPhases) {
        expect(isValidLinkTransition('succeeded', to)).toBe(false);
      }
    });

    it('failed has no valid transitions', () => {
      const allPhases: LinkSessionPhaseName[] = [
        'created', 'institution_selected', 'authenticating', 'mfa_required',
        'extracting', 'succeeded', 'failed', 'cancelled',
      ];
      for (const to of allPhases) {
        expect(isValidLinkTransition('failed', to)).toBe(false);
      }
    });

    it('cancelled has no valid transitions', () => {
      const allPhases: LinkSessionPhaseName[] = [
        'created', 'institution_selected', 'authenticating', 'mfa_required',
        'extracting', 'succeeded', 'failed', 'cancelled',
      ];
      for (const to of allPhases) {
        expect(isValidLinkTransition('cancelled', to)).toBe(false);
      }
    });
  });

  describe('assertValidLinkTransition', () => {
    it('does not throw for valid transitions', () => {
      expect(() => assertValidLinkTransition('created', 'institution_selected')).not.toThrow();
    });

    it('throws for invalid transitions with descriptive message', () => {
      expect(() => assertValidLinkTransition('created', 'succeeded')).toThrow(
        /Invalid link session transition: created → succeeded/,
      );
    });

    it('includes valid transitions in error message', () => {
      expect(() => assertValidLinkTransition('created', 'extracting')).toThrow(
        /Valid transitions from created: \[institution_selected, cancelled\]/,
      );
    });
  });

  describe('full flow walks', () => {
    it('happy path: created → selected → auth → extracting → succeeded', () => {
      expect(isValidLinkTransition('created', 'institution_selected')).toBe(true);
      expect(isValidLinkTransition('institution_selected', 'authenticating')).toBe(true);
      expect(isValidLinkTransition('authenticating', 'extracting')).toBe(true);
      expect(isValidLinkTransition('extracting', 'succeeded')).toBe(true);
    });

    it('MFA path: ... → auth → mfa → auth → extracting → succeeded', () => {
      expect(isValidLinkTransition('authenticating', 'mfa_required')).toBe(true);
      expect(isValidLinkTransition('mfa_required', 'authenticating')).toBe(true);
      expect(isValidLinkTransition('authenticating', 'extracting')).toBe(true);
      expect(isValidLinkTransition('extracting', 'succeeded')).toBe(true);
    });

    it('cancellation from any active state', () => {
      expect(isValidLinkTransition('created', 'cancelled')).toBe(true);
      expect(isValidLinkTransition('institution_selected', 'cancelled')).toBe(true);
      expect(isValidLinkTransition('authenticating', 'cancelled')).toBe(true);
      expect(isValidLinkTransition('mfa_required', 'cancelled')).toBe(true);
      expect(isValidLinkTransition('extracting', 'cancelled')).toBe(true);
    });

    it('error path: auth or MFA failure', () => {
      expect(isValidLinkTransition('authenticating', 'failed')).toBe(true);
      expect(isValidLinkTransition('mfa_required', 'failed')).toBe(true);
      expect(isValidLinkTransition('extracting', 'failed')).toBe(true);
    });
  });
});

// ─── Type Export Verification ────────────────────────────────────────

describe('type exports from index', () => {
  it('all new types are importable from types/index', () => {
    const types = require('../src/types');
    expect(types.AccountType).toBeDefined();
    expect(types.TransactionStatus).toBeDefined();
    expect(types.LogLevel).toBeDefined();
    expect(types.LinkSessionPhase).toBeDefined();
    expect(types.LinkErrorCode).toBeDefined();
    expect(types.assertValidConfig).toBeDefined();
    expect(types.isValidLinkTransition).toBeDefined();
    expect(types.assertValidLinkTransition).toBeDefined();
  });

  it('existing types are still exported', () => {
    const types = require('../src/types');
    expect(types.NavigationPhase).toBeDefined();
    expect(types.NavigationErrorCode).toBeDefined();
    expect(types.isValidTransition).toBeDefined();
    expect(types.assertValidTransition).toBeDefined();
    expect(types.OutboundMessageType).toBeDefined();
    expect(types.InboundMessageType).toBeDefined();
    expect(types.generateMessageId).toBeDefined();
  });
});
