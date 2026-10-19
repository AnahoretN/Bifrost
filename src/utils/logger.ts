// Minimal tagged logger — makes the P2P layer debuggable in devtools without
// pulling in a dependency. Enable with localStorage.setItem('bifrost-debug', '1').
const enabled =
  typeof localStorage !== 'undefined' && localStorage.getItem('bifrost-debug') === '1';

export function createLogger(tag: string) {
  const prefix = `[bifrost:${tag}]`;
  return {
    debug: (...args: unknown[]) => enabled && console.debug(prefix, ...args),
    info: (...args: unknown[]) => enabled && console.info(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
  };
}
