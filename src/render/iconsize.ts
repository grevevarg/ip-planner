/** Box that every icon is scaled to fit inside, in diagram pixels. */
const MAX_WIDTH = 104;
const MAX_HEIGHT = 64;

/** Width and height of an SVG as declared by its viewBox (preferred) or width/height attributes. */
export function svgAspect(svgText: string): { width: number; height: number } | null {
  const tag = /<svg\b[^>]*>/i.exec(svgText)?.[0];
  if (!tag) return null;
  const viewBox = /\bviewBox\s*=\s*["']\s*[-\d.e]+[\s,]+[-\d.e]+[\s,]+([\d.e]+)[\s,]+([\d.e]+)/i.exec(tag);
  if (viewBox) {
    const [width, height] = [Number(viewBox[1]), Number(viewBox[2])];
    if (width > 0 && height > 0) return { width, height };
  }
  const width = parseFloat(/\bwidth\s*=\s*["']([\d.]+)/i.exec(tag)?.[1] ?? '');
  const height = parseFloat(/\bheight\s*=\s*["']([\d.]+)/i.exec(tag)?.[1] ?? '');
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Scales an icon to fit the standard box while keeping its proportions (a wide server stays wide). */
export function fitIcon(natural: { width: number; height: number } | null): { width: number; height: number } {
  if (!natural) return { width: MAX_HEIGHT, height: MAX_HEIGHT };
  const scale = Math.min(MAX_WIDTH / natural.width, MAX_HEIGHT / natural.height);
  return { width: Math.max(1, Math.round(natural.width * scale)), height: Math.max(1, Math.round(natural.height * scale)) };
}
