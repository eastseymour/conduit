/**
 * Auth module types — Correctness by Construction
 *
 * Design invariants:
 * 1. AuthState transitions follow a strict state machine — no skipping states
 * 2. MFA challenges are discriminated unions — each type carries only its relevant data
 * 3. Credentials are never stored after submission — only held transiently
 * 4. Every auth session has a unique ID for traceability
 * 5. AuthResult is a discriminated union — success/failure/locked are distinct variants
 */

// ─── Auth State Machine ──────────────────────────────────────────────

/**
 * All possible states in the authentication flow.
 * Transitions:
 *   idle → logging_in → (mfa_required → mfa_submitting →)? authenticated | auth_failed
 *
 * The MFA loop can repeat: mfa_required → mfa_submitting → mfa_required (if MFA fails)
 */
export type AuthState =
  | 'idle'
  | 'logging_in'
  | 'mfa_required'
  | 'mfa_submitting'
  | 'authenticated'
  | 'auth_failed';

/**
 * Valid transitions from each state. Used by the state machine to enforce
 * correctness. If a transition is not listed, it is illegal.
 */
export const VALID_TRANSITIONS: Readonly<Record<AuthState, readonly AuthState[]>> = {
  idle: ['logging_in'],
  logging_in: ['mfa_required', 'authenticated', 'auth_failed'],
  mfa_required: ['mfa_submitting', 'auth_failed'],
  mfa_submitting: ['mfa_required', 'authenticated', 'auth_failed'],
  authenticated: ['idle'],
  auth_failed: ['idle'],
} as const;

// ─── Credentials ─────────────────────────────────────────────────────

/**
 * User credentials for bank login.
 * Precondition: username and password must be non-empty strings.
 */
export interface Credentials {
  readonly username: string;
  readonly password: string;
}

// ─── MFA Challenge Types (Discriminated Union) ───────────────────────

export type MfaChallengeType =
  | 'sms_code'
  | 'email_code'
  | 'security_questions'
  | 'push_notification';

/**
 * Base interface for all MFA challenges.
 * Every challenge has a unique ID and a type discriminator.
 */
interface MfaChallengeBase {
  readonly challengeId: string;
  readonly type: MfaChallengeType;
}

/**
 * SMS code challenge — a code was sent to a masked phone number.
 */
export interface SmsMfaChallenge extends MfaChallengeBase {
  readonly type: 'sms_code';
  readonly maskedPhoneNumber: string;
}

/**
 * Email code challenge — a code was sent to a masked email address.
 */
export interface EmailMfaChallenge extends MfaChallengeBase {
  readonly type: 'email_code';
  readonly maskedEmail: string;
}

/**
 * Security questions challenge — one or more questions the user must answer.
 */
export interface SecurityQuestionsMfaChallenge extends MfaChallengeBase {
  readonly type: 'security_questions';
  readonly questions: readonly string[];
}

/**
 * Push notification challenge — a notification was sent to a registered device.
 */
export interface PushNotificationMfaChallenge extends MfaChallengeBase {
  readonly type: 'push_notification';
  readonly deviceHint: string;
}

/**
 * Discriminated union of all MFA challenge types.
 * Pattern-match on `type` to access challenge-specific fields.
 */
export type MfaChallenge =
  | SmsMfaChallenge
  | EmailMfaChallenge
  | SecurityQuestionsMfaChallenge
  | PushNotificationMfaChallenge;

// ─── MFA Response Types (Discriminated Union) ────────────────────────

interface MfaResponseBase {
  readonly challengeId: string;
  readonly type: MfaChallengeType;
}

export interface CodeMfaResponse extends MfaResponseBase {
  readonly type: 'sms_code' | 'email_code';
  readonly code: string;
}

export interface SecurityQuestionsMfaResponse extends MfaResponseBase {
  readonly type: 'security_questions';
  readonly answers: readonly string[];
}

export interface PushNotificationMfaResponse extends MfaResponseBase {
  readonly type: 'push_notification';
  readonly approved: boolean;
}

export type MfaResponse =
  | CodeMfaResponse
  | SecurityQuestionsMfaResponse
  | PushNotificationMfaResponse;

// ─── Auth Result (Discriminated Union) ───────────────────────────────

/**
 * Outcome of the authentication flow.
 * Exactly one of: success, failed, locked.
 */
export type AuthResult =
  | { readonly status: 'success'; readonly sessionToken: string; readonly rememberDevice: boolean }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'locked'; readonly reason: string; readonly retryAfter?: Date };

// ─── Auth Session ────────────────────────────────────────────────────

/**
 * Represents a single authentication session.
 * Invariant: sessionId is always set at construction and never changes.
 */
export interface AuthSession {
  readonly sessionId: string;
  readonly bankId: string;
  readonly startedAt: Date;
  state: AuthState;
  mfaChallenge?: MfaChallenge;
  result?: AuthResult;
}

// ─── Auth Events (Discriminated Union) ───────────────────────────────

export type AuthEventType = AuthState;

interface AuthEventBase {
  readonly sessionId: string;
  readonly timestamp: Date;
}

export interface IdleEvent extends AuthEventBase {
  readonly type: 'idle';
}

export interface LoggingInEvent extends AuthEventBase {
  readonly type: 'logging_in';
  readonly bankId: string;
}

export interface MfaRequiredEvent extends AuthEventBase {
  readonly type: 'mfa_required';
  readonly challenge: MfaChallenge;
}

export interface MfaSubmittingEvent extends AuthEventBase {
  readonly type: 'mfa_submitting';
  readonly challengeType: MfaChallengeType;
}

export interface AuthenticatedEvent extends AuthEventBase {
  readonly type: 'authenticated';
  readonly sessionToken: string;
}

export interface AuthFailedEvent extends AuthEventBase {
  readonly type: 'auth_failed';
  readonly reason: string;
  readonly isLocked: boolean;
}

export type AuthEvent =
  | IdleEvent
  | LoggingInEvent
  | MfaRequiredEvent
  | MfaSubmittingEvent
  | AuthenticatedEvent
  | AuthFailedEvent;

// ─── Callbacks / Host App Interface ──────────────────────────────────

/**
 * Callback interface for the host app to receive auth events and MFA prompts.
 * The host app implements this to integrate with the auth flow.
 */
export interface AuthCallbacks {
  /** Called on every state transition */
  onStateChange(event: AuthEvent): void;

  /**
   * Called when MFA is required. Host app must return MFA response.
   * Returning null signals cancellation → transitions to auth_failed.
   */
  onMfaRequired(challenge: MfaChallenge): Promise<MfaResponse | null>;
}

// ─── Auth Module Options ─────────────────────────────────────────────

export interface AuthModuleOptions {
  /** Maximum number of MFA retry attempts before failing */
  readonly maxMfaRetries: number;

  /** Whether to request "remember this device" after successful auth */
  readonly rememberDevice: boolean;

  /** Timeout in ms for the entire auth flow */
  readonly timeoutMs: number;

  /** Timeout in ms for waiting for MFA response from host app */
  readonly mfaTimeoutMs: number;
}

export const DEFAULT_AUTH_OPTIONS: Readonly<AuthModuleOptions> = {
  maxMfaRetries: 3,
  rememberDevice: false,
  timeoutMs: 120_000,
  mfaTimeoutMs: 300_000,
} as const;

// ─── Validation helpers ──────────────────────────────────────────────

/**
 * Validates that credentials are non-empty.
 * Throws if invariant is violated.
 */
export function assertValidCredentials(creds: Credentials): asserts creds is Credentials {
  if (!creds.username || creds.username.trim().length === 0) {
    throw new ConduitAuthError('Username must be non-empty', 'INVALID_CREDENTIALS');
  }
  if (!creds.password || creds.password.trim().length === 0) {
    throw new ConduitAuthError('Password must be non-empty', 'INVALID_CREDENTIALS');
  }
}

/**
 * Validates that an MFA response matches the expected challenge.
 */
export function assertValidMfaResponse(response: MfaResponse, challenge: MfaChallenge): void {
  if (response.challengeId !== challenge.challengeId) {
    throw new ConduitAuthError(
      `MFA response challengeId "${response.challengeId}" does not match challenge "${challenge.challengeId}"`,
      'MFA_MISMATCH',
    );
  }
  if (response.type !== challenge.type) {
    throw new ConduitAuthError(
      `MFA response type "${response.type}" does not match challenge type "${challenge.type}"`,
      'MFA_MISMATCH',
    );
  }

  switch (response.type) {
    case 'sms_code':
    case 'email_code':
      if (!response.code || response.code.trim().length === 0) {
        throw new ConduitAuthError('MFA code must be non-empty', 'INVALID_MFA_RESPONSE');
      }
      break;
    case 'security_questions':
      if (!response.answers || response.answers.length === 0) {
        throw new ConduitAuthError(
          'Security question answers must be non-empty',
          'INVALID_MFA_RESPONSE',
        );
      }
      break;
    case 'push_notification':
      // approved is a boolean, always valid
      break;
  }
}

// ─── Error types ─────────────────────────────────────────────────────

export type ConduitAuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'INVALID_STATE_TRANSITION'
  | 'MFA_MISMATCH'
  | 'INVALID_MFA_RESPONSE'
  | 'AUTH_TIMEOUT'
  | 'MFA_TIMEOUT'
  | 'MFA_MAX_RETRIES'
  | 'BROWSER_ERROR'
  | 'SESSION_EXPIRED'
  | 'ACCOUNT_LOCKED';

export class ConduitAuthError extends Error {
  public readonly code: ConduitAuthErrorCode;

  constructor(message: string, code: ConduitAuthErrorCode) {
    super(message);
    this.name = 'ConduitAuthError';
    this.code = code;
    // Fix prototype chain for instanceof checks
    Object.setPrototypeOf(this, ConduitAuthError.prototype);
  }
}
