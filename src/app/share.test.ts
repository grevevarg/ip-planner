import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileStem } from './files';
import { shareFragment, textFromFragment } from './share';

describe('share links', () => {
  it('round-trips a whole plan, including non-ASCII text', () => {
    const text = readFileSync('public/examples/three-companies.yaml', 'utf8');
    const fragment = shareFragment(text);
    expect(fragment.startsWith('#y=')).toBe(true);
    expect(fragment).toMatch(/^#y=[A-Za-z0-9+\-$]+$/);
    expect(textFromFragment(fragment)).toBe(text);
    expect(text).toContain('Nedgrävd');
  });

  it('ignores fragments that are not share links', () => {
    expect(textFromFragment('')).toBeNull();
    expect(textFromFragment('#site')).toBeNull();
    expect(textFromFragment('#y=')).toBeNull();
    expect(textFromFragment('#y=%%%not-valid%%%')).toBeNull();
  });
});

describe('fileStem', () => {
  it('makes a safe file name from a title', () => {
    expect(fileStem('Lab 5 – Linky / SilverCrest / Bluestar')).toBe('lab-5-linky-silvercrest-bluestar');
    expect(fileStem('Nedgrävd kabel')).toBe('nedgravd-kabel');
    expect(fileStem('   ')).toBe('netplan');
    expect(fileStem(undefined)).toBe('netplan');
  });
});
