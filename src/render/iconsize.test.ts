import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILTIN_ICONS, classifyIcon, iconPath } from '../model/icons';
import { fitIcon, svgAspect } from './iconsize';

describe('svgAspect', () => {
  it('reads the viewBox', () => {
    expect(svgAspect('<svg xmlns="x" viewBox="0 0 135.2 37.5" width="10mm">')).toEqual({ width: 135.2, height: 37.5 });
    expect(svgAspect('<?xml version="1.0"?>\n<svg\n   viewBox="0,0,256,128">')).toEqual({ width: 256, height: 128 });
  });

  it('falls back to width and height', () => {
    expect(svgAspect('<svg width="64" height="32">')).toEqual({ width: 64, height: 32 });
    expect(svgAspect('<svg>')).toBeNull();
    expect(svgAspect('not svg')).toBeNull();
  });
});

describe('fitIcon', () => {
  it('fits the standard box and keeps proportions', () => {
    expect(fitIcon({ width: 146, height: 146 })).toEqual({ width: 64, height: 64 });
    expect(fitIcon({ width: 135.2, height: 37.5 })).toEqual({ width: 104, height: 29 });
    expect(fitIcon({ width: 10, height: 100 })).toEqual({ width: 6, height: 64 });
    expect(fitIcon(null)).toEqual({ width: 64, height: 64 });
  });
});

describe('icon references', () => {
  it('classifies names, paths and URLs', () => {
    expect(classifyIcon('router')).toBe('builtin');
    expect(classifyIcon('icons/custom/fw.svg')).toBe('path');
    expect(classifyIcon('fw.svg')).toBe('path');
    expect(classifyIcon('https://example.org/fw.svg')).toBe('remote');
    expect(classifyIcon('toaster')).toBe('unknown');
  });

  it('maps references to site-relative paths', () => {
    expect(iconPath('router')).toBe('icons/router.svg');
    expect(iconPath('./icons/custom/fw.svg')).toBe('icons/custom/fw.svg');
    expect(iconPath('/icons/custom/fw.svg')).toBe('icons/custom/fw.svg');
    expect(iconPath('https://example.org/fw.svg')).toBeNull();
    expect(iconPath('toaster')).toBeNull();
  });

  it('ships a readable SVG for every built-in icon', () => {
    for (const name of BUILTIN_ICONS) {
      const svg = readFileSync(`public/icons/${name}.svg`, 'utf8');
      expect(svgAspect(svg), name).not.toBeNull();
      // Self-contained: nothing that would be fetched from elsewhere, and no scripts.
      expect(svg, name).not.toMatch(/<script|<image|href\s*=\s*["']https?:/i);
    }
  });
});
