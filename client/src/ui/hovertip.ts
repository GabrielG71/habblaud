// Dica flutuante do personagem sob o cursor: acompanha o personagem a cada quadro que o mundo desenha.
import type { UiComponent, UiContext } from './context';
import { h, setHidden, setText, setVariant } from './dom';
import { formatDuration } from './format';
import { shellStage, shellWaitIn, statusLabel } from './model';
import { providerOf } from './provider';
import {
  createAccountChip,
  createActivityLine,
  createProviderTag,
  createStatusDot,
  updateAccountChip,
  updateActivityLine,
  updateProviderTag,
  updateShellActivityLine,
  updateStatusDot,
} from './widgets';
import { tr } from '../../../shared/i18n';

export class HoverTip implements UiComponent {
  readonly el: HTMLElement;
  private id: string | null = null;
  /** Tamanho da dica: medido uma vez por render (ler offsetWidth a todo quadro forçaria layout), não a cada quadro. */
  private size: { w: number; h: number } | null = null;
  private lastPos = '';
  private name: HTMLElement;
  private chip: HTMLElement;
  private prov: HTMLElement;
  private dot: HTMLElement;
  private status: HTMLElement;
  private activity: HTMLElement;
  private mood: HTMLElement;
  private task: HTMLElement;
  private since: HTMLElement;

  constructor(private ctx: UiContext) {
    this.name = h('strong', { class: 'ui-tip__name' });
    this.chip = createAccountChip('sm');
    this.prov = createProviderTag('ui-prov--xs');
    this.dot = createStatusDot();
    this.status = h('span', { class: 'ui-tip__status' });
    this.activity = createActivityLine();
    this.mood = h('div', { class: 'ui-tip__mood', hidden: true });
    this.task = h('div', { class: 'ui-tip__task', hidden: true });
    this.since = h('span', { class: 'ui-tip__since' });
    this.el = h(
      'div',
      { class: 'ui-tip', attrs: { 'aria-hidden': 'true' } },
      h('div', { class: 'ui-tip__top' }, this.name, this.chip, this.prov),
      this.task,
      h('div', { class: 'ui-tip__line' }, this.dot, this.status, this.since),
      this.activity,
      this.mood,
    );
    ctx.world.onHover((id) => this.setTarget(id));
    // Sem rAF próprio: a dica anda junto com o canvas (30/10/8 fps conforme o ritmo do mundo).
    ctx.world.onFrame(() => this.follow());
  }

  private setTarget(id: string | null): void {
    if (id === this.id) return;
    this.id = id;
    this.el.classList.toggle('is-visible', !!id);
    this.size = null;
    this.lastPos = '';
    if (id) {
      this.render();
      this.follow();
    }
  }

  /** Reposiciona a cada quadro desenhado enquanto houver alguém sob o cursor. */
  private follow = (): void => {
    if (!this.id) return;
    const p = this.ctx.world.screenPositionOf(this.id);
    if (!p) {
      this.el.classList.remove('is-visible');
    } else {
      this.el.classList.add('is-visible');
      const size = (this.size ??= { w: this.el.offsetWidth, h: this.el.offsetHeight });
      const w = size.w;
      const hgt = size.h;
      const x = Math.round(Math.min(innerWidth - w - 8, Math.max(8, p.x - w / 2)));
      const below = p.y - hgt - 10 < 72;
      const y = Math.round(below ? p.y + 46 : p.y - hgt - 10);
      const t = `translate3d(${x}px, ${y}px, 0)`;
      if (t !== this.lastPos) {
        this.lastPos = t;
        this.el.style.transform = t;
      }
    }
  };

  render(): void {
    if (!this.id) return;
    this.size = null;
    const a = this.ctx.agent(this.id);
    if (!a) {
      this.setTarget(null);
      return;
    }
    setText(this.name, a.name);
    updateAccountChip(this.chip, this.ctx.account(a.account), a.account, a.provider);
    updateProviderTag(this.prov, providerOf(a));
    // Esperando um shell: o que ele espera (com o tempo correndo) e o que anda fazendo enquanto isso.
    const now = this.ctx.now();
    const wait = shellWaitIn(a, this.ctx.store.snapshot?.agents ?? [], now);
    const status = wait ? 'shell' : a.status;
    updateStatusDot(this.dot, status);
    setText(this.status, a.status === 'waiting' && a.waitingFor ? `${statusLabel(a.status)}: ${a.waitingFor}` : `${statusLabel(status)}${a.kind === 'sub' ? ` · ${a.role}` : ''}`);
    setVariant(this.el, 'is-', status);
    // Do que se trata a sessão (título) e há quanto tempo está nesse estado (ex.: ociosa há 12 min).
    const title = a.title?.trim();
    setHidden(this.task, !title);
    if (title) setText(this.task, title);
    const inStatus = now - a.statusSince;
    setText(this.since, a.statusSince && inStatus >= 60_000 ? tr('há {0}', [formatDuration(inStatus)]) : '');
    if (wait) updateShellActivityLine(this.activity, wait, now);
    else updateActivityLine(this.activity, a.activity);
    setHidden(this.mood, !wait);
    if (wait) {
      const stage = shellStage(now - wait.since);
      setText(this.mood, `${stage.emoji} ${stage.text}`);
    }
  }
}
