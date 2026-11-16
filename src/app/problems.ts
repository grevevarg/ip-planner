import { countBySeverity, type Diagnostic } from '../model/diagnostics';
import { escapeHtml } from './dom';

/** Fills a container with the list of diagnostics; clicking one jumps to its line in the editor. */
export function renderProblems(container: HTMLElement, diagnostics: Diagnostic[], onPick: (d: Diagnostic) => void): void {
  if (diagnostics.length === 0) {
    container.innerHTML = '<p class="problems-empty">No problems. The file is valid and every check passes.</p>';
    return;
  }
  const order = { error: 0, warning: 1, info: 2 } as const;
  const sorted = [...diagnostics].sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
  container.innerHTML = `<ul class="problems">${sorted
    .map(
      (d, index) => `<li><button type="button" class="problem is-${d.severity}" data-index="${index}">
        <span class="problem-line">Line ${d.line}</span>
        <span class="problem-code">${escapeHtml(d.code)} <span class="visually-hidden">(${d.severity})</span></span>
        <span class="problem-message">${escapeHtml(d.message)}</span>
      </button></li>`,
    )
    .join('')}</ul>`;
  container.querySelectorAll<HTMLButtonElement>('.problem').forEach((button) => {
    button.addEventListener('click', () => onPick(sorted[Number(button.dataset.index)]));
  });
}

/** Text and style for a count badge: errors win over warnings. */
export function badge(diagnostics: Diagnostic[]): { text: string; className: string; label: string } {
  const counts = countBySeverity(diagnostics);
  const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (counts.error) {
    const rest = counts.warning ? `, ${plural(counts.warning, 'warning')}` : '';
    return { text: String(counts.error + counts.warning), className: 'count has-error', label: `${plural(counts.error, 'error')}${rest}` };
  }
  if (counts.warning) return { text: String(counts.warning), className: 'count has-warning', label: plural(counts.warning, 'warning') };
  return { text: '✓', className: 'count is-clear', label: 'No problems' };
}
