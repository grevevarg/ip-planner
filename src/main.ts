import { createEditor } from './editor/editor';
import { analyze } from './model/validate';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <style>
    :root { --ink:#1b2430; --ink-soft:#4a5565; --ink-faint:#7a8494; --editor-bg:#fff; --editor-active:#f1f4f8; --selection:#cfe0fb;
      --accent:#0f4fb4; --on-accent:#fff; --surface:#fff; --rule-strong:#c5ccd6; --shadow-pop:0 4px 16px #0003;
      --font-mono:ui-monospace,monospace; --font-ui:system-ui,sans-serif;
      --syn-key:#0f4fb4; --syn-string:#1b2430; --syn-number:#9a3412; --syn-comment:#7a8494; --syn-punct:#7a8494; }
    body { margin:0; font-family:var(--font-ui); }
  </style>
  <div style="display:flex;height:100vh">
    <div id="editor" style="flex:1;min-width:0;overflow:hidden;border-right:1px solid #8884"></div>
    <pre id="out" style="flex:1;overflow:auto;margin:0;padding:12px;white-space:pre-wrap"></pre>
  </div>`;
const out = app.querySelector<HTMLPreElement>('#out')!;

const initial = 'version: 1\nmeta:\n  title: hello world\n';
let timer: number | undefined;
const editor = createEditor(app.querySelector<HTMLDivElement>('#editor')!, {
  text: initial,
  onChange: (text) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => update(text), 150);
  },
});

function update(text: string): void {
  const analysis = analyze(text);
  editor.showDiagnostics(analysis.diagnostics);
  out.textContent = analysis.diagnostics.length
    ? analysis.diagnostics.map((d) => `${d.severity} ${d.code} line ${d.line}: ${d.message}`).join('\n')
    : 'No problems.';
}
update(initial);
