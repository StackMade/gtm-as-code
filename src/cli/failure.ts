import { ConfigError } from '../config/errors.js';
import { GoogleAuthError } from '../providers/google/auth/index.js';
import { GtmApiError } from '../providers/google/gtm/errors.js';
import { Ga4ApiError } from '../providers/google/ga4/errors.js';

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
    error instanceof Ga4ApiError
  ) {
    console.error(error.message);
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
}
