export interface GlobalOptions {
  verbose: boolean;
  quiet: boolean;
  format: 'text' | 'json' | 'markdown';
  config?: string;
  autoApprove?: boolean;
  allowDestroy?: boolean;
  allowDestroyProtected?: boolean;
}
