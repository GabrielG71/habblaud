import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hash32 } from '../../shared/hash';
import { parseGestorLooks, type GestorLook } from '../../shared/gestor-look';
import { project, type WorldIdSource } from '../../shared/world/projection';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import type { FixedRoom } from './fixed';
import { findGestorLook, gestorLooksFile, loadGestorLooks } from './gestor-look';
import { NameStore } from './names';
import { Office } from './office';

setQuiet(true);

const FIXED: FixedRoom[] = [
  { id: '/p/tcr', path: '/p/tcr', gestor: 'tcr' },
  { id: '/p/pdv', path: '/p/pdv', gestor: 'pdv' },
  { id: '/p/hub', path: '/p/hub', gestor: 'hubib' },
  { id: '/p/nex', path: '/p/nex', gestor: 'nexus' },
];
const ROOMS = ['/p/tcr', '/p/pdv', '/p/hub', '/p/nex'];
const SEEDS: Record<string, number> = { '/p/tcr': 1203, '/p/pdv': 4471, '/p/hub': 8822, '/p/nex': 3307 };

const LOOKS: GestorLook[] = parseGestorLooks([
  { gestor: 'pdv', look: 'm', parts: { skin: '#cf2a30', top: '#d42a31', topAccent: '#2f56b8' }, extras: { headgear: 'hood_mask', pattern: 'web' } },
  { gestor: 'hubib', extras: { figure: 'potion', figureColor: '#c4162c' } },
  { path: '/p/nex/', look: 'm', parts: { hairStyle: 'bald', facialHair: 'beard' } },
]);

function names(): NameStore {
  const n = new NameStore(null);
  for (const r of ROOMS) n.setCharacter(r, { name: `Gestor ${r.slice(3)}`, look: 'f', seed: SEEDS[r] });
  return n;
}

function office(looks: readonly GestorLook[] | undefined) {
  let clock = 1_000_000;
  const o = new Office({
    names: names(),
    version: 't',
    startedAt: clock,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    now: () => clock,
    fixedRooms: () => FIXED,
    ...(looks ? { gestorLooks: () => looks } : {}),
  });
  const open = (cwd: string, n: number) =>
    o.addMain({ id: `acc:${n}`, account: 'acc', sessionId: `s${n}`, cwd, role: 'Agente principal', startedAt: clock, status: 'working' });
  return { o, open, advance: (ms: number) => (clock += ms) };
}

const byRoom = (o: Office, room: string) => o.commit().snapshot.agents.find((a) => a.roomId === room)!;

describe('arquivo do mapeamento', () => {
  it('o modelo versionado (config/gestores.example.json) é válido e não carrega nome de Gestor real', () => {
    const text = readFileSync(join(import.meta.dirname, '..', '..', 'config', 'gestores.example.json'), 'utf8');
    const out = parseGestorLooks(JSON.parse(text));
    expect(out.map((l) => l.gestor)).toEqual(['projeto-a', 'projeto-b', 'projeto-c']);
    expect(out.every((l) => l.look || l.parts || l.extras)).toBe(true);
    expect(out.find((l) => l.extras?.figure === 'potion')).toBeDefined();
    expect(out.find((l) => l.extras?.headgear === 'hood_mask')).toBeDefined();
    expect(out.find((l) => l.parts?.hairStyle === 'bald' && l.parts.facialHair === 'beard')).toBeDefined();
    for (const real of ['tcr', 'pdv', 'hubib', 'nexus']) expect(text.toLowerCase()).not.toContain(real);
  });

  it('sem o arquivo (ou ilegível) é lista vazia; HABBLAUD_GESTORES_FILE troca o caminho', () => {
    const { dir, cleanup } = tempDir();
    expect(loadGestorLooks(join(dir, 'nao-existe.json'))).toEqual([]);
    writeFileSync(join(dir, 'ruim.json'), '{ isso nao e json');
    expect(loadGestorLooks(join(dir, 'ruim.json'))).toEqual([]);
    mkdirSync(join(dir, 'config'));
    writeFileSync(join(dir, 'config', 'gestores.json'), JSON.stringify({ gestores: [{ gestor: 'pdv', extras: { figure: 'potion' } }] }));
    expect(gestorLooksFile(dir, {})).toBe(join(dir, 'config', 'gestores.json'));
    expect(loadGestorLooks(gestorLooksFile(dir, {}))).toEqual([{ gestor: 'pdv', extras: { figure: 'potion' } }]);
    expect(gestorLooksFile(dir, { HABBLAUD_GESTORES_FILE: '/x/g.json' })).toBe('/x/g.json');
    cleanup();
  });

  it('o gestor do repositório (config/gestores.json local, se existir) não mapeia o TCR', () => {
    const real = loadGestorLooks(join(import.meta.dirname, '..', '..', 'config', 'gestores.json'));
    expect(real.find((l) => l.gestor === 'tcr' || l.path?.toLowerCase().endsWith('/tcr'))).toBeUndefined();
  });
});

describe('findGestorLook', () => {
  it('casa pelo gestor da sala fixa ou pelo caminho da sala', () => {
    expect(findGestorLook(LOOKS, '/p/pdv', FIXED)?.look).toBe('m');
    expect(findGestorLook(LOOKS, '/p/hub', FIXED)?.extras?.figure).toBe('potion');
    expect(findGestorLook(LOOKS, '/p/nex', FIXED)?.parts?.facialHair).toBe('beard');
    expect(findGestorLook(LOOKS, '/p/tcr', FIXED)).toBeUndefined();
    expect(findGestorLook(LOOKS, '/outra', FIXED)).toBeUndefined();
    // sala que não é fixa só casa por caminho
    expect(findGestorLook(LOOKS, '/p/pdv')).toBeUndefined();
    expect(findGestorLook(LOOKS, '/p/nex')?.look).toBe('m');
  });
});

describe('aparência dos Gestores no escritório', () => {
  it('cada Gestor mapeado recebe o visual dele e mantém nome e semente', () => {
    const { o, open } = office(LOOKS);
    ROOMS.forEach((r, i) => open(r, i + 1));
    const pdv = byRoom(o, '/p/pdv');
    expect(pdv).toMatchObject({ name: 'Gestor pdv', seed: 4471, look: 'm', parts: { skin: '#cf2a30', top: '#d42a31', topAccent: '#2f56b8' }, extras: { headgear: 'hood_mask', pattern: 'web' } });
    const hub = byRoom(o, '/p/hub');
    expect(hub).toMatchObject({ name: 'Gestor hub', seed: 8822, look: 'f', extras: { figure: 'potion', figureColor: '#c4162c' } });
    expect(hub.parts).toBeUndefined();
    const nex = byRoom(o, '/p/nex');
    expect(nex).toMatchObject({ name: 'Gestor nex', seed: 3307, look: 'm', parts: { hairStyle: 'bald', facialHair: 'beard' } });
    expect(nex.extras).toBeUndefined();
  });

  it('o TCR fica exatamente como era, com ou sem o mapeamento dos outros', () => {
    const a = office(undefined);
    const b = office(LOOKS);
    for (const x of [a, b]) ROOMS.forEach((r, i) => x.open(r, i + 1));
    const tcrA = byRoom(a.o, '/p/tcr');
    const tcrB = byRoom(b.o, '/p/tcr');
    expect(tcrB).toEqual(tcrA);
    expect(tcrB).toMatchObject({ name: 'Gestor tcr', seed: 1203, look: 'f' });
    expect(tcrB.parts).toBeUndefined();
    expect(tcrB.extras).toBeUndefined();
  });

  it('sem mapeamento (ou vazio), todos os Gestores ficam como antes', () => {
    for (const looks of [undefined, [] as GestorLook[]]) {
      const { o, open } = office(looks);
      ROOMS.forEach((r, i) => open(r, i + 1));
      for (const r of ROOMS) {
        const a = byRoom(o, r);
        expect(a.extras).toBeUndefined();
        expect(a.parts).toBeUndefined();
        expect(a.look).toBe('f');
        expect(a.seed).toBe(SEEDS[r]);
      }
    }
  });

  it('o personagem sentado da sala fixa (sem sessão) já tem o visual', () => {
    const { o } = office(LOOKS);
    const snap = o.commit().snapshot;
    const hub = snap.agents.find((a) => a.roomId === '/p/hub')!;
    expect(hub).toMatchObject({ resident: true, name: 'Gestor hub', seed: 8822, extras: { figure: 'potion', figureColor: '#c4162c' } });
    const tcr = snap.agents.find((a) => a.roomId === '/p/tcr')!;
    expect(tcr).toMatchObject({ resident: true, look: 'f', seed: 1203 });
    expect(tcr.extras).toBeUndefined();
    expect(snap.agents.find((a) => a.roomId === '/p/pdv')!.parts).toMatchObject({ skin: '#cf2a30' });
  });

  it('editar o personagem ou voltar ao sorteio não tira o visual do Gestor (o arquivo manda; o nome continua o do editor)', () => {
    const { o, open } = office(LOOKS);
    open('/p/pdv', 1);
    expect(o.setCharacter('acc:1', { name: 'Gestor Aranha', seed: 99, parts: { skin: '#ffe2cc', hairStyle: 'afro', shoes: '#111111' } })).toEqual({ result: 'ok' });
    let a = o.get('acc:1')!;
    expect(a).toMatchObject({ name: 'Gestor Aranha', seed: 99, parts: { skin: '#cf2a30' }, extras: { headgear: 'hood_mask' } });
    expect(o.resetCharacter('acc:1')).toBe('ok');
    a = o.get('acc:1')!;
    expect(a).toMatchObject({ seed: hash32('acc:1'), parts: { skin: '#cf2a30' }, extras: { headgear: 'hood_mask', pattern: 'web' } });
  });

  it('o detalhe do agente é uma cópia: mexer nele não muda o escritório', () => {
    const { o, open } = office(LOOKS);
    open('/p/hub', 1);
    const copy = o.detail('acc:1')!.agent;
    expect(copy.extras).toEqual({ figure: 'potion', figureColor: '#c4162c' });
    copy.extras!.figureColor = '#000000';
    expect(o.get('acc:1')!.extras!.figureColor).toBe('#c4162c');
  });
});

class FakeIds implements WorldIdSource {
  floorId(roomId: string): string {
    return `f_${hash32(roomId).toString(16)}`;
  }
  agentId(agentId: string): string {
    return `a_${hash32(agentId).toString(16)}`;
  }
}

describe('Habblaud World', () => {
  it('as peças locais (poção, capuz, estampa) nunca sobem; sem peças humanas o mundo recebe um personagem sorteado válido', () => {
    const { o, open } = office(LOOKS);
    ROOMS.forEach((r, i) => open(r, i + 1));
    const snap = o.commit().snapshot;
    const uplink = project({ rooms: snap.rooms, agents: snap.agents, theme: 'none', version: '0.0.0', options: { compactions: false, tokensVisible: true } }, new FakeIds(), 1_000_000);
    const json = JSON.stringify(uplink);
    for (const word of ['potion', 'hood_mask', 'web', 'figure', 'headgear', 'extras', 'Gestor']) expect(json).not.toContain(word);
    const agents = uplink.floors.flatMap((f) => f.agents);
    expect(agents).toHaveLength(4);
    for (const a of agents) {
      expect(Object.keys(a.parts).length).toBeGreaterThan(0);
      expect(a.look === 'f' || a.look === 'm').toBe(true);
    }
  });
});
