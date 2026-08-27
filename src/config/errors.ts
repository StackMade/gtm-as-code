export interface ConfigErrorBodyLine {
  label: string;
  value: string;
}

export class ConfigError extends Error {
  constructor(
    public readonly file: string,
    public readonly line: number | undefined,
    public readonly path: string,
    public readonly body: ConfigErrorBodyLine[],
  ) {
    super(ConfigError.format(file, line, path, body));
    this.name = 'ConfigError';
  }

  private static format(
    file: string,
    line: number | undefined,
    path: string,
    body: ConfigErrorBodyLine[],
  ): string {
    const parts: string[] = [line !== undefined ? `${file}:${line}` : file, ''];
    if (path) {
      parts.push(path, '');
    }
    for (const { label, value } of body) {
      parts.push(`${label}:`, `  ${value}`, '');
    }
    return parts.join('\n').trimEnd();
  }
}
