// Aparência dos Gestores (a sessão principal de cada projeto): lida de um arquivo local fora do git
// (config/gestores.json, ver server/model/gestor-look.ts); sem ele nada muda. Só a aparência: nomes ficam como estão.
// Puro: sem Node nem DOM.
import { parseAppearanceParts, type AppearanceParts } from './appearance';
import { parseLookExtras, type LookExtras } from './look-extras';

export interface GestorLook {
  /** Qual Gestor: o `gestor` da sala fixa em escritorio.json (ex.: "pdv")... */
  gestor?: string;
  /** ...ou o caminho da pasta do projeto (sala), absoluto. Vale o que casar primeiro. */
  path?: string;
  /** Troca o `look` ('f' | 'm') do personagem (só muda detalhes do desenho e a dica enviada ao World). */
  look?: 'f' | 'm';
  /** Peças humanas (pele, cabelo, barba, roupa...), por cima da aparência sorteada pela semente da sala. */
  parts?: AppearanceParts;
  /** Peças que só existem no escritório local: capuz, estampa, figura não humana. */
  extras?: LookExtras;
}

const GESTOR_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * Lê `{ "gestores": [ { "gestor" | "path", "look", "parts", "extras" } ] }` (ou a lista direto). Ignora o que está fora
 * do formato (chave ou valor desconhecido invalida só aquela entrada) e entradas sem `gestor` nem `path`; campos
 * extras, como "note", são livres.
 */
export function parseGestorLooks(raw: unknown): GestorLook[] {
  const list = Array.isArray(raw) ? raw : (raw as { gestores?: unknown } | null)?.gestores;
  if (!Array.isArray(list)) return [];
  const out: GestorLook[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const gestor = typeof v.gestor === 'string' && GESTOR_RE.test(v.gestor) ? v.gestor : undefined;
    const path = typeof v.path === 'string' && v.path.trim().startsWith('/') ? v.path.trim() : undefined;
    if (!gestor && !path) continue;
    const parts = v.parts === undefined ? undefined : parseAppearanceParts(v.parts);
    const extras = v.extras === undefined ? undefined : parseLookExtras(v.extras);
    if (parts === null || extras === null) continue;
    if (v.look !== undefined && v.look !== 'f' && v.look !== 'm') continue;
    const look: GestorLook = {
      ...(gestor ? { gestor } : {}),
      ...(path ? { path } : {}),
      ...(v.look ? { look: v.look as 'f' | 'm' } : {}),
      ...(parts && Object.keys(parts).length ? { parts } : {}),
      ...(extras && Object.keys(extras).length ? { extras } : {}),
    };
    if (!look.look && !look.parts && !look.extras) continue;
    out.push(look);
  }
  return out;
}
