import {
  assertValidCredentials,
  assertValidMfaResponse,
  ConduitAuthError,
  MfaChallenge,
  MfaResponse,
} from '../../src/auth/types';

describe('assertValidCredentials', () => {
  it('should accept valid credentials', () => {
    expect(() => assertValidCredentials({ username: 'user', password: 'pass' })).not.toThrow();
  });

  it('should throw for empty username', () => {
    expect(() => assertValidCredentials({ username: '', password: 'pass' })).toThrow(
      ConduitAuthError,
    );
    expect(() => assertValidCredentials({ username: '', password: 'pass' })).toThrow(
      'Username must be non-empty',
    );
  });

  it('should throw for whitespace-only username', () => {
    expect(() => assertValidCredentials({ username: '   ', password: 'pass' })).toThrow(
      ConduitAuthError,
    );
  });

  it('should throw for empty password', () => {
    expect(() => assertValidCredentials({ username: 'user', password: '' })).toThrow(
      ConduitAuthError,
    );
    expect(() => assertValidCredentials({ username: 'user', password: '' })).toThrow(
      'Password must be non-empty',
    );
  });

  it('should throw for whitespace-only password', () => {
    expect(() => assertValidCredentials({ username: 'user', password: '  ' })).toThrow(
      ConduitAuthError,
    );
  });

  it('should have INVALID_CREDENTIALS error code', () => {
    try {
      assertValidCredentials({ username: '', password: '' });
      fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ConduitAuthError);
      expect((e as ConduitAuthError).code).toBe('INVALID_CREDENTIALS');
    }
  });
});

describe('assertValidMfaResponse', () => {
  describe('SMS code', () => {
    const challenge: MfaChallenge = {
      challengeId: 'c1',
      type: 'sms_code',
      maskedPhoneNumber: '***1234',
    };

    it('should accept valid SMS code response', () => {
      const response: MfaResponse = {
        challengeId: 'c1',
        type: 'sms_code',
        code: '123456',
      };
      expect(() => assertValidMfaResponse(response, challenge)).not.toThrow();
    });

    it('should throw for mismatched challengeId', () => {
      const response: MfaResponse = {
        challengeId: 'wrong',
        type: 'sms_code',
        code: '123456',
      };
      expect(() => assertValidMfaResponse(response, challenge)).toThrow('does not match challenge');
    });

    it('should throw for empty code', () => {
      const response: MfaResponse = {
        challengeId: 'c1',
        type: 'sms_code',
        code: '',
      };
      expect(() => assertValidMfaResponse(response, challenge)).toThrow(
        'MFA code must be non-empty',
      );
    });

    it('should throw for whitespace-only code', () => {
      const response: MfaResponse = {
        challengeId: 'c1',
        type: 'sms_code',
        code: '   ',
      };
      expect(() => assertValidMfaResponse(response, challenge)).toThrow(
        'MFA code must be non-empty',
      );
    });

    it('should have MFA_MISMATCH error code for mismatched ids', () => {
      const response: MfaResponse = {
        challengeId: 'wrong',
        type: 'sms_code',
        code: '123456',
      };
      try {
        assertValidMfaResponse(response, challenge);
        fail('Should have thrown');
      } catch (e) {
        expect((e as ConduitAuthError).code).toBe('MFA_MISMATCH');
      }
    });

    it('should have INVALID_MFA_RESPONSE error code for empty code', () => {
      const response: MfaResponse = {
        challengeId: 'c1',
        type: 'sms_code',
        code: '',
      };
      try {
        assertValidMfaResponse(response, challenge);
        fail('Should have thrown');
      } catch (e) {
        expect((e as ConduitAuthError).code).toBe('INVALID_MFA_RESPONSE');
      }
    });
  });

  describe('Email code', () => {
    const challenge: MfaChallenge = {
      challengeId: 'c2',
      type: 'email_code',
      maskedEmail: 'u***@example.com',
    };

    it('should accept valid email code response', () => {
      const response: MfaResponse = {
        challengeId: 'c2',
        type: 'email_code',
        code: '654321',
      };
      expect(() => assertValidMfaResponse(response, challenge)).not.toThrow();
    });

    it('should throw for mismatched type', () => {
      // This would require a cast since TypeScript wouldn't allow it
      const response = {
        challengeId: 'c2',
        type: 'sms_code' as const,
        code: '654321',
      };
      expect(() => assertValidMfaResponse(response, challenge)).toThrow(
        'does not match challenge type',
      );
    });
  });

  describe('Security questions', () => {
    const challenge: MfaChallenge = {
      challengeId: 'c3',
      type: 'security_questions',
      questions: ['What is your pet name?', 'What city were you born in?'],
    };

    it('should accept valid security questions response', () => {
      const response: MfaResponse = {
        challengeId: 'c3',
        type: 'security_questions',
        answers: ['Fluffy', 'New York'],
      };
      expect(() => assertValidMfaResponse(response, challenge)).not.toThrow();
    });

    it('should throw for empty answers', () => {
      const response: MfaResponse = {
        challengeId: 'c3',
        type: 'security_questions',
        answers: [],
      };
      expect(() => assertValidMfaResponse(response, challenge)).toThrow(
        'Security question answers must be non-empty',
      );
    });
  });

  describe('Push notification', () => {
    const challenge: MfaChallenge = {
      challengeId: 'c4',
      type: 'push_notification',
      deviceHint: 'iPhone 15',
    };

    it('should accept push notification approval', () => {
      const response: MfaResponse = {
        challengeId: 'c4',
        type: 'push_notification',
        approved: true,
      };
      expect(() => assertValidMfaResponse(response, challenge)).not.toThrow();
    });

    it('should accept push notification denial', () => {
      const response: MfaResponse = {
        challengeId: 'c4',
        type: 'push_notification',
        approved: false,
      };
      expect(() => assertValidMfaResponse(response, challenge)).not.toThrow();
    });
  });
});

describe('ConduitAuthError', () => {
  it('should be an instance of Error', () => {
    const err = new ConduitAuthError('test', 'INVALID_CREDENTIALS');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ConduitAuthError);
  });

  it('should store the error code', () => {
    const err = new ConduitAuthError('test', 'AUTH_TIMEOUT');
    expect(err.code).toBe('AUTH_TIMEOUT');
    expect(err.message).toBe('test');
    expect(err.name).toBe('ConduitAuthError');
  });
});
