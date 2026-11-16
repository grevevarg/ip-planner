/** Draggable divider between the editor and the output pane. Also works with the arrow keys. */
export function setupSplitter(handle: HTMLElement, workspace: HTMLElement, initial: number, onChange: (percent: number) => void): void {
  let percent = initial;
  const apply = (value: number): void => {
    percent = Math.min(80, Math.max(20, value));
    workspace.style.setProperty('--split', `${percent}%`);
    handle.setAttribute('aria-valuenow', String(Math.round(percent)));
  };
  apply(initial);

  handle.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-dragging');
    const move = (e: PointerEvent): void => {
      const rect = workspace.getBoundingClientRect();
      apply(((e.clientX - rect.left) / rect.width) * 100);
    };
    const stop = (): void => {
      handle.classList.remove('is-dragging');
      handle.removeEventListener('pointermove', move);
      onChange(percent);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop, { once: true });
    handle.addEventListener('pointercancel', stop, { once: true });
  });

  handle.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    apply(percent + (event.key === 'ArrowLeft' ? -2 : 2));
    onChange(percent);
  });
}
