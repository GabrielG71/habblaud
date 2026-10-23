// Janela de arquivos de uma sala fixa: árvore de pastas e visualizador de código, só leitura (API em
// server/http/files.ts). Flutuante como o terminal: arrasta pela barra, redimensiona pelas bordas, expande na tela
// toda. O miolo (ui/filespane.ts) e o realce (highlight.js) só são carregados quando a janela abre pela primeira vez.
// As teclas digitadas aqui não vazam para os atalhos do escritório; Esc fecha (ou limpa o filtro).
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setText } from './dom';
import type { FilesPane } from './filespane';
import { ICONS } from './icons';
import { maximizeButton, Movable } from './movable';
import { tr } from '../../../shared/i18n';

/** O que a gaveta usa da janela de arquivos. */
export interface FilesControl {
  /** Sala aberta na janela, ou null com a janela fechada. */
  readonly roomId: string | null;
  /** Abre a janela na sala (se já está aberta noutra, troca o conteúdo). */
  open(roomId: string): void;
  close(): void;
}

export class FilesPanel implements UiComponent, FilesControl {
  readonly el: HTMLElement;
  private room: string | null = null;
  private lastName = '';
  private lastPath = '';
  private titleEl: HTMLElement;
  private body: HTMLElement;
  private pane: FilesPane | null = null;
  private loading: Promise<FilesPane> | null = null;
  private movable: Movable;

  constructor(private ctx: UiContext) {
    const icon = h('span', { class: 'ui-term__icon', attrs: { 'aria-hidden': 'true' } });
    icon.innerHTML = ICONS.folder;
    this.titleEl = h('strong', { class: 'ui-files__title' });
    const close = iconButton(ICONS.close, tr('Fechar (Esc)'), () => this.close(), 'ui-icon-btn--sm ui-term__close');
    const bar = h('div', { class: 'ui-term__bar' }, icon, h('div', { class: 'ui-files__who' }, this.titleEl), maximizeButton(() => this.movable), close);
    this.body = h('div', { class: 'ui-files__host' }, h('p', { class: 'ui-files__msg', text: tr('Carregando…') }));
    this.el = h('section', { class: 'ui-term ui-files', role: 'dialog', hidden: true, attrs: { 'aria-label': tr('Arquivos') } }, bar, this.body);
    // Teclas digitadas aqui (filtro, setas da árvore) não são dos atalhos do escritório (T, P, M, Esc...).
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.addEventListener('keyup', (e) => e.stopPropagation());
    this.movable = new Movable(this.el, bar, { key: 'habblaud.move.files', enabled: () => !ctx.isNarrow() });
  }

  get roomId(): string | null {
    return this.room;
  }

  open(roomId: string): void {
    const wasOpen = this.room !== null;
    this.room = roomId;
    this.syncRoom();
    if (!wasOpen) {
      this.movable.restore();
      this.el.hidden = false;
    }
    this.ensurePane().then(
      (pane) => {
        if (this.room !== roomId) return;
        pane.setRoom(roomId);
        if (!wasOpen) pane.focus();
      },
      () => undefined,
    );
    this.ctx.invalidate();
  }

  close(): void {
    if (this.room === null) return;
    this.room = null;
    this.el.hidden = true;
    this.ctx.invalidate();
  }

  render(): void {
    if (this.room !== null) this.syncRoom();
  }

  /** Título e caminho da sala (a sala pode ser renomeada, ou sair do prédio, com a janela aberta). */
  private syncRoom(): void {
    const room = this.room === null ? undefined : this.ctx.store.room(this.room);
    if (room) {
      this.lastName = room.name;
      this.lastPath = room.path;
    } else if (this.room !== null && !this.lastPath) {
      this.lastName = this.room.split('/').pop() || this.room;
    }
    setText(this.titleEl, tr('Arquivos — {0}', [this.lastName]));
  }

  private ensurePane(): Promise<FilesPane> {
    if (this.pane) return Promise.resolve(this.pane);
    this.loading ??= import('./filespane')
      .then(({ FilesPane }) => {
        this.pane = new FilesPane({ rootPath: () => this.lastPath, close: () => this.close() });
        this.body.replaceChildren(this.pane.el);
        return this.pane;
      })
      .catch((err: unknown) => {
        // Pedaço que não carregou (rede, servidor reiniciado): a próxima abertura tenta de novo.
        this.loading = null;
        this.body.replaceChildren(h('p', { class: 'ui-files__msg is-error', text: tr('Não foi possível carregar a janela de arquivos.') }));
        throw err;
      });
    return this.loading;
  }
}
