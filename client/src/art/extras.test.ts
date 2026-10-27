// Peças só do escritório local (shared/look-extras.ts): figura (poção), capuz e estampa de teia.
import { describe, expect, it } from 'vitest';
import type { LookExtras } from '../../../shared/look-extras';
import { appearanceFromSeed as pureFromSeed, appearanceKey } from './character/appearance';
import { FIGURE_AVATAR_CROP, FIGURE_H, FIGURE_W, POTION_LIQUID, renderFigure } from './character/figure';
import { CHAR_AX, CHAR_AY, CHAR_H, CHAR_W, POSE_FRAMES, SEAT_DROP, renderCharacter } from './character/render';
import type { Appearance, Dir, Pose } from './api';
import { appearanceFromSeed } from './index';
import type { PixelBuf } from './core/pixbuf';

const DIRS: Dir[] = ['down', 'left', 'up', 'right'];
const POSES_FOR_TEST = Object.keys(POSE_FRAMES) as Pose[];
const POTION: LookExtras = { figure: 'potion', figureColor: '#c4162c' };
const potion = (seed = 8822): Appearance => appearanceFromSeed(seed, { look: 'm', extras: POTION });

function digest(buf: PixelBuf): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.data.length; i++) h = Math.imul(h ^ buf.data[i], 0x01000193);
  return String(h >>> 0);
}
function count(buf: PixelBuf, test: (r: number, g: number, b: number) => boolean, rect = { x: 0, y: 0, w: buf.w, h: buf.h }): number {
  let n = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      const i = (y * buf.w + x) * 4;
      if (buf.data[i + 3] >= 200 && test(buf.data[i], buf.data[i + 1], buf.data[i + 2])) n++;
    }
  }
  return n;
}
const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const exact = (c: string) => {
  const [r, g, b] = hex(c);
  return (rr: number, gg: number, bb: number) => rr === r && gg === g && bb === b;
};

describe('appearanceFromSeed com extras', () => {
  it('extras entram na aparência; vazio ou ausente não deixam rastro (o TCR segue igual)', () => {
    const plain = appearanceFromSeed(1203, { look: 'm' });
    expect('extras' in plain).toBe(false);
    expect('extras' in appearanceFromSeed(1203, { look: 'm', extras: {} })).toBe(false);
    expect(appearanceFromSeed(1203, { look: 'm', extras: {} })).toEqual(pureFromSeed(1203, { look: 'm' }));
    expect(appearanceFromSeed(1203, { look: 'm', extras: { pattern: 'web' } }).extras).toEqual({ pattern: 'web' });
  });

  it('a chave de cache muda com os extras (e só com eles)', () => {
    const base = pureFromSeed(5, { look: 'm' });
    const withX = { ...base, extras: { headgear: 'hood_mask' as const } };
    expect(appearanceKey(withX)).not.toBe(appearanceKey(base));
    expect(appearanceKey({ ...base })).toBe(appearanceKey(base));
    expect(appearanceKey({ ...withX, extras: { headgear: 'hood_mask', headgearColor: '#d42a31' } })).not.toBe(appearanceKey(withX));
  });

  it('sem extras o desenho é idêntico ao de antes (mesmos bytes)', () => {
    for (const seed of [1203, 4471, 3307]) {
      const a = pureFromSeed(seed, { look: 'm' });
      const b = appearanceFromSeed(seed, { look: 'm' });
      for (const dir of DIRS) {
        expect(digest(renderCharacter({ appearance: b, dir, pose: 'stand', frame: 0 }).buf)).toBe(digest(renderCharacter({ appearance: a, dir, pose: 'stand', frame: 0 }).buf));
      }
    }
  });
});

describe('figura: poção', () => {
  it('mesma folha e âncora do personagem, em todas as poses, direções e quadros', () => {
    expect([FIGURE_W, FIGURE_H]).toEqual([CHAR_W, CHAR_H]);
    expect(SEAT_DROP).toBe(4); // figure.ts guarda uma cópia: mudou aqui, mude lá
    const a = potion();
    for (const pose of POSES_FOR_TEST) {
      for (const dir of DIRS) {
        for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
          for (const seated of [false, true]) {
            const s = renderCharacter({ appearance: a, dir, pose, frame, seated });
            expect([s.buf.w, s.buf.h, s.ax, s.ay]).toEqual([CHAR_W, CHAR_H, CHAR_AX, CHAR_AY]);
            expect(s.buf.countOpaque()).toBeGreaterThan(120);
            const box = s.buf.bounds()!;
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.y).toBeGreaterThanOrEqual(0);
            expect(box.x + box.w).toBeLessThanOrEqual(CHAR_W);
            expect(box.y + box.h).toBeLessThanOrEqual(CHAR_H);
          }
        }
      }
    }
  });

  it('é vermelha (líquido), tem cortiça e brilho rosado; a cor do líquido é a pedida', () => {
    const s = renderCharacter({ appearance: potion(), dir: 'down', pose: 'stand', frame: 0 });
    const red = count(s.buf, (r, g, b) => r > 150 && g < 60 && b < 80);
    const cork = count(s.buf, (r, g, b) => r > 140 && g > 100 && b > 40 && r > g + 25 && g > b + 25 && !(r > 200 && g < 90));
    expect(red).toBeGreaterThan(60);
    expect(cork).toBeGreaterThan(5);
    let glow = 0;
    for (let i = 0; i < s.buf.data.length; i += 4) if (s.buf.data[i + 3] > 0 && s.buf.data[i + 3] < 100 && s.buf.data[i] > 200 && s.buf.data[i + 1] < 160) glow++;
    expect(glow).toBeGreaterThan(30);
    const blue = renderCharacter({ appearance: appearanceFromSeed(1, { extras: { figure: 'potion', figureColor: '#1c4fd0' } }), dir: 'down', pose: 'stand', frame: 0 });
    expect(count(blue.buf, (r, g, b) => b > 150 && r < 60)).toBeGreaterThan(60);
    expect(count(blue.buf, (r, g, b) => r > 150 && g < 60 && b < 80)).toBe(0);
    expect(POTION_LIQUID).toBe('#c4162c');
  });

  it('não depende do personagem: semente, look e peças não mudam o desenho', () => {
    const one = renderCharacter({ appearance: potion(1), dir: 'down', pose: 'stand', frame: 0 });
    const other = renderCharacter({ appearance: { ...appearanceFromSeed(99999, { look: 'f', parts: { hairStyle: 'afro', skin: '#5a3623' }, extras: POTION }) }, dir: 'down', pose: 'stand', frame: 0 });
    expect(digest(other.buf)).toBe(digest(one.buf));
  });

  it('quica em vez de andar: os quadros do passo diferem e sobem do chão; sentado desce até o assento', () => {
    const a = potion();
    const topOf = (pose: 'walk' | 'stand' | 'sit', frame: number, seated = false) => renderFigure({ appearance: a, dir: 'down', pose, frame }, seated).buf.crop(0, 0, CHAR_W, 20).bounds()!.y;
    expect(topOf('walk', 1)).toBeLessThan(topOf('walk', 0));
    expect(topOf('walk', 2)).toBe(topOf('walk', 0));
    expect(topOf('stand', 1)).toBeLessThan(topOf('stand', 0));
    expect(topOf('sit', 0, true)).toBeGreaterThan(topOf('stand', 0));
    const frames = [0, 1, 2, 3].map((f) => digest(renderFigure({ appearance: a, dir: 'down', pose: 'walk', frame: f }, false).buf));
    expect(new Set(frames).size).toBe(2);
  });

  it('o avatar (recorte 20x20) mostra a figura inteira', () => {
    const s = renderCharacter({ appearance: potion(), dir: 'down', pose: 'stand', frame: 0 });
    const c = FIGURE_AVATAR_CROP;
    expect([c.w, c.h]).toEqual([20, 20]);
    let inside = 0;
    let outside = 0;
    for (let y = 0; y < s.buf.h; y++) {
      for (let x = 0; x < s.buf.w; x++) {
        if (s.buf.alpha(x, y) < 160) continue; // a sombra e o brilho (translúcidos) podem passar do recorte
        if (x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h) inside++;
        else outside++;
      }
    }
    expect(inside).toBeGreaterThan(150);
    expect(outside).toBe(0);
  });
});

describe('capuz e estampa de teia (peças do Homem-Aranha)', () => {
  const HOOD: LookExtras = { headgear: 'hood_mask', headgearColor: '#d42a31', pattern: 'web', patternColor: '#6e0f1b' };
  const suit = { skin: '#cf2a30', top: '#d42a31', topAccent: '#2f56b8', topStyle: 'sweater' as const, bottom: '#2f56b8', shoes: '#d42a31', hairStyle: 'afro' as const, hair: '#2bd0d0', accessory: 'sunglasses' as const, facialHair: 'beard' as const };
  const hooded = (extras: LookExtras | undefined) => appearanceFromSeed(4471, { look: 'm', parts: suit, extras });
  const draw = (a: Appearance, dir: Dir = 'down', pose: 'stand' | 'walk' = 'stand') => renderCharacter({ appearance: a, dir, pose, frame: 0 }).buf;

  it('o capuz cobre cabelo, barba e óculos e desenha olhos brancos grandes', () => {
    const bare = draw(hooded(undefined));
    const mask = draw(hooded({ headgear: 'hood_mask', headgearColor: '#d42a31' }));
    const head = { x: 4, y: 3, w: 16, h: 16 };
    expect(count(bare, exact('#2bd0d0'), head) + count(bare, (r, g, b) => r > 30 && r < 80 && g < 60 && b < 60, head)).toBeGreaterThan(0);
    expect(count(mask, (r, g, b) => g > 190 && b > 190 && r > 150 && b > g - 5, head)).toBeGreaterThanOrEqual(10); // lentes brancas
    expect(count(mask, (r, g, b) => r > 150 && g < 70 && b < 80, head)).toBeGreaterThan(60); // capuz vermelho
    // nenhum pixel do cabelo colorido sobra
    expect(count(mask, (r, g, b) => Math.abs(r - 0x2b) < 14 && Math.abs(g - 0xd0) < 22 && Math.abs(b - 0xd0) < 22, head)).toBe(0);
  });

  it('funciona nas 4 direções, em todas as poses; só muda o desenho, nunca o tamanho', () => {
    const a = hooded(HOOD);
    const plain = hooded(undefined);
    for (const dir of DIRS) {
      for (const pose of POSES_FOR_TEST) {
        const s = renderCharacter({ appearance: a, dir, pose, frame: 0 });
        expect([s.buf.w, s.buf.h, s.ax, s.ay]).toEqual([CHAR_W, CHAR_H, CHAR_AX, CHAR_AY]);
        expect(digest(s.buf)).not.toBe(digest(renderCharacter({ appearance: plain, dir, pose, frame: 0 }).buf));
      }
    }
  });

  it('a lente aparece de frente e de perfil, e some de costas', () => {
    const white = (b: PixelBuf) => count(b, (r, g, bb) => r > 235 && g > 235 && bb > 235);
    expect(white(draw(hooded(HOOD), 'down'))).toBeGreaterThanOrEqual(10);
    expect(white(draw(hooded(HOOD), 'left'))).toBeGreaterThanOrEqual(5);
    expect(white(draw(hooded(HOOD), 'up'))).toBe(0);
  });

  it('a teia entra na roupa de cima (e só onde há roupa) com a cor pedida', () => {
    const torso = { x: 7, y: 17, w: 10, h: 8 };
    const off = draw(hooded({ headgear: 'hood_mask' }));
    const on = draw(hooded(HOOD));
    expect(count(off, exact('#6e0f1b'), torso)).toBe(0);
    expect(count(on, exact('#6e0f1b'), torso)).toBeGreaterThan(6);
    // fora do corpo (fundo transparente) nada é pintado
    for (const dir of DIRS) {
      const buf = draw(hooded({ pattern: 'web', patternColor: '#00ff00' }), dir);
      const base = draw(hooded(undefined), dir);
      for (let i = 3; i < buf.data.length; i += 4) if (base.data[i] === 0) expect(buf.data[i]).toBe(0);
    }
  });

  it('a estampa sozinha (sem capuz) não esconde o cabelo', () => {
    const only = draw(hooded({ pattern: 'web' }));
    const head = { x: 4, y: 3, w: 16, h: 16 };
    expect(count(only, (r, g, b) => Math.abs(r - 0x2b) < 14 && Math.abs(g - 0xd0) < 22 && Math.abs(b - 0xd0) < 22, head)).toBeGreaterThan(10);
  });
});
