import { ConfigError } from '../config/errors.js';
import { GoogleAuthError } from '../providers/google/auth/index.js';
import { GtmApiError, WorkspaceConflictError } from '../providers/google/gtm/errors.js';
import { Ga4ApiError } from '../providers/google/ga4/errors.js';
import { StateVersionError } from '../core/state.js';
import { StateLockedError } from '../core/lock.js';

/**
 * Prints the message of an error this tool raises itself — those messages are already
 * written for the user — and falls back to the raw message for anything unexpected.
 * Shared so every command fails the same way.
 */
export function printFailure(error: unknown): void {
  if (
    error instanceof ConfigError ||
    error instanceof GoogleAuthError ||
    error instanceof GtmApiError ||
    error instanceof WorkspaceConflictError ||
    error instanceof Ga4ApiError ||
    error instanceof StateVersionError ||
    error instanceof StateLockedError
  ) {
    console.error(error.message);
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
}
