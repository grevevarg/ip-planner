/** Example files shipped in public/examples/, listed in index.json. */

export interface ExampleEntry {
  file: string;
  title: string;
  description: string;
}

const base = `${import.meta.env.BASE_URL}examples/`;

export async function listExamples(): Promise<ExampleEntry[]> {
  const response = await fetch(`${base}index.json`);
  if (!response.ok) throw new Error(`examples/index.json: ${response.status}`);
  const entries: unknown = await response.json();
  if (!Array.isArray(entries)) return [];
  return entries.filter(
    (e): e is ExampleEntry => typeof e === 'object' && e !== null && typeof e.file === 'string' && typeof e.title === 'string',
  );
}

export async function loadExample(file: string): Promise<string> {
  // Only plain file names from the index are fetched, never paths.
  if (!/^[\w.-]+\.ya?ml$/.test(file)) throw new Error(`Not an example file: ${file}`);
  const response = await fetch(`${base}${file}`);
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  return response.text();
}
