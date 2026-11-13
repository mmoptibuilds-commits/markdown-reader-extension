import { Minus, Plus } from 'lucide-react';
import { useId, type ReactElement } from 'react';
import type { ReaderSettings } from '../../core/settings';
import type { SettingsChange, SettingsPatch } from '../../core/settings-change';
import { choiceToChange, ThemeGallery } from '../components/ThemeGallery';

const fonts: Array<{ value: ReaderSettings['fontFamily']; label: string }> = [
  { value: 'serif', label: 'Serif' },
  { value: 'sans', label: 'Sans' },
  { value: 'mono', label: 'Mono' },
];

/** The "Aa" panel: theme and the reading measurements, applied as you change them. */
export function ReadingPanel({ id, settings, change, changeSoon }: {
  id: string;
  settings: ReaderSettings;
  change: (change: SettingsChange) => void;
  changeSoon: (patch: SettingsPatch) => void;
}): ReactElement {
  const fontName = useId();
  const size = settings.fontSize;
  return <div id={id} className="reading-panel" popover="auto" role="dialog" aria-label="Reading settings">
    <ThemeGallery compact legend="Theme" settings={settings} onSelect={(choice) => change({ kind: 'patch', patch: choiceToChange(choice) })} />
    <div className="panel-row">
      <span className="panel-label" id={`${id}-size`}>Text size</span>
      <div className="stepper" role="group" aria-labelledby={`${id}-size`}>
        <button className="icon-button" type="button" aria-label="Smaller text" disabled={size <= 14} onClick={() => change({ kind: 'patch', patch: { fontSize: size - 1 } })}><Minus size={16} aria-hidden="true" /></button>
        <output aria-live="polite">{size}px</output>
        <button className="icon-button" type="button" aria-label="Larger text" disabled={size >= 28} onClick={() => change({ kind: 'patch', patch: { fontSize: size + 1 } })}><Plus size={16} aria-hidden="true" /></button>
      </div>
    </div>
    <fieldset className="panel-row segmented">
      <legend className="panel-label">Typeface</legend>
      <div>{fonts.map((font) => <label key={font.value} className={settings.fontFamily === font.value ? 'is-selected' : ''}>
        <input className="visually-hidden" type="radio" name={fontName} checked={settings.fontFamily === font.value} onChange={() => change({ kind: 'patch', patch: { fontFamily: font.value } })} />
        <span className={`font-sample font-${font.value}`}>{font.label}</span>
      </label>)}</div>
    </fieldset>
    <label className="panel-range">
      <span className="panel-label">Line width<output>{settings.readingWidth}px</output></span>
      <input type="range" min={560} max={1120} step={20} value={settings.readingWidth} aria-valuetext={`${settings.readingWidth} pixels`} onChange={(event) => changeSoon({ readingWidth: Number(event.target.value) })} />
    </label>
    <label className="panel-range">
      <span className="panel-label">Line spacing<output>{settings.lineHeight.toFixed(2)}</output></span>
      <input type="range" min={1.35} max={2.2} step={0.05} value={settings.lineHeight} aria-valuetext={`${settings.lineHeight.toFixed(2)} times the text size`} onChange={(event) => changeSoon({ lineHeight: Number(event.target.value) })} />
    </label>
  </div>;
}
