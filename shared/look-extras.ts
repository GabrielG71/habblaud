// Peças de aparência que ficam FORA de `AppearanceParts` de propósito: as listas de shared/appearance.ts são espelhadas
// com o Habblaud World e travadas por teste (shared/world/protocol.ts), então estilos novos moram aqui e só existem no
// escritório local. O World nunca as recebe (a projeção lê só `parts`): quem usa `figure` ou máscara cai no sorteio
// normal de lá. Puro: sem Node nem DOM.

/** Figuras não humanas: o renderer desenha a figura no lugar do avatar (cena, lista, gaveta, dica). */
export const FIGURES = ['potion'] as const;
/** Capuz que cobre a cabeça toda (some o cabelo, os pelos e o acessório), com olhos grandes e brancos. */
export const HEADGEARS = ['hood_mask'] as const;
/** Estampas da roupa de cima (por cima do estilo da roupa). */
export const PATTERNS = ['web'] as const;

export interface LookExtras {
  /** Figura no lugar do personagem. */
  figure?: (typeof FIGURES)[number];
  /** Cor do conteúdo da figura (a poção: o líquido). */
  figureColor?: string;
  headgear?: (typeof HEADGEARS)[number];
  headgearColor?: string;
  pattern?: (typeof PATTERNS)[number];
  patternColor?: string;
}

const EXTRA_KEYS = ['figure', 'figureColor', 'headgear', 'headgearColor', 'pattern', 'patternColor'] as const;
const LISTS: Partial<Record<(typeof EXTRA_KEYS)[number], readonly string[]>> = {
  figure: FIGURES,
  headgear: HEADGEARS,
  pattern: PATTERNS,
};
const COLOR = /^#[0-9a-f]{6}$/i;

/** Extras válidos na ordem fixa (cores em minúsculas), ou null se houver chave desconhecida ou valor fora do formato. */
export function parseLookExtras(raw: unknown): LookExtras | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  for (const k of Object.keys(src)) if (!(EXTRA_KEYS as readonly string[]).includes(k)) return null;
  const out: Record<string, string> = {};
  for (const k of EXTRA_KEYS) {
    const v = src[k];
    if (v === undefined) continue;
    if (typeof v !== 'string') return null;
    const allowed = LISTS[k];
    if (allowed ? !allowed.includes(v) : !COLOR.test(v)) return null;
    out[k] = allowed ? v : v.toLowerCase();
  }
  return out as LookExtras;
}

/** Assinatura estável (cache de sprites e detecção de mudança); vazia sem extras. */
export function extrasKey(e: LookExtras | undefined): string {
  return e ? EXTRA_KEYS.map((k) => e[k] ?? '').join(',') : '';
}

export function hasExtras(e: LookExtras | undefined): e is LookExtras {
  return !!e && EXTRA_KEYS.some((k) => e[k] !== undefined);
}
