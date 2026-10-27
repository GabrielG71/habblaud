// Equipe do escritório: pessoas (nome + aparência) que os subagentes assumem ao entrar na sala. A lista vem de um
// arquivo local fora do git (config/equipe.json, ver server/model/team.ts); sem ele nada muda. Puro: sem Node nem DOM.
import { nameKey, parseAppearanceParts, parseCharacterName, type AppearanceParts } from './appearance';

export interface TeamMember {
  name: string;
  look: 'f' | 'm';
  /** Peças do avatar (pele, cabelo, barba, óculos, boné...); o que faltar sai do sorteio pela semente da pessoa. */
  parts: AppearanceParts;
}

/**
 * Lê `{ "people": [ { "name", "look", "parts" } ] }` (ou a lista direto). Ignora o que está fora do formato e os
 * nomes repetidos (sem diferenciar caixa nem acento); campos extras, como "note", são livres.
 */
export function parseTeam(raw: unknown): TeamMember[] {
  const list = Array.isArray(raw) ? raw : (raw as { people?: unknown } | null)?.people;
  if (!Array.isArray(list)) return [];
  const out: TeamMember[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const v = item as Record<string, unknown>;
    const name = parseCharacterName(v.name);
    const parts = parseAppearanceParts(v.parts ?? {});
    if (!name || !parts || (v.look !== 'f' && v.look !== 'm') || seen.has(nameKey(name))) continue;
    seen.add(nameKey(name));
    out.push({ name, look: v.look, parts });
  }
  return out;
}

/** A pessoa de `team` com esse nome (sem diferenciar caixa nem acento). */
export function findMember(team: readonly TeamMember[], name: string): TeamMember | undefined {
  const key = nameKey(name);
  return team.find((m) => nameKey(m.name) === key);
}

/**
 * Sorteia uma pessoa que não esteja em `taken`. Se todas estiverem ocupadas, vale qualquer uma (repete).
 * `rnd` devolve um número em [0, 1).
 */
export function pickMember(team: readonly TeamMember[], taken: ReadonlySet<string>, rnd: () => number = Math.random): TeamMember {
  const free = team.filter((m) => !taken.has(m.name));
  const pool = free.length ? free : team;
  return pool[Math.min(pool.length - 1, Math.floor(rnd() * pool.length))];
}
