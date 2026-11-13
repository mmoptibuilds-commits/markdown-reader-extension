import { describe, expect, it } from 'vitest';
import { filterCommands, type ReaderCommand } from './dialogs';

const command = (label: string, keywords?: string): ReaderCommand => ({ id: label, label, run: () => undefined, ...(keywords ? { keywords } : {}) });
const commands = [command('Open file'), command('Open folder'), command('Search this document', 'find'), command('Print or save as PDF'), command('Next theme', 'appearance colour')];

describe('command palette search', () => {
  it('lists every command for an empty query', () => {
    expect(filterCommands(commands, '  ').map(({ label }) => label)).toEqual(commands.map(({ label }) => label));
  });

  it('ranks label starts, then word starts, then substrings, then keywords', () => {
    expect(filterCommands(commands, 'o').map(({ label }) => label)).toEqual(['Open file', 'Open folder', 'Print or save as PDF', 'Search this document', 'Next theme']);
    expect(filterCommands(commands, 'find').map(({ label }) => label)).toEqual(['Search this document']);
    expect(filterCommands(commands, 'PDF').map(({ label }) => label)).toEqual(['Print or save as PDF']);
  });

  it('returns nothing for an unmatched query', () => {
    expect(filterCommands(commands, 'zzz')).toEqual([]);
  });
});
