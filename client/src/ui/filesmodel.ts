// Lógica pura do explorador de arquivos (ui/files.ts, ui/filespane.ts): tipos da API, linhas da árvore com filtro,
// linguagem do realce, caminho absoluto e a memória do último arquivo aberto. Sem DOM, para testar em Node.

/** Uma entrada de GET /api/files/tree. */
export interface FileEntry {
  name: string;
  kind: 'dir' | 'file' | 'link';
  size?: number;
  blocked?: boolean;
}

/** Resposta de GET /api/files/tree. */
export interface TreeData {
  room: string;
  path: string;
  entries: FileEntry[];
  truncated: boolean;
}

/** Resposta de GET /api/files/raw. */
export type RawData = { path: string; size: number; text: string } | { path: string; size: number; binary: true } | { path: string; size: number; tooLarge: true };

/** O que se sabe de uma pasta: carregando, a lista, ou o erro. */
export type DirState = { state: 'loading' } | { state: 'ready'; data: TreeData } | { state: 'error'; status: number; message: string };

/** Teto da lista do servidor (server/files/browse.ts TREE_MAX_ENTRIES). */
export const TREE_LIMIT = 2000;

/** Linha da árvore, já na ordem de exibição. */
export type TreeRow =
  | { type: 'entry'; path: string; name: string; kind: FileEntry['kind']; depth: number; blocked: boolean; open: boolean; size?: number }
  | { type: 'loading' | 'empty' | 'truncated'; path: string; depth: number }
  | { type: 'error'; path: string; depth: number; message: string };

export function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

export function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

function matches(name: string, needle: string): boolean {
  return name.toLowerCase().includes(needle);
}

/** Alguma entrada JÁ CARREGADA, abaixo de `dir`, casa com o filtro? (o que não foi carregado não entra) */
function hasMatchBelow(dirs: ReadonlyMap<string, DirState>, dir: string, needle: string, seen = new Set<string>()): boolean {
  if (seen.has(dir)) return false;
  seen.add(dir);
  const st = dirs.get(dir);
  if (st?.state !== 'ready') return false;
  return st.data.entries.some((e) => !e.blocked && (matches(e.name, needle) || (e.kind === 'dir' && hasMatchBelow(dirs, joinRel(dir, e.name), needle, seen))));
}

/**
 * Linhas visíveis da árvore: pastas abertas expandidas a partir da raiz (''), com o filtro por nome aplicado só ao que
 * já foi carregado. Com filtro, uma pasta com resultado carregado dentro dela aparece aberta, mesmo fechada.
 */
export function treeRows(dirs: ReadonlyMap<string, DirState>, open: ReadonlySet<string>, filter: string): TreeRow[] {
  const needle = filter.trim().toLowerCase();
  const rows: TreeRow[] = [];
  const walk = (dir: string, depth: number): void => {
    const st = dirs.get(dir);
    if (!st || st.state === 'loading') {
      rows.push({ type: 'loading', path: dir, depth });
      return;
    }
    if (st.state === 'error') {
      rows.push({ type: 'error', path: dir, depth, message: st.message });
      return;
    }
    let shown = 0;
    for (const e of st.data.entries) {
      const path = joinRel(dir, e.name);
      const isDir = e.kind === 'dir' && !e.blocked;
      const below = needle && isDir ? hasMatchBelow(dirs, path, needle) : false;
      if (needle && !matches(e.name, needle) && !below) continue;
      shown++;
      const expanded = isDir && (open.has(path) || below);
      rows.push({ type: 'entry', path, name: e.name, kind: e.kind, depth, blocked: !!e.blocked, open: expanded, ...(e.size !== undefined ? { size: e.size } : {}) });
      if (expanded) walk(path, depth + 1);
    }
    if (!needle && shown === 0) rows.push({ type: 'empty', path: dir, depth });
    if (st.data.truncated) rows.push({ type: 'truncated', path: dir, depth });
  };
  walk('', 0);
  return rows;
}

// ---------------------------------------------------------------- linguagem do realce

/** Linguagens registradas no highlight.js (filespane.ts). */
export type Lang = 'javascript' | 'typescript' | 'json' | 'markdown' | 'sql' | 'css' | 'xml' | 'yaml' | 'bash' | 'java' | 'python' | 'ini';

const BY_EXT: Readonly<Record<string, Lang>> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  md: 'markdown',
  markdown: 'markdown',
  sql: 'sql',
  css: 'css',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  xhtml: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  java: 'java',
  py: 'python',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  toml: 'ini',
  properties: 'ini',
  env: 'ini',
  editorconfig: 'ini',
};

/** Linguagem do realce pelo nome do arquivo; undefined = texto puro (extensão desconhecida). */
export function languageOf(rel: string): Lang | undefined {
  const name = baseName(rel).toLowerCase();
  // .env.example, .env.sample, .env.local...: chave=valor.
  if (name === '.env' || name.startsWith('.env.')) return 'ini';
  const dot = name.lastIndexOf('.');
  // Sem ponto, ou só o ponto da frente (".gitignore"): sem extensão. ".editorconfig" vale como extensão conhecida.
  const ext = dot === -1 ? '' : name.slice(dot + 1);
  return ext && Object.hasOwn(BY_EXT, ext) ? BY_EXT[ext] : undefined;
}

export function isMarkdown(rel: string): boolean {
  return languageOf(rel) === 'markdown';
}

// ---------------------------------------------------------------- texto

/** Número de linhas de um texto (um \n final não cria linha nova; texto vazio tem 1). */
export function lineCount(text: string): number {
  if (!text) return 1;
  let n = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) n++;
  return text.endsWith('\n') ? n - 1 : n;
}

/** Tamanho legível; abaixo de 1 KB em bytes (formatSize do histórico arredonda tudo para cima). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0).replace('.', ',')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

/** Caminho absoluto de um arquivo da sala (o que o botão "copiar caminho" entrega). */
export function absolutePath(roomPath: string, rel: string): string {
  const root = roomPath.length > 1 ? roomPath.replace(/\/+$/, '') : roomPath;
  if (!rel) return root;
  return root === '/' ? `/${rel}` : `${root}/${rel}`;
}

// ---------------------------------------------------------------- memória do último arquivo por sala

export const LAST_FILE_KEY = 'habblaud.files.last';

/** Lê o mapa sala -> arquivo do armazenamento (qualquer coisa estranha vira vazio). */
export function parseLastFiles(raw: string | null): Record<string, string> {
  try {
    const v: unknown = JSON.parse(raw ?? 'null');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, p] of Object.entries(v)) if (typeof p === 'string' && p) out[k] = p;
    return out;
  } catch {
    return {};
  }
}

export function loadLastFile(storage: Pick<Storage, 'getItem'> | null, room: string): string | undefined {
  try {
    return parseLastFiles(storage?.getItem(LAST_FILE_KEY) ?? null)[room];
  } catch {
    return undefined;
  }
}

export function saveLastFile(storage: Pick<Storage, 'getItem' | 'setItem'> | null, room: string, rel: string): void {
  try {
    if (!storage) return;
    const all = parseLastFiles(storage.getItem(LAST_FILE_KEY));
    delete all[room];
    all[room] = rel;
    // Um teto para o mapa não crescer para sempre (as mais recentes ficam: a ordem de inserção é a de gravação).
    const keys = Object.keys(all);
    if (keys.length > 50) for (const k of keys.slice(0, keys.length - 50)) delete all[k];
    storage.setItem(LAST_FILE_KEY, JSON.stringify(all));
  } catch {
    // sem armazenamento
  }
}

/** Pastas que levam até um arquivo ('a/b/c.ts' -> ['a', 'a/b']). */
export function ancestors(rel: string): string[] {
  const parts = rel.split('/');
  parts.pop();
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}
