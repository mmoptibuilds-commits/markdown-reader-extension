/** Browser-facing operations on the single dynamic content script that opens Markdown URLs. */
export interface AutoRenderRegistry {
  isRegistered(): Promise<boolean>;
  register(matches: string[]): Promise<void>;
  /** Replaces the match list of an existing registration. A rejected update leaves the old list active. */
  update(matches: string[]): Promise<void>;
  unregister(): Promise<void>;
}

export interface AutoRenderSyncDeps {
  readOrigins(): Promise<string[]>;
  /** Asks the browser whether a host pattern such as `https://example.test/*` is currently granted. */
  hasOriginAccess(pattern: string): Promise<boolean>;
  registry: AutoRenderRegistry;
  reportError?: (error: unknown) => void;
}

/**
 * Converts a stored origin into a host pattern, accepting only a plain http(s) origin:
 * no credentials, no path, and a value that round-trips through URL parsing unchanged.
 */
export function originToMatchPattern(origin: string): string | undefined {
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (url.username || url.password || url.origin !== origin) return undefined;
    return `${url.origin}/*`;
  } catch {
    return undefined;
  }
}

/**
 * Creates the function the background worker calls whenever stored origins or
 * permissions may have changed. Calls never overlap: a request that arrives while a
 * pass is running triggers exactly one more pass after it finishes, and every caller
 * resolves only after the registration reflects the latest stored state.
 */
export function createAutoRenderSync(deps: AutoRenderSyncDeps): () => Promise<void> {
  let running: Promise<void> | undefined;
  let dirty = false;

  const pass = async (): Promise<void> => {
    const origins = await deps.readOrigins();
    const matches: string[] = [];
    for (const origin of origins) {
      const pattern = originToMatchPattern(origin);
      if (!pattern) continue;
      try {
        if (await deps.hasOriginAccess(pattern)) matches.push(pattern);
      } catch (error) {
        deps.reportError?.(error);
      }
    }

    const registered = await deps.registry.isRegistered();
    if (!matches.length) {
      if (registered) await deps.registry.unregister();
    } else if (registered) {
      await deps.registry.update(matches);
    } else {
      await deps.registry.register(matches);
    }
  };

  return () => {
    dirty = true;
    if (!running) {
      running = (async () => {
        try {
          while (dirty) {
            dirty = false;
            await pass();
          }
        } finally {
          running = undefined;
        }
      })();
    }
    return running;
  };
}
