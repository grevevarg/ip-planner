import { EditorView, basicSetup } from 'codemirror';
import { yaml } from '@codemirror/lang-yaml';
import { parseYaml } from './model/parse';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div style="display:flex;height:100vh">
    <div id="editor" style="flex:1;overflow:auto;border-right:1px solid #8884"></div>
    <pre id="out" style="flex:1;overflow:auto;margin:0;padding:12px"></pre>
  </div>`;
const out = app.querySelector<HTMLPreElement>('#out')!;

function show(text: string): void {
  const r = parseYaml(text);
  out.textContent = r.syntax.length
    ? r.syntax.map((p) => `line ${p.line}: ${p.message}`).join('\n')
    : JSON.stringify(r.data, null, 2);
}

const initial = 'version: 1\nmeta:\n  title: hello world\n';
new EditorView({
  doc: initial,
  parent: app.querySelector<HTMLDivElement>('#editor')!,
  extensions: [
    basicSetup,
    yaml(),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) show(u.state.doc.toString());
    }),
  ],
});
show(initial);
