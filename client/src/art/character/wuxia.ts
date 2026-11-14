// Estilo "giang hồ" (wuxia): o mesmo personagem do escritório vestido como um herói de romance de capa e espada.
// Puro (desenha num PixelBuf). A aparência original continua sendo a fonte da verdade: este módulo só deriva dela,
// de forma determinística, uma escola (môn phái), cabelo, cores de túnica e acessórios, e desenha as peças por cima
// do rig normal. Nada daqui sai do navegador.
import { HAIR_FUN } from '../../../../shared/world/appearance-flat';
import { hash32 } from '../../../../shared/hash';
import type { Appearance, HeldItem } from '../api';
import { luminance, ramp, shade, type Ramp } from '../core/color';
import type { PixelBuf } from '../core/pixbuf';
import type { HeadView } from './hair';
import { appearanceKey } from './appearance';

export type Sect = 'swordsman' | 'monk' | 'taoist' | 'beggar' | 'heroine' | 'scholar';

export interface WuxiaLook {
  sect: Sect;
  /** A aparência derivada (cabelo, túnica de mangas compridas, calça da cor da túnica). */
  appearance: Appearance;
  robe: Ramp;
  /** Faixa da cintura (subagente: a cor do crachá) ou o kasaya do monge. */
  sash: Ramp;
  /** Gola interna. */
  trim: string;
  /** Subagente (discípulo): túnica curta. */
  sub: boolean;
}

/** O que as funções de desenho precisam do rig (coordenadas do sprite de 24x34). */
export interface WxCtx {
  b: PixelBuf;
  view: HeadView;
  ub: number;
  lean: number;
  seated: boolean;
  look: WuxiaLook;
  skin: Ramp;
  /** Origem da grade da cabeça (já com quique e cochilo). */
  ox: number;
  oy: number;
}

const POOL_M: readonly Sect[] = ['swordsman', 'swordsman', 'monk', 'taoist', 'beggar', 'scholar'];
const POOL_F: readonly Sect[] = ['heroine', 'heroine', 'swordsman', 'taoist', 'beggar', 'scholar'];

const ROBES: Readonly<Record<Sect, readonly string[]>> = {
  swordsman: ['#ece8dd', '#5d7fa8', '#3f4b5e', '#7a3b3b'],
  monk: ['#d9a046', '#c98a3a'],
  taoist: ['#8d9aa8', '#5f6b78', '#b9b3a3'],
  beggar: ['#9b8a6c', '#87785e'],
  heroine: ['#e9a6b8', '#b9a0d8', '#9fd3c7', '#d65a52', '#f0ede4'],
  scholar: ['#a9c7da', '#c3d4ae', '#e6dfca'],
};
const SASHES: Readonly<Record<Sect, readonly string[]>> = {
  swordsman: ['#2f3a52', '#8a2f35', '#c9a85a'],
  monk: ['#a8432f'],
  taoist: ['#3b3f4a', '#efe9da'],
  beggar: ['#c9b27a'],
  heroine: ['#f7f1e3', '#d4b25a', '#7a3b6b'],
  scholar: ['#3a4458', '#6b4f3a'],
};
const DARK_HAIR = ['#1f1a1c', '#2b2530', '#3b2c24'] as const;

const GOLD = '#d9b95a';
const WOOD = '#6b4a32';

const cache = new Map<string, WuxiaLook>();

const pick = <T>(list: readonly T[], n: number): T => list[(n >>> 0) % list.length]!;

export function wuxiaLook(a: Appearance): WuxiaLook {
  const key = appearanceKey(a);
  const hit = cache.get(key);
  if (hit) return hit;
  const h = hash32(key);
  const f = a.look === 'f';
  const sect = pick(f ? POOL_F : POOL_M, h);
  const robeHex = pick(ROBES[sect], h >>> 5);
  const sub = !!a.lanyard;
  const sashHex = a.lanyard ?? pick(SASHES[sect], h >>> 9);
  // Cabelos coloridos ou claros viram pretos/castanho-escuros (o tom da época).
  const light = (HAIR_FUN as readonly string[]).includes(a.hair) || luminance(a.hair) > 0.3;
  let hair = light ? pick(DARK_HAIR, h >>> 13) : a.hair;
  if (sect === 'taoist' && ((h >>> 17) & 3) === 0) hair = '#cfcac2'; // mestre de cabelos brancos
  if (sect === 'monk') hair = shade(a.skin, -0.06); // cabeça raspada: a nuca "rapada" some na pele
  let hairStyle: Appearance['hairStyle'];
  switch (sect) {
    case 'swordsman': hairStyle = f ? 'ponytail' : 'bun'; break;
    case 'monk': hairStyle = 'bald'; break;
    case 'taoist': hairStyle = 'bun'; break;
    case 'beggar': hairStyle = f ? 'ponytail' : 'spiky'; break;
    case 'heroine': hairStyle = (h >>> 19) & 1 ? 'bun' : 'long'; break;
    case 'scholar': hairStyle = 'short'; break;
  }
  let facialHair = a.facialHair;
  if (f || sect === 'monk') facialHair = 'none';
  else if (sect === 'taoist' && (h >>> 21) & 1) facialHair = 'goatee';
  else if (sect === 'scholar') facialHair = (h >>> 21) & 1 ? 'mustache' : 'none';
  const shoes = sect === 'monk' ? '#8a6a45' : sect === 'beggar' ? '#6b5a44' : '#2a2830';
  const appearance: Appearance = {
    ...a,
    hair,
    hairStyle,
    facialHair,
    accessory: sect === 'heroine' ? 'earrings' : 'none',
    accessoryColor: '#7cc8a8',
    topStyle: 'jacket',
    top: robeHex,
    topAccent: sashHex,
    bottom: robeHex,
    bottomStyle: 'pants',
    shoes,
    // O crachá vira a faixa da cintura (ver drawRobeTorso).
    lanyard: null,
  };
  const look: WuxiaLook = {
    sect,
    appearance,
    robe: ramp(robeHex, 0.08),
    sash: ramp(sashHex, 0.08),
    trim: luminance(robeHex) > 0.7 ? '#9aa3b2' : '#f4efe3',
    sub,
  };
  if (cache.size > 2048) cache.clear();
  cache.set(key, look);
  return look;
}

// ---------------------------------------------------------------- túnica

/** Tronco: gola cruzada, faixa na cintura e detalhes da escola. Substitui drawTorso. */
export function drawRobeTorso(c: WxCtx): void {
  const { b, look } = c;
  const t = look.robe;
  const s = look.sash;
  const y = 18 + c.ub;
  const lx = c.lean;
  const sect = look.sect;
  if (c.view === 'side') {
    b.rect(8 + lx, y, 7, 6, t.base);
    for (let yy = y; yy < y + 6; yy++) {
      b.set(8 + lx, yy, t.lt);
      b.set(14 + lx, yy, t.dk);
    }
    if (sect === 'monk') {
      for (let i = 0; i < 5; i++) b.set(13 - i + lx, y + i, s.base);
    } else {
      b.set(9 + lx, y, look.trim);
      b.set(10 + lx, y + 1, look.trim);
      b.set(11 + lx, y + 2, t.dk);
    }
    b.hline(8 + lx, 14 + lx, y + 4, s.base);
    b.set(8 + lx, y + 4, s.lt);
    b.set(8 + lx, y + 5, s.dk);
    if (sect === 'beggar') b.rect(12 + lx, y + 1, 2, 2, '#b7a27c');
    if (sect === 'scholar') b.vline(10 + lx, y + 2, y + 3, '#e8dcc0');
    if (look.sub) b.set(9 + lx, y + 5, '#8fd6b0');
    return;
  }
  b.rect(8, y, 8, 6, t.base);
  for (let yy = y; yy < y + 6; yy++) {
    b.set(8, yy, t.lt);
    b.set(15, yy, t.dk);
  }
  const front = c.view === 'down';
  if (front) {
    if (sect === 'monk') {
      // Kasaya: faixa vermelha do ombro esquerdo ao quadril direito.
      for (let i = 0; i < 5; i++) {
        b.set(9 + i, y + i, s.base);
        b.set(10 + i, y + i, s.dk);
      }
      // Rosário no pescoço.
      for (const [x, yy] of [[9, 0], [9, 1], [10, 2], [11, 3], [12, 3], [13, 2], [14, 1], [14, 0]] as const) {
        b.set(x, y + yy, '#5a3424');
      }
      b.set(11, y + 3, '#8a5a3a');
    } else {
      // Gola cruzada (lado direito por cima): abertura do pescoço em V e borda da lapela até o quadril.
      b.set(11, y, c.skin.base);
      b.set(12, y, c.skin.dk);
      b.set(10, y, look.trim);
      b.set(13, y, look.trim);
      b.set(11, y + 1, look.trim);
      b.set(12, y + 1, look.trim);
      b.set(12, y + 2, t.dk);
      b.set(13, y + 3, t.dk);
    }
    if (sect === 'beggar') {
      b.rect(13, y + 1, 2, 2, '#b7a27c');
      b.set(9, y + 2, '#6f6250');
    }
  } else {
    b.hline(10, 13, y, t.dk);
    if (sect === 'monk') for (let i = 0; i < 5; i++) b.set(14 - i, y + i, s.base);
    if (sect === 'beggar') b.rect(9, y + 1, 2, 2, '#b7a27c');
  }
  // Faixa da cintura com o nó caindo à frente.
  b.hline(8, 15, y + 4, s.base);
  b.set(8, y + 4, s.lt);
  b.set(15, y + 4, s.dk);
  b.set(8, y + 5, t.base);
  b.hline(9, 14, y + 5, t.dk);
  if (front) {
    b.set(10, y + 5, s.base);
    b.set(10, y + 6, s.dk);
    if (look.sub) b.set(11, y + 6, '#8fd6b0'); // plaqueta de jade do discípulo
    if (sect === 'scholar') {
      // Leque enfiado na faixa.
      b.set(13, y + 2, WOOD);
      b.vline(13, y + 3, y + 5, '#e8dcc0');
    }
  }
  drawBackGear(c, 'front');
}

/** Saia da túnica sobre as pernas (em pé). Sentado o colo já sai da cor da túnica. */
export function drawRobeSkirt(c: WxCtx): void {
  if (c.seated) return;
  const { b, look } = c;
  const t = look.robe;
  const top = 24 + c.ub;
  const bottom = look.sub ? 25 : 27;
  if (c.view === 'side') {
    const lx = c.lean;
    for (let y = top; y <= bottom; y++) {
      const w = y >= top + 2 ? 1 : 0;
      b.hline(8 + lx - w, 14 + lx, y, t.base);
      b.set(8 + lx - w, y, t.lt);
      b.set(14 + lx, y, t.dk);
    }
    b.hline(7 + lx, 14 + lx, bottom, t.dk);
  } else {
    for (let y = top; y <= bottom; y++) {
      const w = y >= top + 2 ? 1 : 0;
      b.hline(8 - w, 15 + w, y, t.base);
      b.set(8 - w, y, t.lt);
      b.set(15 + w, y, t.dk);
    }
    b.hline(7, 16, bottom, t.dk);
    if (c.view === 'down' && look.sect !== 'monk') b.vline(13, top, bottom - 1, t.dk);
    if (look.sect === 'beggar') b.rect(9, top + 2, 2, 2, '#6f6250');
  }
  // Cabaça de vinho na cintura do mendigo.
  if (look.sect === 'beggar' && c.view !== 'side') drawGourd(b, c.view === 'up' ? 5 : 16, top - 1);
}

function drawGourd(b: PixelBuf, x: number, y: number): void {
  b.stamp(['.r.', 'ggG', '.g.', 'ggG', 'ggG', '.G.'], x, y, { r: '#b8463a', g: '#d9a441', G: '#a8762a' });
}

/**
 * Espada (escolas de espada) ou espanador taoista nas costas. 'behind' = antes de tudo (perfil: atrás do corpo);
 * 'front' = depois do tronco (de frente: o punho por cima do ombro; de costas: a bainha inteira na diagonal).
 */
export function drawBackGear(c: WxCtx, layer: 'behind' | 'front'): void {
  const { b, look } = c;
  const sect = look.sect;
  const sword = sect === 'swordsman' || sect === 'heroine';
  const whisk = sect === 'taoist';
  if (!sword && !whisk) return;
  const dy = c.ub;
  const sheath = sect === 'heroine' ? '#6b2f3a' : '#2f2a2e';
  if (c.view === 'side') {
    if (layer !== 'behind') return;
    const lx = c.lean;
    if (sword) {
      for (let i = 0; i <= 11; i++) b.set(17 - Math.round(i * 0.5) + lx, 12 + i + dy, i < 3 ? WOOD : sheath);
      b.hline(15 + lx, 17 + lx, 15 + dy, GOLD);
      b.set(18 + lx, 12 + dy, '#c93945');
      b.set(18 + lx, 13 + dy, '#c93945');
    } else {
      for (let i = 0; i <= 5; i++) b.set(16 - Math.round(i * 0.5) + lx, 13 + i + dy, WOOD);
      b.rect(16 + lx, 10 + dy, 3, 3, '#f4f2ee');
      b.set(18 + lx, 13 + dy, '#dcd8ce');
    }
    return;
  }
  if (layer !== 'front') return;
  if (c.view === 'down') {
    // Só o punho aparece por cima do ombro direito.
    if (sword) {
      b.vline(17, 13 + dy, 17 + dy, WOOD);
      b.set(18, 12 + dy, WOOD);
      b.hline(16, 18, 17 + dy, GOLD);
      b.set(19, 12 + dy, '#c93945');
      b.set(19, 13 + dy, '#c93945');
    } else {
      b.vline(17, 13 + dy, 17 + dy, WOOD);
      b.rect(17, 10 + dy, 3, 3, '#f4f2ee');
      b.set(19, 12 + dy, '#dcd8ce');
    }
    return;
  }
  // De costas: diagonal do ombro esquerdo (na tela) ao quadril direito.
  if (sword) {
    for (let i = 0; i <= 12; i++) {
      const x = 6 + Math.round(i * 0.75);
      const yy = 13 + i + dy;
      const col = i < 3 ? WOOD : sheath;
      b.set(x, yy, col);
      b.set(x + 1, yy, i < 3 ? WOOD : shade(sheath, 0.12));
    }
    b.hline(7, 10, 16 + dy, GOLD);
    b.set(5, 12 + dy, '#c93945');
  } else {
    for (let i = 0; i <= 6; i++) b.set(7 + Math.round(i * 0.6), 13 + i + dy, WOOD);
    b.rect(5, 10 + dy, 3, 3, '#f4f2ee');
  }
}

// ---------------------------------------------------------------- cabeça

/** Faixa, coroa, chapéu de letrado ou grampo, por cima do cabelo. Substitui o acessório sazonal. */
export function drawWuxiaHead(c: WxCtx): void {
  const { b, look, ox, oy, view } = c;
  const put = (cx: number, cy: number, col: string) => b.set(ox + cx, oy + cy, col);
  const s = look.sash;
  switch (look.sect) {
    case 'swordsman':
    case 'beggar': {
      const band = look.sect === 'beggar' ? '#7a6448' : s.base === '#c9a85a' ? '#8a2f35' : s.base;
      if (view === 'side') {
        for (let cx = 1; cx <= 11; cx++) put(cx, 6, band);
        put(12, 7, band);
        put(12, 8, band);
        put(13, 9, band);
      } else {
        for (let cx = 1; cx <= 12; cx++) put(cx, 6, band);
        if (view === 'up') {
          put(6, 7, band);
          put(7, 7, band);
          put(6, 8, band);
          put(7, 9, band);
        } else {
          put(13, 7, band);
          put(13, 8, band);
        }
      }
      break;
    }
    case 'monk': {
      // Giới ba (marcas de ordenação) no alto da cabeça raspada.
      const dot = shade(c.skin.base, -0.22);
      if (view === 'side') {
        put(4, 5, dot);
        put(6, 5, dot);
        put(5, 6, dot);
      } else {
        for (const cx of [4, 6, 8]) put(cx, 5, dot);
        for (const cx of [5, 7]) put(cx, 6, dot);
      }
      break;
    }
    case 'taoist': {
      // Coroa pequena sobre o coque, atravessada por um grampo.
      const crown = '#3b3f4a';
      const x0 = view === 'side' ? 6 : 5;
      b.rect(ox + x0, oy - 1, 4, 3, crown);
      b.hline(ox + x0, ox + x0 + 3, oy - 1, '#5a6070');
      b.hline(ox + x0 - 2, ox + x0 + 5, oy + 1, GOLD);
      break;
    }
    case 'scholar': {
      // Phốc đầu: gorro preto com as duas abas laterais.
      // Copa alta e justa (sem aba) e duas hastes finas saindo de trás, na altura do alto da copa.
      const cap = '#26252b';
      b.rect(ox + 3, oy + 1, 8, 5, cap);
      b.rect(ox + 4, oy - 1, 6, 2, cap);
      b.hline(ox + 4, ox + 6, oy, '#45444d');
      b.set(ox + 4, oy + 1, '#45444d');
      if (view === 'side') {
        b.hline(ox + 10, ox + 14, oy + 1, cap);
        b.set(ox + 14, oy, cap);
      } else {
        b.hline(ox, ox + 3, oy + 1, cap);
        b.hline(ox + 10, ox + 13, oy + 1, cap);
        b.set(ox - 1, oy, cap);
        b.set(ox + 14, oy, cap);
      }
      break;
    }
    case 'heroine': {
      // Grampo dourado e uma flor no cabelo.
      const x = view === 'up' ? 3 : view === 'side' ? 9 : 10;
      const dir = view === 'up' ? -1 : 1;
      put(x, 2, GOLD);
      put(x + dir, 1, GOLD);
      put(x + 2 * dir, 0, '#fff0be');
      put(x, 3, '#f08aa8');
      put(x - dir, 3, '#d0587e');
      break;
    }
  }
}

// ---------------------------------------------------------------- itens

/** Itens do escritório trocados por equivalentes de época. Devolve false para desenhar o item original. */
export function drawWuxiaItem(b: PixelBuf, it: HeldItem, x: number, y: number, view: HeadView): boolean {
  const side = view === 'side';
  switch (it) {
    case 'coffee':
      // Xícara de chá de celadon.
      b.stamp(['hhhh', 'gggG', '.gG.'], x, y + 1, { h: '#e9f2ea', g: '#9fc7a8', G: '#76a585' }, side);
      return true;
    case 'water':
      drawGourd(b, x, y - 1);
      return true;
    case 'laptop':
      // Rolo de tiras de bambu (trúc giản).
      if (side) {
        b.rect(x, y, 2, 7, '#c9a356');
        b.vline(x + 1, y, y + 6, '#a8843f');
      } else {
        b.rect(x, y, 8, 5, '#d8b86a');
        for (let i = 1; i < 8; i += 2) b.vline(x + i, y, y + 4, '#a8843f');
        b.hline(x, x + 7, y + 1, '#7a5a2a');
        b.hline(x, x + 7, y + 3, '#7a5a2a');
      }
      return true;
    case 'papers':
      // Pergaminho enrolado nas duas pontas.
      if (side) {
        b.rect(x, y, 2, 6, '#f2ead6');
        b.hline(x, x + 1, y, '#8a5a3a');
        b.hline(x, x + 1, y + 5, '#8a5a3a');
      } else {
        b.rect(x, y + 1, 6, 4, '#f2ead6');
        b.hline(x + 1, x + 3, y + 2, '#5a4a3a');
        b.vline(x - 1, y, y + 5, '#8a5a3a');
        b.vline(x + 6, y, y + 5, '#8a5a3a');
      }
      return true;
    case 'phone':
      // Leque de papel.
      if (side) b.stamp(['ff', 'fF', '.h'], x, y, { f: '#efe3c5', F: '#c9a76a', h: WOOD });
      else b.stamp(['fFfFf', '.fFf.', '..h..'], x - 1, y, { f: '#efe3c5', F: '#c9a76a', h: WOOD });
      return true;
    case 'book':
      // Bí kíp: livro costurado de capa azul e etiqueta clara.
      if (view === 'down' || side) return false;
      b.rect(x, y, 5, 6, '#2f4f7a');
      b.rect(x + 1, y + 1, 1, 4, '#efe3c5');
      b.vline(x + 4, y, y + 5, '#1f3656');
      return true;
    default:
      return false;
  }
}
