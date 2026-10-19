// Minimal tagged logger. info/warn/error always print (lifecycle events are
// low-volume and essential for diagnosing P2P flows); debug is gated —
// enable with localStorage.setItem('bifrost-debug', '1') and reload.
const debugEnabled =
  typeof localStorage !== 'undefined' && localStorage.getItem('bifrost-debug') === '1';

export function createLogger(tag: string) {
  const prefix = `[bifrost:${tag}]`;
  return {
    debug: (...args: unknown[]) => debugEnabled && console.debug(prefix, ...args),
    info: (...args: unknown[]) => console.info(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}
