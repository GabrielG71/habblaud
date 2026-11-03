import { beforeEach, describe, expect, it } from 'vitest';
import { pruneTabLabels, setTabLabel, tabLabel } from './tablabels';

beforeEach(() => {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  };
});

describe('nomes das abas', () => {
  it('guarda, limita e volta ao nome do personagem com texto vazio', () => {
    setTabLabel('a:1', '  feat/x  ');
    expect(tabLabel('a:1')).toBe('feat/x');
    setTabLabel('a:1', 'y'.repeat(100));
    expect(tabLabel('a:1')).toHaveLength(40);
    setTabLabel('a:1', '   ');
    expect(tabLabel('a:1')).toBeUndefined();
  });

  it('descarta agentes ausentes do snapshot, menos o que acabou de ser nomeado', () => {
    setTabLabel('a:1', 'um', 0);
    setTabLabel('a:2', 'dois', 0);
    pruneTabLabels(new Set(['a:2']), 10_000);
    expect(tabLabel('a:1')).toBe('um');
    pruneTabLabels(new Set(['a:2']), 120_000);
    expect(tabLabel('a:1')).toBeUndefined();
    expect(tabLabel('a:2')).toBe('dois');
  });
});
