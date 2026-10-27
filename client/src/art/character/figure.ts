// Figuras não humanas (puro: desenha num PixelBuf). Uma figura ocupa o lugar do personagem inteiro, na mesma folha de
// 24x34 px e com a mesma âncora (12, 31), então cena, lista, gaveta e dica a desenham sem caso especial. Por ora só a
// poção: frasco de vidro redondo, líquido com bolhinhas, gargalo e rolha de cortiça, brilho rosado em volta.
import type { CharacterFrameRequest, Pose } from '../api';
import { mix, ramp, shade } from '../core/color';
import { PixelBuf } from '../core/pixbuf';
import type { BufSprite } from '../core/sprite';

// Mesmas medidas de CHAR_* e SEAT_DROP de render.ts (que importa este arquivo, então não dá para importar de volta;
// art.test.ts confere que não se separam).
export const FIGURE_W = 24;
export const FIGURE_H = 34;
const AX = 12;
const AY = 31;
const SEAT_DROP = 4;

/** Cor padrão do líquido. */
export const POTION_LIQUID = '#c4162c';

/** Recorte do avatar (busto) de uma figura: a figura inteira, em 20x20 como o busto de um personagem. */
export const FIGURE_AVATAR_CROP = { x: 2, y: 11, w: 20, h: 20 } as const;

/** Quanto a figura sobe em cada quadro da pose (o frasco quica no lugar de mexer pernas e braços). */
function hop(pose: Pose, frame: number): number {
  switch (pose) {
    case 'walk':
      return [0, 2, 0, 2][frame % 4];
    case 'run':
      return [0, 3, 0, 3][frame % 4];
    case 'cheer':
    case 'laugh':
    case 'stretch':
    case 'raise_hand':
    case 'play':
    case 'game':
      return frame % 2 ? 2 : 0;
    case 'sulk':
    case 'sleep':
      return 0;
    default:
      return frame % 2 ? 1 : 0;
  }
}

const CX = 12; // centro do frasco em x
const CY = 23; // centro do corpo (a elipse) em y
const RX = 7.5;
const RY = 6.5;
const SURFACE = 21; // linha da superfície do líquido

function insideBody(x: number, y: number, grow = 0): boolean {
  const nx = (x + 0.5 - CX) / (RX + grow);
  const ny = (y + 0.5 - CY) / (RY + grow);
  return nx * nx + ny * ny <= 1;
}

export function renderFigure(req: CharacterFrameRequest, seated: boolean): BufSprite {
  const extras = req.appearance.extras;
  const liquid = ramp(extras?.figureColor ?? POTION_LIQUID, 0.09);
  const frame = Math.max(0, Math.floor(req.frame));
  // Sentado, o frasco desce até o assento; em pé, o quique tira ele do chão e a sombra encolhe.
  const up = seated ? -(SEAT_DROP - 1) : hop(req.pose, frame);
  const b = new PixelBuf(FIGURE_W, FIGURE_H);
  b.oy = -up;

  const glass = 'rgba(247,218,228,0.72)';
  const glassEdge = '#ecc8d4';
  // Vidro: o corpo inteiro; o líquido vai por cima, da superfície para baixo.
  for (let y = 15; y <= 30; y++) {
    for (let x = 3; x <= 21; x++) {
      if (!insideBody(x, y)) continue;
      const edge = !insideBody(x, y, -1.15);
      if (y < SURFACE) {
        b.set(x, y, edge ? glassEdge : glass);
        continue;
      }
      const nx = (x + 0.5 - CX) / RX;
      const ny = (y + 0.5 - CY) / RY;
      const d = nx * nx + ny * ny;
      let c = liquid.base;
      if (y === SURFACE) c = liquid.lt; // menisco
      else if (d > 0.62 && nx + ny > 0.35) c = liquid.dk; // sombra embaixo e à direita
      else if (d > 0.62 && nx + ny < -0.3) c = liquid.lt; // luz em cima e à esquerda
      if (d > 0.9 && nx + ny > 0.2) c = liquid.dd;
      if (edge && y > SURFACE && nx + ny < 0.2) c = mix(c, '#f4c9d3', 0.28); // vidro por cima do líquido
      b.set(x, y, c);
    }
  }
  // Gargalo: borda do vidro (lábio) e o pescoço.
  b.rect(8, 15, 8, 1, glassEdge);
  b.rect(10, 16, 4, 2, glass);
  b.set(10, 16, glassEdge);
  b.set(10, 17, glassEdge);
  b.set(13, 16, shade(glassEdge, -0.12));
  b.set(13, 17, shade(glassEdge, -0.12));
  // Rolha de cortiça: larga em cima, afunila ao entrar no gargalo.
  const cork = ramp('#c99b5c', 0.09);
  b.rect(9, 12, 6, 2, cork.base);
  b.rect(10, 14, 4, 1, cork.dk);
  b.hline(9, 14, 12, cork.lt);
  b.set(14, 13, cork.dk);
  b.set(14, 12, cork.base);
  const pore = shade(cork.dd, -0.08);
  b.set(10, 13, pore);
  b.set(12, 12, pore);
  b.set(13, 13, pore);

  // Bolhas: no líquido (fixas, uma troca de lugar a cada quadro) e uma subindo no ar do frasco.
  const bubble = mix(liquid.hi, '#ffffff', 0.35);
  const spot = mix(liquid.lt, '#ffffff', 0.15);
  const wob = frame % 2;
  b.set(9, 24, bubble);
  b.set(14, 23 + wob, bubble);
  b.set(11, 26, spot);
  b.set(15, 26 - wob, spot);
  b.set(8, 22 + wob, spot);
  b.set(12, 28 - wob, bubble);
  b.set(11, 19 - wob, 'rgba(255,236,242,0.9)');
  b.set(13, 18 + wob * 0, 'rgba(255,236,242,0.7)');

  // Brilhos: arco grande em cima à esquerda e um ponto embaixo à direita.
  const shine = 'rgba(255,255,255,0.85)';
  b.set(6, 21, shine);
  b.set(6, 20, shine);
  b.set(7, 19, shine);
  b.set(7, 18, shine);
  b.set(8, 17, 'rgba(255,255,255,0.7)');
  b.set(9, 17, 'rgba(255,255,255,0.55)');
  b.set(17, 27, 'rgba(255,255,255,0.7)');
  b.set(16, 28, 'rgba(255,255,255,0.5)');

  b.outline();
  b.oy = 0;
  // Brilho rosado em volta (por cima do contorno, só em pixels vazios).
  const glow = new PixelBuf(FIGURE_W, FIGURE_H);
  for (let y = 0; y < FIGURE_H; y++) {
    for (let x = 0; x < FIGURE_W; x++) {
      if (b.alpha(x, y) >= 160) continue;
      let best = 9;
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (b.alpha(x + dx, y + dy) >= 160) best = Math.min(best, Math.hypot(dx, dy));
        }
      }
      if (best <= 3) glow.set(x, y, `rgba(255,120,160,${(0.3 * (1 - (best - 1) / 2.4)).toFixed(3)})`);
    }
  }
  glow.draw(b, 0, 0);
  if (!seated) glow.shadow(AX, AY - 0.5, up ? 4 : 6, 2, '#1c2034', up ? 0.14 : 0.2);
  return { buf: glow, ax: AX, ay: AY };
}
