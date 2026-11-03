import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import type { FixedRoom } from '../model/fixed';
import { tempDir } from '../test/fixtures';
import { PtyError } from './manager';
import { ensureWorktree, validBranch, worktreePath, type GitExec } from './worktree';

setQuiet(true);

const hasGit = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe('validBranch', () => {
  it('aceita nomes comuns e recusa o que o git ou um shell leriam diferente', () => {
    for (const ok of ['feat/x', 'fix-1', 'a', 'v1.2/ajuste_3', 'a'.repeat(80)]) expect(validBranch(ok), ok).toBe(true);
    for (const bad of ['-x', 'a..b', 'a b', '$(id)', ';rm', '../x', 'x.lock', 'a/x.lock/b', 'x/', '.x', 'a/.b', 'a//b', 'HEAD', 'x.', 'a@{1}', 'a'.repeat(81), '', 'a\nb', 'a`b`'])
      expect(validBranch(bad), bad).toBe(false);
    expect(validBranch(undefined)).toBe(false);
    expect(validBranch(42)).toBe(false);
  });
});

describe('worktreePath', () => {
  it('fica dentro de <sala>-wt/', () => {
    expect(worktreePath('/x/habblaud', 'feat/a')).toBe('/x/habblaud-wt/feat/a');
    expect(worktreePath('/x/habblaud/', 'b')).toBe('/x/habblaud-wt/b');
    expect(() => worktreePath('/x/habblaud', '../fora')).toThrow(PtyError);
    expect(() => worktreePath('/x/habblaud', '/abs')).toThrow(PtyError);
  });
});

describe('ensureWorktree (git falso)', () => {
  const room = (over: Partial<FixedRoom> = {}): FixedRoom => ({ id: '/nao/existe/sala', path: '/nao/existe/sala', git: true, ...over });
  const spy = () => {
    const calls: { file: string; args: string[] }[] = [];
    const exec: GitExec = async (file, args) => {
      calls.push({ file, args });
      return { stdout: '', stderr: '' };
    };
    return { calls, exec };
  };

  it('roda git com o array de argumentos exato, sem shell', async () => {
    const { calls, exec } = spy();
    const p = await ensureWorktree([room()], '/nao/existe/sala', 'feat/a', exec);
    expect(p).toBe('/nao/existe/sala-wt/feat/a');
    expect(calls).toEqual([{ file: 'git', args: ['-C', '/nao/existe/sala', 'worktree', 'add', '-b', 'feat/a', '/nao/existe/sala-wt/feat/a'] }]);
  });

  it('não roda git com branch inválida, sala desconhecida ou sala fora de um repositório', async () => {
    const { calls, exec } = spy();
    await expect(ensureWorktree([room()], '/nao/existe/sala', '-x', exec)).rejects.toMatchObject({ status: 400 });
    await expect(ensureWorktree([room()], '/nao/existe/sala', 'HEAD', exec)).rejects.toMatchObject({ status: 400 });
    await expect(ensureWorktree([room()], '/outra', 'a', exec)).rejects.toMatchObject({ status: 400 });
    await expect(ensureWorktree([room()], '/nao/existe/sala-wt/a', 'a', exec)).rejects.toMatchObject({ status: 400 });
    await expect(ensureWorktree([room({ git: undefined })], '/nao/existe/sala', 'a', exec)).rejects.toMatchObject({ status: 400 });
    expect(calls).toEqual([]);
  });

  it('erro do git vira 409 com a mensagem dele', async () => {
    const exec: GitExec = async () => {
      throw Object.assign(new Error('falhou'), { stderr: 'fatal: a branch já existe\n' });
    };
    await expect(ensureWorktree([room()], '/nao/existe/sala', 'a', exec)).rejects.toMatchObject({ status: 409, message: expect.stringContaining('a branch já existe') });
  });

  it('cria uma worktree por vez em cada sala', async () => {
    let live = 0;
    let max = 0;
    const exec: GitExec = async () => {
      live++;
      max = Math.max(max, live);
      await new Promise((ok) => setTimeout(ok, 10));
      live--;
      return { stdout: '', stderr: '' };
    };
    await Promise.all([ensureWorktree([room()], '/nao/existe/sala', 'a', exec), ensureWorktree([room()], '/nao/existe/sala', 'b', exec)]);
    expect(max).toBe(1);
  });
});

describe.skipIf(!hasGit)('ensureWorktree (git real, pasta temporária)', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

  it('cria, reaproveita sem rodar o git e recusa pasta alheia', async () => {
    const tmp = tempDir('habblaud-wt-');
    const repo = join(tmp.dir, 'sala');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
    const rooms = [{ id: repo, path: repo, git: true as const }];

    const p = await ensureWorktree(rooms, repo, 'feat/a');
    expect(p).toBe(`${repo}-wt/feat/a`);
    expect(readFileSync(join(p, '.git'), 'utf8').startsWith(`gitdir: ${repo}/.git/worktrees/`)).toBe(true);
    expect(git(repo, 'branch', '--list', 'feat/a')).toContain('feat/a');

    const never: GitExec = async () => {
      throw new Error('não devia rodar');
    };
    expect(await ensureWorktree(rooms, repo, 'feat/a', never)).toBe(p);

    // branch que já existe sem worktree: o git recusa e nada é apagado
    git(repo, 'branch', 'velha');
    await expect(ensureWorktree(rooms, repo, 'velha')).rejects.toMatchObject({ status: 409 });

    // pasta qualquer no lugar
    mkdirSync(`${repo}-wt/pasta`, { recursive: true });
    writeFileSync(join(`${repo}-wt/pasta`, 'x'), '1');
    await expect(ensureWorktree(rooms, repo, 'pasta')).rejects.toMatchObject({ status: 409 });
    expect(existsSync(join(`${repo}-wt/pasta`, 'x'))).toBe(true);
    tmp.cleanup();
  });
});
