export interface GlobalOptions {
  verbose: boolean;
  quiet: boolean;
  format: 'text' | 'json' | 'markdown';
  config?: string;
  /** `--dotenv <path>`: an env file to load before the config is interpolated. */
  dotenv?: string;
  /** `--env <name>`: which entry of the config's `environments:` block to use. */
  env?: string;
  autoApprove?: boolean;
  allowDestroy?: boolean;
  allowDestroyProtected?: boolean;
}
