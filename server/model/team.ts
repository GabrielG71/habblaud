// Equipe do escritório, lida de config/equipe.json (ignorado pelo git: nomes e descrições reais ficam só nesta máquina;
// HABBLAUD_TEAM_FILE troca o caminho). Formato em config/equipe.example.json. Sem o arquivo, ou vazio, o sorteio de
// nomes do pool continua como era.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTeam, type TeamMember } from '../../shared/team';
import { tr } from '../../shared/i18n';
import { errMsg, log } from '../log';

export function teamFile(rootDir: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.HABBLAUD_TEAM_FILE?.trim() || join(rootDir, 'config', 'equipe.json');
}

export function loadTeam(file: string): TeamMember[] {
  try {
    return parseTeam(JSON.parse(readFileSync(file, 'utf8')));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(tr('equipe.json ilegível ({0}); subagentes com nomes sorteados.', [errMsg(err)]));
    return [];
  }
}
