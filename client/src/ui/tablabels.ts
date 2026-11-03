// Nome das abas do terminal escolhido pelo usuário (duplo clique no nome; a branch, nas frentes abertas numa worktree).
// Só no navegador, por agente (id do processo), como em ui/agentorder.ts.
const KEY = 'habblaud.tabs.names';
const MAX_LABEL = 40;
/** Quanto tempo um nome recém-guardado escapa da limpeza (o agente novo ainda não chegou ao snapshot). */
const FRESH_MS = 60_000;

type LabelMap = Record<string, string>;

const fresh = new Map<string, number>();

function load(): LabelMap {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const map: LabelMap = {};
    for (const [id, l] of Object.entries(v)) if (typeof l === 'string' && l) map[id] = l;
    return map;
  } catch {
    return {};
  }
}

function save(map: LabelMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // sem armazenamento: o nome vale só até recarregar
  }
}

/** Nome guardado da aba, se houver. */
export function tabLabel(agentId: string): string | undefined {
  return load()[agentId];
}

/** Guarda o nome da aba; vazio volta ao nome do personagem. */
export function setTabLabel(agentId: string, label: string, now = Date.now()): void {
  const map = load();
  const text = label.trim().slice(0, MAX_LABEL);
  if (text) {
    map[agentId] = text;
    fresh.set(agentId, now);
  } else delete map[agentId];
  save(map);
}

/** Descarta os nomes de agentes que já não estão no snapshot (o processo encerrou). */
export function pruneTabLabels(present: ReadonlySet<string>, now = Date.now()): void {
  const map = load();
  let changed = false;
  for (const id of Object.keys(map)) {
    if (present.has(id)) continue;
    const at = fresh.get(id);
    if (at !== undefined && now - at < FRESH_MS) continue;
    delete map[id];
    fresh.delete(id);
    changed = true;
  }
  if (changed) save(map);
}
