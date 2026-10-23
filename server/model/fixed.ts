// Salas fixas, lidas de <dataDir>/escritorio.json: existem mesmo sem sessão aberta, e o personagem da sala fica
// sentado nelas, desligado, até uma sessão chegar (Office.build cria o residente).
//
//   { "salas": [ { "path": "/home/eu/projeto", "gestor": "proj" } ] }
//
// `gestor` é opcional: o projeto que o "Ligar" do painel abre pela ponte do VS Code.
import { readFileSync } from 'node:fs';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';
import { normalizeCwd } from './rooms';

export interface FixedRoom {
  /** cwd normalizado (id da sala). */
  id: string;
  path: string;
  gestor?: string;
}

const GESTOR_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export function parseFixedRooms(raw: unknown): FixedRoom[] {
  const salas = (raw as { salas?: unknown } | null)?.salas;
  if (!Array.isArray(salas)) return [];
  const out: FixedRoom[] = [];
  const seen = new Set<string>();
  for (const s of salas) {
    const path = (s as { path?: unknown })?.path;
    if (typeof path !== 'string' || !path.trim().startsWith('/')) continue;
    const id = normalizeCwd(path);
    if (seen.has(id)) continue;
    seen.add(id);
    const gestor = (s as { gestor?: unknown }).gestor;
    out.push({ id, path: path.trim(), ...(typeof gestor === 'string' && GESTOR_RE.test(gestor) ? { gestor } : {}) });
  }
  return out;
}

export function loadFixedRooms(file: string): FixedRoom[] {
  try {
    return parseFixedRooms(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('escritorio.json ilegível ({0}); sem salas fixas.', [errMsg(err)]));
    return [];
  }
}
