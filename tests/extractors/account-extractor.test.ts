/**
 * Tests for Account Extractor — CDT-13
 *
 * Covers:
 * - parseAmount: currency string → number parsing
 * - maskAccountNumber: account number masking
 * - inferAccountType: account name → type inference
 * - applyTransform: named transform application
 * - extractFieldValue: DOM element data extraction
 * - assembleAccount: raw fields → Account assembly
 * - extractAccountsFromRawData: end-to-end extraction
 * - buildExtractionScript: script generation
 * - Edge cases: zero balance, negative amounts, empty data, credit cards, multiple accounts
 */

import {
  parseAmount,
  maskAccountNumber,
  inferAccountType,
  applyTransform,
  extractFieldValue,
  assembleAccount,
  extractAccountsFromRawData,
  buildExtractionScript,
} from '../../src/extractors/account-extractor';
import type { RawAccountFields } from '../../src/extractors/account-extractor';

// ─── parseAmount ────────────────────────────────────────────────────

describe('parseAmount', () => {
  it('parses basic dollar amounts', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
  });

  it('parses amounts without dollar sign', () => {
    expect(parseAmount('1234.56')).toBe(1234.56);
  });

  it('parses negative amounts with minus', () => {
    expect(parseAmount('-$1,234.56')).toBe(-1234.56);
  });

  it('parses negative amounts in accounting notation (parentheses)', () => {
    expect(parseAmount('($1,234.56)')).toBe(-1234.56);
  });

  it('parses zero', () => {
    expect(parseAmount('$0.00')).toBe(0);
  });

  it('parses amounts without cents', () => {
    expect(parseAmount('$1,000')).toBe(1000);
  });

  it('returns 0 for empty string', () => {
    expect(parseAmount('')).toBe(0);
  });

  it('returns 0 for "--"', () => {
    expect(parseAmount('--')).toBe(0);
  });

  it('returns 0 for "N/A"', () => {
    expect(parseAmount('N/A')).toBe(0);
  });

  it('returns 0 for null/undefined input', () => {
    expect(parseAmount(null as unknown as string)).toBe(0);
    expect(parseAmount(undefined as unknown as string)).toBe(0);
  });

  it('handles large amounts', () => {
    expect(parseAmount('$1,234,567.89')).toBe(1234567.89);
  });

  it('handles small amounts', () => {
    expect(parseAmount('$0.01')).toBe(0.01);
  });

  it('handles amounts with whitespace', () => {
    expect(parseAmount('  $1,234.56  ')).toBe(1234.56);
  });
});

// ─── maskAccountNumber ──────────────────────────────────────────────

describe('maskAccountNumber', () => {
  it('masks a full account number', () => {
    expect(maskAccountNumber('123456789')).toBe('****6789');
  });

  it('preserves already-masked numbers starting with *', () => {
    expect(maskAccountNumber('****1234')).toBe('****1234');
  });

  it('preserves already-masked numbers starting with …', () => {
    expect(maskAccountNumber('…1234')).toBe('…1234');
  });

  it('preserves already-masked numbers starting with x', () => {
    expect(maskAccountNumber('xxxx1234')).toBe('xxxx1234');
  });

  it('handles numbers with dashes', () => {
    expect(maskAccountNumber('1234-5678-9012')).toBe('****9012');
  });

  it('handles very short numbers (≤4 digits)', () => {
    expect(maskAccountNumber('1234')).toBe('1234');
  });

  it('handles whitespace', () => {
    expect(maskAccountNumber('  123456789  ')).toBe('****6789');
  });
});

// ─── inferAccountType ───────────────────────────────────────────────

describe('inferAccountType', () => {
  describe('checking accounts', () => {
    it('detects "Total Checking"', () => {
      expect(inferAccountType('TOTAL CHECKING')).toBe('checking');
    });

    it('detects "Premier Plus Checking"', () => {
      expect(inferAccountType('Premier Plus Checking')).toBe('checking');
    });

    it('detects "College Checking"', () => {
      expect(inferAccountType('College Checking')).toBe('checking');
    });

    it('detects "Secure Checking"', () => {
      expect(inferAccountType('Secure Checking')).toBe('checking');
    });
  });

  describe('savings accounts', () => {
    it('detects "Chase Savings"', () => {
      expect(inferAccountType('Chase Savings')).toBe('savings');
    });

    it('detects "Money Market"', () => {
      expect(inferAccountType('Money Market Savings')).toBe('savings');
    });

    it('detects "Certificate of Deposit"', () => {
      expect(inferAccountType('Certificate of Deposit')).toBe('savings');
    });
  });

  describe('credit cards', () => {
    it('detects "Sapphire Reserve"', () => {
      expect(inferAccountType('Sapphire Reserve')).toBe('credit_card');
    });

    it('detects "Sapphire Preferred"', () => {
      expect(inferAccountType('Sapphire Preferred')).toBe('credit_card');
    });

    it('detects "Freedom Unlimited"', () => {
      expect(inferAccountType('Freedom Unlimited')).toBe('credit_card');
    });

    it('detects "Freedom Flex"', () => {
      expect(inferAccountType('Freedom Flex')).toBe('credit_card');
    });

    it('detects "Chase Credit Card"', () => {
      expect(inferAccountType('Chase Credit Card')).toBe('credit_card');
    });

    it('detects "Ink Business Preferred"', () => {
      expect(inferAccountType('Ink Business Preferred')).toBe('credit_card');
    });

    it('detects "United Explorer"', () => {
      expect(inferAccountType('United Explorer')).toBe('credit_card');
    });

    it('detects "Southwest Rapid Rewards"', () => {
      expect(inferAccountType('Southwest Rapid Rewards')).toBe('credit_card');
    });

    it('detects "Marriott Bonvoy"', () => {
      expect(inferAccountType('Marriott Bonvoy Boundless')).toBe('credit_card');
    });

    it('detects Amazon Visa', () => {
      expect(inferAccountType('Amazon Prime Visa')).toBe('credit_card');
    });
  });

  describe('mortgage', () => {
    it('detects "Home Mortgage"', () => {
      expect(inferAccountType('Home Mortgage')).toBe('mortgage');
    });

    it('detects "Home Loan"', () => {
      expect(inferAccountType('Home Loan')).toBe('mortgage');
    });
  });

  describe('loans', () => {
    it('detects "Auto Loan"', () => {
      expect(inferAccountType('Auto Loan')).toBe('loan');
    });

    it('detects "Personal Loan"', () => {
      expect(inferAccountType('Personal Loan')).toBe('loan');
    });

    it('detects "Student Loan"', () => {
      expect(inferAccountType('Student Loan')).toBe('loan');
    });
  });

  describe('investment', () => {
    it('detects "You Invest"', () => {
      expect(inferAccountType('You Invest Trade')).toBe('investment');
    });

    it('detects "Investment Account"', () => {
      expect(inferAccountType('Investment Account')).toBe('investment');
    });

    it('detects "IRA"', () => {
      expect(inferAccountType('Traditional IRA')).toBe('investment');
    });
  });

  describe('line of credit', () => {
    it('detects "Home Equity Line of Credit"', () => {
      expect(inferAccountType('Home Equity Line of Credit')).toBe('line_of_credit');
    });

    it('detects "HELOC"', () => {
      expect(inferAccountType('HELOC')).toBe('line_of_credit');
    });
  });

  describe('explicit type override', () => {
    it('uses explicit type when it matches a valid type', () => {
      expect(inferAccountType('My Account', 'checking')).toBe('checking');
    });

    it('uses explicit type for credit_card', () => {
      expect(inferAccountType('My Account', 'credit_card')).toBe('credit_card');
    });

    it('matches explicit type against patterns when not a direct match', () => {
      expect(inferAccountType('My Account', 'mastercard')).toBe('credit_card');
    });

    it('falls back to name-based inference when explicit type is unrecognized', () => {
      expect(inferAccountType('Total Checking', 'unknown_type')).toBe('checking');
    });
  });

  describe('default fallback', () => {
    it('returns "other" for unrecognized names', () => {
      expect(inferAccountType('My Special Account')).toBe('other');
    });

    it('returns "other" for empty name with no explicit type', () => {
      expect(inferAccountType('')).toBe('other');
    });
  });
});

// ─── applyTransform ─────────────────────────────────────────────────

describe('applyTransform', () => {
  it('trims whitespace', () => {
    expect(applyTransform('  hello  ', 'trim')).toBe('hello');
  });

  it('parses amount', () => {
    expect(applyTransform('$1,234.56', 'parseAmount')).toBe(1234.56);
  });

  it('strips whitespace', () => {
    expect(applyTransform('hello world  foo', 'stripWhitespace')).toBe('helloworldfoo');
  });

  it('masks account number', () => {
    expect(applyTransform('123456789', 'maskAccountNumber')).toBe('****6789');
  });

  it('converts to uppercase', () => {
    expect(applyTransform('hello', 'uppercase')).toBe('HELLO');
  });

  it('converts to lowercase', () => {
    expect(applyTransform('HELLO', 'lowercase')).toBe('hello');
  });

  it('trims on parseDate', () => {
    expect(applyTransform('  2024-01-15  ', 'parseDate')).toBe('2024-01-15');
  });

  it('throws on unknown transform', () => {
    expect(() => applyTransform('test', 'unknown' as any)).toThrow('Unknown transform');
  });
});

// ─── extractFieldValue ──────────────────────────────────────────────

describe('extractFieldValue', () => {
  const baseData = {
    textContent: 'Hello World',
    innerText: 'Hello World Inner',
    attributes: { 'data-value': '42', class: 'test-class' },
    value: 'input-value',
  };

  it('extracts textContent', () => {
    expect(extractFieldValue(baseData, { type: 'textContent' })).toBe('Hello World');
  });

  it('extracts innerText', () => {
    expect(extractFieldValue(baseData, { type: 'innerText' })).toBe('Hello World Inner');
  });

  it('extracts attribute', () => {
    expect(extractFieldValue(baseData, { type: 'attribute', attributeName: 'data-value' })).toBe('42');
  });

  it('returns null for missing attribute', () => {
    expect(extractFieldValue(baseData, { type: 'attribute', attributeName: 'missing' })).toBeNull();
  });

  it('extracts value', () => {
    expect(extractFieldValue(baseData, { type: 'value' })).toBe('input-value');
  });

  it('extracts with regex', () => {
    expect(
      extractFieldValue(baseData, { type: 'regex', pattern: '(\\w+) World' }),
    ).toBe('Hello World');
  });

  it('extracts regex group', () => {
    expect(
      extractFieldValue(baseData, { type: 'regex', pattern: '(\\w+) World', groupIndex: 1 }),
    ).toBe('Hello');
  });

  it('returns null for non-matching regex', () => {
    expect(
      extractFieldValue(baseData, { type: 'regex', pattern: 'xyz' }),
    ).toBeNull();
  });

  it('handles null textContent', () => {
    const data = { ...baseData, textContent: null };
    expect(extractFieldValue(data, { type: 'textContent' })).toBeNull();
  });
});

// ─── assembleAccount ────────────────────────────────────────────────

describe('assembleAccount', () => {
  it('assembles a valid checking account', () => {
    const raw: RawAccountFields = {
      accountName: 'Total Checking',
      accountNumber: '****1234',
      balance: '$5,432.10',
    };
    const account = assembleAccount(raw, 0, 'chase');
    expect(account).not.toBeNull();
    expect(account!.id).toBe('chase-acct-0');
    expect(account!.name).toBe('Total Checking');
    expect(account!.type).toBe('checking');
    expect(account!.accountNumber).toBe('****1234');
    expect(account!.balance.current).toBe(5432.1);
    expect(account!.currency).toBe('USD');
    expect(account!.institutionId).toBe('chase');
  });

  it('assembles a credit card account', () => {
    const raw: RawAccountFields = {
      accountName: 'Sapphire Reserve',
      accountNumber: '****5678',
      balance: '$1,200.00',
    };
    const account = assembleAccount(raw, 1, 'chase');
    expect(account).not.toBeNull();
    expect(account!.type).toBe('credit_card');
  });

  it('handles zero balance', () => {
    const raw: RawAccountFields = {
      accountName: 'Savings',
      balance: '$0.00',
    };
    const account = assembleAccount(raw, 0, 'chase');
    expect(account).not.toBeNull();
    expect(account!.balance.current).toBe(0);
  });

  it('handles negative balance (credit card debt)', () => {
    const raw: RawAccountFields = {
      accountName: 'Freedom Unlimited',
      balance: '-$500.00',
    };
    const account = assembleAccount(raw, 0, 'chase');
    expect(account).not.toBeNull();
    expect(account!.balance.current).toBe(-500);
    expect(account!.type).toBe('credit_card');
  });

  it('handles numeric balance', () => {
    const raw: RawAccountFields = {
      accountName: 'Checking',
      balance: 1000,
    };
    const account = assembleAccount(raw, 0, 'chase');
    expect(account).not.toBeNull();
    expect(account!.balance.current).toBe(1000);
  });

  it('returns null for empty name', () => {
    const raw: RawAccountFields = {
      accountName: '',
      balance: '$100.00',
    };
    expect(assembleAccount(raw, 0, 'chase')).toBeNull();
  });

  it('returns null for missing name', () => {
    const raw: RawAccountFields = {
      balance: '$100.00',
    };
    expect(assembleAccount(raw, 0, 'chase')).toBeNull();
  });

  it('generates placeholder account number when missing', () => {
    const raw: RawAccountFields = {
      accountName: 'Checking',
      balance: '$100.00',
    };
    const account = assembleAccount(raw, 3, 'chase');
    expect(account!.accountNumber).toBe('****0003');
  });

  it('uses explicit account type when provided', () => {
    const raw: RawAccountFields = {
      accountName: 'My Account',
      balance: '$100.00',
      accountType: 'savings',
    };
    const account = assembleAccount(raw, 0, 'chase');
    expect(account!.type).toBe('savings');
  });

  it('handles non-finite balance (NaN)', () => {
    const raw: RawAccountFields = {
      accountName: 'Checking',
      balance: 'not a number',
    };
    const account = assembleAccount(raw, 0, 'chase');
    expect(account!.balance.current).toBe(0);
  });

  it('handles Infinity balance', () => {
    const raw: RawAccountFields = {
      accountName: 'Checking',
      balance: Infinity,
    };
    const account = assembleAccount(raw, 0, 'chase');
    expect(account!.balance.current).toBe(0);
  });
});

// ─── extractAccountsFromRawData ─────────────────────────────────────

describe('extractAccountsFromRawData', () => {
  it('extracts multiple valid accounts', () => {
    const tiles: RawAccountFields[] = [
      { accountName: 'Total Checking', accountNumber: '****1234', balance: '$5,432.10' },
      { accountName: 'Chase Savings', accountNumber: '****5678', balance: '$10,000.00' },
      { accountName: 'Sapphire Reserve', accountNumber: '****9012', balance: '$1,200.00' },
    ];
    const result = extractAccountsFromRawData(tiles, 'chase');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accounts).toHaveLength(3);
      expect(result.accounts[0]!.type).toBe('checking');
      expect(result.accounts[1]!.type).toBe('savings');
      expect(result.accounts[2]!.type).toBe('credit_card');
    }
  });

  it('returns ok=false when no tiles found', () => {
    const result = extractAccountsFromRawData([], 'chase');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('No account tiles found');
    }
  });

  it('returns ok=false when all tiles have invalid data', () => {
    const tiles: RawAccountFields[] = [
      { balance: '$100.00' }, // No name
      { accountName: '', balance: '$200.00' }, // Empty name
    ];
    const result = extractAccountsFromRawData(tiles, 'chase');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('Failed to extract any valid accounts');
      expect(result.partialAccounts).toHaveLength(2);
    }
  });

  it('skips invalid tiles but returns valid ones', () => {
    const tiles: RawAccountFields[] = [
      { accountName: 'Total Checking', balance: '$1,000.00' },
      { balance: '$500.00' }, // No name — invalid
      { accountName: 'Savings', balance: '$2,000.00' },
    ];
    const result = extractAccountsFromRawData(tiles, 'chase');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accounts).toHaveLength(2);
      expect(result.accounts[0]!.name).toBe('Total Checking');
      expect(result.accounts[1]!.name).toBe('Savings');
    }
  });

  it('handles zero-balance accounts', () => {
    const tiles: RawAccountFields[] = [
      { accountName: 'Empty Checking', balance: '$0.00' },
    ];
    const result = extractAccountsFromRawData(tiles, 'chase');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accounts).toHaveLength(1);
      expect(result.accounts[0]!.balance.current).toBe(0);
    }
  });

  it('generates unique IDs for all accounts', () => {
    const tiles: RawAccountFields[] = [
      { accountName: 'Account 1', balance: '$100.00' },
      { accountName: 'Account 2', balance: '$200.00' },
      { accountName: 'Account 3', balance: '$300.00' },
    ];
    const result = extractAccountsFromRawData(tiles, 'chase');
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ids = result.accounts.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    }
  });

  it('handles credit cards vs checking correctly', () => {
    const tiles: RawAccountFields[] = [
      { accountName: 'TOTAL CHECKING', balance: '$5,000.00' },
      { accountName: 'Freedom Unlimited', balance: '$1,500.00' },
      { accountName: 'Sapphire Preferred', balance: '$3,000.00' },
    ];
    const result = extractAccountsFromRawData(tiles, 'chase');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accounts[0]!.type).toBe('checking');
      expect(result.accounts[1]!.type).toBe('credit_card');
      expect(result.accounts[2]!.type).toBe('credit_card');
    }
  });

  it('handles mixed account types typical of Chase dashboard', () => {
    const tiles: RawAccountFields[] = [
      { accountName: 'TOTAL CHECKING ...1234', accountNumber: '****1234', balance: '$2,543.67' },
      { accountName: 'CHASE SAVINGS ...5678', accountNumber: '****5678', balance: '$15,000.00' },
      { accountName: 'Chase Sapphire Reserve', accountNumber: '****9012', balance: '$4,321.00' },
      { accountName: 'Chase Freedom Flex', accountNumber: '****3456', balance: '$500.50' },
      { accountName: 'Home Mortgage', accountNumber: '****7890', balance: '$250,000.00' },
    ];
    const result = extractAccountsFromRawData(tiles, 'chase');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accounts).toHaveLength(5);
      expect(result.accounts[0]!.type).toBe('checking');
      expect(result.accounts[1]!.type).toBe('savings');
      expect(result.accounts[2]!.type).toBe('credit_card');
      expect(result.accounts[3]!.type).toBe('credit_card');
      expect(result.accounts[4]!.type).toBe('mortgage');
    }
  });
});

// ─── buildExtractionScript ──────────────────────────────────────────

describe('buildExtractionScript', () => {
  it('generates a valid JavaScript function', () => {
    const script = buildExtractionScript(
      {
        accountsList: '.accounts-container, #accountTileList',
        accountItem: '.account-tile',
        accountName: '.account-name',
        accountNumber: '.account-number',
        accountBalance: '.account-balance',
        accountType: '.account-type',
      },
      {
        readySelector: '.accounts-container',
        fields: [
          {
            fieldName: 'accountName',
            selector: '.account-name',
            strategy: { type: 'textContent' },
            transform: 'trim',
            required: true,
          },
          {
            fieldName: 'balance',
            selector: '.account-balance',
            strategy: { type: 'textContent' },
            transform: 'parseAmount',
            required: true,
          },
        ],
      },
    );

    // Script should be valid JavaScript (wrapped in IIFE)
    expect(script).toContain('(function()');
    expect(script).toContain('accountsList');
    expect(script).toContain('accountName');
    expect(script).toContain('querySelector');
    // Should contain the serialized selectors
    expect(script).toContain('.accounts-container');
    expect(script).toContain('#accountTileList');
  });

  it('includes all field extractors in the script', () => {
    const script = buildExtractionScript(
      {
        accountsList: '#list',
        accountItem: '.item',
        accountName: '.name',
        accountBalance: '.balance',
      },
      {
        readySelector: '#list',
        fields: [
          {
            fieldName: 'accountName',
            selector: '.name',
            strategy: { type: 'textContent' },
            required: true,
          },
          {
            fieldName: 'accountNumber',
            selector: '.number',
            strategy: { type: 'attribute', attributeName: 'data-number' },
            required: false,
          },
        ],
      },
    );

    expect(script).toContain('accountName');
    expect(script).toContain('accountNumber');
    expect(script).toContain('attribute');
    expect(script).toContain('data-number');
  });
});
