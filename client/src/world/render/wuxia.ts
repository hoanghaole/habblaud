// Enfeites do estilo giang hồ (wuxia) desenhados por cima das paredes já prontas: colunas laqueadas nas pontas de
// cada trecho de parede e nos batentes, e lanternas vermelhas penduradas nos vãos livres (sem cobrir quadros, TVs,
// janelas nem passagens). À noite as lanternas acendem (drawWuxiaLights). Só desenho: nada muda caminhos ou colisões.
import { FURNITURE, TILE } from '../../art/api';
import type { AreaLayout, WallSegment } from '../layout/types';

const CAP = 4;
const FACE = TILE * 2;
const BASEBOARD = 3;

type Face = Extract<WallSegment, { kind: 'face' }>;

/** Trechos [a, b) da face que não são passagem. */
function solid(w: Face): [number, number][] {
  let segs: [number, number][] = [[w.x, w.x + w.w]];
  for (const d of w.doorways ?? []) {
    const next: [number, number][] = [];
    for (const [a, b] of segs) {
      if (d.x + d.w <= a || d.x >= b) next.push([a, b]);
      else {
        if (d.x > a) next.push([a, d.x]);
        if (d.x + d.w < b) next.push([d.x + d.w, b]);
      }
    }
    segs = next;
  }
  return segs.filter(([a, b]) => b - a >= 8);
}

/** Faixas x ocupadas por itens de parede (com folga) na face dada. */
function busy(layout: AreaLayout, w: Face): [number, number][] {
  const out: [number, number][] = [];
  for (const it of layout.wallItems) {
    if (it.on !== 'face') continue;
    if (it.baseY < w.y || it.baseY > w.y + FACE + 2) continue;
    const half = ((FURNITURE[it.kind]?.footprint.w ?? 1) * TILE) / 2;
    out.push([it.cx - half - 4, it.cx + half + 4]);
  }
  return out;
}

/** Onde ficam as lanternas (centro do corpo), para desenho e luz. */
export function wuxiaLanterns(layout: AreaLayout): { x: number; y: number }[] {
  const spots: { x: number; y: number }[] = [];
  for (const w of layout.walls) {
    if (w.kind !== 'face') continue;
    const taken = busy(layout, w);
    for (const [a, b] of solid(w)) {
      for (let x = a + 14; x <= b - 14; x += 40) {
        if (taken.some(([l, r]) => x + 4 > l && x - 4 < r)) continue;
        spots.push({ x, y: w.y + CAP + 8 });
      }
    }
  }
  return spots;
}

function pillar(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const top = y + CAP;
  const h = FACE - CAP - BASEBOARD;
  ctx.fillStyle = '#8e2f2a';
  ctx.fillRect(x, top, 3, h);
  ctx.fillStyle = '#b8473c';
  ctx.fillRect(x, top, 1, h);
  ctx.fillStyle = '#5e1c19';
  ctx.fillRect(x + 2, top, 1, h);
  ctx.fillStyle = '#d9b95a';
  ctx.fillRect(x, top, 3, 1);
  ctx.fillRect(x, top + 3, 3, 1);
  ctx.fillStyle = '#9d968a';
  ctx.fillRect(x - 1, top + h - 1, 5, 2);
}

function lanternAt(ctx: CanvasRenderingContext2D, cx: number, cy: number, wallTop: number): void {
  ctx.fillStyle = '#3e2617';
  ctx.fillRect(cx, wallTop + CAP, 1, cy - 4 - (wallTop + CAP));
  ctx.fillStyle = '#d9b95a';
  ctx.fillRect(cx - 1, cy - 4, 3, 1);
  ctx.fillRect(cx - 1, cy + 3, 3, 1);
  ctx.fillStyle = '#c8322a';
  ctx.fillRect(cx - 2, cy - 3, 5, 6);
  ctx.fillRect(cx - 3, cy - 2, 7, 4);
  ctx.fillStyle = '#e25444';
  ctx.fillRect(cx - 2, cy - 2, 2, 3);
  ctx.fillStyle = '#9a2420';
  ctx.fillRect(cx + 2, cy - 2, 1, 4);
  ctx.fillRect(cx, cy - 3, 1, 6);
  ctx.fillStyle = '#c8322a';
  ctx.fillRect(cx, cy + 4, 1, 3);
  ctx.fillStyle = '#d9b95a';
  ctx.fillRect(cx, cy + 7, 1, 1);
}

/** Colunas e lanternas nas faces de parede da área (na camada de paredes, cacheada). */
export function decorateWuxiaWalls(ctx: CanvasRenderingContext2D, layout: AreaLayout): void {
  ctx.save();
  for (const w of layout.walls) {
    if (w.kind !== 'face' || w.style.pattern === 'glass' || w.style.exterior) continue;
    for (const [a, b] of solid(w)) {
      pillar(ctx, a, w.y);
      pillar(ctx, b - 3, w.y);
    }
  }
  for (const w of layout.walls) {
    if (w.kind !== 'face' || w.style.pattern === 'glass' || w.style.exterior) continue;
    for (const s of wuxiaLanterns({ ...layout, walls: [w] })) lanternAt(ctx, s.x, s.y, w.y);
  }
  ctx.restore();
}

let glow: HTMLCanvasElement | null = null;
function glowSprite(): HTMLCanvasElement {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 30;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(15, 15, 1, 15, 15, 15);
  grad.addColorStop(0, 'rgba(255,170,110,0.95)');
  grad.addColorStop(1, 'rgba(255,120,80,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 30, 30);
  return (glow = c);
}

/** Lanternas acesas: brilho quente proporcional à luz da sala (0..1). */
export function drawWuxiaLights(ctx: CanvasRenderingContext2D, layout: AreaLayout, light: number): void {
  if (light <= 0.01) return;
  const g = glowSprite();
  ctx.save();
  for (const s of wuxiaLanterns({ ...layout, walls: layout.walls.filter((w) => w.kind === 'face' && w.style.pattern !== 'glass' && !w.style.exterior) })) {
    ctx.globalAlpha = light * 0.45;
    ctx.drawImage(g, Math.round(s.x - 15), Math.round(s.y - 15));
    ctx.globalAlpha = light * 0.8;
    ctx.fillStyle = '#ffd2a0';
    ctx.fillRect(s.x - 1, s.y - 1, 2, 2);
  }
  ctx.restore();
}

/** Tela do biombo de mesa / TV: o conteúdo vira tinta sobre papel. */
export function paperScreen(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }): void {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = '#e9d8ad';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
}
