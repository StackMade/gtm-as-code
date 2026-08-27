import { GoogleAuth } from 'google-auth-library';
import type { AuthClient } from 'google-auth-library';

/**
 * `GoogleAuth` already implements Google's credential discovery chain (ADC,
 * service-account key, Workload Identity Federation), so this file only adds
 * scoping and safe error reporting.
 *
 * Never log the return value of `authorize()` or anything read off it: it is
 * (or carries) the live credential.
 */

export const SCOPES = {
  gtmReadonly: 'https://www.googleapis.com/auth/tagmanager.readonly',
  gtmEdit: 'https://www.googleapis.com/auth/tagmanager.edit.containers',
  gtmPublish: 'https://www.googleapis.com/auth/tagmanager.publish',
  ga4Edit: 'https://www.googleapis.com/auth/analytics.edit',
  ga4Readonly: 'https://www.googleapis.com/auth/analytics.readonly',
} as const;

export class GoogleAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GoogleAuthError';
  }
}

/** Throws GoogleAuthError, never the raw SDK error — that one can stringify request detail. */
export async function authorize(scopes: string[]): Promise<AuthClient> {
  const auth = new GoogleAuth({ scopes });
  try {
    return await auth.getClient();
  } catch (error) {
    throw new GoogleAuthError(describeAuthFailure(error), { cause: error });
  }
}

/** Project id inferred from the active credential — safe to log. */
export async function currentProjectId(): Promise<string | null> {
  const auth = new GoogleAuth();
  try {
    return await auth.getProjectId();
  } catch {
    return null;
  }
}

export function describeAuthFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/could not load the default credentials/i.test(message)) {
    return [
      'No Google credentials found.',
      'Local development: run `gcloud auth application-default login`.',
      'CI/CD: set GOOGLE_APPLICATION_CREDENTIALS to a service-account key file, or configure Workload Identity Federation.',
    ].join('\n');
  }
  if (/invalid_grant/i.test(message)) {
    return [
      'Google credentials were rejected (invalid_grant) — they may be expired or revoked.',
      'Local development: run `gcloud auth application-default login` again.',
    ].join('\n');
  }
  return `Google authentication failed: ${message}`;
}
