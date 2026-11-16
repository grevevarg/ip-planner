/**
 * App shell: toolbar, resizable split between the editor and the output tabs,
 * and the loop that turns every edit into diagnostics and a fresh plan.
 */
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-sans/latin-ext-400.css';
import '@fontsource/ibm-plex-sans/latin-ext-500.css';
import '@fontsource/ibm-plex-sans/latin-ext-600.css';
import '@fontsource/ibm-plex-sans-condensed/latin-400.css';
import '@fontsource/ibm-plex-sans-condensed/latin-600.css';
import '@fontsource/ibm-plex-sans-condensed/latin-ext-400.css';
import '@fontsource/ibm-plex-sans-condensed/latin-ext-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-ext-400.css';
import './styles.css';
import './print.css';

import { renderDocs } from './app/docs';
import { $, debounce, escapeHtml } from './app/dom';
import { listExamples, loadExample } from './app/examples';
import { copyText, downloadText, fileStem, pickTextFile } from './app/files';
import { store } from './app/persist';
import { badge, renderProblems } from './app/problems';
import { LONG_LINK_CHARS, shareFragment, textFromFragment } from './app/share';
import { setupSplitter } from './app/splitter';
import { createTopology } from './app/topology';
import { createEditor } from './editor/editor';
import type { Diagnostic } from './model/diagnostics';
import { freezeYaml } from './model/freeze';
import { analyze, type Analysis } from './model/validate';
import { footerText, renderPlan } from './render/plan';

const STARTER = `version: 1
meta:
  title: My network plan

sites:
  - id: office
    name: Office
    supernet: 192.168.10.0/24
    vlans:
      - { id: 10, name: Staff, hosts: 50 }
`;

type TabId = 'plan' | 'topology' | 'd2' | 'problems' | 'docs';
const TABS: { id: TabId; label: string }[] = [
  { id: 'plan', label: 'Plan' },
  { id: 'topology', label: 'Topology' },
  { id: 'd2', label: 'D2 source' },
  { id: 'problems', label: 'Problems' },
  { id: 'docs', label: 'Docs' },
];

const app = $<HTMLDivElement>('#app');
app.innerHTML = `
  <header class="toolbar">
    <span class="brand">net<span class="brand-mask">/</span>plan</span>
    <div class="toolbar-group">
      <button type="button" class="btn" data-action="new">New</button>
      <button type="button" class="btn" data-action="open">Open .yaml</button>
      <button type="button" class="btn" data-action="save">Save .yaml</button>
      <details class="menu" data-examples>
        <summary class="btn">Examples</summary>
        <div class="menu-list"><p class="problems-empty">Loading the examples…</p></div>
      </details>
    </div>
    <div class="toolbar-group">
      <button type="button" class="btn" data-action="copy-resolved" title="Copy the YAML with every auto value written in, so the plan stops moving">Copy resolved YAML</button>
      <button type="button" class="btn" data-action="share" title="Copy a link that contains this plan">Share link</button>
    </div>
    <span class="toolbar-spacer"></span>
    <span class="toast" role="status" aria-live="polite"></span>
    <button type="button" class="btn btn-outline" data-action="svg">Download SVG</button>
    <button type="button" class="btn btn-primary" data-action="export">Export PDF</button>
  </header>
  <main class="workspace">
    <section class="pane-editor" aria-label="YAML editor">
      <div class="editor-host"></div>
      <details class="drawer">
        <summary>Problems <span class="count" data-badge></span> <span data-badge-label></span></summary>
        <div class="drawer-list" data-problems></div>
      </details>
    </section>
    <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize editor" aria-valuemin="20" aria-valuemax="80" tabindex="0"></div>
    <section class="pane-output" aria-label="Output">
      <div class="tabs" role="tablist">
        ${TABS.map((tab) => `<button type="button" class="tab" role="tab" id="tab-${tab.id}" aria-controls="panel-${tab.id}" data-tab="${tab.id}">${tab.label}${tab.id === 'problems' ? ' <span class="count" data-badge></span>' : ''}</button>`).join('')}
      </div>
      <p class="stale-note" hidden></p>
      <div class="panel panel-plan" role="tabpanel" id="panel-plan" aria-labelledby="tab-plan">
        <article class="sheet"><p class="plan-empty">Nothing to show yet. Write a plan on the left, or open a .yaml file.</p></article>
      </div>
      <div class="panel panel-topology" role="tabpanel" id="panel-topology" aria-labelledby="tab-topology" hidden>
        <div class="topology-bar"><span data-topology-status>The diagram appears here once the YAML is valid.</span></div>
        <div class="topology-stage"></div>
      </div>
      <div class="panel panel-d2" role="tabpanel" id="panel-d2" aria-labelledby="tab-d2" hidden>
        <div class="code-bar">
          <span>Generated from the YAML and read-only. Icons are shown as paths here; the drawn diagram embeds them.</span>
          <span class="toolbar-spacer"></span>
          <button type="button" class="btn btn-outline" data-action="copy-d2">Copy D2</button>
        </div>
        <pre class="code-block" data-d2-source tabindex="0"></pre>
      </div>
      <div class="panel panel-problems" role="tabpanel" id="panel-problems" aria-labelledby="tab-problems" hidden>
        <div data-problems></div>
      </div>
      <div class="panel panel-docs" role="tabpanel" id="panel-docs" aria-labelledby="tab-docs" hidden>
        <article class="docs"><p class="panel-note">Loading the schema documentation…</p></article>
      </div>
    </section>
  </main>
  <div class="print-footer" aria-hidden="true"></div>`;

const workspace = $<HTMLElement>('.workspace');
const output = $<HTMLElement>('.pane-output');
const sheet = $<HTMLElement>('.sheet');
const staleNote = $<HTMLParagraphElement>('.stale-note');
const toastEl = $<HTMLSpanElement>('.toast');
const printFooter = $<HTMLDivElement>('.print-footer');

// ── State ──────────────────────────────────────────────────────────────────

/** The latest analysis of the editor text. */
let current: Analysis | null = null;
/** The latest analysis without errors; this is what the views show. */
let lastGood: Analysis | null = null;
let fileName: string | undefined;
/** The text as it was last loaded or saved; anything else in the editor is unsaved work. */
let pristine = '';
/** Columns the user has switched off, per table. Kept in localStorage and honoured in print. */
const hiddenColumns = store.loadColumns();

function toast(message: string, kind: 'info' | 'warning' = 'info'): void {
  toastEl.textContent = message;
  toastEl.classList.toggle('is-warning', kind === 'warning');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => (toastEl.textContent = ''), kind === 'warning' ? 9000 : 4000);
}
toast.timer = 0 as number | undefined;

// ── Topology ───────────────────────────────────────────────────────────────

/** Puts the current diagram into the Topology section of the plan (which is what gets printed). */
function fillTopologySlot(): void {
  const slot = sheet.querySelector<HTMLElement>('[data-topology-slot]');
  if (!slot) return;
  const url = topology.imageUrl();
  if (url) {
    const image = document.createElement('img');
    image.src = url;
    image.alt = 'Topology diagram';
    slot.replaceChildren(image);
  } else if (topology.error()) {
    const note = document.createElement('p');
    note.className = 'plan-empty';
    note.textContent = 'The topology diagram could not be drawn. See the Topology tab for the reason.';
    slot.replaceChildren(note);
  }
}

const topology = createTopology(
  {
    stage: $<HTMLElement>('.topology-stage'),
    status: $<HTMLElement>('[data-topology-status]'),
    source: $<HTMLElement>('[data-d2-source]'),
  },
  fillTopologySlot,
);

// ── Tabs ───────────────────────────────────────────────────────────────────

let docsLoaded = false;

function selectTab(id: TabId): void {
  for (const tab of TABS) {
    $<HTMLButtonElement>(`#tab-${tab.id}`).setAttribute('aria-selected', String(tab.id === id));
    $<HTMLElement>(`#panel-${tab.id}`).hidden = tab.id !== id;
  }
  store.saveTab(id);
  if (id === 'docs' && !docsLoaded) {
    docsLoaded = true;
    const docs = $<HTMLElement>('.docs');
    renderDocs(docs).catch(() => {
      docsLoaded = false;
      docs.innerHTML = '<p class="panel-note">The documentation could not be loaded. Check your connection and open this tab again.</p>';
    });
  }
}
for (const tab of TABS) $<HTMLButtonElement>(`#tab-${tab.id}`).addEventListener('click', () => selectTab(tab.id));
const savedTab = store.loadTab();
selectTab(TABS.some((tab) => tab.id === savedTab) ? (savedTab as TabId) : 'plan');

// ── Editor and the analyse → render loop ───────────────────────────────────

// Every edit is analysed and autosaved; text put there by the app itself (open, example, shared link) is not.
const editor = createEditor($<HTMLDivElement>('.editor-host'), {
  text: '',
  onChange: debounce((text: string) => {
    update(text);
    // `pristine` is what the app itself last put in the editor, so anything else is the user's work.
    if (text !== pristine) store.saveText(text);
  }, 150),
});

function showProblems(diagnostics: Diagnostic[]): void {
  const info = badge(diagnostics);
  document.querySelectorAll<HTMLElement>('[data-badge]').forEach((el) => {
    el.textContent = info.text;
    el.className = info.className;
    el.title = info.label;
  });
  $<HTMLElement>('[data-badge-label]').textContent = info.label;
  document.querySelectorAll<HTMLElement>('[data-problems]').forEach((container) => {
    renderProblems(container, diagnostics, (d) => editor.reveal(d.from, d.to));
  });
}

/** A real running footer where the browser supports page-margin boxes; otherwise the fixed element is used. */
const marginBoxes = 'CSSMarginRule' in window;
document.documentElement.classList.toggle('has-margin-boxes', marginBoxes);
const footerStyle = document.createElement('style');
document.head.append(footerStyle);

function setFooter(text: string): void {
  printFooter.textContent = text;
  const quoted = JSON.stringify(text);
  const font = `font: 8pt 'IBM Plex Sans', sans-serif; color: #667180;`;
  footerStyle.textContent = marginBoxes
    ? `@page { @bottom-left { content: ${quoted}; ${font} } @bottom-right { content: "Page " counter(page) " of " counter(pages); ${font} } }`
    : '';
}

function renderViews(): void {
  if (!lastGood?.model) return;
  sheet.innerHTML = renderPlan(lastGood.model, lastGood.diagnostics, { hidden: hiddenColumns });
  fillTopologySlot();
  setFooter(footerText(lastGood.model));
  document.title = `${lastGood.model.meta.title ?? 'Untitled plan'} – netplan`;
}

function update(text: string): void {
  current = analyze(text);
  editor.showDiagnostics(current.diagnostics);
  showProblems(current.diagnostics);

  if (!current.hasErrors && current.model) {
    lastGood = current;
    renderViews();
    topology.update(current.model);
  }
  // With errors the last good render stays up, dimmed, until the file is fixed.
  const errors = current.diagnostics.filter((d) => d.severity === 'error').length;
  output.classList.toggle('is-stale', current.hasErrors && lastGood !== null);
  staleNote.hidden = !current.hasErrors;
  if (current.hasErrors) {
    const count = `${errors} ${errors === 1 ? 'error' : 'errors'}`;
    staleNote.textContent = lastGood
      ? `Showing the last version without errors. Fix ${count} in the YAML to update it.`
      : `Fix ${count} in the YAML to see the plan.`;
  }
}

// ── Column visibility ──────────────────────────────────────────────────────

sheet.addEventListener('change', (event) => {
  const box = event.target as HTMLInputElement;
  const { table, column } = box.dataset;
  if (!table || !column) return;
  const hidden = new Set(hiddenColumns[table] ?? []);
  if (box.checked) hidden.delete(column);
  else hidden.add(column);
  hiddenColumns[table] = [...hidden];
  store.saveColumns(hiddenColumns);

  // Re-render, then reopen the menu the user is working in.
  const menus = [...sheet.querySelectorAll('.column-menu')];
  const index = menus.indexOf(box.closest('.column-menu')!);
  renderViews();
  const reopened = sheet.querySelectorAll<HTMLDetailsElement>('.column-menu')[index];
  if (reopened) {
    reopened.open = true;
    reopened.querySelector<HTMLInputElement>(`input[data-column="${column}"]`)?.focus();
  }
});

// Clicking anywhere else closes open column menus and toolbar menus.
document.addEventListener('click', (event) => {
  document.querySelectorAll<HTMLDetailsElement>('details.column-menu[open], details.menu[open]').forEach((menu) => {
    if (!menu.contains(event.target as Node)) menu.open = false;
  });
});

// ── Toolbar actions ────────────────────────────────────────────────────────

/**
 * Replaces the editor content. `autosave: false` is for a plan opened from a
 * shared link: it is shown, but the visitor's own saved plan is kept until
 * they start editing.
 */
function loadText(text: string, options: { name?: string; autosave?: boolean } = {}): void {
  fileName = options.name;
  pristine = text;
  editor.setText(text);
  update(text);
  if (options.autosave !== false) store.saveText(text);
}

/** True when it is fine to replace the editor content. Asks first if there is unsaved work. */
function mayDiscard(question: string): boolean {
  return editor.getText() === pristine || window.confirm(`${question} Changes since you last saved the .yaml will be lost.`);
}

const actions: Record<string, () => void | Promise<void>> = {
  new() {
    if (!mayDiscard('Start a new plan?')) return;
    loadText(STARTER);
    toast('Started a new plan');
  },
  async open() {
    if (!mayDiscard('Open another file?')) return;
    const file = await pickTextFile('.yaml,.yml,text/yaml,text/plain');
    if (!file) return;
    loadText(file.text, { name: file.name });
    toast(`Opened ${file.name}`);
  },
  save() {
    const name = fileName ?? `${fileStem(current?.model?.meta.title ?? lastGood?.model?.meta.title)}.yaml`;
    downloadText(name, editor.getText(), 'text/yaml');
    pristine = editor.getText();
    toast(`Saved ${name}`);
  },
  async 'copy-resolved'() {
    // Analyse the text as it is right now rather than waiting for the debounce.
    const analysis = analyze(editor.getText());
    if (analysis.hasErrors || !analysis.model) {
      toast('Fix the errors first: auto values cannot be computed while the YAML has errors.', 'warning');
      return;
    }
    const ok = await copyText(freezeYaml(analysis.text, analysis.model));
    toast(ok ? 'Copied the YAML with all auto values written in' : 'Could not copy to the clipboard.', ok ? 'info' : 'warning');
  },
  async share() {
    const url = `${window.location.origin}${window.location.pathname}${shareFragment(editor.getText())}`;
    const ok = await copyText(url);
    if (!ok) toast('Could not copy the link to the clipboard.', 'warning');
    else if (url.length > LONG_LINK_CHARS) {
      toast(`Link copied, but it is ${(url.length / 1000).toFixed(1)} kB long and some apps cut long links. Sending the saved .yaml is safer.`, 'warning');
    } else toast('Link copied. Anyone with the link can read the plan.');
  },
  async export() {
    if (!lastGood) {
      toast('Nothing to export yet: the YAML has errors.', 'warning');
      return;
    }
    if (current?.hasErrors) toast('The YAML has errors, so the PDF shows the last version without them.', 'warning');
    // The PDF includes the diagram, so wait for a redraw that is still under way.
    await topology.settled();
    await document.fonts.ready;
    await sheet.querySelector<HTMLImageElement>('[data-topology-slot] img')?.decode().catch(() => undefined);
    window.print();
  },
  svg() {
    const svg = topology.svg();
    if (!svg) {
      toast(topology.error() ? 'The diagram could not be drawn, so there is no SVG to download.' : 'The diagram is not ready yet.', 'warning');
      return;
    }
    const name = `${fileStem(lastGood?.model?.meta.title)}-topology.svg`;
    downloadText(name, svg, 'image/svg+xml');
    toast(`Downloaded ${name}`);
  },
  async 'copy-d2'() {
    toast((await copyText(topology.source())) ? 'Copied the D2 source' : 'Could not copy. Select the text and copy it by hand.');
  },
};

document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
  button.addEventListener('click', () => void actions[button.dataset.action!]());
});

setupSplitter($<HTMLElement>('.splitter'), workspace, store.loadSplit(), store.saveSplit);

// ── Examples menu ──────────────────────────────────────────────────────────

const examplesMenu = $<HTMLDetailsElement>('[data-examples]');
const examplesList = $<HTMLElement>('.menu-list', examplesMenu);

async function openExample(file: string, title: string): Promise<void> {
  examplesMenu.open = false;
  if (!mayDiscard(`Load the example "${title}"?`)) return;
  try {
    loadText(await loadExample(file));
    toast(`Loaded the example "${title}"`);
  } catch {
    toast('The example could not be loaded. Check your connection and try again.', 'warning');
  }
}

listExamples().then(
  (examples) => {
    examplesList.innerHTML = examples
      .map((e, index) => `<button type="button" class="menu-item" data-example="${index}">${escapeHtml(e.title)}<small>${escapeHtml(e.description ?? '')}</small></button>`)
      .join('');
    examplesList.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((button) => {
      const example = examples[Number(button.dataset.example)];
      button.addEventListener('click', () => void openExample(example.file, example.title));
    });
  },
  () => {
    examplesList.innerHTML = '<p class="problems-empty">The examples could not be loaded.</p>';
  },
);

// ── Start-up: a shared link wins, then the autosaved plan, then the main example ──

/** Takes a shared plan out of the URL fragment, if there is one. Returns whether the fragment was a share link. */
function takeSharedPlan(): { isShareLink: boolean; text: string | null } {
  const fragment = window.location.hash;
  const isShareLink = fragment.startsWith('#y=');
  // Drop the fragment so a reload does not throw away edits made since.
  if (isShareLink) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return { isShareLink, text: textFromFragment(fragment) };
}

function openShared(text: string): void {
  const saved = store.loadText();
  loadText(text, { autosave: false });
  toast(saved !== null && saved !== text ? 'Opened a shared plan. Your own plan stays saved until you edit this one.' : 'Opened a shared plan');
}

// A share link pasted into the address bar while the app is open.
window.addEventListener('hashchange', () => {
  const shared = takeSharedPlan();
  if (!shared.isShareLink) return;
  if (shared.text === null) toast('The shared link is damaged, so it was ignored.', 'warning');
  else if (mayDiscard('Open the shared plan?')) openShared(shared.text);
});

async function start(): Promise<void> {
  const shared = takeSharedPlan();
  if (shared.text !== null) {
    openShared(shared.text);
    return;
  }
  if (shared.isShareLink) toast('The shared link is damaged, so it was ignored.', 'warning');
  const saved = store.loadText();
  if (saved !== null) {
    loadText(saved);
    return;
  }
  // First visit: show the full example rather than an empty page.
  try {
    loadText(await loadExample('three-companies.yaml'), { autosave: false });
  } catch {
    loadText(STARTER, { autosave: false });
  }
}

void start();
