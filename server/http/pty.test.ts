import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import type { PtyManager } from '../pty/manager';
import { ensureWorktree, type GitExec } from '../pty/worktree';
import { createPtyRoutes } from './pty';

setQuiet(true);

const closers: (() => void)[] = [];
afterEach(() => closers.splice(0).forEach((c) => c()));

async function serve(withWorktree: boolean) {
  const git: string[][] = [];
  const created: unknown[] = [];
  const exec: GitExec = async (_f, args) => {
    git.push(args);
    return { stdout: '', stderr: '' };
  };
  const rooms = [{ id: '/nao/existe/sala', path: '/nao/existe/sala', git: true as const }];
  const ptys = { create: (p: unknown) => (created.push(p), { id: 'p1' }) } as unknown as PtyManager;
  const route = createPtyRoutes(ptys, withWorktree ? { worktree: (r, b) => ensureWorktree(rooms, r, b, exec) } : {});
  const server = http.createServer((req, res) => route(req, res, new URL(req.url ?? '/', 'http://x').pathname));
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  closers.push(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const post = (body: unknown, headers: Record<string, string> = {}, method = 'POST') =>
    new Promise<{ status: number; body: string }>((ok, fail) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/api/pty/worktree', method, headers: { 'content-type': 'application/json', host: `localhost:${port}`, ...headers } }, (res) => {
        let text = '';
        res.on('data', (c) => (text += c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, body: text }));
      });
      req.on('error', fail);
      req.end(JSON.stringify(body));
    });
  return { post, git, created };
}

describe('POST /api/pty/worktree', () => {
  it('branch ruim: 400 e o git não roda', async () => {
    const s = await serve(true);
    expect((await s.post({ room: '/nao/existe/sala', branch: '-x' })).status).toBe(400);
    expect((await s.post({ room: '/nao/existe/sala', branch: '$(id)' })).status).toBe(400);
    expect((await s.post({ room: '/nao/existe/sala' })).status).toBe(400);
    expect(s.git).toEqual([]);
    expect(s.created).toEqual([]);
  });

  it('Host que não é local: 403', async () => {
    const s = await serve(true);
    const r = await s.post({ room: '/nao/existe/sala', branch: 'feat/a' }, { host: 'meu-mac.local:4747' });
    expect(r.status).toBe(403);
    expect(s.git).toEqual([]);
  });

  it('cria a worktree e abre o terminal nela; GET é 405; sem a dependência, 404', async () => {
    const s = await serve(true);
    const r = await s.post({ room: '/nao/existe/sala', branch: 'feat/a', account: 'a', cols: 90 });
    expect(r.status).toBe(201);
    expect(s.created).toEqual([{ cwd: '/nao/existe/sala-wt/feat/a', account: 'a', cols: 90, rows: undefined }]);
    expect((await s.post({}, {}, 'GET')).status).toBe(405);
    expect((await (await serve(false)).post({ room: '/nao/existe/sala', branch: 'a' })).status).toBe(404);
  });
});
