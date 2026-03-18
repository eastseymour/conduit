/**
 * Auth module public API.
 *
 * Re-exports all types, the state machine, auth module, and MFA handler.
 */

export { AuthModule } from './auth-module';
export { AuthStateMachine } from './auth-state-machine';
export { MfaHandler } from './mfa-handler';
export type { MfaFlowResult } from './mfa-handler';
export {
  // Types
  type AuthState,
  type Credentials,
  type MfaChallengeType,
  type MfaChallenge,
  type SmsMfaChallenge,
  type EmailMfaChallenge,
  type SecurityQuestionsMfaChallenge,
  type PushNotificationMfaChallenge,
  type MfaResponse,
  type CodeMfaResponse,
  type SecurityQuestionsMfaResponse,
  type PushNotificationMfaResponse,
  type AuthResult,
  type AuthSession,
  type AuthEvent,
  type AuthEventType,
  type IdleEvent,
  type LoggingInEvent,
  type MfaRequiredEvent,
  type MfaSubmittingEvent,
  type AuthenticatedEvent,
  type AuthFailedEvent,
  type AuthCallbacks,
  type AuthModuleOptions,
  type ConduitAuthErrorCode,
  // Constants
  VALID_TRANSITIONS,
  DEFAULT_AUTH_OPTIONS,
  // Validation
  assertValidCredentials,
  assertValidMfaResponse,
  // Error
  ConduitAuthError,
} from './types';
