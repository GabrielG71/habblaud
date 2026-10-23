import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IncomingMessage } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { RAW_MAX_BYTES, TREE_MAX_ENTRIES } from '../files/browse';
import { setQuiet } from '../log';
import type { FixedRoom } from '../model/fixed';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { symlinkOrSkip, tempDir } from '../test/fixtures';
import { createApiHandler } from './app';
import { createFilesRoutes, filesRequestProblem } from './files';
import { createRequestGuard } from './guard';
import { Hub } from './sse';

setQuiet(true);

interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

interface Env {
  base: string;
  port: string;
  room: string;
  outside: string;
  get: (path: string, headers?: Record<string, string>, method?: string) => Promise<Res>;
  tree: (rel?: string, room?: string) => Promise<Res>;
  raw: (rel: string, room?: string) => Promise<Res>;
  close: () => Promise<void>;
}

/** Sala fixa de mentira numa pasta temporária (nunca um projeto de verdade) e uma pasta "de fora" ao lado. */
async function start(): Promise<Env> {
  const tmp = tempDir('habblaud-files-');
  const room = join(tmp.dir, 'sala');
  const outside = join(tmp.dir, 'fora');
  mkdirSync(room);
  mkdirSync(outside);
  const rooms: FixedRoom[] = [{ id: room, path: room }];
  const claude = join(tmp.dir, '.claude');
  mkdirSync(join(claude, 'sessions'), { recursive: true });
  const accounts = new AccountsService({ dirs: [claude], home: tmp.dir, env: {}, onChange: () => undefined });
  const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined });
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
  const api = createApiHandler({
    office,
    hub,
    accounts,
    sources: () => [],
    version: '9.9.9',
    inDocker: false,
    browse: createFilesRoutes(() => rooms),
    // Porta remota de mentira: marcada por um cabeçalho do teste.
    remote: { is: (req) => req.headers['x-test-remote'] === '1', allows: () => true },
  });
  const guard = createRequestGuard({ allowedHosts: new Set(['habblaud.lan']) });
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = String((server.address() as AddressInfo).port);
  const base = `http://127.0.0.1:${port}`;
  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<Res>((ok, fail) => {
      const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => {
          let json: unknown = null;
          try {
            json = JSON.parse(body);
          } catch {
            // corpo que não é JSON (o guard de borda responde em texto)
          }
          ok({ status: res.statusCode ?? 0, json });
        });
      });
      req.on('error', fail);
      req.end();
    });
  const q = (kind: 'tree' | 'raw', rel: string | undefined, id: string) => `/api/files/${kind}?room=${encodeURIComponent(id)}${rel === undefined ? '' : `&path=${rel}`}`;
  return {
    base,
    port,
    room,
    outside,
    get,
    tree: (rel, id = room) => get(q('tree', rel === undefined ? undefined : encodeURIComponent(rel), id)),
    raw: (rel, id = room) => get(q('raw', encodeURIComponent(rel), id)),
    close: () =>
      new Promise<void>((ok) => {
        hub.stop();
        server.closeAllConnections();
        server.close(() => {
          tmp.cleanup();
          ok();
        });
      }),
  };
}

/** Nomes que o explorador trata como segredo (lista própria e estreita em server/files/browse.ts). */
const SECRET_FILES = [
  '.env',
  '.env.local',
  '.env.production',
  'chave.pem',
  'a.key',
  'id_rsa',
  'id_rsa.pub',
  'id_ed25519',
  'cert.p12',
  'x.pfx',
  'app.keystore',
  'app.jks',
  '.npmrc',
  '.netrc',
  '.pgpass',
  'credentials',
  'credentials.json',
  'secrets.json',
  'secrets.yml',
  'secrets.yaml',
  'service-account.json',
  'service-account-prod.json',
  'tcr-base.txt',
];

/** Nomes com secret/token/senha/password que são código e precisam abrir. */
const READABLE_LOOKALIKES = ['token.service.ts', 'RecuperarSenha.js', 'password-reset.ts', 'secret-santa.md', 'credentials-form.tsx'];

const names = (r: Res): string[] => r.json.entries.map((e: { name: string }) => e.name);
const entry = (r: Res, name: string) => r.json.entries.find((e: { name: string }) => e.name === name);

describe('GET /api/files/tree e /api/files/raw', () => {
  let env: Env;
  beforeEach(async () => {
    env = await start();
    const { room, outside } = env;
    for (const d of ['zeta', 'Alpha-dir', 'sub', '.git', 'node_modules', '.ssh', '.aws']) mkdirSync(join(room, d));
    writeFileSync(join(room, 'b.txt'), 'bê');
    writeFileSync(join(room, 'B2.txt'), 'dois');
    writeFileSync(join(room, 'a.txt'), 'olá mundo\n');
    writeFileSync(join(room, '.git', 'config'), '[remote "origin"]');
    writeFileSync(join(room, 'node_modules', 'x.js'), '1');
    writeFileSync(join(room, 'sub', 'dentro.md'), '# dentro');
    // Segredos de mentira (o conteúdo é só um marcador para provar que nunca sai).
    for (const f of SECRET_FILES) writeFileSync(join(room, f), 'MARCADOR_SEGREDO');
    // Código que só tem cara de segredo no nome: precisa abrir.
    for (const f of READABLE_LOOKALIKES) writeFileSync(join(room, f), 'export const ok = 1;\n');
    writeFileSync(join(room, 'sub', '.env'), 'MARCADOR_SEGREDO');
    writeFileSync(join(room, '.ssh', 'known_hosts'), 'MARCADOR_SEGREDO');
    writeFileSync(join(room, '.aws', 'config'), 'MARCADOR_SEGREDO');
    writeFileSync(join(room, '.env.example'), 'CHAVE=\n');
    for (const f of ['.env.sample', '.env.template']) writeFileSync(join(room, f), 'CHAVE=\n');
    writeFileSync(join(room, 'bin.dat'), Buffer.from([1, 2, 0, 3]));
    writeFileSync(join(outside, 'fora.txt'), 'MARCADOR_FORA');
    mkdirSync(join(outside, 'pasta'));
    writeFileSync(join(outside, 'pasta', 'x.txt'), 'MARCADOR_FORA');
  });
  afterEach(async () => {
    await env.close();
  });

  it('lista a raiz: pastas primeiro, depois alfabética sem diferenciar maiúscula; .git fora; node_modules aparece', async () => {
    for (const r of [await env.tree(), await env.tree(''), await env.get(`/api/files/tree?room=${encodeURIComponent(env.room)}`)]) {
      expect(r.status).toBe(200);
      expect(r.json).toMatchObject({ room: env.room, path: '', truncated: false });
    }
    const r = await env.tree();
    const n = names(r);
    expect(n).not.toContain('.git');
    expect(n.slice(0, 5)).toEqual(['.aws', '.ssh', 'Alpha-dir', 'node_modules', 'sub']);
    expect(n.indexOf('zeta')).toBe(5);
    const files = n.slice(6);
    expect(files.indexOf('a.txt')).toBeLessThan(files.indexOf('b.txt'));
    expect(files.indexOf('b.txt')).toBeLessThan(files.indexOf('B2.txt'));
    expect(entry(r, 'a.txt')).toEqual({ name: 'a.txt', kind: 'file', size: Buffer.byteLength('olá mundo\n') });
    expect(entry(r, 'sub')).toEqual({ name: 'sub', kind: 'dir' });
    expect(entry(r, 'node_modules')).toEqual({ name: 'node_modules', kind: 'dir' });
  });

  it('lista subpasta e normaliza o caminho; arquivo na tree e pasta na raw dão 404', async () => {
    const r = await env.tree('sub/./');
    expect(r.status).toBe(200);
    expect(r.json.path).toBe('sub');
    expect(names(r)).toEqual(['.env', 'dentro.md']);
    expect(entry(r, '.env').blocked).toBe(true);
    expect((await env.tree('a.txt')).status).toBe(404);
    expect((await env.raw('sub')).status).toBe(404);
    expect((await env.raw('')).status).toBe(404);
    expect((await env.tree('nao-existe')).status).toBe(404);
    expect((await env.raw('nao-existe.txt')).status).toBe(404);
  });

  it('raw devolve o texto do arquivo', async () => {
    const r = await env.raw('sub/dentro.md');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ path: 'sub/dentro.md', size: 8, text: '# dentro' });
    expect((await env.raw('a.txt')).json.text).toBe('olá mundo\n');
  });

  it('traversal: .. e %2e%2e não saem da sala', async () => {
    for (const rel of ['..', '../fora', '../fora/fora.txt', 'sub/../../fora/fora.txt', '..//fora/fora.txt']) {
      for (const kind of ['tree', 'raw'] as const) {
        const r = await env[kind](rel);
        expect(r.status, `${kind} ${rel}`).toBe(403);
        expect(JSON.stringify(r.json)).not.toContain('MARCADOR');
      }
    }
    // Codificado direto no query (sem passar pelo helper): decodifica uma vez só.
    for (const enc of ['%2e%2e%2ffora%2ffora.txt', '%2E%2E/fora/fora.txt', '..%2ffora%2ffora.txt', '%2e%2e']) {
      const r = await env.get(`/api/files/raw?room=${encodeURIComponent(env.room)}&path=${enc}`);
      expect(r.status, enc).toBe(403);
      expect(JSON.stringify(r.json)).not.toContain('MARCADOR');
    }
    // Dupla codificação vira um nome literal (inexistente), não um ".."
    expect((await env.get(`/api/files/raw?room=${encodeURIComponent(env.room)}&path=%252e%252e%252ffora%252ffora.txt`)).status).toBe(404);
    // Barras duplas e ./ que ficam dentro da sala são normalizadas.
    expect((await env.raw('sub//dentro.md')).status).toBe(200);
    expect((await env.raw('sub/../a.txt')).status).toBe(200);
  });

  it('\\0 e caminho absoluto dão 400', async () => {
    for (const rel of ['a\0.txt', '/etc/passwd', `${'/'}${env.outside}/fora.txt`, env.outside, '\\windows']) {
      for (const kind of ['tree', 'raw'] as const) {
        const r = await env[kind](rel);
        expect(r.status, `${kind} ${JSON.stringify(rel)}`).toBe(400);
      }
    }
    expect((await env.get(`/api/files/raw?room=${encodeURIComponent(env.room)}&path=a%00.txt`)).status).toBe(400);
  });

  it('o cliente não escolhe a pasta: só o id de uma sala fixa; sala inexistente dá 404', async () => {
    expect((await env.tree('', 'sala-que-nao-existe')).status).toBe(404);
    expect((await env.raw('a.txt', 'sala-que-nao-existe')).status).toBe(404);
    expect((await env.tree('', env.outside)).status).toBe(404);
    expect((await env.tree('', '/')).status).toBe(404);
    expect((await env.get('/api/files/tree')).status).toBe(404);
    expect((await env.get('/api/files/tree?room=')).status).toBe(404);
  });

  it('symlink de arquivo: dentro da sala lê, para fora dá 403', async (ctx) => {
    symlinkOrSkip(ctx.skip, join(env.room, 'a.txt'), join(env.room, 'link-dentro'));
    symlinkOrSkip(ctx.skip, join(env.outside, 'fora.txt'), join(env.room, 'link-fora'));
    symlinkOrSkip(ctx.skip, join(env.room, '.env'), join(env.room, 'link-env'));
    const t = await env.tree();
    expect(entry(t, 'link-dentro')).toEqual({ name: 'link-dentro', kind: 'link' });
    expect(entry(t, 'link-fora')).toEqual({ name: 'link-fora', kind: 'link', blocked: true });
    expect(entry(t, 'link-env')).toEqual({ name: 'link-env', kind: 'link', blocked: true });
    expect((await env.raw('link-dentro')).json.text).toBe('olá mundo\n');
    const out = await env.raw('link-fora');
    expect(out.status).toBe(403);
    expect(JSON.stringify(out.json)).not.toContain('MARCADOR');
    const sec = await env.raw('link-env');
    expect(sec.status).toBe(403);
    expect(JSON.stringify(sec.json)).not.toContain('MARCADOR');
  });

  it('symlink de diretório: dentro da sala navega, para fora dá 403 (pasta e arquivo através dela)', async (ctx) => {
    symlinkOrSkip(ctx.skip, join(env.room, 'sub'), join(env.room, 'dir-dentro'));
    symlinkOrSkip(ctx.skip, env.outside, join(env.room, 'dir-fora'));
    symlinkOrSkip(ctx.skip, join(env.room, '.ssh'), join(env.room, 'dir-ssh'));
    const t = await env.tree();
    expect(entry(t, 'dir-dentro')).toEqual({ name: 'dir-dentro', kind: 'link' });
    expect(entry(t, 'dir-fora')).toEqual({ name: 'dir-fora', kind: 'link', blocked: true });
    expect(entry(t, 'dir-ssh').blocked).toBe(true);
    expect(names(await env.tree('dir-dentro'))).toEqual(['.env', 'dentro.md']);
    expect((await env.raw('dir-dentro/dentro.md')).json.text).toBe('# dentro');
    for (const rel of ['dir-fora', 'dir-fora/fora.txt', 'dir-fora/pasta', 'dir-fora/pasta/x.txt', 'dir-ssh', 'dir-ssh/known_hosts']) {
      for (const kind of ['tree', 'raw'] as const) {
        const r = await env[kind](rel);
        expect(r.status, `${kind} ${rel}`).toBe(403);
        expect(JSON.stringify(r.json)).not.toContain('MARCADOR');
      }
    }
  });

  it('link quebrado dá 404 e não derruba a listagem', async (ctx) => {
    symlinkOrSkip(ctx.skip, join(env.room, 'nao-existe'), join(env.room, 'quebrado'));
    expect(entry(await env.tree(), 'quebrado')).toEqual({ name: 'quebrado', kind: 'link', blocked: true });
    expect((await env.raw('quebrado')).status).toBe(404);
  });

  it('.env e variantes: blocked na tree, 403 na raw; .env.example é legível', async () => {
    const t = await env.tree();
    for (const f of SECRET_FILES) {
      expect(entry(t, f), f).toMatchObject({ kind: 'file', blocked: true });
      const r = await env.raw(f);
      expect(r.status, f).toBe(403);
      expect(JSON.stringify(r.json)).not.toContain('MARCADOR');
    }
    for (const f of ['.env.example', '.env.sample', '.env.template']) {
      expect(entry(t, f), f).toEqual({ name: f, kind: 'file', size: 7 });
      expect((await env.raw(f)).json, f).toEqual({ path: f, size: 7, text: 'CHAVE=\n' });
    }
    // Qualquer componente do caminho, não só o nome final; maiúscula não escapa.
    expect((await env.raw('sub/.env')).status).toBe(403);
    expect((await env.raw('sub/../.ENV')).status).toBe(403);
    expect((await env.raw('./.env')).status).toBe(403);
  });

  it('código com secret/token/senha no nome é legível (token.service.ts, RecuperarSenha.js)', async () => {
    const t = await env.tree();
    for (const f of READABLE_LOOKALIKES) {
      expect(entry(t, f), f).toEqual({ name: f, kind: 'file', size: 21 });
      const r = await env.raw(f);
      expect(r.status, f).toBe(200);
      expect(r.json, f).toEqual({ path: f, size: 21, text: 'export const ok = 1;\n' });
    }
    // O segredo de verdade, no mesmo diretório, continua fechado.
    expect((await env.raw('.env')).status).toBe(403);
  });

  it('diretório-segredo: aparece blocked e não lista o conteúdo (403), nem os arquivos dentro', async () => {
    const t = await env.tree();
    expect(entry(t, '.ssh')).toEqual({ name: '.ssh', kind: 'dir', blocked: true });
    expect(entry(t, '.aws')).toEqual({ name: '.aws', kind: 'dir', blocked: true });
    for (const rel of ['.ssh', '.aws', '.ssh/known_hosts', '.aws/config']) {
      for (const kind of ['tree', 'raw'] as const) {
        const r = await env[kind](rel);
        expect(r.status, `${kind} ${rel}`).toBe(403);
        expect(JSON.stringify(r.json)).not.toContain('MARCADOR');
      }
    }
    // .git sai da listagem e também não abre.
    expect((await env.tree('.git')).status).toBe(403);
    expect((await env.raw('.git/config')).status).toBe(403);
  });

  it('binário: byte NUL nos primeiros 8 KB', async () => {
    expect((await env.raw('bin.dat')).json).toEqual({ path: 'bin.dat', size: 4, binary: true });
    // NUL depois dos 8 KB não conta.
    writeFileSync(join(env.room, 'tarde.txt'), Buffer.concat([Buffer.alloc(8 * 1024, 0x61), Buffer.from([0])]));
    expect((await env.raw('tarde.txt')).json.text).toHaveLength(8 * 1024 + 1);
  });

  it('arquivo acima de 1 MB: tooLarge, sem o texto', async () => {
    writeFileSync(join(env.room, 'grande.txt'), Buffer.alloc(RAW_MAX_BYTES + 1, 0x61));
    writeFileSync(join(env.room, 'limite.txt'), Buffer.alloc(RAW_MAX_BYTES, 0x61));
    const big = await env.raw('grande.txt');
    expect(big.status).toBe(200);
    expect(big.json).toEqual({ path: 'grande.txt', size: RAW_MAX_BYTES + 1, tooLarge: true });
    const edge = await env.raw('limite.txt');
    expect(edge.json.text).toHaveLength(RAW_MAX_BYTES);
  });

  it('mais de 2000 entradas: corta em 2000 com truncated', async () => {
    mkdirSync(join(env.room, 'muitos'));
    for (let i = 0; i < TREE_MAX_ENTRIES + 5; i++) writeFileSync(join(env.room, 'muitos', `f${String(i).padStart(5, '0')}`), '');
    const r = await env.tree('muitos');
    expect(r.status).toBe(200);
    expect(r.json.entries).toHaveLength(TREE_MAX_ENTRIES);
    expect(r.json.truncated).toBe(true);
    expect(names(r)[0]).toBe('f00000');
    mkdirSync(join(env.room, 'exato'));
    for (let i = 0; i < TREE_MAX_ENTRIES; i++) writeFileSync(join(env.room, 'exato', `f${i}`), '');
    const exact = await env.tree('exato');
    expect(exact.json.entries).toHaveLength(TREE_MAX_ENTRIES);
    expect(exact.json.truncated).toBe(false);
  });

  it('método diferente de GET dá 405 (com Allow); rota desconhecida dá 404', async () => {
    for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'PATCH']) {
      // A borda (guard.ts) já exige JSON nos métodos que escrevem; com ele o 405 vem da própria rota.
      const r = await env.get(`/api/files/tree?room=${encodeURIComponent(env.room)}`, { 'Content-Type': 'application/json' }, method);
      expect(r.status, method).toBe(405);
    }
    expect((await env.get('/api/files/outra')).status).toBe(404);
  });

  it('guarda: Origin estrangeiro, outro site e Host de rebinding são recusados', async () => {
    const url = `/api/files/raw?room=${encodeURIComponent(env.room)}&path=a.txt`;
    expect((await env.get(url)).status).toBe(200);
    expect((await env.get(url, { Origin: `http://127.0.0.1:${env.port}` })).status).toBe(200);
    const cross = await env.get(url, { Origin: 'http://attacker.example' });
    expect(cross.status).toBe(403);
    expect(JSON.stringify(cross.json)).not.toContain('olá');
    expect((await env.get(url, { Origin: `http://127.0.0.1:${Number(env.port) + 1}` })).status).toBe(403);
    expect((await env.get(url, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await env.get(url, { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
    // Rebinding: domínio do atacante apontando para 127.0.0.1 (a borda recusa) e nome liberado que não é loopback
    // (passa a borda, mas a trava do explorador recusa).
    for (const host of [`attacker.example:${env.port}`, `habblaud.lan:${env.port}`]) {
      for (const kind of ['tree', 'raw']) {
        const r = await env.get(`/api/files/${kind}?room=${encodeURIComponent(env.room)}&path=a.txt`, { Host: host });
        expect(r.status, `${kind} ${host}`).toBe(403);
        expect(JSON.stringify(r.json)).not.toContain('olá');
      }
    }
    expect((await env.get(url, { Host: `localhost:${env.port}` })).status).toBe(200);
  });

  it('porta remota: 403 sempre, mesmo com o recurso liberado', async () => {
    for (const kind of ['tree', 'raw']) {
      const r = await env.get(`/api/files/${kind}?room=${encodeURIComponent(env.room)}&path=a.txt`, { 'X-Test-Remote': '1' });
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.json)).not.toContain('olá');
    }
  });
});

describe('filesRequestProblem', () => {
  const req = (h: Record<string, string>, addr = '127.0.0.1') => ({ socket: { remoteAddress: addr }, headers: h }) as unknown as IncomingMessage;

  it('aceita o próprio computador e recusa o resto', () => {
    expect(filesRequestProblem(req({ host: 'localhost:4747', origin: 'http://localhost:4747', 'sec-fetch-site': 'same-origin' }))).toBeNull();
    expect(filesRequestProblem(req({ host: 'localhost:4747' }, '192.168.0.9'))).toMatch(/próprio computador/);
    expect(filesRequestProblem(req({ host: 'meu-mac.local:4747' }))).toMatch(/localhost/);
    expect(filesRequestProblem(req({ host: 'localhost:4747', origin: 'http://evil.example' }))).toMatch(/origem/);
  });
});
