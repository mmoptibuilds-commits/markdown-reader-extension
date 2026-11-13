import { describe, expect, it } from 'vitest';
import { hostPattern } from './origins';

describe('host patterns', () => {
  it.each([
    ['https://docs.example.test', 'https://docs.example.test/*'],
    ['https://docs.example.test:8443', 'https://docs.example.test/*'],
    ['http://localhost:5173', 'http://localhost/*'],
    ['http://127.0.0.1:34449', 'http://127.0.0.1/*'],
  ])('maps %s to a pattern without a port', (origin, pattern) => {
    expect(hostPattern(origin)).toBe(pattern);
    expect(hostPattern(new URL(`${origin}/a/b.md?x=1`))).toBe(pattern);
  });
});
