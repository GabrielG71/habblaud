// Abas da janela de terminal: os agentes principais presentes no mesmo projeto (sala) do agente aberto.
// Clicar numa aba troca a janela para o terminal daquele agente (interativo ou ao vivo). Arrastar uma aba
// muda a ordem (a mesma da lista lateral; ver ui/agentorder.ts). Ao lado do nome, o começo do que o agente está
// fazendo; o X encerra a sessão (pede um segundo clique) e só aparece com o terminal interativo ligado.
// O "+" no fim abre outra frente do gestor: na mesma pasta ou numa worktree nova (`<pasta>-wt/<branch>`). Duplo clique
// no nome da aba renomeia (só neste navegador; ver ui/tablabels.ts).
import { validBranch } from '../../../shared/branch';
import type { AgentInfo } from '../../../shared/types';
import type { UiContext } from './context';
import { moveAgent, orderAgents } from './agentorder';
import { h, KeyedList, setAttr, setHidden, setText, setTitle } from './dom';
import { activityFallback } from './model';
import { ptyControllable, stopAgent } from './ptyapi';
import { pruneTabLabels, setTabLabel, tabLabel } from './tablabels';
import { createStatusDot, updateStatusDot } from './widgets';
import { tr } from '../../../shared/i18n';

/** Quanto tempo o X fica pedindo confirmação. */
const CONFIRM_MS = 3000;

/** O que mostrar ao lado do nome: a atividade de quem trabalha ou espera; o título da conversa de quem está parado. */
function doingOf(a: AgentInfo): string {
  if (a.status === 'working' || a.status === 'waiting') return a.activity?.text ?? activityFallback(a);
  return a.title ?? '';
}

export class TermTabs {
  /** Faixa inteira: as abas (rolam) e o botão "+". */
  readonly el: HTMLElement;
  private listEl: HTMLElement;
  private list: KeyedList<AgentInfo>;
  private addBtn: HTMLButtonElement;
  private pop: HTMLElement;
  private branchInput: HTMLInputElement;
  private openBtn: HTMLButtonElement;
  private sameBtn: HTMLButtonElement;
  private worktreeNote: HTMLElement;
  private popMsg: HTMLElement;
  private popBusy = false;
  /** Aba cujo nome está sendo editado. */
  private editing: string | null = null;
  private current: string | null = null;
  private roomId: string | null = null;
  private peers: AgentInfo[] = [];
  /** Aba cujo X espera o segundo clique. */
  private confirming: string | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  /** Aba sendo arrastada (id do agente). */
  private dragging: string | null = null;

  constructor(private ctx: UiContext) {
    this.listEl = h('div', { class: 'ui-ttabs__list', role: 'tablist', attrs: { 'aria-label': tr('Agentes do projeto (arraste para reordenar)') } });
    this.addBtn = h('button', {
      class: 'ui-ttabs__add',
      type: 'button',
      text: '+',
      title: tr('Nova frente deste gestor'),
      hidden: true,
      attrs: { 'aria-label': tr('Nova frente deste gestor'), 'aria-haspopup': 'true', 'aria-expanded': 'false' },
      on: { click: () => this.togglePop() },
    });
    this.sameBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Mesma pasta'), on: { click: () => this.openSameFolder() } });
    this.branchInput = h('input', {
      class: 'ui-ttabs__branch',
      type: 'text',
      attrs: { placeholder: tr('nome-da-branch'), 'aria-label': tr('Branch da nova worktree'), autocomplete: 'off', spellcheck: 'false', maxlength: '80' },
      on: { input: () => this.syncPop() },
    });
    this.openBtn = h('button', { class: 'ui-btn', type: 'button', text: tr('Abrir'), on: { click: () => this.openWorktree() } });
    this.worktreeNote = h('p', { class: 'ui-ttabs__hint', text: tr('Cria <pasta>-wt/<branch> a partir da branch atual') });
    this.popMsg = h('p', { class: 'ui-ttabs__err', hidden: true, role: 'alert' });
    this.pop = h(
      'div',
      { class: 'ui-ttabs__pop', role: 'dialog', hidden: true, attrs: { 'aria-label': tr('Nova frente deste gestor') } },
      this.sameBtn,
      h('div', { class: 'ui-ttabs__sep' }),
      h('label', { class: 'ui-ttabs__label', text: tr('Nova worktree') }, this.branchInput),
      this.worktreeNote,
      h('div', { class: 'ui-ttabs__row' }, this.openBtn),
      this.popMsg,
    );
    this.branchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.openWorktree();
      }
    });
    this.pop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.closePop(true);
      }
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.pop.hidden && !this.pop.contains(e.target as Node) && !this.addBtn.contains(e.target as Node)) this.closePop(false);
    });
    this.el = h('div', { class: 'ui-ttabs', hidden: true }, this.listEl, this.addBtn, this.pop);
    this.list = new KeyedList<AgentInfo>(this.listEl, {
      animate: false,
      key: (a) => a.id,
      create: (a) => {
        const b = h(
          'button',
          { class: 'ui-ttab', type: 'button', role: 'tab', attrs: { draggable: 'true' } },
          createStatusDot(),
          h('span', { class: 'ui-ttab__name' }),
          h('span', { class: 'ui-ttab__doing' }),
          h('span', { class: 'ui-ttab__live', text: '›_', hidden: true }),
          // Dentro do botão da aba: span (botão dentro de botão não vale); o teclado usa Delete na aba.
          h('span', { class: 'ui-ttab__close', role: 'button', attrs: { 'aria-label': tr('Encerrar esta sessão') }, text: '×' }),
        );
        const close = b.children[4] as HTMLElement;
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          this.closeTab(b.dataset.id!);
        });
        close.addEventListener('pointerdown', (e) => e.stopPropagation());
        b.addEventListener('keydown', (e) => {
          if (e.key === 'Delete') {
            e.preventDefault();
            this.closeTab(b.dataset.id!);
          }
        });
        b.dataset.id = a.id;
        (b.children[1] as HTMLElement).addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.rename(b);
        });
        b.addEventListener('click', () => {
          const id = b.dataset.id!;
          if (id !== this.current) ctx.terminals?.open(id);
        });
        this.wireDrag(b);
        return b;
      },
      update: (b, a) => {
        b.dataset.id = a.id;
        updateStatusDot(b.firstElementChild as HTMLElement, a.status);
        if (this.editing !== a.id) setText(b.children[1] as HTMLElement, tabLabel(a.id) ?? a.name);
        const doing = doingOf(a);
        setText(b.children[2] as HTMLElement, doing);
        setHidden(b.children[2] as HTMLElement, !doing);
        const live = !!ctx.terminals?.interactive(a.id);
        setHidden(b.children[3] as HTMLElement, !live);
        const close = b.children[4] as HTMLElement;
        const confirm = this.confirming === a.id;
        setHidden(close, !ctx.terminals?.interactiveEnabled || !ptyControllable(a));
        close.classList.toggle('is-confirm', confirm);
        setText(close, confirm ? tr('encerrar?') : '×');
        setTitle(close, confirm ? tr('Clique de novo para encerrar a sessão (a conversa fica salva)') : tr('Encerrar esta sessão'));
        const on = a.id === this.current;
        b.classList.toggle('is-on', on);
        setAttr(b, 'aria-selected', String(on));
        const cwd = this.ctx.store.snapshot?.ptys?.find((p) => p.agentId === a.id)?.cwd;
        const wt = cwd && cwd !== this.ctx.store.room(a.roomId)?.path ? `\n${cwd}` : '';
        setTitle(b, `${tabLabel(a.id) ?? a.name}${a.title ? ` · ${a.title}` : ''}${wt}${doing && doing !== a.title ? `
${doing}` : ''}${live ? tr(' (interativo)') : ''}`);
      },
    });
  }

  /** `agentId` = agente aberto na janela (null = sessão do histórico ou nenhum). */
  render(agentId: string | null): void {
    this.current = agentId;
    const agent = agentId ? this.ctx.agent(agentId) : undefined;
    this.roomId = agent?.roomId ?? null;
    const peers = agent
      ? (this.ctx.store.snapshot?.agents ?? [])
          .filter((a) => a.kind === 'main' && a.roomId === agent.roomId && a.status !== 'offline' && !a.id.startsWith('demo:'))
          .sort((x, y) => x.startedAt - y.startedAt || x.id.localeCompare(y.id))
      : [];
    this.peers = agent ? orderAgents(agent.roomId, peers, (a) => a.sessionId) : [];
    if (agent && this.ctx.store.snapshot) pruneTabLabels(new Set(this.ctx.store.snapshot.agents.map((a) => a.id)));
    // Uma aba só não ajuda (some), a não ser que dê para abrir outra frente: sala fixa com o terminal interativo.
    const canAdd = !!agent && !!this.ctx.store.room(agent.roomId)?.fixed && !!this.ctx.terminals?.interactiveEnabled && ptyControllable(agent);
    const show = this.peers.length >= 2 || canAdd;
    setHidden(this.el, !show);
    setHidden(this.addBtn, !this.ctx.terminals?.interactiveEnabled || !agent);
    if (this.pop.hidden === false && (this.addBtn.hidden || !show)) this.closePop(false);
    this.list.sync(show ? this.peers : []);
  }

  private currentAgent(): AgentInfo | undefined {
    return this.current ? this.ctx.agent(this.current) : undefined;
  }

  private togglePop(): void {
    if (!this.pop.hidden) return this.closePop(true);
    this.popMsg.hidden = true;
    this.branchInput.value = '';
    this.pop.hidden = false;
    this.addBtn.setAttribute('aria-expanded', 'true');
    const r = this.addBtn.getBoundingClientRect();
    const w = 280;
    this.pop.style.top = `${Math.round(r.bottom + 4)}px`;
    this.pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, window.innerWidth - w - 8)))}px`;
    this.syncPop();
    (this.worktreeEnabled() ? this.branchInput : this.sameBtn).focus();
  }

  private closePop(refocus: boolean): void {
    if (this.pop.hidden) return;
    this.pop.hidden = true;
    this.addBtn.setAttribute('aria-expanded', 'false');
    if (refocus) this.addBtn.focus();
  }

  private worktreeEnabled(): boolean {
    const a = this.currentAgent();
    return !!a && !!this.ctx.store.room(a.roomId)?.fixed?.git;
  }

  /** Estado do formulário: worktree só em sala fixa que é repositório; "Abrir" só com branch válida. */
  private syncPop(): void {
    const ok = this.worktreeEnabled();
    const msg = ok ? '' : tr('A pasta da sala não é um repositório git');
    this.branchInput.disabled = !ok || this.popBusy;
    setTitle(this.branchInput, msg);
    setTitle(this.openBtn, msg);
    const v = this.branchInput.value;
    this.openBtn.disabled = !ok || this.popBusy || !validBranch(v);
    this.sameBtn.disabled = this.popBusy;
    this.branchInput.classList.toggle('is-bad', !!v && !validBranch(v));
    setText(this.worktreeNote, ok ? tr('Cria <pasta>-wt/<branch> a partir da branch atual') : msg);
  }

  private fail(err: Error): void {
    this.popBusy = false;
    setText(this.popMsg, tr('Não deu: {0}', [err.message]));
    this.popMsg.hidden = false;
    this.syncPop();
  }

  private openSameFolder(): void {
    const a = this.currentAgent();
    const room = a && this.ctx.store.room(a.roomId);
    if (!a || !room || !this.ctx.terminals) return;
    this.popBusy = true;
    this.syncPop();
    this.ctx.terminals
      .newSession(room.path, a.account)
      .then(() => {
        this.popBusy = false;
        this.closePop(false);
      })
      .catch((err: Error) => this.fail(err));
  }

  private openWorktree(): void {
    const a = this.currentAgent();
    const room = a && this.ctx.store.room(a.roomId);
    const branch = this.branchInput.value;
    if (!a || !room || !this.ctx.terminals || !this.worktreeEnabled() || !validBranch(branch)) return;
    this.popBusy = true;
    this.popMsg.hidden = true;
    this.syncPop();
    this.ctx.terminals
      .newWorktreeSession(room.id, branch, a.account)
      .then((agentId) => {
        if (agentId) setTabLabel(agentId, branch);
        this.popBusy = false;
        this.closePop(false);
        this.ctx.invalidate();
      })
      .catch((err: Error) => this.fail(err));
  }

  /** Duplo clique no nome: campo no lugar do texto. Enter salva, Esc cancela, vazio volta ao nome do personagem. */
  private rename(b: HTMLElement): void {
    const id = b.dataset.id;
    const a = id ? this.ctx.agent(id) : undefined;
    if (!id || !a || this.editing) return;
    const span = b.children[1] as HTMLElement;
    const input = h('input', { class: 'ui-ttab__edit', type: 'text', attrs: { maxlength: '40', 'aria-label': tr('Nome da aba'), draggable: 'false' } });
    input.value = tabLabel(id) ?? a.name;
    this.editing = id;
    b.draggable = false;
    span.textContent = '';
    span.append(input);
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      if (save) setTabLabel(id, input.value);
      this.editing = null;
      b.draggable = true;
      input.remove();
      setText(span, tabLabel(id) ?? this.ctx.agent(id)?.name ?? '');
      this.ctx.invalidate();
    };
    for (const ev of ['click', 'dblclick', 'pointerdown', 'keyup']) input.addEventListener(ev, (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
    input.focus();
    input.select();
  }

  /** X da aba: o primeiro clique pede confirmação; o segundo encerra a sessão (aqui ou noutro terminal). */
  private closeTab(id: string): void {
    if (!this.ctx.terminals?.interactiveEnabled || !ptyControllable(this.ctx.agent(id))) return;
    if (this.confirming !== id) {
      this.resetConfirm();
      this.confirming = id;
      this.confirmTimer = setTimeout(() => {
        this.resetConfirm();
        this.ctx.invalidate();
      }, CONFIRM_MS);
      this.ctx.invalidate();
      return;
    }
    this.resetConfirm();
    const name = this.ctx.agent(id)?.name ?? tr('Sessão');
    stopAgent(id)
      .then(() => this.ctx.announce(tr('{0}: sessão encerrada.', [name])))
      .catch((err: Error) => this.ctx.announce(tr('Não deu para encerrar: {0}', [err.message])))
      .finally(() => this.ctx.invalidate());
    // Era a aba aberta: passa para a vizinha.
    if (id === this.current) {
      const i = this.peers.findIndex((a) => a.id === id);
      const next = this.peers[i + 1] ?? this.peers[i - 1];
      if (next) this.ctx.terminals?.open(next.id);
    }
  }

  private resetConfirm(): void {
    if (this.confirmTimer) clearTimeout(this.confirmTimer);
    this.confirmTimer = null;
    this.confirming = null;
  }

  private wireDrag(b: HTMLElement): void {
    b.addEventListener('dragstart', (e) => {
      this.dragging = b.dataset.id ?? null;
      b.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.dragging ?? '');
      }
    });
    b.addEventListener('dragend', () => {
      this.dragging = null;
      b.classList.remove('is-dragging');
      this.clearMarks();
    });
    b.addEventListener('dragover', (e) => {
      if (!this.dragging || this.dragging === b.dataset.id) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      const after = this.isAfter(b, e.clientX);
      this.clearMarks();
      b.classList.add(after ? 'is-drop-after' : 'is-drop-before');
    });
    b.addEventListener('dragleave', () => b.classList.remove('is-drop-before', 'is-drop-after'));
    b.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = this.dragging;
      const to = b.dataset.id;
      this.clearMarks();
      if (!from || !to || from === to) return;
      this.move(from, to, this.isAfter(b, e.clientX));
    });
  }

  private isAfter(b: HTMLElement, x: number): boolean {
    const r = b.getBoundingClientRect();
    return x > r.left + r.width / 2;
  }

  private clearMarks(): void {
    for (const el of this.listEl.querySelectorAll('.is-drop-before, .is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
  }

  /** Põe `from` antes (ou depois) de `to` e guarda a ordem do projeto. */
  private move(from: string, to: string, after: boolean): void {
    if (!this.roomId) return;
    if (moveAgent(this.roomId, this.peers, (a) => a.id, (a) => a.sessionId, from, to, after)) this.ctx.invalidate();
  }
}
