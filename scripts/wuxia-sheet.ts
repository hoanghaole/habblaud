// Folha de comparação do estilo giang hồ: cada personagem moderno ao lado da versão wuxia, nas 4 direções e
// em algumas poses. Uso: npx tsx scripts/wuxia-sheet.ts [saida.png] [escala]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { appearanceFromSeed } from '../client/src/art/character/appearance';
import { renderCharacter } from '../client/src/art/character/render';
import { wuxiaLook } from '../client/src/art/character/wuxia';
import type { CharacterFrameRequest, Dir, HeldItem, Pose } from '../client/src/art/api';

const out = process.argv[2] ?? 'wuxia-sheet.png';
const scale = Number(process.argv[3] ?? 4);
const CW = 26;
const CH = 36;

const cells: { pose: Pose; dir: Dir; held?: HeldItem; seated?: boolean }[] = [
  { pose: 'stand', dir: 'down' },
  { pose: 'stand', dir: 'up' },
  { pose: 'walk', dir: 'left' },
  { pose: 'walk', dir: 'right' },
  { pose: 'type', dir: 'down' },
  { pose: 'drink', dir: 'down', held: 'coffee' },
  { pose: 'stand', dir: 'down', held: 'laptop' },
  { pose: 'sit', dir: 'down' },
];
const seeds = process.argv[4] ? process.argv[4].split(',').map(Number) : [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233];

const cols = cells.length * 2 + 1;
const W = cols * CW;
const H = seeds.length * CH;
const img = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const y = Math.floor(i / W);
  const shadeRow = Math.floor(y / CH) % 2 ? 222 : 236;
  img.set([shadeRow, shadeRow - 4, shadeRow - 10, 255], i * 4);
}

function blit(req: CharacterFrameRequest, cx: number, cy: number): void {
  const { buf } = renderCharacter(req);
  for (let y = 0; y < buf.h; y++) {
    for (let x = 0; x < buf.w; x++) {
      const si = (y * buf.w + x) * 4;
      const a = buf.data[si + 3] / 255;
      if (!a) continue;
      const di = ((cy + y) * W + cx + x) * 4;
      for (let k = 0; k < 3; k++) img[di + k] = Math.round(buf.data[si + k] * a + img[di + k] * (1 - a));
    }
  }
}

const sectNames: string[] = [];
seeds.forEach((seed, row) => {
  const a = appearanceFromSeed(seed);
  sectNames.push(`${seed}: ${wuxiaLook(a).sect} (${a.look})`);
  cells.forEach((c, i) => {
    const req = { appearance: a, dir: c.dir, pose: c.pose, frame: 1, held: c.held, seated: c.seated };
    blit(req, i * CW + 1, row * CH + 1);
    blit({ ...req, style: 'giangho' }, (cells.length + 1 + i) * CW + 1, row * CH + 1);
  });
});

// PNG (RGBA 8 bits) ampliado sem suavização.
const SW = W * scale;
const SH = H * scale;
const raw = Buffer.alloc((SW * 4 + 1) * SH);
for (let y = 0; y < SH; y++) {
  raw[y * (SW * 4 + 1)] = 0;
  for (let x = 0; x < SW; x++) {
    const si = (Math.floor(y / scale) * W + Math.floor(x / scale)) * 4;
    const di = y * (SW * 4 + 1) + 1 + x * 4;
    raw[di] = img[si]!;
    raw[di + 1] = img[si + 1]!;
    raw[di + 2] = img[si + 2]!;
    raw[di + 3] = img[si + 3]!;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SW, 0);
ihdr.writeUInt32BE(SH, 4);
ihdr.set([8, 6, 0, 0, 0], 8);
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`${out}: ${SW}x${SH}`);
console.log(sectNames.join('\n'));
