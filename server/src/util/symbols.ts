/** True for symbols served by the Canadian/reference feed (Yahoo). */
export function isCaSymbol(symbol: string): boolean {
  return /\.(TO|V)$/i.test(symbol) || symbol.startsWith('^') || symbol.endsWith('=X');
}

export function exchangeOf(symbol: string): string {
  if (/\.TO$/i.test(symbol)) return 'TSX';
  if (/\.V$/i.test(symbol)) return 'TSXV';
  if (symbol.startsWith('^') || symbol.endsWith('=X')) return 'IDX';
  return 'US';
}
