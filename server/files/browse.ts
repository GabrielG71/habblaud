// Explorador de arquivos das salas fixas (somente leitura): lista pastas e devolve o texto dos arquivos de dentro da
// sala. A sala vem só do id (server/model/fixed.ts), nunca de caminho do cliente; o alvo é confinado à raiz real da
// sala (realpath nos dois lados, links inclusive) e nada com cara de segredo sai, nem na listagem nem na leitura.
// Node puro (fs/promises), sem escrita e sem exec.
import { constants } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { tr } from '../../shared/i18n';
import { SECRET_DIRS } from '../deliveries/files';
import type { FixedRoom } from '../model/fixed';

export const TREE_MAX_ENTRIES = 2000;
export const RAW_MAX_BYTES = 1024 * 1024;
const SNIFF_BYTES = 8 * 1024;
const PATH_MAX = 4096;

export interface TreeEntry {
  name: string;
  kind: 'dir' | 'file' | 'link';
  size?: number;
  blocked?: boolean;
}
export interface TreeResponse {
  room: string;
  path: string;
  entries: TreeEntry[];
  truncated: boolean;
}
export type RawResponse = { path: string; size: number; text: string } | { path: string; size: number; binary: true } | { path: string; size: number; tooLarge: true };

export class BrowseError extends Error {
  constructor(
    readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Nomes de arquivo que são segredo (lista própria e estreita do explorador; a das entregas, em deliveries/files.ts,
 * bloqueia qualquer nome com "token", "senha"... e esconderia código legítimo como token.service.ts).
 * `.env` e `.env.*` fecham, menos os modelos (.env.example, .env.sample, .env.template).
 */
const SECRET_NAMES =
  /^(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_rsa.*|id_ed25519.*|\.npmrc|\.netrc|\.pgpass|credentials(\.json)?|secrets\.(json|ya?ml)|service-account.*\.json|tcr-base\.txt)$/i;
const ENV_TEMPLATES = /^\.env\.(example|sample|template)$/i;

/** O componente (nome de arquivo ou pasta) é segredo? */
function secretName(name: string): boolean {
  if (ENV_TEMPLATES.test(name)) return false;
  return SECRET_NAMES.test(name);
}

/** Algum componente do caminho relativo (já normalizado, com "/") é segredo? `.git` também não abre. */
function secretPath(segments: readonly string[]): boolean {
  if (segments.length === 0) return false;
  if (SECRET_DIRS.test(segments.join('/'))) return true;
  return segments.some((s) => s === '.git' || secretName(s));
}

/** Alvo é a raiz ou fica dentro dela (raiz já sem barra final, exceto "/"). */
function inside(target: string, root: string): boolean {
  if (target === root) return true;
  return target.startsWith(root.endsWith(sep) ? root : root + sep);
}

function segmentsOf(root: string, target: string): string[] {
  return target === root ? [] : target.slice(root.endsWith(sep) ? root.length : root.length + 1).split(sep);
}

const notFound = () => new BrowseError(404, tr('não encontrado'));
const protectedPath = () => new BrowseError(403, tr('arquivo protegido'));
const outside = () => new BrowseError(403, tr('fora da sala'));

interface Target {
  room: FixedRoom;
  root: string;
  /** Caminho real do alvo (links resolvidos). */
  real: string;
  /** Caminho relativo normalizado, com "/" ('' = raiz). */
  rel: string;
}

/** Sala (só entre as fixas), raiz real e alvo confinado; lança BrowseError. */
async function resolveTarget(rooms: readonly FixedRoom[], roomId: string, relInput: string): Promise<Target> {
  if (relInput.length > PATH_MAX || relInput.includes('\0') || relInput.startsWith('/') || relInput.startsWith('\\') || /^[a-z]:/i.test(relInput)) {
    throw new BrowseError(400, tr('caminho inválido'));
  }
  const room = rooms.find((r) => r.id === roomId);
  if (!room) throw new BrowseError(404, tr('sala não encontrada'));
  let root: string;
  try {
    root = await realpath(room.path);
  } catch {
    throw new BrowseError(404, tr('sala não encontrada'));
  }
  const lexical = resolve(root, relInput);
  if (!inside(lexical, root)) throw outside();
  const rel = segmentsOf(root, lexical);
  if (secretPath(rel)) throw protectedPath();
  let real: string;
  try {
    real = await realpath(lexical);
  } catch (err) {
    throw (err as NodeJS.ErrnoException).code === 'EACCES' ? protectedPath() : notFound();
  }
  if (!inside(real, root)) throw outside();
  if (secretPath(segmentsOf(root, real))) throw protectedPath();
  return { room, root, real, rel: rel.join('/') };
}

/** Lista uma pasta da sala: pastas primeiro, depois ordem alfabética sem diferenciar maiúscula; até TREE_MAX_ENTRIES. */
export async function listTree(rooms: readonly FixedRoom[], roomId: string, relInput: string): Promise<TreeResponse> {
  const t = await resolveTarget(rooms, roomId, relInput);
  let isDir: boolean;
  try {
    isDir = (await stat(t.real)).isDirectory();
  } catch {
    throw notFound();
  }
  if (!isDir) throw notFound();
  let dirents;
  try {
    dirents = await readdir(t.real, { withFileTypes: true });
  } catch (err) {
    throw (err as NodeJS.ErrnoException).code === 'EACCES' ? protectedPath() : notFound();
  }
  dirents = dirents.filter((d) => d.name !== '.git' && (d.isDirectory() || d.isFile() || d.isSymbolicLink()));
  dirents.sort((a, b) => {
    const da = a.isDirectory() ? 0 : 1;
    const db = b.isDirectory() ? 0 : 1;
    if (da !== db) return da - db;
    const la = a.name.toLowerCase();
    const lb = b.name.toLowerCase();
    return la < lb ? -1 : la > lb ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  const truncated = dirents.length > TREE_MAX_ENTRIES;
  const here = t.rel ? t.rel.split('/') : [];
  const entries = await Promise.all(
    dirents.slice(0, TREE_MAX_ENTRIES).map(async (d): Promise<TreeEntry> => {
      const blocked = secretPath([...here, d.name]);
      if (d.isSymbolicLink()) {
        // Link: só abre se o destino real fica dentro da sala e não é segredo.
        let reachable = false;
        try {
          const target = await realpath(`${t.real}${sep}${d.name}`);
          reachable = inside(target, t.root) && !secretPath(segmentsOf(t.root, target));
        } catch {
          reachable = false;
        }
        return blocked || !reachable ? { name: d.name, kind: 'link', blocked: true } : { name: d.name, kind: 'link' };
      }
      if (d.isDirectory()) return blocked ? { name: d.name, kind: 'dir', blocked: true } : { name: d.name, kind: 'dir' };
      let size = 0;
      try {
        size = (await stat(`${t.real}${sep}${d.name}`)).size;
      } catch {
        size = 0;
      }
      return blocked ? { name: d.name, kind: 'file', size, blocked: true } : { name: d.name, kind: 'file', size };
    }),
  );
  return { room: t.room.id, path: t.rel, entries, truncated };
}

/** Texto de um arquivo da sala (até RAW_MAX_BYTES; binário e grande demais só informam). */
export async function readRaw(rooms: readonly FixedRoom[], roomId: string, relInput: string): Promise<RawResponse> {
  const t = await resolveTarget(rooms, roomId, relInput);
  let fh;
  try {
    // O realpath acabou de resolver; O_NOFOLLOW + fstat no descritor fecham a janela de troca por link/FIFO.
    fh = await open(t.real, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (err) {
    throw (err as NodeJS.ErrnoException).code === 'EACCES' ? protectedPath() : notFound();
  }
  try {
    const st = await fh.stat();
    if (!st.isFile()) throw notFound();
    if (st.size > RAW_MAX_BYTES) return { path: t.rel, size: st.size, tooLarge: true };
    // Lê no máximo RAW_MAX_BYTES + 1 (o arquivo pode crescer entre o stat e a leitura).
    const buf = Buffer.allocUnsafe(Math.min(st.size, RAW_MAX_BYTES) + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await fh.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    if (n > RAW_MAX_BYTES) return { path: t.rel, size: n, tooLarge: true };
    if (buf.subarray(0, Math.min(n, SNIFF_BYTES)).includes(0)) return { path: t.rel, size: n, binary: true };
    return { path: t.rel, size: n, text: buf.subarray(0, n).toString('utf8') };
  } finally {
    await fh.close();
  }
}
