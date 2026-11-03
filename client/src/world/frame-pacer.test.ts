import { describe, expect, it } from 'vitest';
import type { AgentInfo, RoomInfo } from '../../../shared/types';
import { ACTIVE_FPS, ACTIVE_HOLD_MS, createFramePacer, IDLE_FPS, officeSignature, UNFOCUSED_FPS } from './frame-pacer';

/** Quantos quadros o pacer manda desenhar em `seconds` de um monitor de `hz` (jitter opcional, determinístico). */
function drawn(hz: number, seconds: number, opts: { focused?: boolean; jitter?: number; start?: number; active?: boolean } = {}): { count: number; times: number[] } {
  const pacer = createFramePacer(opts.focused ?? true);
  const step = 1000 / hz;
  const start = opts.start ?? 0;
  const times: number[] = [];
  // Primeiro quadro (que arma o ritmo ativo da carga inicial) fora da conta; depois só o regime em estudo.
  pacer.due(start);
  const settle = start + ACTIVE_HOLD_MS + 10;
  for (let i = 1; i * step <= seconds * 1000; i++) {
    const j = opts.jitter ? Math.sin(i * 12.9898) * opts.jitter : 0;
    const ts = settle + i * step + j;
    if (opts.active) pacer.poke(ts);
    if (pacer.due(ts)) times.push(ts);
  }
  return { count: times.length, times };
}

describe('createFramePacer', () => {
  it('ativo: limita a ~30 quadros por segundo em qualquer monitor, mesmo com jitter', () => {
    for (const hz of [60, 75, 100, 120, 144, 165, 240]) {
      const { count } = drawn(hz, 10, { active: true });
      expect(count, `${hz} Hz`).toBeGreaterThanOrEqual(10 * ACTIVE_FPS * 0.85);
      expect(count, `${hz} Hz`).toBeLessThanOrEqual(10 * ACTIVE_FPS * 1.08);
    }
    expect(drawn(60, 10, { active: true, jitter: 0.8 }).count).toBeGreaterThanOrEqual(290);
    expect(drawn(100, 10, { active: true }).count).toBeGreaterThanOrEqual(290);
    expect(drawn(120, 10, { active: true }).count).toBeLessThanOrEqual(302);
  });

  it('ocioso (com foco, sem atividade): ~10 quadros por segundo', () => {
    for (const hz of [60, 100, 144]) {
      const { count } = drawn(hz, 10);
      expect(count, `${hz} Hz`).toBeGreaterThanOrEqual(10 * IDLE_FPS * 0.85);
      expect(count, `${hz} Hz`).toBeLessThanOrEqual(10 * IDLE_FPS * 1.1);
    }
  });

  it('sem foco: ~8 quadros por segundo, e atividade não sobe esse ritmo', () => {
    for (const hz of [60, 100, 144]) {
      const { count } = drawn(hz, 10, { focused: false });
      expect(count, `${hz} Hz`).toBeGreaterThanOrEqual(10 * UNFOCUSED_FPS * 0.85);
      expect(count, `${hz} Hz`).toBeLessThanOrEqual(10 * UNFOCUSED_FPS * 1.1);
    }
    const busy = drawn(100, 10, { focused: false, active: true });
    expect(busy.count).toBeLessThanOrEqual(10 * UNFOCUSED_FPS * 1.1);
  });

  it('a carga inicial nasce no ritmo ativo e cai para o ocioso depois do tempo de espera', () => {
    const p = createFramePacer();
    expect(p.due(1000)).toBe(true);
    expect(p.tier(1100)).toBe('active');
    expect(p.tier(1000 + ACTIVE_HOLD_MS - 1)).toBe('active');
    expect(p.tier(1000 + ACTIVE_HOLD_MS + 1)).toBe('idle');
  });

  it('o tempo entre desenhos nunca passa de um intervalo mais um quadro do monitor', () => {
    const idle = drawn(100, 10).times;
    for (let i = 1; i < idle.length; i++) expect(idle[i] - idle[i - 1]).toBeLessThanOrEqual(1000 / IDLE_FPS + 10 + 0.001);
    const active = drawn(100, 10, { active: true }).times;
    for (let i = 1; i < active.length; i++) expect(active[i] - active[i - 1]).toBeLessThanOrEqual(1000 / ACTIVE_FPS + 10 + 0.001);
  });

  it('atividade tira do ocioso na hora e a espera termina sozinha', () => {
    const p = createFramePacer();
    p.due(0);
    const t0 = ACTIVE_HOLD_MS + 500; // já ocioso
    expect(p.tier(t0)).toBe('idle');
    expect(p.due(t0)).toBe(true);
    expect(p.due(t0 + 16)).toBe(false); // 10 fps: ainda não
    p.poke(t0 + 17);
    expect(p.tier(t0 + 17)).toBe('active');
    expect(p.due(t0 + 20)).toBe(true); // o próximo quadro já desenha
    expect(p.due(t0 + 23)).toBe(false);
    expect(p.due(t0 + 37)).toBe(true); // ~30 fps
    expect(p.tier(t0 + 17 + ACTIVE_HOLD_MS + 1)).toBe('idle');
  });

  it('cada sinal de atividade renova a espera, sem acumular além dela', () => {
    const p = createFramePacer();
    p.due(0);
    p.poke(10_000);
    p.poke(11_000);
    expect(p.tier(11_000 + ACTIVE_HOLD_MS - 1)).toBe('active');
    expect(p.tier(11_000 + ACTIVE_HOLD_MS + 1)).toBe('idle');
  });

  it('voltar ao foco desenha o próximo quadro na hora', () => {
    const p = createFramePacer(false);
    expect(p.due(1000)).toBe(true);
    expect(p.due(1016)).toBe(false); // 8 fps: ainda não
    p.setFocused(true);
    expect(p.due(1017)).toBe(true);
    expect(p.due(1020)).toBe(false);
    expect(p.due(1050)).toBe(true);
  });

  it('depois de uma pausa longa (aba oculta) desenha de imediato e não tenta recuperar quadros', () => {
    const p = createFramePacer();
    expect(p.due(100)).toBe(true);
    expect(p.due(60_000)).toBe(true);
    expect(p.due(60_004)).toBe(false);
    expect(p.due(60_040)).toBe(false); // ocioso: 100 ms
    expect(p.due(60_101)).toBe(true);
  });
});

describe('officeSignature', () => {
  const agent = (over: Partial<AgentInfo> = {}) => ({ id: 'a', roomId: 'r', status: 'working', ...over }) as AgentInfo;
  const room = (over: Partial<RoomInfo> = {}) => ({ id: 'r', ...over }) as RoomInfo;
  const sig = (agents: AgentInfo[], rooms: RoomInfo[] = [room()]) => officeSignature({ agents, rooms });

  it('muda com quem entra, sai, troca de sala ou de estado', () => {
    const base = sig([agent()]);
    expect(sig([agent(), agent({ id: 'b' })])).not.toBe(base);
    expect(sig([])).not.toBe(base);
    expect(sig([agent({ status: 'waiting' })])).not.toBe(base);
    expect(sig([agent({ roomId: 'r2' })])).not.toBe(base);
    expect(sig([agent({ shells: [{} as never] })])).not.toBe(base);
  });

  it('muda com o efeito de uma sala (festa, alarme de CI)', () => {
    expect(sig([agent()], [room({ effect: { kind: 'party', text: 'x', at: 5, until: 9 } as RoomInfo['effect'] })])).not.toBe(sig([agent()]));
  });

  it('não muda com o que é só do feed e da gaveta (atividade, título, tarefas)', () => {
    const base = sig([agent()]);
    expect(sig([agent({ title: 'outro', activity: { text: 'Lendo' } as never, tasks: [{} as never] })])).toBe(base);
  });
});
