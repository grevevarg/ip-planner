/** CodeMirror 6 setup: YAML mode, schema completion and hover, and our diagnostics in the lint gutter. */
import { autocompletion } from '@codemirror/autocomplete';
import { indentWithTab } from '@codemirror/commands';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, setDiagnostics, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import type { Diagnostic } from '../model/diagnostics';
import { schemaCompletion, schemaHover } from './schema-assist';

export interface NetplanEditor {
  getText(): string;
  /** Replaces the whole document (one undo step). */
  setText(text: string): void;
  showDiagnostics(diagnostics: Diagnostic[]): void;
  /** Scrolls to a range, selects it and focuses the editor. */
  reveal(from: number, to: number): void;
  focus(): void;
}

// Colours come from CSS custom properties so the editor follows the app theme.
const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', color: 'var(--ink)', backgroundColor: 'var(--editor-bg)' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55' },
  '.cm-content': { caretColor: 'var(--accent)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-gutters': { backgroundColor: 'var(--editor-bg)', color: 'var(--ink-faint)', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--editor-active)', color: 'var(--ink)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--selection)',
  },
  '.cm-cursor': { borderLeftColor: 'var(--accent)' },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface)',
    color: 'var(--ink)',
    border: '1px solid var(--rule-strong)',
    borderRadius: '4px',
    boxShadow: 'var(--shadow-pop)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'var(--accent)', color: 'var(--on-accent)' },
  '.cm-completionDetail': { fontStyle: 'normal', color: 'var(--ink-faint)', marginLeft: '1em' },
  '.cm-tooltip-autocomplete ul li[aria-selected] .cm-completionDetail': { color: 'inherit', opacity: '0.8' },
  '.cm-completionInfo': { maxWidth: '26rem', padding: '6px 10px', fontFamily: 'var(--font-ui)' },
  '.cm-schema-hover': { maxWidth: '30rem', padding: '8px 12px', fontFamily: 'var(--font-ui)', fontSize: '13px', lineHeight: '1.45' },
  '.cm-schema-hover-head': { display: 'flex', gap: '0.75em', alignItems: 'baseline', marginBottom: '2px' },
  '.cm-schema-hover code': { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--ink-soft)' },
  '.cm-schema-hover p': { margin: '4px 0 0' },
  '.cm-diagnostic': { fontFamily: 'var(--font-ui)', fontSize: '13px' },
  '.cm-diagnosticSource': { fontFamily: 'var(--font-mono)', fontSize: '11px' },
  '.cm-panels': { backgroundColor: 'var(--surface)', color: 'var(--ink)' },
});

const highlight = HighlightStyle.define([
  { tag: [tags.propertyName, tags.definition(tags.propertyName)], color: 'var(--syn-key)' },
  { tag: [tags.string, tags.content], color: 'var(--syn-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: 'var(--syn-number)' },
  { tag: [tags.comment, tags.lineComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [tags.punctuation, tags.separator, tags.squareBracket, tags.brace], color: 'var(--syn-punct)' },
  { tag: tags.meta, color: 'var(--syn-punct)' },
]);

export function createEditor(parent: HTMLElement, options: { text: string; onChange: (text: string) => void }): NetplanEditor {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.text,
      extensions: [
        basicSetup,
        keymap.of([indentWithTab]),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        yaml(),
        syntaxHighlighting(highlight),
        theme,
        lintGutter(),
        autocompletion({ override: [schemaCompletion], activateOnTyping: true }),
        schemaHover,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange(update.state.doc.toString());
        }),
      ],
    }),
  });

  return {
    getText: () => view.state.doc.toString(),
    setText(text) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 }, scrollIntoView: true });
    },
    showDiagnostics(diagnostics) {
      const length = view.state.doc.length;
      const mapped: CmDiagnostic[] = diagnostics.map((d) => {
        const from = Math.min(d.from, length);
        return { from, to: Math.min(Math.max(d.to, from), length), severity: d.severity, message: d.message, source: d.code };
      });
      view.dispatch(setDiagnostics(view.state, mapped));
    },
    reveal(from, to) {
      const length = view.state.doc.length;
      const anchor = Math.min(from, length);
      view.dispatch({ selection: { anchor, head: Math.min(to, length) }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
      view.focus();
    },
    focus: () => view.focus(),
  };
}
