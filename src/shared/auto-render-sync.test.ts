import { describe, expect, it } from 'vitest';
import { createAutoRenderSync, type AutoRenderRegistry, type AutoRenderSyncDeps } from './auto-render-sync';

interface FakeRegistry extends AutoRenderRegistry {
  calls: string[];
  matches: string[] | undefined;
}

function fakeRegistry(initial?: string[]): FakeRegistry {
  const registry: FakeRegistry = {
    calls: [],
    matches: initial,
    async isRegistered() {
      return registry.matches !== undefined;
    },
    async register(matches) {
      registry.calls.push('register');
      registry.matches = matches;
    },
    async update(matches) {
      registry.calls.push('update');
      registry.matches = matches;
    },
    async unregister() {
      registry.calls.push('unregister');
      registry.matches = undefined;
    },
  };
  return registry;
}

function deps(overrides: Partial<AutoRenderSyncDeps> & { origins: string[]; granted: string[] }, registry: AutoRenderRegistry): AutoRenderSyncDeps {
  const { origins, granted, ...rest } = overrides;
  return {
    readOrigins: async () => origins,
    hasOriginAccess: async (pattern) => granted.includes(pattern),
    registry,
    reportError: () => undefined,
    ...rest,
  };
}

describe('automatic rendering registration', () => {
  it('registers only origins that still hold browser permission', async () => {
    const registry = fakeRegistry();
    const sync = createAutoRenderSync(deps({
      origins: ['https://notes.example.test', 'https://revoked.example.test'],
      granted: ['https://notes.example.test/*'],
    }, registry));

    await sync();

    expect(registry.matches).toEqual(['https://notes.example.test/*']);
    expect(registry.calls).toEqual(['register']);
  });

  it('skips malformed, credentialed, non-web, and path-bearing stored origins', async () => {
    const registry = fakeRegistry();
    const sync = createAutoRenderSync(deps({
      origins: ['not a url', 'ftp://files.example.test', 'https://user:pw@secret.example.test', 'https://ok.example.test/path', 'https://ok.example.test'],
      granted: ['https://ok.example.test/*', 'https://secret.example.test/*'],
    }, registry));

    await sync();

    expect(registry.matches).toEqual(['https://ok.example.test/*']);
  });

  it('unregisters the script when no stored origin is still permitted', async () => {
    const registry = fakeRegistry(['https://gone.example.test/*']);
    const sync = createAutoRenderSync(deps({ origins: ['https://gone.example.test'], granted: [] }, registry));

    await sync();

    expect(registry.matches).toBeUndefined();
    expect(registry.calls).toEqual(['unregister']);
  });

  it('updates an existing registration in place, so a failed update keeps the previous one', async () => {
    const registry = fakeRegistry(['https://old.example.test/*']);
    const failing: AutoRenderRegistry = {
      ...registry,
      async update() { throw new Error('Invalid match pattern'); },
    };
    const reported: unknown[] = [];
    const sync = createAutoRenderSync(deps({
      origins: ['https://new.example.test'],
      granted: ['https://new.example.test/*'],
      reportError: (error) => reported.push(error),
    }, failing));

    await expect(sync()).rejects.toThrow('Invalid match pattern');
    expect(registry.matches).toEqual(['https://old.example.test/*']);
    expect(reported).toHaveLength(0);
  });

  it('runs a second pass when a change arrives during an in-flight sync', async () => {
    const registry = fakeRegistry();
    let origins = ['https://first.example.test'];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const sync = createAutoRenderSync(deps({
      readOrigins: async () => {
        const snapshot = origins;
        if (snapshot.length === 1) await gate;
        return snapshot;
      },
      origins: [],
      granted: ['https://first.example.test/*', 'https://second.example.test/*'],
    }, registry));

    const firstPass = sync();
    origins = ['https://first.example.test', 'https://second.example.test'];
    const secondRequest = sync();
    release();
    await Promise.all([firstPass, secondRequest]);

    expect(registry.matches).toEqual(['https://first.example.test/*', 'https://second.example.test/*']);
  });
});
