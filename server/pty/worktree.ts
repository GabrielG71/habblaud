// Nova frente de um Gestor numa worktree: `git worktree add -b <branch> <sala>-wt/<branch>` a partir da branch atual.
// Só execFile com argumentos (sem shell); a branch passa pela regex abaixo (sem '-' inicial, '..', espaços, '$', ';'),
// o caminho é conferido depois do resolve e NADA aqui apaga uma worktree, nem em erro.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { BRANCH_RE, validBranch } from '../../shared/branch';
import { tr } from '../../shared/i18n';
import { fixedRoomFor, type FixedRoom } from '../model/fixed';
import { PtyError } from './manager';

const execFileP = promisify(execFile);

export { BRANCH_RE, validBranch };

/** `git` com argumentos: devolve só o necessário para os testes trocarem por um falso. */
export type GitExec = (file: 'git', args: string[], opts: { timeout: number; env: NodeJS.ProcessEnv; encoding: 'utf8' }) => Promise<{ stdout: string; stderr: string }>;

/** `<sala>-wt/<branch>`, sempre dentro de `<sala>-wt/`. */
export function worktreePath(roomPath: string, branch: string): string {
  const wtRoot = `${roomPath.trim().replace(/\/{2,}/g, '/').replace(/\/+$/, '')}-wt`;
  const p = resolve(wtRoot, branch);
  if (!p.startsWith(`${wtRoot}/`)) throw new PtyError(400, tr('branch inválida'));
  return p;
}

/** A pasta é uma worktree desta sala (`.git` é arquivo apontando para `<sala>/.git/worktrees/`)? */
function isRoomWorktree(dir: string, roomPath: string): boolean {
  try {
    const git = join(dir, '.git');
    if (!statSync(git).isFile()) return false;
    return readFileSync(git, 'utf8').startsWith(`gitdir: ${roomPath}/.git/worktrees/`);
  } catch {
    return false;
  }
}

// Uma criação por sala por vez (dois cliques não disputam o lock do git).
const running = new Map<string, Promise<unknown>>();

/** Garante a worktree da branch e devolve o caminho dela. Se já existe (desta sala), reaproveita sem rodar o git. */
export async function ensureWorktree(rooms: readonly FixedRoom[], roomId: unknown, branch: unknown, exec: GitExec = execFileP as GitExec): Promise<string> {
  const room = typeof roomId === 'string' ? fixedRoomFor(rooms, roomId) : undefined;
  if (!room || room.id !== roomId) throw new PtyError(400, tr('sala desconhecida'));
  if (!room.git) throw new PtyError(400, tr('a pasta da sala não é um repositório git'));
  if (!validBranch(branch)) throw new PtyError(400, tr('nome de branch inválido'));
  const roomPath = room.id;
  const wtPath = worktreePath(roomPath, branch);

  const prev = running.get(roomPath) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    if (existsSync(wtPath)) {
      if (isRoomWorktree(wtPath, roomPath)) return wtPath;
      throw new PtyError(409, tr('já existe uma pasta em {0} que não é uma worktree desta sala', [wtPath]));
    }
    try {
      await exec('git', ['-C', roomPath, 'worktree', 'add', '-b', branch, wtPath], {
        timeout: 20_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        encoding: 'utf8',
      });
    } catch (err) {
      const e = err as { stderr?: unknown; message?: string };
      const msg = (typeof e.stderr === 'string' && e.stderr.trim()) || e.message || '';
      throw new PtyError(409, tr('git worktree falhou: {0}', [msg.trim().slice(0, 300)]));
    }
    return wtPath;
  });
  running.set(roomPath, run);
  try {
    return await run;
  } finally {
    if (running.get(roomPath) === run) running.delete(roomPath);
  }
}
