// Salas fixas, lidas de <dataDir>/escritorio.json: existem mesmo sem sessão aberta, e o personagem da sala fica
// sentado nelas, desligado, até uma sessão chegar (Office.build cria o residente).
//
//   { "salas": [ { "path": "/home/eu/projeto", "gestor": "proj" } ] }
//
// Todos opcionais além de `path`: `gestor` é o projeto que o "Ligar" abre pela ponte do VS Code; `nome` e `prompt`
// (caminho absoluto de um .md) vão para o Claude Code que o "Ligar aqui" abre no terminal do Habblaud.
import { existsSync, readFileSync } from 'node:fs';
import { errMsg, log } from '../log';
import { tr } from '../../shared/i18n';
import { normalizeCwd } from './rooms';

export interface FixedRoom {
  /** cwd normalizado (id da sala). */
  id: string;
  path: string;
  gestor?: string;
  /** Nome da sessão aberta pelo terminal do Habblaud (`claude -n`). */
  nome?: string;
  /** Briefing do gestor (`claude --append-system-prompt-file`): caminho absoluto de um .md. */
  prompt?: string;
}

const GESTOR_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const NOME_RE = /^[^\x00-\x1f\x7f]{1,60}$/;

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
    const { gestor, nome, prompt } = s as { gestor?: unknown; nome?: unknown; prompt?: unknown };
    out.push({
      id,
      path: path.trim(),
      ...(typeof gestor === 'string' && GESTOR_RE.test(gestor) ? { gestor } : {}),
      ...(typeof nome === 'string' && NOME_RE.test(nome.trim()) ? { nome: nome.trim() } : {}),
      ...(typeof prompt === 'string' && prompt.startsWith('/') && prompt.endsWith('.md') ? { prompt } : {}),
    });
  }
  return out;
}

/** Argumentos do Claude Code aberto na pasta de uma sala fixa: o nome da sessão e o briefing do gestor (se o arquivo existe). */
export function gestorArgs(rooms: readonly FixedRoom[], cwd: string): string[] {
  const room = rooms.find((r) => r.id === normalizeCwd(cwd));
  if (!room) return [];
  const args = room.nome ? ['-n', room.nome] : [];
  if (room.prompt && existsSync(room.prompt)) args.push('--append-system-prompt-file', room.prompt);
  return args;
}

export function loadFixedRooms(file: string): FixedRoom[] {
  try {
    return parseFixedRooms(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('escritorio.json ilegível ({0}); sem salas fixas.', [errMsg(err)]));
    return [];
  }
}
