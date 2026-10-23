// Miolo da janela de arquivos (ui/files.ts): árvore de pastas à esquerda (carga preguiçosa, uma pasta por vez) e o
// visualizador à direita (só leitura, com número de linha e realce). Carregado sob demanda (import dinâmico em
// ui/files.ts), e o highlight.js só entra quando o primeiro arquivo de código é aberto.
// O conteúdo do arquivo nunca vira HTML por concatenação: texto puro entra por textContent e o realce usa a saída do
// próprio highlight.js, que escapa o texto (nomes de arquivo também entram sempre por textContent).
import { copyText, h, iconButton, setHidden, setText } from './dom';
import {
  absolutePath,
  ancestors,
  type DirState,
  formatBytes,
  isMarkdown,
  type Lang,
  languageOf,
  lineCount,
  loadLastFile,
  type RawData,
  saveLastFile,
  type TreeData,
  type TreeRow,
  treeRows,
  TREE_LIMIT,
} from './filesmodel';
import { ICONS } from './icons';
import { renderMarkdown } from './markdown';
import { safeLocalStorage } from './prefs';
import { tr } from '../../../shared/i18n';

type Hljs = (typeof import('highlight.js/lib/core'))['default'];

/** Acima disto o realce fica desligado (um arquivo de 1 MB numa linha só travaria a janela). */
const HIGHLIGHT_MAX_CHARS = 400_000;

// ---------------------------------------------------------------- highlight.js sob demanda

let hljsLoading: Promise<Hljs | null> | null = null;

/** highlight.js só com o core e as linguagens da lista; null se o pedaço não carregou (cai em texto puro). */
function loadHighlighter(): Promise<Hljs | null> {
  hljsLoading ??= (async () => {
    try {
      const [core, javascript, typescript, json, markdown, sql, css, xml, yaml, bash, java, python, ini] = await Promise.all([
        import('highlight.js/lib/core'),
        import('highlight.js/lib/languages/javascript'),
        import('highlight.js/lib/languages/typescript'),
        import('highlight.js/lib/languages/json'),
        import('highlight.js/lib/languages/markdown'),
        import('highlight.js/lib/languages/sql'),
        import('highlight.js/lib/languages/css'),
        import('highlight.js/lib/languages/xml'),
        import('highlight.js/lib/languages/yaml'),
        import('highlight.js/lib/languages/bash'),
        import('highlight.js/lib/languages/java'),
        import('highlight.js/lib/languages/python'),
        import('highlight.js/lib/languages/ini'),
      ]);
      const hl = core.default;
      const langs: Record<Lang, (typeof javascript)['default']> = {
        javascript: javascript.default,
        typescript: typescript.default,
        json: json.default,
        markdown: markdown.default,
        sql: sql.default,
        css: css.default,
        xml: xml.default,
        yaml: yaml.default,
        bash: bash.default,
        java: java.default,
        python: python.default,
        ini: ini.default,
      };
      for (const [name, def] of Object.entries(langs)) hl.registerLanguage(name, def);
      return hl;
    } catch {
      hljsLoading = null;
      return null;
    }
  })();
  return hljsLoading;
}

// ---------------------------------------------------------------- API

type Failure = { ok: false; status: number; message: string };
type Result<T> = { ok: true; data: T } | Failure;

async function getJson<T>(kind: 'tree' | 'raw', room: string, path: string): Promise<Result<T>> {
  const url = `/api/files/${kind}?room=${encodeURIComponent(room)}&path=${encodeURIComponent(path)}`;
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // corpo que não é JSON (proxy fora do ar...)
    }
    if (res.ok && body && typeof body === 'object') return { ok: true, data: body as T };
    const msg = (body as { error?: unknown } | null)?.error;
    return { ok: false, status: res.status, message: typeof msg === 'string' && msg ? msg : tr('Não foi possível falar com o Habblaud.') };
  } catch {
    return { ok: false, status: 0, message: tr('Não foi possível falar com o Habblaud.') };
  }
}

// ---------------------------------------------------------------- ícones da árvore (pixel art própria, sem lib)

const FOLDER = ['.###....', '#####...', '########', '#......#', '#......#', '#......#', '########'];
const FILE = ['.####.', '.#..##', '.#...#', '.#...#', '.#...#', '.#...#', '.#####'];
const LINK = ['...####', '...#..#', '.....#.', '#...#..', '##.#...', '.###...', '..##...'];

function px(rows: readonly string[]): string {
  const w = Math.max(...rows.map((r) => r.length));
  let d = '';
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') d += `M${x} ${y}h1v1h-1z`;
  });
  return `<svg class="ui-files__ico" width="${w + 4}" height="${rows.length + 4}" viewBox="0 0 ${w} ${rows.length}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path fill="currentColor" d="${d}"/></svg>`;
}

const ROW_ICON = { dir: px(FOLDER), file: px(FILE), link: px(LINK) } as const;

// ---------------------------------------------------------------- viewer

type View =
  | { state: 'empty' }
  | { state: 'loading'; rel: string }
  | { state: 'text'; rel: string; size: number; text: string }
  | { state: 'note'; rel: string; size?: number; message: string; error?: boolean };

export interface PaneHost {
  /** Caminho absoluto da sala mostrada (para o "copiar caminho"). */
  rootPath(): string;
  /** Esc fora de qualquer campo: fecha a janela. */
  close(): void;
}

export class FilesPane {
  readonly el: HTMLElement;
  private room = '';
  private gen = 0;
  private dirs = new Map<string, DirState>();
  private open = new Set<string>();
  private filter = '';
  /** Pasta que o botão de recarregar atualiza: a última tocada (ou a do arquivo aberto). */
  private focusDir = '';
  private selected = '';
  private view: View = { state: 'empty' };
  private mdSource = false;
  private fileGen = 0;
  private storage = safeLocalStorage();

  private tree: HTMLElement;
  private filterInput: HTMLInputElement;
  private reloadBtn: HTMLButtonElement;
  private pathEl: HTMLElement;
  private sizeEl: HTMLElement;
  private mdBtn: HTMLButtonElement;
  private copyBtn: HTMLButtonElement;
  private copyTimer: ReturnType<typeof setTimeout> | null = null;
  private content: HTMLElement;
  private noteEl: HTMLElement;

  constructor(private host: PaneHost) {
    this.filterInput = h('input', { class: 'ui-files__filter', type: 'search', attrs: { placeholder: tr('Filtrar por nome'), 'aria-label': tr('Filtrar por nome'), autocomplete: 'off', spellcheck: 'false' } });
    this.filterInput.addEventListener('input', () => {
      this.filter = this.filterInput.value;
      this.renderTree();
    });
    this.filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.filterInput.value) {
        e.stopPropagation();
        this.filterInput.value = '';
        this.filter = '';
        this.renderTree();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.tree.querySelector<HTMLElement>('.ui-files__row')?.focus();
      }
    });
    this.reloadBtn = iconButton('↻', tr('Recarregar a pasta'), () => this.reload(), 'ui-icon-btn--sm ui-files__reload');
    this.tree = h('div', { class: 'ui-files__tree', role: 'tree', attrs: { 'aria-label': tr('Árvore de arquivos') } });
    this.tree.addEventListener('click', (e) => this.onTreeClick(e));
    this.tree.addEventListener('keydown', (e) => this.onTreeKey(e));
    const side = h('div', { class: 'ui-files__side' }, h('div', { class: 'ui-files__tools' }, this.filterInput, this.reloadBtn), this.tree);

    this.pathEl = h('span', { class: 'ui-files__path' });
    this.sizeEl = h('span', { class: 'ui-files__size' });
    this.mdBtn = h('button', { class: 'ui-btn ui-files__md-toggle', type: 'button', hidden: true, on: { click: () => this.toggleMarkdown() } });
    this.copyBtn = iconButton(ICONS.copy, tr('Copiar caminho'), () => void this.copyPath(), 'ui-icon-btn--sm');
    this.copyBtn.hidden = true;
    const bar = h('div', { class: 'ui-files__viewbar' }, this.pathEl, this.sizeEl, this.mdBtn, this.copyBtn);
    this.content = h('div', { class: 'ui-files__content' });
    this.noteEl = h('p', { class: 'ui-files__msg' });
    const view = h('div', { class: 'ui-files__view' }, bar, this.content);

    this.el = h('div', { class: 'ui-files__body' }, side, view);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        this.host.close();
      }
    });
    void this.renderViewer();
  }

  // ------------------------------------------------------------ sala

  /** Mostra os arquivos de outra sala (a mesma sala não recarrega nada). */
  setRoom(id: string): void {
    if (id === this.room) return;
    this.room = id;
    this.gen++;
    this.fileGen++;
    this.dirs = new Map();
    this.open = new Set();
    this.filter = '';
    this.filterInput.value = '';
    this.focusDir = '';
    this.selected = '';
    this.view = { state: 'empty' };
    this.updateReloadTitle();
    this.renderTree();
    void this.renderViewer();
    void this.loadDir('').then(() => {
      if (this.room !== id) return;
      const last = loadLastFile(this.storage, id);
      if (last) void this.openFile(last, { restoring: true });
    });
  }

  focus(): void {
    this.filterInput.focus({ preventScroll: true });
  }

  // ------------------------------------------------------------ árvore

  private async loadDir(path: string, force = false): Promise<void> {
    const cur = this.dirs.get(path);
    if (!force && (cur?.state === 'ready' || cur?.state === 'loading')) return;
    const room = this.room;
    const gen = this.gen;
    // Recarregando uma pasta que já está na tela: mantém a lista antiga até a nova chegar.
    if (!(force && cur?.state === 'ready')) {
      this.dirs.set(path, { state: 'loading' });
      this.renderTree();
    }
    const r = await getJson<TreeData>('tree', room, path);
    if (gen !== this.gen) return;
    if (r.ok) this.dirs.set(path, { state: 'ready', data: r.data });
    else this.dirs.set(path, { state: 'error', status: r.status, message: path === '' && r.status === 404 ? tr('Só as salas fixas têm arquivos para ver.') : r.status === 403 && path !== '' ? tr('bloqueado (segredo)') : r.message });
    this.renderTree();
  }

  private toggleDir(path: string): void {
    this.focusDir = path;
    this.updateReloadTitle();
    if (this.open.has(path)) {
      this.open.delete(path);
      this.renderTree();
    } else {
      this.open.add(path);
      void this.loadDir(path);
      this.renderTree();
    }
  }

  private reload(): void {
    void this.loadDir(this.focusDir, true);
    if (this.selected) void this.openFile(this.selected, { keepScroll: true });
  }

  private updateReloadTitle(): void {
    const label = tr('Recarregar a pasta: {0}', [this.focusDir || '/']);
    this.reloadBtn.title = label;
    this.reloadBtn.setAttribute('aria-label', label);
  }

  private renderTree(): void {
    const active = document.activeElement instanceof HTMLElement && this.tree.contains(document.activeElement) ? document.activeElement.dataset.path : undefined;
    const rows = treeRows(this.dirs, this.open, this.filter);
    const frag = document.createDocumentFragment();
    for (const r of rows) frag.append(this.rowEl(r));
    if (this.filter.trim() && rows.length === 0 && this.dirs.get('')?.state === 'ready') frag.append(h('p', { class: 'ui-files__note', text: tr('Nada com esse nome entre o que já foi carregado.') }));
    this.tree.replaceChildren(frag);
    if (active !== undefined) this.tree.querySelector<HTMLElement>(`[data-path="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
  }

  private rowEl(r: TreeRow): HTMLElement {
    const pad = `--depth:${r.depth}`;
    if (r.type !== 'entry') {
      const text = r.type === 'error' ? r.message : r.type === 'loading' ? tr('carregando…') : r.type === 'empty' ? tr('pasta vazia') : tr('lista cortada em {0}', [TREE_LIMIT]);
      return h('div', { class: `ui-files__note${r.type === 'error' ? ' is-error' : ''}`, style: pad, text });
    }
    const dir = r.kind === 'dir' && !r.blocked;
    const caret = h('span', { class: 'ui-files__caret', text: dir ? (r.open ? '▾' : '▸') : '', attrs: { 'aria-hidden': 'true' } });
    const ico = h('span', { class: 'ui-files__icon', attrs: { 'aria-hidden': 'true' } });
    ico.innerHTML = r.blocked ? ICONS.lock : ROW_ICON[r.kind];
    const row = h(
      'button',
      {
        class: 'ui-files__row',
        type: 'button',
        role: 'treeitem',
        style: pad,
        title: r.blocked ? tr('bloqueado (segredo)') : r.path,
        tabIndex: -1,
        attrs: {
          'data-path': r.path,
          'data-kind': r.kind,
          'aria-level': r.depth + 1,
          'aria-expanded': dir ? String(r.open) : undefined,
          'aria-selected': r.kind !== 'dir' && r.path === this.selected ? 'true' : undefined,
          'aria-disabled': r.blocked ? 'true' : undefined,
        },
      },
      caret,
      ico,
      h('span', { class: 'ui-files__name', text: r.name }),
      r.type === 'entry' && r.kind === 'file' && r.size !== undefined && !r.blocked ? h('span', { class: 'ui-files__fsize', text: formatBytes(r.size) }) : null,
    );
    if (r.blocked) row.classList.add('is-blocked');
    if (r.kind !== 'dir' && r.path === this.selected) row.classList.add('is-selected');
    return row;
  }

  private onTreeClick(e: MouseEvent): void {
    const row = (e.target as Element | null)?.closest<HTMLElement>('.ui-files__row');
    if (!row || !this.tree.contains(row)) return;
    const path = row.dataset.path ?? '';
    if (row.classList.contains('is-blocked')) return;
    if (row.dataset.kind === 'dir') this.toggleDir(path);
    else {
      this.focusDir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      this.updateReloadTitle();
      void this.openFile(path);
    }
  }

  private onTreeKey(e: KeyboardEvent): void {
    const row = (e.target as Element | null)?.closest<HTMLElement>('.ui-files__row');
    if (!row) return;
    const rows = [...this.tree.querySelectorAll<HTMLElement>('.ui-files__row')];
    const i = rows.indexOf(row);
    const isDir = row.dataset.kind === 'dir' && !row.classList.contains('is-blocked');
    const path = row.dataset.path ?? '';
    const go = (el: HTMLElement | undefined) => {
      if (!el) return;
      e.preventDefault();
      el.focus();
    };
    switch (e.key) {
      case 'ArrowDown':
        go(rows[i + 1]);
        break;
      case 'ArrowUp':
        if (i === 0) {
          e.preventDefault();
          this.filterInput.focus();
        } else go(rows[i - 1]);
        break;
      case 'ArrowRight':
        if (isDir && !this.open.has(path)) {
          e.preventDefault();
          this.toggleDir(path);
        } else go(rows[i + 1]);
        break;
      case 'ArrowLeft':
        if (isDir && this.open.has(path)) {
          e.preventDefault();
          this.toggleDir(path);
        } else if (path.includes('/')) go(this.tree.querySelector<HTMLElement>(`[data-path="${CSS.escape(path.slice(0, path.lastIndexOf('/')))}"]`) ?? undefined);
        break;
      case 'Home':
        go(rows[0]);
        break;
      case 'End':
        go(rows[rows.length - 1]);
        break;
    }
  }

  // ------------------------------------------------------------ arquivo

  private async openFile(rel: string, opts: { restoring?: boolean; keepScroll?: boolean } = {}): Promise<void> {
    const room = this.room;
    const id = ++this.fileGen;
    this.selected = rel;
    const scroll = opts.keepScroll ? this.content.scrollTop : 0;
    this.view = { state: 'loading', rel };
    // Abre as pastas do caminho (arquivo lembrado de outra visita) para ele aparecer na árvore.
    for (const dir of ancestors(rel)) {
      this.open.add(dir);
      void this.loadDir(dir);
    }
    this.renderTree();
    void this.renderViewer();
    const r = await getJson<RawData>('raw', room, rel);
    if (id !== this.fileGen || room !== this.room) return;
    if (!r.ok) {
      if (opts.restoring) {
        // O arquivo lembrado sumiu ou ficou protegido: volta ao "escolha um arquivo".
        this.selected = '';
        this.view = { state: 'empty' };
      } else {
        const message = r.status === 403 ? tr('bloqueado (segredo)') : r.message;
        this.view = { state: 'note', rel, message, error: true };
      }
    } else {
      const d = r.data;
      saveLastFile(this.storage, room, rel);
      if ('text' in d) this.view = { state: 'text', rel, size: d.size, text: d.text };
      else if ('binary' in d) this.view = { state: 'note', rel, size: d.size, message: tr('arquivo binário, não exibido') };
      else this.view = { state: 'note', rel, size: d.size, message: tr('maior que 1 MB') };
    }
    this.renderTree();
    await this.renderViewer();
    if (scroll && id === this.fileGen) this.content.scrollTop = scroll;
  }

  private toggleMarkdown(): void {
    this.mdSource = !this.mdSource;
    void this.renderViewer();
  }

  private async copyPath(): Promise<void> {
    const rel = this.view.state === 'empty' ? '' : this.view.rel;
    if (!rel) return;
    const ok = await copyText(absolutePath(this.host.rootPath(), rel));
    this.copyBtn.innerHTML = ok ? ICONS.check : ICONS.copy;
    this.copyBtn.title = ok ? tr('Copiado!') : tr('Não foi possível copiar');
    if (this.copyTimer) clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => {
      this.copyBtn.innerHTML = ICONS.copy;
      this.copyBtn.title = tr('Copiar caminho');
    }, 1400);
  }

  private async renderViewer(): Promise<void> {
    const v = this.view;
    const id = this.fileGen;
    const rel = v.state === 'empty' ? '' : v.rel;
    setText(this.pathEl, rel);
    this.pathEl.title = rel ? absolutePath(this.host.rootPath(), rel) : '';
    setText(this.sizeEl, v.state === 'text' || (v.state === 'note' && v.size !== undefined) ? formatBytes(v.size ?? 0) : '');
    setHidden(this.copyBtn, !rel);
    const md = v.state === 'text' && isMarkdown(rel);
    setHidden(this.mdBtn, !md);
    if (md) setText(this.mdBtn, this.mdSource ? tr('Ver renderizado') : tr('Ver fonte'));

    if (v.state === 'empty' || v.state === 'loading' || v.state === 'note') {
      this.noteEl.className = `ui-files__msg${v.state === 'note' && v.error ? ' is-error' : ''}`;
      setText(this.noteEl, v.state === 'empty' ? tr('Escolha um arquivo na árvore.') : v.state === 'loading' ? tr('carregando…') : v.message);
      this.content.replaceChildren(this.noteEl);
      return;
    }
    if (md && !this.mdSource) {
      const box = h('div', { class: 'ui-md ui-files__md' });
      box.append(renderMarkdown(v.text));
      this.content.replaceChildren(box);
      return;
    }
    const lang = languageOf(rel);
    const big = v.text.length > HIGHLIGHT_MAX_CHARS;
    const hl = lang && !big ? await loadHighlighter() : null;
    // Outro arquivo (ou outra sala) foi aberto enquanto o realce carregava.
    if (id !== this.fileGen) return;
    this.content.replaceChildren(this.codeEl(v.text, hl && lang ? this.highlight(hl, lang, v.text) : null, big));
  }

  /** HTML escapado do highlight.js, ou null se o realce falhar (o texto entra puro). */
  private highlight(hl: Hljs, lang: Lang, text: string): string | null {
    try {
      return hl.highlight(text, { language: lang, ignoreIllegals: true }).value;
    } catch {
      return null;
    }
  }

  private codeEl(text: string, html: string | null, big: boolean): HTMLElement {
    const n = lineCount(text);
    const nums = h('pre', { class: 'ui-files__nums', attrs: { 'aria-hidden': 'true' } });
    nums.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
    const code = h('code', { class: 'ui-files__codetext hljs' });
    // `html` é a saída do highlight.js (já escapada); sem ela, o texto entra como texto.
    if (html !== null) code.innerHTML = html;
    else code.textContent = text;
    const wrap = h('div', { class: 'ui-files__code' }, nums, h('pre', { class: 'ui-files__src' }, code));
    if (!big) return wrap;
    return h('div', {}, h('p', { class: 'ui-files__note', text: tr('realce desligado (arquivo grande)') }), wrap);
  }
}
