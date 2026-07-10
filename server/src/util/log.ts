function stamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export function log(scope: string, ...args: unknown[]): void {
  console.log(`[${stamp()}] [${scope}]`, ...args);
}

export function warn(scope: string, ...args: unknown[]): void {
  console.warn(`[${stamp()}] [${scope}] WARN`, ...args);
}

export function error(scope: string, ...args: unknown[]): void {
  console.error(`[${stamp()}] [${scope}] ERROR`, ...args);
}
