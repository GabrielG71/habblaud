// Aparência dos Gestores, lida de config/gestores.json (ignorado pelo git: o mapeamento de quem usa qual visual fica só
// nesta máquina; HABBLAUD_GESTORES_FILE troca o caminho). Formato em config/gestores.example.json. Sem o arquivo, ou
// vazio, os Gestores têm a aparência de sempre.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseGestorLooks, type GestorLook } from '../../shared/gestor-look';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';
import type { FixedRoom } from './fixed';
import { normalizeCwd } from './rooms';

export function gestorLooksFile(rootDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.HABBLAUD_GESTORES_FILE?.trim() || join(rootDir, 'config', 'gestores.json');
}

export function loadGestorLooks(file: string): GestorLook[] {
  try {
    return parseGestorLooks(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('gestores.json ilegível ({0}); Gestores com a aparência de sempre.', [errMsg(err)]));
    return [];
  }
}

/**
 * A aparência da sala `roomId` (cwd normalizado): a primeira entrada cujo `path` é a sala ou cujo `gestor` é o da sala
 * fixa correspondente. Sala que não é fixa só casa por `path`.
 */
export function findGestorLook(looks: readonly GestorLook[], roomId: string, fixed: readonly FixedRoom[] = []): GestorLook | undefined {
  const gestor = fixed.find((f) => f.id === roomId)?.gestor;
  return looks.find((l) => (l.path !== undefined && normalizeCwd(l.path) === roomId) || (l.gestor !== undefined && l.gestor === gestor));
}
