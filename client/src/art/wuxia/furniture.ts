// Móveis no estilo giang hồ (wuxia), puros (PixelBuf). Cada móvel parte do sprite moderno (mesmo tamanho, âncora e
// regiões dinâmicas, então caminhos, assentos, telas e luzes continuam no lugar) e:
//  - por padrão troca o material: plástico, metal e laminado (cores neutras) viram madeira laqueada; o que tem cor
//    (estofados, livros) fica, só um pouco mais quente;
//  - os objetos que denunciam o escritório moderno são redesenhados do zero na mesma caixa: plantas viram bambu e
//    bonsai, o bebedouro vira jarras de vinho, a cafeteira vira um fogareiro com bule, a luminária vira lanterna, a
//    máquina de lanches vira o armário de ervas, divisórias de vidro viram biombos de treliça com papel, pôsteres e
//    quadros viram rolos de caligrafia e de paisagem a nanquim.
import type { FurnitureKind } from '../api';
import { parseColor, rgbToHsl } from '../core/color';
import { PixelBuf } from '../core/pixbuf';
import type { BufFurniture, BufSprite } from '../core/sprite';
import { renderFurniture } from '../furniture/index';

const WOOD_STOPS = ['#24160f', '#3e2617', '#5e3a22', '#7f5131', '#a06a40', '#c08a56', '#d9ab74'] as const;
const WOOD_RGB = WOOD_STOPS.map((c) => parseColor(c));

export const LACQUER = '#8e2f2a';
export const LACQUER_DK = '#5e1c19';
export const GOLD = '#d9b95a';
export const PAPER = '#efe6cf';
export const INK = '#2a2420';

/** Madeira pela luminosidade (0..1), interpolando os tons de WOOD_STOPS. */
function woodAt(l: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (l - 0.08) / 0.87)) * (WOOD_RGB.length - 1);
  const i = Math.min(WOOD_RGB.length - 2, Math.floor(t));
  const k = t - i;
  const a = WOOD_RGB[i]!;
  const b = WOOD_RGB[i + 1]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function copy(src: PixelBuf): PixelBuf {
  const b = new PixelBuf(src.w, src.h);
  b.data.set(src.data);
  return b;
}

/**
 * Troca o material do sprite. `paperGlass`: vidro azulado vira papel de arroz com treliça de madeira (biombos).
 * Pixels neutros viram madeira; os quase pretos (contorno) ficam marrom-escuros; os coloridos esquentam um pouco.
 */
export function rematerial(src: PixelBuf, opts: { paperGlass?: boolean } = {}): PixelBuf {
  const b = copy(src);
  const d = b.data;
  const warm = parseColor('#7a4a2a');
  const paper = parseColor(PAPER);
  const lattice = parseColor('#6e4128');
  for (let y = 0; y < b.h; y++) {
    for (let x = 0; x < b.w; x++) {
      const i = (y * b.w + x) * 4;
      const a = d[i + 3]!;
      if (!a) continue;
      const r = d[i]!, g = d[i + 1]!, bl = d[i + 2]!;
      const [h, s, l] = rgbToHsl(r, g, bl);
      let out: [number, number, number];
      const glassy = opts.paperGlass && ((h >= 170 && h <= 240 && s > 0.12 && l > 0.5) || a < 250);
      if (glassy) {
        const grid = x % 4 === 1 || y % 5 === 2;
        const c = grid ? lattice : paper;
        out = [c[0], c[1], c[2]];
        d[i + 3] = 255;
      } else if (l < 0.17) {
        out = [36 + l * 60, 22 + l * 40, 15 + l * 30];
      } else if (s < 0.26 || (l > 0.86 && s < 0.45)) {
        out = woodAt(l);
      } else {
        out = [r + (warm[0] - r) * 0.14, g + (warm[1] - g) * 0.14, bl + (warm[2] - bl) * 0.14];
      }
      d[i] = out[0];
      d[i + 1] = out[1];
      d[i + 2] = out[2];
    }
  }
  return b;
}

function sprite(base: BufSprite, buf: PixelBuf, keepRects = true): BufSprite {
  return { buf, ax: base.ax, ay: base.ay, rects: keepRects ? base.rects : undefined };
}

/** Variação determinística pequena (0..n-1) a partir da seed. */
const vary = (seed: number, n: number, salt = 0) => ((((seed + salt * 7919) % n) + n) % n);

// ---------------------------------------------------------------- objetos redesenhados

function bamboo(base: BufSprite, seed: number): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const cx = Math.round(base.ax);
  const ay = Math.min(b.h - 1, Math.round(base.ay) - 1);
  // Vaso de celadon.
  b.shadow(cx, ay + 0.5, 6, 1.5);
  b.rect(cx - 5, ay - 6, 10, 7, '#7fa89a');
  b.hline(cx - 5, cx + 4, ay - 6, '#a9cbbd');
  b.vline(cx + 4, ay - 5, ay, '#5b8273');
  b.hline(cx - 4, cx + 3, ay - 3, '#6a9486');
  // Três colmos com nós e folhas.
  const tops = [3 + vary(seed, 3), 1, 5 + vary(seed, 4, 1)];
  [-3, 0, 3].forEach((dx, k) => {
    const x = cx + dx - 1;
    const top = Math.max(1, tops[k]!);
    for (let y = top; y < ay - 6; y++) {
      b.set(x, y, '#93c46a');
      b.set(x + 1, y, '#5f9440');
    }
    for (let y = top + 4; y < ay - 7; y += 6) b.hline(x, x + 1, y, '#3f6a2a');
    for (let y = top + 2; y < ay - 14; y += 7) {
      const side = (y + k) % 2 ? 1 : -1;
      for (let i = 1; i <= 4; i++) {
        const lx = side > 0 ? x + 1 + i : x - i;
        const ly = y - Math.round(i / 2);
        b.set(lx, ly, i < 3 ? '#4f8f3a' : '#7cb85a');
        b.set(lx, ly + 1, '#3d7530');
      }
    }
  });
  b.outline();
  return b;
}

function bonsai(base: BufSprite, seed: number): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const cx = Math.round(base.ax);
  const ay = Math.min(b.h - 1, Math.round(base.ay) - 1);
  const pw = Math.min(b.w - 3, 10);
  // Vaso de porcelana branca e azul.
  b.shadow(cx, ay + 0.5, pw / 2 + 1, 1.2);
  b.rect(cx - Math.floor(pw / 2), ay - 3, pw, 4, '#eef2f6');
  b.hline(cx - Math.floor(pw / 2), cx - Math.floor(pw / 2) + pw - 1, ay - 3, '#c9d3df');
  b.hline(cx - Math.floor(pw / 2) + 1, cx - Math.floor(pw / 2) + pw - 2, ay - 1, '#3f5fa8');
  for (let x = cx - Math.floor(pw / 2) + 1; x < cx + Math.ceil(pw / 2) - 1; x += 2) b.set(x, ay - 2, '#5a7cc0');
  // Tronco torto e copas em "nuvens".
  const top = Math.max(2, ay - b.h + 3);
  const lean = vary(seed, 2) ? 1 : -1;
  const trunkTop = Math.max(top + 4, ay - 10);
  for (let y = ay - 4; y >= trunkTop; y--) {
    const x = cx + Math.round(Math.sin((ay - y) / 3) * 1.5) * lean;
    b.set(x, y, '#7a5236');
    b.set(x + 1, y, '#5a3a24');
  }
  const pads: [number, number, number][] = [
    [cx - 3 * lean, trunkTop + 1, 3],
    [cx + 2 * lean, trunkTop - 2, 4],
    [cx + 4 * lean, ay - 7, 2],
  ];
  for (const [px, py, r] of pads) {
    if (py < 1) continue;
    b.ellipse(px, py, r + 1, Math.max(1, r - 1), '#2f6a3e');
    b.ellipse(px - 1, py - 1, r, Math.max(1, r - 2), '#4c8f50');
    b.set(px - 1, py - 2, '#7cba6a');
  }
  b.outline();
  return b;
}

function wineJars(base: BufSprite): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const cx = Math.round(base.ax);
  const ay = Math.min(b.h - 1, Math.round(base.ay));
  b.shadow(cx, ay + 0.5, 7, 1.5);
  // Banquinho de madeira.
  b.rect(cx - 7, ay - 3, 14, 2, '#7f5131');
  b.hline(cx - 7, cx + 6, ay - 3, '#a06a40');
  b.vline(cx - 6, ay - 1, ay, '#5e3a22');
  b.vline(cx + 5, ay - 1, ay, '#5e3a22');
  const jar = (y0: number, rx: number, ry: number, label: boolean) => {
    b.ellipse(cx, y0, rx, ry, '#7a4a2a');
    b.ellipse(cx - 1, y0 - 1, rx - 2, ry - 2, '#9a6038');
    b.set(cx - rx + 2, y0 - ry + 3, '#c08a56');
    b.rect(cx - 2, y0 - ry - 2, 4, 2, '#5e3a22');
    // Tampa de pano amarrada.
    b.rect(cx - 3, y0 - ry - 4, 6, 2, '#c9a24a');
    b.hline(cx - 3, cx + 2, y0 - ry - 2, '#b8463a');
    if (label) {
      b.rect(cx - 2, y0 - 2, 5, 5, '#c0392b');
      b.vline(cx, y0 - 1, y0 + 1, INK);
      b.hline(cx - 1, cx + 1, y0, INK);
    }
  };
  jar(ay - 11, 7, 8, true);
  jar(ay - 26, 4, 5, false);
  b.outline();
  return b;
}

function teaStove(base: BufSprite, lit: boolean): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const cx = Math.round(base.ax);
  const ay = Math.min(b.h - 1, Math.round(base.ay));
  b.shadow(cx, ay + 0.5, 8, 1.5);
  // Aparador baixo com duas gavetas.
  b.rect(cx - 8, ay - 15, 16, 15, '#7f5131');
  b.hline(cx - 8, cx + 7, ay - 15, '#a06a40');
  b.vline(cx + 7, ay - 14, ay - 1, '#5e3a22');
  b.hline(cx - 7, cx + 6, ay - 9, '#5e3a22');
  b.set(cx - 1, ay - 12, GOLD);
  b.set(cx - 1, ay - 6, GOLD);
  // Fogareiro de barro com brasas.
  b.rect(cx - 5, ay - 22, 10, 7, '#8a5a3a');
  b.hline(cx - 5, cx + 4, ay - 22, '#a87a52');
  b.rect(cx - 2, ay - 19, 4, 2, lit ? '#ffb347' : '#e8742a');
  b.set(cx - 1, ay - 19, lit ? '#fff0be' : '#ffb347');
  // Bule de barro roxo (Yixing): corpo, bico à esquerda, alça à direita, tampa.
  b.ellipse(cx, ay - 26, 5, 3, '#6b3a3a');
  b.ellipse(cx - 1, ay - 27, 3, 2, '#8a4f4a');
  b.line(cx - 5, ay - 26, cx - 7, ay - 29, '#6b3a3a');
  b.vline(cx + 6, ay - 28, ay - 25, '#4f2a2a');
  b.rect(cx - 1, ay - 31, 3, 2, '#5a3030');
  b.set(cx, ay - 32, '#8a4f4a');
  b.outline();
  return b;
}

function lantern(base: BufSprite): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const g = base.rects?.glow ?? { x: 3, y: 5, w: 8, h: 6 };
  const cx = g.x + Math.floor(g.w / 2);
  const cy = g.y + Math.floor(g.h / 2);
  const ay = Math.min(b.h - 1, Math.round(base.ay) - 1);
  const pole = Math.min(b.w - 2, cx + 5);
  b.shadow(pole, ay + 0.5, 5, 1.2);
  // Haste com pé em cruz e braço que segura a lanterna.
  b.vline(pole, 1, ay - 1, '#5e3a22');
  b.vline(pole + 1, 1, ay - 1, '#3e2617');
  b.hline(pole - 4, pole + 1, ay, '#5e3a22');
  b.hline(cx, pole, 1, '#5e3a22');
  b.vline(cx, 1, cy - 5, '#3e2617');
  // Lanterna vermelha com tampas douradas e borla.
  b.ellipse(cx, cy, 5, 5, '#c8322a');
  b.ellipse(cx - 1, cy - 1, 3, 3, '#e25444');
  b.vline(cx, cy - 4, cy + 4, '#9a2420');
  b.vline(cx - 3, cy - 3, cy + 3, '#a8281f');
  b.vline(cx + 3, cy - 3, cy + 3, '#a8281f');
  b.hline(cx - 2, cx + 2, cy - 5, GOLD);
  b.hline(cx - 2, cx + 2, cy + 5, GOLD);
  b.vline(cx, cy + 6, cy + 9, '#c8322a');
  b.set(cx, cy + 10, GOLD);
  b.outline();
  return b;
}

function herbCabinet(base: BufSprite): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const cx = Math.round(base.ax);
  const ay = Math.min(b.h - 1, Math.round(base.ay) - 1);
  const w = Math.min(b.w - 2, 16);
  const x0 = cx - Math.floor(w / 2);
  const top = Math.max(1, ay - 37);
  b.shadow(cx, ay + 0.5, w / 2 + 1, 1.5);
  b.rect(x0, top, w, ay - top + 1, '#6e4128');
  b.rect(x0 - 1, top, w + 2, 2, '#4a2c1c');
  b.hline(x0 - 1, x0 + w, top, '#7f5131');
  // Gavetinhas com puxador de latão e etiqueta.
  const cols = 3;
  const cw = Math.floor((w - 2) / cols);
  for (let y = top + 3; y + 4 <= ay - 2; y += 5) {
    for (let c = 0; c < cols; c++) {
      const x = x0 + 1 + c * cw;
      b.rect(x, y, cw - 1, 4, '#8f5a36');
      b.hline(x, x + cw - 2, y, '#a87048');
      b.hline(x + 1, x + cw - 3, y + 1, '#e8dcc0');
      b.set(x + Math.floor((cw - 1) / 2), y + 2, GOLD);
    }
  }
  b.hline(x0, x0 + w - 1, ay, '#3e2617');
  b.outline();
  return b;
}

function urn(base: BufSprite): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const cx = Math.round(base.ax);
  const ay = Math.min(b.h - 1, Math.round(base.ay));
  b.shadow(cx, ay + 0.5, 5, 1);
  b.ellipse(cx, ay - 5, 5, 5, '#d9cfb8');
  b.ellipse(cx - 1, ay - 6, 3, 3, '#ece4d0');
  b.hline(cx - 4, cx + 4, ay - 5, '#3f5fa8');
  b.set(cx - 2, ay - 4, '#5a7cc0');
  b.set(cx + 2, ay - 4, '#5a7cc0');
  b.rect(cx - 3, ay - 11, 6, 2, '#c9bfa6');
  b.outline();
  return b;
}

/** Rolo vertical de caligrafia (pôster): papel montado em seda com dois rolos e o carimbo vermelho. */
function calligraphy(base: BufSprite, seed: number): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const w = b.w;
  const h = b.h;
  const silk = ['#3f5f6e', '#6e4a5f', '#5a6a3f'][vary(seed, 3)]!;
  b.rect(1, 1, w - 2, h - 2, silk);
  b.rect(2, 4, w - 4, h - 8, PAPER);
  b.hline(0, w - 1, 0, '#4a2c1c');
  b.hline(0, w - 1, h - 1, '#4a2c1c');
  b.set(0, h - 1, '#2a1a12');
  b.set(w - 1, h - 1, '#2a1a12');
  // Duas colunas de "ideogramas" (traços a nanquim, determinísticos).
  const colsX = [Math.floor(w / 2) - 2, Math.floor(w / 2) + 1];
  colsX.forEach((x, k) => {
    for (let y = 5; y < h - 6; y += 3) {
      const g = vary(seed + y * 13 + k * 31, 4);
      if (g === 0) b.hline(x, x + 1, y, INK);
      else if (g === 1) b.vline(x, y, y + 1, INK);
      else if (g === 2) {
        b.set(x, y, INK);
        b.set(x + 1, y + 1, INK);
      } else {
        b.hline(x - 1, x + 1, y, INK);
        b.set(x, y + 1, INK);
      }
    }
  });
  b.rect(3, h - 7, 2, 2, '#c0392b');
  b.outline();
  return b;
}

/** Rolo horizontal com paisagem a nanquim (quadro), dentro de rects.art. */
function inkLandscape(base: BufSprite, seed: number): PixelBuf {
  const b = new PixelBuf(base.buf.w, base.buf.h);
  const w = b.w;
  const h = b.h;
  const art = base.rects?.art ?? { x: 3, y: 3, w: w - 6, h: h - 6 };
  b.rect(1, 1, w - 2, h - 2, '#6e5a3a');
  b.vline(0, 0, h - 1, '#4a2c1c');
  b.vline(w - 1, 0, h - 1, '#4a2c1c');
  b.rect(art.x, art.y, art.w, art.h, PAPER);
  // Montanhas em três planos, névoa e um sol vermelho.
  const peaks = (y0: number, amp: number, col: string, phase: number) => {
    for (let x = 0; x < art.w; x++) {
      const t = (x + phase) / art.w;
      const top = Math.round(y0 - Math.abs(Math.sin(t * Math.PI * 2.2)) * amp - Math.sin(t * 9) * 1);
      for (let y = Math.max(0, top); y < art.h; y++) b.set(art.x + x, art.y + y, col);
    }
  };
  peaks(art.h * 0.6, art.h * 0.45, '#b9b6aa', vary(seed, 7));
  peaks(art.h * 0.8, art.h * 0.35, '#7d7f78', vary(seed, 5, 1) + 3);
  b.hline(art.x, art.x + art.w - 1, art.y + art.h - 3, '#e2dccb');
  peaks(art.h + 1, art.h * 0.3, '#4a4d48', vary(seed, 4, 2) + 9);
  b.rect(art.x + art.w - 6, art.y + 2, 2, 2, '#c0392b');
  b.set(art.x + 2 + vary(seed, Math.max(1, art.w - 6), 3), art.y + art.h - 3, INK);
  b.outline();
  return b;
}

// ---------------------------------------------------------------- composição

const REDRAWN = new Set<FurnitureKind>(['plant_tall', 'plant_small', 'water_cooler', 'coffee_machine', 'floor_lamp', 'vending_machine', 'trash_bin', 'poster', 'painting']);

export function isRedrawn(kind: FurnitureKind): boolean {
  return REDRAWN.has(kind);
}

/** Sprites de um móvel no estilo giang hồ (mesmas caixas e âncoras que os modernos). */
export function wuxiaFurniture(kind: FurnitureKind, variant: string | undefined, state: number, seed: number): BufFurniture {
  const f = renderFurniture(kind, variant, state, seed);
  const base = f.base;
  const front = f.front ? sprite(f.front, rematerial(f.front.buf)) : undefined;
  switch (kind) {
    case 'plant_tall':
      return { base: sprite(base, bamboo(base, seed)) };
    case 'plant_small':
      return { base: sprite(base, bonsai(base, seed)) };
    case 'water_cooler':
      return { base: sprite(base, wineJars(base)) };
    case 'coffee_machine':
      return { base: sprite(base, teaStove(base, state === 1)) };
    case 'floor_lamp':
      return { base: sprite(base, lantern(base)) };
    case 'vending_machine':
      return { base: sprite(base, herbCabinet(base), false) };
    case 'trash_bin':
      return { base: sprite(base, urn(base)) };
    case 'poster':
      return { base: sprite(base, calligraphy(base, seed + (variant?.length ?? 0) * 17)) };
    case 'painting':
      return { base: sprite(base, inkLandscape(base, seed)) };
    case 'glass_partition':
      return { base: sprite(base, rematerial(base.buf, { paperGlass: true })), front };
    case 'desk': {
      const b = rematerial(base.buf);
      const r = base.rects?.screen;
      if (r) {
        // O monitor vira um biombo de mesa laqueado: a "tela" (o que o agente faz) aparece como papel pintado.
        b.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, LACQUER_DK);
        b.rect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, LACQUER);
        for (const [x, y] of [[r.x - 2, r.y - 2], [r.x + r.w + 1, r.y - 2], [r.x - 2, r.y + r.h + 1], [r.x + r.w + 1, r.y + r.h + 1]] as const) b.set(x, y, GOLD);
        b.rect(r.x, r.y, r.w, r.h, PAPER);
      }
      return { base: sprite(base, b), front };
    }
    case 'whiteboard': {
      const b = rematerial(base.buf);
      const r = base.rects?.board;
      if (r) b.rect(r.x, r.y, r.w, r.h, PAPER);
      return { base: sprite(base, b), front };
    }
    default:
      return { base: sprite(base, rematerial(base.buf)), front };
  }
}

/** Cor de tapete da época (vermelho laca, índigo ou ameixa), pela seed. */
export function wuxiaRugColor(seed: number): string {
  return ['#8e2f2a', '#2f4a6e', '#6e2f4a'][vary(seed, 3)]!;
}

