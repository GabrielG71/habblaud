import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hash32 } from '../../shared/hash';
import { NAME_POOL } from '../../shared/names';
import { parseTeam, type TeamMember } from '../../shared/team';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { NameStore } from './names';
import { DONE_GRACE_MS, Office } from './office';
import { loadTeam, teamFile } from './team';

setQuiet(true);

const TEAM: TeamMember[] = ['Pessoa A', 'Pessoa B', 'Pessoa C'].map((name, i) => ({
  name,
  look: i === 0 ? 'f' : 'm',
  parts: { skin: '#f6cfb0', hairStyle: i === 0 ? 'curly' : 'short', facialHair: i === 2 ? 'beard' : 'none' },
}));

function setup(team: readonly TeamMember[] | undefined, names = new NameStore(null)) {
  let clock = 1_000_000;
  const office = new Office({
    names,
    version: 't',
    startedAt: clock,
    accounts: (s) => [{ id: 'acc', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '/x', sessions: s.get('acc') ?? 0, usageStatus: 'disabled' }],
    sources: () => [],
    accountName: () => 'Conta C',
    now: () => clock,
    ...(team ? { team: () => team } : {}),
  });
  office.addMain({ id: 'acc:1', account: 'acc', sessionId: 's1', cwd: '/p/a', role: 'Agente principal', startedAt: clock, status: 'working' });
  const sub = (id: string, role = 'dev-backend') => office.addSub({ id, parentId: 'acc:1', sessionId: 's1', role, background: false, startedAt: clock });
  return { office, names, sub, advance: (ms: number) => (clock += ms) };
}

describe('equipe: pessoa de cada subagente', () => {
  it('nome da pessoa, função separada e avatar montado com as peças dela', () => {
    const { office, sub } = setup(TEAM);
    sub('s1:x', 'qa');
    const a = office.get('s1:x')!;
    const member = TEAM.find((p) => p.name === a.name)!;
    expect(member).toBeDefined();
    expect(a.role).toBe('qa');
    expect(a.look).toBe(member.look);
    expect(a.parts).toEqual(member.parts);
    expect(a.seed).toBe(hash32(`equipe:${a.name}`));
    expect(a.custom).toBeUndefined();
  });

  it('sem repetir pessoa enquanto houver livre; todas ocupadas: repete', () => {
    for (let round = 0; round < 20; round++) {
      const { office, sub } = setup(TEAM);
      for (const id of ['s1:a', 's1:b', 's1:c']) sub(id);
      const names = ['s1:a', 's1:b', 's1:c'].map((id) => office.get(id)!.name);
      expect(new Set(names).size).toBe(3);
      sub('s1:d');
      expect(names).toContain(office.get('s1:d')!.name);
    }
  });

  it('quem sai libera a pessoa para o próximo', () => {
    const { office, sub, advance } = setup(TEAM.slice(0, 2));
    sub('s1:a');
    sub('s1:b');
    const freed = office.get('s1:a')!.name;
    office.completeSub('s1:a');
    advance(DONE_GRACE_MS + 1);
    office.tick();
    expect(office.has('s1:a')).toBe(false);
    sub('s1:c');
    expect(office.get('s1:c')!.name).toBe(freed);
  });

  it('estável: subagente retomado volta com a mesma pessoa, na sala ou depois de sair dela', () => {
    const { office, sub, advance } = setup(TEAM);
    sub('s1:a');
    sub('s1:b');
    const before = office.get('s1:a')!;
    const { name, seed, parts } = before;
    office.completeSub('s1:a');
    office.reactivateSub('s1:a');
    expect(office.get('s1:a')!.name).toBe(name);
    office.completeSub('s1:a');
    advance(DONE_GRACE_MS + 1);
    office.tick();
    expect(office.has('s1:a')).toBe(false);
    for (let i = 0; i < 20; i++) {
      sub('s1:a');
      const back = office.get('s1:a')!;
      expect([back.name, back.seed, back.parts]).toEqual([name, seed, parts]);
      office.completeSub('s1:a');
      advance(DONE_GRACE_MS + 1);
      office.tick();
    }
  });

  it('estável também entre reinícios (names.json)', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'names.json');
      const first = setup(TEAM, new NameStore(file));
      first.sub('s1:a');
      const name = first.office.get('s1:a')!.name;
      first.names.flush();
      const reloaded = new NameStore(file);
      reloaded.load();
      const second = setup(TEAM, reloaded);
      second.sub('s1:a');
      expect(second.office.get('s1:a')!.name).toBe(name);
    } finally {
      tmp.cleanup();
    }
  });

  it('o gestor (agente principal) fica como está: nome do pool, sem peças', () => {
    const { office } = setup(TEAM);
    const main = office.get('acc:1')!;
    expect(NAME_POOL.map((p) => p.name)).toContain(main.name);
    expect(main.parts).toBeUndefined();
    expect(main.seed).toBe(hash32('acc:1'));
  });

  it('sem equipe (ou lista vazia) vale o comportamento de antes', () => {
    for (const team of [undefined, []] as const) {
      const { office, sub } = setup(team);
      sub('s1:a');
      const a = office.get('s1:a')!;
      expect(NAME_POOL.map((p) => p.name)).toContain(a.name);
      expect(a.parts).toBeUndefined();
      expect(a.seed).toBe(hash32('s1:a'));
    }
  });
});

describe('loadTeam', () => {
  it('arquivo ausente: lista vazia, sem erro', () => {
    const tmp = tempDir();
    try {
      expect(loadTeam(join(tmp.dir, 'nao-existe.json'))).toEqual([]);
    } finally {
      tmp.cleanup();
    }
  });

  it('arquivo ilegível: lista vazia', () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 'config', 'equipe.json');
      mkdirSync(join(tmp.dir, 'config'));
      writeFileSync(file, '{ quebrado');
      expect(loadTeam(file)).toEqual([]);
    } finally {
      tmp.cleanup();
    }
  });

  it('o caminho padrão fica em config/ e HABBLAUD_TEAM_FILE o troca', () => {
    expect(teamFile('/raiz', {})).toBe('/raiz/config/equipe.json');
    expect(teamFile('/raiz', { HABBLAUD_TEAM_FILE: '/x/e.json' })).toBe('/x/e.json');
  });

  it('o modelo versionado (config/equipe.example.json) é válido e tem nomes genéricos', () => {
    const team = loadTeam(join(import.meta.dirname, '..', '..', 'config', 'equipe.example.json'));
    expect(team.length).toBeGreaterThanOrEqual(3);
    expect(team.every((p) => /^Pessoa /.test(p.name))).toBe(true);
    expect(parseTeam({ people: team })).toEqual(team);
  });
});
