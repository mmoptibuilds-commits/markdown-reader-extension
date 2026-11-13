import { Check } from 'lucide-react';
import { useId, type ReactElement } from 'react';
import type { CustomTheme, ReaderSettings, ThemeId } from '../../core/settings';
import { BUILT_IN_THEMES, deriveCustomPalette, resolveTheme, type ThemePalette } from '../../core/themes';
import { swatchStyle } from '../theme';

export type ThemeChoice = { kind: 'built-in'; id: ThemeId } | { kind: 'custom'; id: string };

interface Option {
  value: string;
  name: string;
  description: string;
  choice: ThemeChoice;
  palette: ThemePalette;
  /** System shows its light and dark palettes side by side. */
  alternate?: ThemePalette;
  custom: boolean;
}

function options(customThemes: readonly CustomTheme[]): Option[] {
  const builtIn = BUILT_IN_THEMES.map((theme): Option => {
    const light = resolveTheme({ theme: theme.id, customThemeId: null, customThemes: [] }, false).palette;
    const dark = resolveTheme({ theme: theme.id, customThemeId: null, customThemes: [] }, true).palette;
    return {
      value: theme.id,
      name: theme.name,
      description: theme.description,
      choice: { kind: 'built-in', id: theme.id },
      palette: light,
      ...(theme.appearance === 'system' ? { alternate: dark } : {}),
      custom: false,
    };
  });
  const custom = customThemes.map((theme): Option => ({
    value: `custom:${theme.id}`,
    name: theme.name,
    description: 'Custom theme',
    choice: { kind: 'custom', id: theme.id },
    palette: deriveCustomPalette(theme),
    custom: true,
  }));
  return [...builtIn, ...custom];
}

/**
 * Theme selection as a radio group: one Tab stop, arrow keys move and apply the choice,
 * and the selected card has a check mark as well as a ring, so state is not colour-only.
 */
export function ThemeGallery({ settings, onSelect, compact = false, legend = 'Theme' }: {
  settings: Pick<ReaderSettings, 'theme' | 'customThemeId' | 'customThemes'>;
  onSelect: (choice: ThemeChoice) => void;
  compact?: boolean;
  legend?: string;
}): ReactElement {
  const name = useId();
  const selected = settings.customThemeId && settings.customThemes.some(({ id }) => id === settings.customThemeId)
    ? `custom:${settings.customThemeId}`
    : settings.theme;
  return <fieldset className={`theme-gallery ${compact ? 'is-compact' : ''}`}>
    <legend className={compact ? 'visually-hidden' : ''}>{legend}</legend>
    <div className="theme-options">
      {options(settings.customThemes).map((option) => {
        const checked = option.value === selected;
        return <label key={option.value} className={`theme-option ${checked ? 'is-selected' : ''}`} title={compact ? option.name : undefined}>
          <input className="visually-hidden" type="radio" name={name} value={option.value} checked={checked} onChange={() => onSelect(option.choice)} />
          <span className="theme-preview" aria-hidden="true" style={swatchStyle(option.palette)}>
            {option.alternate && <span className="theme-preview-alternate" style={swatchStyle(option.alternate)} />}
            <span className="theme-preview-text">Aa</span>
            <span className="theme-preview-line" />
            <span className="theme-preview-accent" />
            {checked && <span className="theme-preview-check"><Check size={compact ? 12 : 14} strokeWidth={3} /></span>}
          </span>
          <span className={compact ? 'visually-hidden' : 'theme-option-text'}>
            <strong>{option.name}{option.custom && <span className="theme-custom-tag">Custom</span>}</strong>
            {!compact && <small>{option.description}</small>}
          </span>
        </label>;
      })}
    </div>
  </fieldset>;
}

export const choiceToChange = (choice: ThemeChoice): Partial<ReaderSettings> =>
  choice.kind === 'custom' ? { customThemeId: choice.id } : { theme: choice.id, customThemeId: null };
