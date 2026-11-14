// Folha de comparação dos móveis: moderno (em cima) e giang hồ (embaixo), todos os kinds/variantes.
// Uso: npx tsx scripts/wuxia-furniture-sheet.ts [saida.png] [escala]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { FURNITURE, type FurnitureKind } from '../client/src/art/api';
import { renderFurniture } from '../client/src/art/furniture/index';
import { wuxiaFurniture } from '../client/src/art/wuxia/furniture';
import type { PixelBuf } from '../client/src/art/core/pixbuf';

const out = process.argv[2] ?? 'wuxia-furniture.png';
const scale = Number(process.argv[3] ?? 3);
const items: { kind: FurnitureKind; v?: string }[] = [];
for (const kind of Object.keys(FURNITURE) as FurnitureKind[]) {
  const vs = FURNITURE[kind].variants;
  if (kind === 'poster' || kind === 'light_switch') items.push({ kind, v: vs?.[0] });
  else for (const v of vs ?? [undefined]) items.push({ kind, v });
}
const CELL = 56;
const PER_ROW = 14;
const rows = Math.ceil(items.length / PER_ROW);
const W = PER_ROW * CELL;
const H = rows * CELL * 2;
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const band = Math.floor(Math.floor(i / W) / CELL) % 2;
  const c = band ? [214, 206, 190] : [232, 226, 214];
  img.set([...c, 255], i * 4);
}
function blit(buf: PixelBuf, x0: number, y0: number) {
  for (let y = 0; y < buf.h; y++) for (let x = 0; x < buf.w; x++) {
    const si = (y * buf.w + x) * 4;
    const a = buf.data[si + 3]! / 255;
    if (!a || x0 + x < 0 || y0 + y < 0 || x0 + x >= W || y0 + y >= H) continue;
    const di = ((y0 + y) * W + x0 + x) * 4;
    for (let k = 0; k < 3; k++) img[di + k] = Math.round(buf.data[si + k]! * a + img[di + k]! * (1 - a));
  }
}
items.forEach((it, n) => {
  const col = n % PER_ROW;
  const row = Math.floor(n / PER_ROW);
  const m = renderFurniture(it.kind, it.v, 0, 1);
  const w = wuxiaFurniture(it.kind, it.v, 0, 1);
  const cx = col * CELL + CELL / 2;
  const by = row * CELL * 2 + CELL - 4;
  blit(m.base.buf, Math.round(cx - m.base.buf.w / 2), by - m.base.buf.h);
  if (m.front) blit(m.front.buf, Math.round(cx - m.front.buf.w / 2), by - m.front.buf.h);
  blit(w.base.buf, Math.round(cx - w.base.buf.w / 2), by + CELL - w.base.buf.h);
  if (w.front) blit(w.front.buf, Math.round(cx - w.front.buf.w / 2), by + CELL - w.front.buf.h);
});
const SW = W * scale, SH = H * scale;
const raw = Buffer.alloc((SW * 4 + 1) * SH);
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
  const si = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4;
  const di = y * (SW * 4 + 1) + 1 + x * 4;
  raw[di] = img[si]!; raw[di + 1] = img[si + 1]!; raw[di + 2] = img[si + 2]!; raw[di + 3] = 255;
}
const T = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = T[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ih = Buffer.alloc(13); ih.writeUInt32BE(SW, 0); ih.writeUInt32BE(SH, 4); ih.set([8, 6, 0, 0, 0], 8);
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${SW}x${SH}, ${items.length} móveis`);
