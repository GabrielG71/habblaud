import { describe, expect, it } from 'vitest';
import { parseGestorLooks } from './gestor-look';

describe('parseGestorLooks', () => {
  it('lê { gestores } ou a lista direto; peças e extras validados', () => {
    const one = { gestor: 'pdv', note: 'livre', look: 'm', parts: { skin: '#CF2A30', hairStyle: 'short' }, extras: { headgear: 'hood_mask' } };
    expect(parseGestorLooks({ gestores: [one] })).toEqual([
      { gestor: 'pdv', look: 'm', parts: { skin: '#cf2a30', hairStyle: 'short' }, extras: { headgear: 'hood_mask' } },
    ]);
    expect(parseGestorLooks([one])).toHaveLength(1);
  });

  it('aceita o caminho da pasta no lugar do nome do Gestor', () => {
    expect(parseGestorLooks([{ path: ' /p/hub ', extras: { figure: 'potion' } }])).toEqual([{ path: '/p/hub', extras: { figure: 'potion' } }]);
    expect(parseGestorLooks([{ path: 'relativo', extras: { figure: 'potion' } }])).toEqual([]);
  });

  it('ignora só a entrada fora do formato (as outras ficam)', () => {
    const out = parseGestorLooks({
      gestores: [
        { gestor: 'ok', look: 'f' },
        { gestor: 'rm -rf /', look: 'f' },
        { look: 'f' },
        { gestor: 'sem-nada' },
        { gestor: 'look-ruim', look: 'x' },
        { gestor: 'peca-ruim', parts: { hairStyle: 'nao-existe' } },
        { gestor: 'extra-ruim', extras: { figure: 'dragao' } },
        { gestor: 'extra-desconhecido', extras: { nada: 'x' } },
        null,
        'texto',
        { gestor: 'figura', extras: { figure: 'potion' } },
      ],
    });
    expect(out.map((l) => l.gestor)).toEqual(['ok', 'figura']);
  });

  it('formato desconhecido vira lista vazia', () => {
    for (const raw of [null, undefined, 3, 'x', {}, { gestores: 'x' }]) expect(parseGestorLooks(raw)).toEqual([]);
  });
});
