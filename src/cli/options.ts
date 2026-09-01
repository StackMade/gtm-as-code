export interface GlobalOptions {
  verbose: boolean;
  quiet: boolean;
  format: 'text' | 'json' | 'markdown';
  config?: string;
  /** `--env <path>`: an env file to load before the config is interpolated. */
  env?: string;
  autoApprove?: boolean;
  allowDestroy?: boolean;
  allowDestroyProtected?: boolean;
}
