import { describe, expect, it } from 'vitest';
import { gestorArgs, parseFixedRooms } from './fixed';
import { NameStore } from './names';
import { Office } from './office';

describe('salas fixas', () => {
  it('lê só caminhos absolutos, sem repetir, e o gestor só com nome simples', () => {
    expect(
      parseFixedRooms({
        salas: [
          { path: '/p/tcr/', gestor: 'tcr' },
          { path: '/p/tcr' },
          { path: 'relativo' },
          { path: '/p/pdv', gestor: 'rm -rf /' },
          { path: '/p/hub', gestor: 'hubib' },
        ],
      }),
    ).toEqual([
      { id: '/p/tcr', path: '/p/tcr/', gestor: 'tcr' },
      { id: '/p/pdv', path: '/p/pdv' },
      { id: '/p/hub', path: '/p/hub', gestor: 'hubib' },
    ]);
    expect(parseFixedRooms(null)).toEqual([]);
    expect(parseFixedRooms({ salas: 'x' })).toEqual([]);
  });

  it('a sala existe sem sessão, com o personagem dela sentado desligado; a sessão que chega o substitui', () => {
    const names = new NameStore(null);
    names.setCharacter('/p/pdv', { name: 'Gestor PDV', look: 'f', seed: 7 });
    const deps = { names, version: 't', startedAt: 0, accounts: () => [], sources: () => [], accountName: () => undefined };
    const office = new Office({ ...deps, fixedRooms: () => [{ id: '/p/pdv', path: '/p/pdv', gestor: 'pdv' }, { id: '/p/tcr', path: '/p/tcr' }] });

    let snap = office.commit().snapshot;
    expect(snap.rooms.map((r) => [r.id, r.slot])).toEqual([['/p/pdv', 0], ['/p/tcr', 1]]);
    const pdv = snap.agents.find((a) => a.roomId === '/p/pdv')!;
    expect(pdv).toMatchObject({ id: 'residente:/p/pdv', name: 'Gestor PDV', seed: 7, resident: true, launch: 'pdv', status: 'idle', kind: 'main' });
    expect(snap.agents.find((a) => a.roomId === '/p/tcr')!.launch).toBeUndefined();

    office.addMain({ id: 'acc:1', account: 'acc', sessionId: 's1', cwd: '/p/pdv', role: 'Agente principal', startedAt: 0, status: 'working' });
    office.markDirty();
    snap = office.commit().snapshot;
    expect(snap.agents.filter((a) => a.roomId === '/p/pdv').map((a) => [a.id, a.name, !!a.resident])).toEqual([['acc:1', 'Gestor PDV', false]]);
    // a sala fixa continua na mesma vaga
    expect(snap.rooms.find((r) => r.id === '/p/pdv')!.slot).toBe(0);
  });

  it('o terminal do Habblaud abre o Claude Code da sala fixa com o nome e o briefing do gestor', () => {
    const rooms = parseFixedRooms({
      salas: [
        { path: '/p/pdv', nome: 'Gestor PDV', prompt: import.meta.filename.replace(/fixed\.test\.ts$/, '../README.md') },
        { path: '/p/tcr', nome: 'Gestor\nTCR', prompt: 'relativo.md' },
        { path: '/p/hub', prompt: '/nao/existe.md' },
      ],
    });
    expect(gestorArgs(rooms, '/p/pdv/')).toEqual(['-n', 'Gestor PDV', '--append-system-prompt-file', rooms[0].prompt]);
    // nome com quebra de linha e briefing relativo são recusados na leitura
    expect(gestorArgs(rooms, '/p/tcr')).toEqual([]);
    // briefing que não existe não vai para o claude
    expect(gestorArgs(rooms, '/p/hub')).toEqual([]);
    expect(gestorArgs(rooms, '/outra')).toEqual([]);
  });
});
