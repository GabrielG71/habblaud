import { describe, expect, it } from 'vitest';
import { HAIR_STYLES, TOP_STYLES, ACCESSORIES } from './appearance';
import { extrasKey, FIGURES, HEADGEARS, hasExtras, parseLookExtras, PATTERNS } from './look-extras';
import * as protocol from './world/protocol';

describe('parseLookExtras', () => {
  it('lê figura, capuz e estampa, com as cores em minúsculas e na ordem fixa', () => {
    expect(parseLookExtras({ patternColor: '#AABBCC', pattern: 'web', headgear: 'hood_mask', figure: 'potion', figureColor: '#C4162C' })).toEqual({
      figure: 'potion',
      figureColor: '#c4162c',
      headgear: 'hood_mask',
      pattern: 'web',
      patternColor: '#aabbcc',
    });
    expect(Object.keys(parseLookExtras({ pattern: 'web', figure: 'potion' })!)).toEqual(['figure', 'pattern']);
  });

  it('recusa chave desconhecida, valor fora da lista e cor fora do formato', () => {
    for (const bad of [{ nada: 'x' }, { figure: 'dragao' }, { headgear: 'cartola' }, { pattern: 3 }, { figureColor: 'vermelho' }, [], null, 'x', 7]) {
      expect(parseLookExtras(bad)).toBeNull();
    }
    expect(parseLookExtras({})).toEqual({});
  });

  it('assinatura estável; vazia sem extras', () => {
    expect(extrasKey(undefined)).toBe('');
    expect(extrasKey({ figure: 'potion' })).toBe(extrasKey({ figure: 'potion' }));
    expect(extrasKey({ figure: 'potion' })).not.toBe(extrasKey({ figure: 'potion', figureColor: '#c4162c' }));
    expect(hasExtras(undefined)).toBe(false);
    expect(hasExtras({})).toBe(false);
    expect(hasExtras({ pattern: 'web' })).toBe(true);
  });

  it('não mexe no contrato com o World: nada daqui entra nas listas de peças de shared/appearance.ts nem do protocolo', () => {
    const known = new Set<string>([...HAIR_STYLES, ...TOP_STYLES, ...ACCESSORIES, ...protocol.HAIR_STYLES, ...protocol.TOP_STYLES, ...protocol.ACCESSORIES]);
    for (const v of [...FIGURES, ...HEADGEARS, ...PATTERNS]) expect(known.has(v)).toBe(false);
    expect(HAIR_STYLES).toEqual(protocol.HAIR_STYLES);
    expect(TOP_STYLES).toEqual(protocol.TOP_STYLES);
    expect(ACCESSORIES).toEqual(protocol.ACCESSORIES);
  });
});
