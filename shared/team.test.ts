import { describe, expect, it } from 'vitest';
import { findMember, parseTeam, pickMember, type TeamMember } from './team';

const m = (name: string, look: 'f' | 'm' = 'm'): TeamMember => ({ name, look, parts: { hairStyle: 'short' } });

describe('parseTeam', () => {
  it('lê { people } ou a lista direto, com as peças validadas', () => {
    const one = { name: 'Pessoa A', look: 'f', note: 'livre', parts: { skin: '#EAB894', facialHair: 'none' } };
    expect(parseTeam({ people: [one] })).toEqual([{ name: 'Pessoa A', look: 'f', parts: { skin: '#eab894', facialHair: 'none' } }]);
    expect(parseTeam([one])).toHaveLength(1);
  });

  it('ignora o que está fora do formato e nomes repetidos (caixa e acento)', () => {
    const good = { name: 'João', look: 'm', parts: {} };
    const out = parseTeam({
      people: [
        good,
        { name: 'joão', look: 'm', parts: {} },
        { name: 'Sem look', parts: {} },
        { name: '', look: 'm' },
        { name: 'Peça ruim', look: 'm', parts: { hairStyle: 'nao-existe' } },
        { name: 'Cor ruim', look: 'm', parts: { skin: 'vermelho' } },
        null,
        'texto',
      ],
    });
    expect(out.map((p) => p.name)).toEqual(['João']);
  });

  it('formato desconhecido vira lista vazia', () => {
    for (const raw of [null, undefined, 3, 'x', {}, { people: 'x' }]) expect(parseTeam(raw)).toEqual([]);
  });
});

describe('pickMember', () => {
  const team = [m('A'), m('B'), m('C')];

  it('nunca devolve quem está ocupado enquanto houver alguém livre', () => {
    for (let i = 0; i < 50; i++) {
      expect(pickMember(team, new Set(['A', 'C']), Math.random).name).toBe('B');
      expect(pickMember(team, new Set(['B']), Math.random).name).not.toBe('B');
    }
  });

  it('todos ocupados: repete', () => {
    expect(team.map((p) => p.name)).toContain(pickMember(team, new Set(['A', 'B', 'C']), () => 0.5).name);
  });

  it('o sorteio usa o rnd injetado, inclusive nos extremos', () => {
    expect(pickMember(team, new Set(), () => 0).name).toBe('A');
    expect(pickMember(team, new Set(), () => 0.999999).name).toBe('C');
  });
});

describe('findMember', () => {
  it('acha sem diferenciar caixa nem acento composto', () => {
    expect(findMember([m('João')], 'JOÃO')?.name).toBe('João');
    expect(findMember([m('João')], 'Ana')).toBeUndefined();
  });
});
