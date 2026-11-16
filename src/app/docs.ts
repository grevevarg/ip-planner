/** The Docs tab: docs/SCHEMA.md rendered in place. Loaded on first use. */
import { marked } from 'marked';

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function renderDocs(container: HTMLElement): Promise<void> {
  const { default: markdown } = await import('../../docs/SCHEMA.md?raw');
  // SCHEMA.md is generated from our own schema, so its HTML (only <br> in table cells) is trusted.
  container.innerHTML = await marked.parse(markdown, { gfm: true });

  // Headings get ids matching the anchors the generator writes, scoped to this panel.
  container.querySelectorAll<HTMLElement>('h1, h2, h3').forEach((heading) => {
    heading.id = `doc-${slug(heading.textContent ?? '')}`;
  });
  // In-page links scroll inside the panel instead of changing the URL fragment (which holds share links).
  container.addEventListener('click', (event) => {
    const link = (event.target as HTMLElement).closest('a');
    const href = link?.getAttribute('href');
    if (!link || !href) return;
    if (href.startsWith('#')) {
      event.preventDefault();
      container.querySelector(`#doc-${CSS.escape(href.slice(1))}`)?.scrollIntoView({ block: 'start' });
    } else {
      link.target = '_blank';
      link.rel = 'noopener';
    }
  });
}
