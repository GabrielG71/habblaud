// Nome de branch aceito para uma nova worktree (server/pty/worktree.ts revalida; o navegador só avisa antes).
// Sem '-' ou '.' no começo, sem '..', '//', '@{', '.lock', espaço nem metacaractere de shell.
export const BRANCH_RE = /^(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock(?:\/|$))(?!.*\/\.)(?!.*[\/.]$)[A-Za-z0-9_][A-Za-z0-9._\/-]{0,79}$/;

export function validBranch(b: unknown): b is string {
  return typeof b === 'string' && b !== 'HEAD' && BRANCH_RE.test(b);
}
