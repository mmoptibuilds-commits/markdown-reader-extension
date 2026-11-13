import { browser } from 'wxt/browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, normalizeSettings, SETTINGS_STORAGE_KEY, type ReaderSettings } from '../../core/settings';
import { applySettingsChange, SettingsChangeError, type SettingsChange, type SettingsPatch } from '../../core/settings-change';
import { changeSettings, loadSettings } from '../../shared/storage';

export interface SettingsState {
  settings: ReaderSettings;
  /** False until the stored settings have been read; controls should not offer stale defaults as saved. */
  loaded: boolean;
  /** Applies a change immediately on screen and saves it through the shared queue. */
  change: (change: SettingsChange) => Promise<ReaderSettings | undefined>;
  /** For sliders: shows the value at once and saves it once the user pauses. */
  changeSoon: (patch: SettingsPatch) => void;
}

/**
 * Shared settings state for every extension page. Changes are sent as intentions, the page
 * follows storage changes made elsewhere, and a failed save restores the stored value.
 */
export function useSettings(onError: (message: string) => void): SettingsState {
  const [settings, setSettings] = useState<ReaderSettings>({ ...DEFAULT_SETTINGS });
  const [loaded, setLoaded] = useState(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const pendingRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    loadSettings().then((saved) => {
      if (!cancelled) { setSettings(saved); setLoaded(true); }
    }).catch(() => {
      if (!cancelled) { setLoaded(true); onErrorRef.current('Preferences could not be loaded. Defaults are shown until the page is reopened.'); }
    });
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
      // While this page's own changes are in flight, its optimistic state is newer.
      if (area !== 'local' || !(SETTINGS_STORAGE_KEY in changes) || pendingRef.current > 0) return;
      setSettings(normalizeSettings(changes[SETTINGS_STORAGE_KEY]?.newValue));
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => { cancelled = true; browser.storage.onChanged.removeListener(onChanged); };
  }, []);

  const change = useCallback(async (next: SettingsChange): Promise<ReaderSettings | undefined> => {
    setSettings((current) => {
      try { return applySettingsChange(current, next); } catch { return current; }
    });
    pendingRef.current += 1;
    try {
      const saved = await changeSettings(next);
      pendingRef.current -= 1;
      if (pendingRef.current === 0) setSettings(saved);
      return saved;
    } catch (error) {
      pendingRef.current -= 1;
      onErrorRef.current(error instanceof SettingsChangeError ? error.message : 'Settings could not be saved. Browser storage may be full or unavailable.');
      if (pendingRef.current === 0) void loadSettings().then(setSettings).catch(() => undefined);
      return undefined;
    }
  }, []);

  const pendingPatch = useRef<SettingsPatch>({});
  const timer = useRef(0);
  const changeSoon = useCallback((patch: SettingsPatch) => {
    setSettings((current) => applySettingsChange(current, { kind: 'patch', patch }));
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const next = pendingPatch.current;
      pendingPatch.current = {};
      void change({ kind: 'patch', patch: next });
    }, 250);
  }, [change]);
  useEffect(() => () => {
    window.clearTimeout(timer.current);
    if (Object.keys(pendingPatch.current).length) void changeSettings({ kind: 'patch', patch: pendingPatch.current }).catch(() => undefined);
  }, []);

  return { settings, loaded, change, changeSoon };
}
