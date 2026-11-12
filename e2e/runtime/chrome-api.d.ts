// Minimal typings for the extension APIs that the runtime specs call from inside page.evaluate().
// The real APIs are provided by Chromium; these declarations only keep the specs type-checked.
declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
  permissions: { contains(request: { origins: string[] }): Promise<boolean> };
  scripting: { getRegisteredContentScripts(filter?: { ids?: string[] }): Promise<unknown[]> };
};
