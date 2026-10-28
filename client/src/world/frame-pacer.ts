// Ritmo de desenho dos laços de requestAnimationFrame (escritório e cidade).
//
// O navegador chama o laço no ritmo do monitor (100 Hz, 144 Hz...), mas o pixel art não ganha nada acima de 60
// quadros por segundo. O pacer diz, a cada chamada, se este quadro deve ser desenhado. Quem o usa NÃO atualiza o
// relógio (`lastTs`) nos quadros pulados: o dt do próximo desenho carrega o tempo todo que passou, então o mundo
// anda na mesma velocidade, só desenhado menos vezes.
//
// Com a janela visível mas sem foco (outra janela por cima do teclado), o desenho cai para 15 quadros por segundo:
// o escritório segue vivo para quem olha de relance, gastando uma fração da CPU/GPU.

export const FOCUSED_FPS = 60;
export const UNFOCUSED_FPS = 15;

/** Folga no limiar: um quadro de monitor 60 Hz que chega 1–2 ms adiantado (jitter) ainda conta como devido. */
const SLACK_MS = 2;

export interface FramePacer {
  /** true se o quadro com este timestamp (o do rAF) deve ser desenhado; já agenda o próximo. */
  due(ts: number): boolean;
  /** Janela com foco (60 fps) ou sem foco (15 fps). O próximo quadro desenha na hora. */
  setFocused(focused: boolean): void;
  /** Esquece o agendamento: o próximo quadro desenha na hora. */
  reset(): void;
}

export function createFramePacer(focused = true): FramePacer {
  let interval = 1000 / (focused ? FOCUSED_FPS : UNFOCUSED_FPS);
  let next = 0;
  return {
    due(ts) {
      if (ts + Math.min(SLACK_MS, interval / 4) < next) return false;
      // Mantém a fase (60 médios mesmo em 100 Hz) sem tentar "recuperar" quadros depois de um atraso.
      next = Math.max(next + interval, ts + interval / 2);
      return true;
    },
    setFocused(on) {
      interval = 1000 / (on ? FOCUSED_FPS : UNFOCUSED_FPS);
      next = 0;
    },
    reset() {
      next = 0;
    },
  };
}

/** A janela do navegador está com foco? (fora do navegador, p. ex. nos testes, conta como sim) */
export function windowFocused(): boolean {
  return typeof document === 'undefined' || typeof document.hasFocus !== 'function' ? true : document.hasFocus();
}
