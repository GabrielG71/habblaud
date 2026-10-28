import { describe, expect, it } from 'vitest';
import { createFramePacer } from './frame-pacer';

/** Quantos quadros o pacer manda desenhar em `seconds` de um monitor de `hz` (jitter opcional, determinístico). */
function drawn(hz: number, seconds: number, opts: { focused?: boolean; jitter?: number } = {}): { count: number; times: number[] } {
  const pacer = createFramePacer(opts.focused ?? true);
  const step = 1000 / hz;
  const times: number[] = [];
  for (let i = 1; i * step <= seconds * 1000; i++) {
    const j = opts.jitter ? Math.sin(i * 12.9898) * opts.jitter : 0;
    const ts = i * step + j;
    if (pacer.due(ts)) times.push(ts);
  }
  return { count: times.length, times };
}

describe('createFramePacer', () => {
  it('em 60 Hz desenha todos os quadros, mesmo com jitter', () => {
    expect(drawn(60, 10).count).toBe(600);
    expect(drawn(60, 10, { jitter: 0.8 }).count).toBe(600);
  });

  it('em monitores mais rápidos limita a ~60 quadros por segundo', () => {
    for (const hz of [75, 100, 120, 144, 165, 240]) {
      const { count } = drawn(hz, 10);
      expect(count, `${hz} Hz`).toBeGreaterThanOrEqual(480);
      expect(count, `${hz} Hz`).toBeLessThanOrEqual(615);
    }
    // 100 Hz e 120 Hz dividem bem: 60 médios
    expect(drawn(100, 10).count).toBeGreaterThanOrEqual(590);
    expect(drawn(120, 10).count).toBeGreaterThanOrEqual(595);
    expect(drawn(120, 10).count).toBeLessThanOrEqual(605);
  });

  it('sem foco desenha ~15 quadros por segundo', () => {
    for (const hz of [60, 100, 144]) {
      const { count } = drawn(hz, 10, { focused: false });
      expect(count, `${hz} Hz`).toBeGreaterThanOrEqual(130);
      expect(count, `${hz} Hz`).toBeLessThanOrEqual(155);
    }
  });

  it('o tempo entre desenhos nunca passa de um intervalo mais um quadro do monitor', () => {
    const { times } = drawn(100, 10);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(1000 / 60 + 10 + 0.001);
  });

  it('voltar ao foco desenha o próximo quadro na hora', () => {
    const p = createFramePacer(false);
    expect(p.due(1000)).toBe(true);
    expect(p.due(1016)).toBe(false); // 15 fps: ainda não
    p.setFocused(true);
    expect(p.due(1017)).toBe(true);
    expect(p.due(1020)).toBe(false);
    expect(p.due(1034)).toBe(true);
  });

  it('depois de uma pausa longa (aba oculta) desenha de imediato e não tenta recuperar quadros', () => {
    const p = createFramePacer();
    expect(p.due(100)).toBe(true);
    expect(p.due(60_000)).toBe(true);
    expect(p.due(60_004)).toBe(false);
    expect(p.due(60_017)).toBe(true);
  });
});
