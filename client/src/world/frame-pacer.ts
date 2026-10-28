// Ritmo de desenho dos laços de requestAnimationFrame (escritório, cidade, cena Visita e peças que seguem o mundo).
//
// O navegador chama o laço no ritmo do monitor (100 Hz, 144 Hz...), mas o pixel art não precisa disso. O pacer diz, a
// cada chamada, se este quadro deve ser desenhado. Quem o usa NÃO atualiza o relógio (`lastTs`) nos quadros pulados:
// o dt do próximo desenho carrega o tempo todo que passou, então o mundo anda na mesma velocidade, só desenhado
// menos vezes.
//
// Três ritmos:
//  - ativo (30 fps): o usuário mexe no mundo (ponteiro, roda, câmera andando, seleção) ou o escritório mudou de
//    estado (agente trabalhando/esperando, sala nova). Dura ACTIVE_HOLD_MS depois do último `poke`.
//  - ocioso (10 fps): janela com foco e nada acontecendo no mundo. O escritório segue vivo (todo mundo se mexe),
//    gastando uma fração do custo. O trabalho em terminais, feed e gaveta (DOM) não passa por aqui.
//  - sem foco (8 fps): janela visível, mas outra por cima do teclado. Atividade não sobe este ritmo.
// `poke` e `setFocused(true)` fazem o próximo quadro desenhar na hora.

import type { OfficeSnapshot } from '../../../shared/types';

export const ACTIVE_FPS = 30;
export const IDLE_FPS = 10;
export const UNFOCUSED_FPS = 8;
/** Quanto o ritmo ativo dura depois do último sinal de atividade (ms). */
export const ACTIVE_HOLD_MS = 2500;

/** Folga no limiar: um quadro de monitor 60 Hz que chega 1–2 ms adiantado (jitter) ainda conta como devido. */
const SLACK_MS = 2;

export type PaceTier = 'active' | 'idle' | 'unfocused';

export interface FramePacer {
  /** true se o quadro com este timestamp (o do rAF) deve ser desenhado; já agenda o próximo. */
  due(ts: number): boolean;
  /** Janela com foco (30/10 fps) ou sem foco (8 fps). O próximo quadro desenha na hora. */
  setFocused(focused: boolean): void;
  /**
   * Algo relevante aconteceu no mundo (clique, câmera, agente mudando de estado): fica no ritmo ativo por
   * ACTIVE_HOLD_MS. Saindo do ocioso, o próximo quadro desenha na hora. `ts` é o relógio do rAF (performance.now()).
   */
  poke(ts?: number): void;
  /** Esquece o agendamento: o próximo quadro desenha na hora. */
  reset(): void;
  /** O ritmo em vigor no instante `ts` (para testes e depuração). */
  tier(ts?: number): PaceTier;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function createFramePacer(focused = true): FramePacer {
  let isFocused = focused;
  let next = 0;
  // Começa ativo: a carga inicial (salas montando, primeiros agentes) não nasce travada.
  let activeUntil = Number.NEGATIVE_INFINITY;
  let started = false;
  let lastTier: PaceTier | null = null;

  const tierAt = (ts: number): PaceTier => (!isFocused ? 'unfocused' : ts < activeUntil ? 'active' : 'idle');
  const fpsOf = (t: PaceTier): number => (t === 'active' ? ACTIVE_FPS : t === 'idle' ? IDLE_FPS : UNFOCUSED_FPS);

  return {
    due(ts) {
      if (!started) {
        started = true;
        activeUntil = ts + ACTIVE_HOLD_MS;
      }
      const tier = tierAt(ts);
      const interval = 1000 / fpsOf(tier);
      // Subiu de ritmo (ocioso -> ativo): não espera o intervalo longo que já estava agendado.
      if (lastTier && tier !== lastTier && interval < 1000 / fpsOf(lastTier)) next = 0;
      lastTier = tier;
      if (ts + Math.min(SLACK_MS, interval / 4) < next) return false;
      // Mantém a fase (30 médios mesmo em 100 Hz) sem tentar "recuperar" quadros depois de um atraso.
      next = Math.max(next + interval, ts + interval / 2);
      return true;
    },
    setFocused(on) {
      isFocused = on;
      next = 0;
    },
    poke(ts = nowMs()) {
      started = true;
      const wasIdle = ts >= activeUntil;
      activeUntil = Math.max(activeUntil, ts + ACTIVE_HOLD_MS);
      if (wasIdle && isFocused) next = 0;
    },
    reset() {
      next = 0;
    },
    tier(ts = nowMs()) {
      return tierAt(ts);
    },
  };
}

/** A janela do navegador está com foco? (fora do navegador, p. ex. nos testes, conta como sim) */
export function windowFocused(): boolean {
  return typeof document === 'undefined' || typeof document.hasFocus !== 'function' ? true : document.hasFocus();
}

/**
 * Assinatura do que move o escritório: quem está em que sala e em que estado (trabalhando, esperando, à toa...),
 * quantos shells esperam e o efeito de cada sala. Mudou = o mundo tem o que mostrar, então sobe de ritmo. Não entra
 * a atividade (cada ferramenta usada) nem o texto: isso é do feed e da gaveta, não da animação.
 */
export function officeSignature(snap: Pick<OfficeSnapshot, 'agents' | 'rooms'>): string {
  let sig = '';
  for (const a of snap.agents) sig += `${a.id}|${a.roomId}|${a.status}|${a.shells?.length ?? 0};`;
  for (const r of snap.rooms) sig += `${r.id}|${r.effect?.at ?? 0};`;
  return sig;
}
