// Explorador de arquivos das salas fixas (somente leitura; lógica em server/files/browse.ts):
//   GET /api/files/tree?room=<id>&path=<rel>   pastas e arquivos de uma pasta da sala
//   GET /api/files/raw?room=<id>&path=<rel>    texto de um arquivo da sala (até 1 MB)
// Lê arquivos do computador: só conexões do próprio computador (a mesma trava do terminal: socket loopback, Host local
// e Origin da mesma origem); a porta remota é recusada em http/app.ts.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BrowseError, listTree, readRaw } from '../files/browse';
import type { FixedRoom } from '../model/fixed';
import { sendJson } from './app';
import { localRequestFault } from './guard';
import { tr } from '../../shared/i18n';

/** Motivo da recusa, ou null. */
export function filesRequestProblem(req: IncomingMessage): string | null {
  switch (localRequestFault(req)) {
    case 'address':
      return tr('os arquivos da sala só podem ser vistos no próprio computador');
    case 'host':
      return tr('abra o Habblaud por http://localhost para ver os arquivos da sala');
    case 'origin':
      return tr('origem não permitida para os arquivos da sala');
    default:
      return null;
  }
}

export function createFilesRoutes(rooms: () => readonly FixedRoom[]): (req: IncomingMessage, res: ServerResponse, url: URL) => void {
  const run = async (req: IncomingMessage, res: ServerResponse, url: URL) => {
    const problem = filesRequestProblem(req);
    if (problem) return sendJson(res, 403, { error: problem });
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: tr('método não permitido') });
    }
    const room = url.searchParams.get('room') ?? '';
    const path = url.searchParams.get('path') ?? '';
    if (url.pathname === '/api/files/tree') return sendJson(res, 200, await listTree(rooms(), room, path));
    if (url.pathname === '/api/files/raw') return sendJson(res, 200, await readRaw(rooms(), room, path));
    sendJson(res, 404, { error: tr('rota desconhecida') });
  };
  return (req, res, url) => {
    run(req, res, url).catch((err) => {
      if (res.headersSent) return void res.destroy();
      if (err instanceof BrowseError) sendJson(res, err.status, { error: err.message });
      else sendJson(res, 500, { error: tr('erro interno') });
    });
  };
}
