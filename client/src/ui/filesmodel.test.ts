import { describe, expect, it } from 'vitest';
import {
  absolutePath,
  ancestors,
  type DirState,
  formatBytes,
  type FileEntry,
  isMarkdown,
  languageOf,
  lineCount,
  LAST_FILE_KEY,
  loadLastFile,
  parseLastFiles,
  saveLastFile,
  treeRows,
} from './filesmodel';

const dir = (path: string, entries: FileEntry[], truncated = false): [string, DirState] => [path, { state: 'ready', data: { room: 'r', path, entries, truncated } }];
const d = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({ name, kind: 'dir', ...extra });
const f = (name: string, extra: Partial<FileEntry> = {}): FileEntry => ({ name, kind: 'file', size: 1, ...extra });
const paths = (rows: ReturnType<typeof treeRows>) => rows.map((r) => `${r.type}:${r.path}@${r.depth}`);

describe('treeRows', () => {
  it('raiz ainda carregando mostra uma linha de carga', () => {
    expect(paths(treeRows(new Map([['', { state: 'loading' }]]), new Set(), ''))).toEqual(['loading:@0']);
  });

  it('só expande as pastas abertas, e pasta aberta sem carga mostra "carregando"', () => {
    const dirs = new Map([dir('', [d('a'), d('b'), f('x.ts')]), dir('a', [f('y.ts')])]);
    expect(paths(treeRows(dirs, new Set(), ''))).toEqual(['entry:a@0', 'entry:b@0', 'entry:x.ts@0']);
    expect(paths(treeRows(dirs, new Set(['a']), ''))).toEqual(['entry:a@0', 'entry:a/y.ts@1', 'entry:b@0', 'entry:x.ts@0']);
    expect(paths(treeRows(dirs, new Set(['b']), ''))).toEqual(['entry:a@0', 'entry:b@0', 'loading:b@1', 'entry:x.ts@0']);
  });

  it('pasta vazia, erro e lista cortada viram linhas de aviso', () => {
    const dirs = new Map<string, DirState>([dir('', [d('a'), d('e')], true), dir('a', []), ['e', { state: 'error', status: 403, message: 'protegido' }]]);
    const rows = treeRows(dirs, new Set(['a', 'e']), '');
    expect(paths(rows)).toEqual(['entry:a@0', 'empty:a@1', 'entry:e@0', 'error:e@1', 'truncated:@0']);
    expect(rows[3]).toMatchObject({ message: 'protegido' });
  });

  it('o filtro age só no que já foi carregado e abre as pastas com resultado dentro', () => {
    const dirs = new Map([dir('', [d('src'), d('docs'), f('README.md')]), dir('src', [f('token.service.ts'), f('app.ts'), d('deep')]), dir('src/deep', [f('Token.md')])]);
    expect(paths(treeRows(dirs, new Set(), 'token'))).toEqual(['entry:src@0', 'entry:src/token.service.ts@1', 'entry:src/deep@1', 'entry:src/deep/Token.md@2']);
    // docs nunca foi carregada: não aparece nem some por engano; sem resultado fora, o filtro esconde.
    expect(paths(treeRows(dirs, new Set(), 'readme'))).toEqual(['entry:README.md@0']);
    expect(treeRows(dirs, new Set(), 'zzz')).toEqual([]);
  });

  it('bloqueado não abre nem entra na busca por dentro', () => {
    const dirs = new Map([dir('', [d('.ssh', { blocked: true }), f('.env', { blocked: true })]), dir('.ssh', [f('chave')])]);
    const rows = treeRows(dirs, new Set(['.ssh']), '');
    expect(paths(rows)).toEqual(['entry:.ssh@0', 'entry:.env@0']);
    expect(rows[0]).toMatchObject({ blocked: true, open: false });
    expect(paths(treeRows(dirs, new Set(), 'chave'))).toEqual([]);
  });

  it('link aparece como link e nunca expande', () => {
    const dirs = new Map([dir('', [{ name: 'atalho', kind: 'link' }])]);
    expect(treeRows(dirs, new Set(['atalho']), '')[0]).toMatchObject({ kind: 'link', open: false });
  });
});

describe('languageOf', () => {
  it('reconhece as extensões registradas e deixa o resto como texto puro', () => {
    const cases: Record<string, string | undefined> = {
      'a/b/index.ts': 'typescript',
      'x.TSX': 'typescript',
      'app.js': 'javascript',
      'package.json': 'json',
      'README.md': 'markdown',
      'q.sql': 'sql',
      'main.css': 'css',
      'index.html': 'xml',
      'conf.yml': 'yaml',
      'run.sh': 'bash',
      'A.java': 'java',
      'tool.py': 'python',
      'my.ini': 'ini',
      '.env.example': 'ini',
      '.env.sample': 'ini',
      '.editorconfig': 'ini',
      '.gitignore': undefined,
      Makefile: undefined,
      'foo.constructor': undefined,
      'foo.': undefined,
      'dados.csv': undefined,
    };
    for (const [name, lang] of Object.entries(cases)) expect(languageOf(name), name).toBe(lang);
    expect(isMarkdown('docs/a.md')).toBe(true);
    expect(isMarkdown('a.ts')).toBe(false);
  });
});

describe('texto e caminhos', () => {
  it('lineCount ignora o \\n final', () => {
    expect(lineCount('')).toBe(1);
    expect(lineCount('a')).toBe(1);
    expect(lineCount('a\n')).toBe(1);
    expect(lineCount('a\nb')).toBe(2);
    expect(lineCount('a\n\nb\n')).toBe(3);
  });

  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(20 * 1024)).toBe('20 KB');
    expect(formatBytes(1024 * 1024 + 1024 * 512)).toBe('1,5 MB');
  });

  it('absolutePath junta a sala e o relativo', () => {
    expect(absolutePath('/home/g/proj', 'src/a.ts')).toBe('/home/g/proj/src/a.ts');
    expect(absolutePath('/home/g/proj/', 'a.ts')).toBe('/home/g/proj/a.ts');
    expect(absolutePath('/', 'a.ts')).toBe('/a.ts');
    expect(absolutePath('/home/g/proj', '')).toBe('/home/g/proj');
  });

  it('ancestors', () => {
    expect(ancestors('a/b/c.ts')).toEqual(['a', 'a/b']);
    expect(ancestors('c.ts')).toEqual([]);
  });
});

describe('último arquivo por sala', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it('grava e lê por sala, sem misturar', () => {
    const s = memory();
    saveLastFile(s, '/p/a', 'src/x.ts');
    saveLastFile(s, '/p/b', 'README.md');
    expect(loadLastFile(s, '/p/a')).toBe('src/x.ts');
    expect(loadLastFile(s, '/p/b')).toBe('README.md');
    expect(loadLastFile(s, '/p/c')).toBeUndefined();
  });

  it('lixo no armazenamento vira vazio e armazenamento ausente ou que lança não quebra', () => {
    expect(parseLastFiles('{{')).toEqual({});
    expect(parseLastFiles('[1]')).toEqual({});
    expect(parseLastFiles('{"a":"x","b":3,"c":""}')).toEqual({ a: 'x' });
    expect(loadLastFile(null, 'a')).toBeUndefined();
    expect(() => saveLastFile(null, 'a', 'b')).not.toThrow();
    const boom = {
      getItem: () => {
        throw new Error('negado');
      },
      setItem: () => {
        throw new Error('negado');
      },
    };
    expect(loadLastFile(boom, 'a')).toBeUndefined();
    expect(() => saveLastFile(boom, 'a', 'b')).not.toThrow();
  });

  it('limita o mapa guardado', () => {
    const s = memory();
    for (let i = 0; i < 60; i++) saveLastFile(s, `/p/${i}`, 'a');
    expect(Object.keys(parseLastFiles(s.getItem(LAST_FILE_KEY))).length).toBe(50);
    expect(loadLastFile(s, '/p/59')).toBe('a');
    expect(loadLastFile(s, '/p/0')).toBeUndefined();
  });
});
