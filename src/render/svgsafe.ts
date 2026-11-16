/**
 * D2's SVG output is put into the page inline, and a diagram can come from a
 * shared link written by someone else (`diagram.extra_d2` accepts raw D2,
 * including Markdown blocks). Anything that could run code is removed first.
 */
const BLOCKED = 'script, iframe, object, embed, link, meta, base, form';

export interface SafeSvg {
  element: SVGSVGElement;
  /** The cleaned SVG as text, for "Download SVG" and for the <img> used in print. */
  text: string;
}

export function sanitizeSvg(svgText: string): SafeSvg | null {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;

  root.querySelectorAll(BLOCKED).forEach((node) => node.remove());
  for (const node of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.replace(/\s+/g, '').toLowerCase();
      const isUrl = name === 'href' || name.endsWith(':href') || name === 'src';
      if (name.startsWith('on') || (isUrl && (value.startsWith('javascript:') || value.startsWith('data:text/html')))) {
        node.removeAttribute(attribute.name);
      }
    }
  }

  // Give the diagram its natural size so it scales predictably inline and as an image.
  const viewBox = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    root.setAttribute('width', String(Math.round(viewBox[2])));
    root.setAttribute('height', String(Math.round(viewBox[3])));
  }
  const element = document.importNode(root, true) as unknown as SVGSVGElement;
  return { element, text: new XMLSerializer().serializeToString(root) };
}
