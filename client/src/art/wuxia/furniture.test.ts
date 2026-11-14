import { describe, expect, it } from 'vitest';
import { FURNITURE, type FurnitureKind } from '../api';
import { renderFurniture } from '../furniture/index';
import { isRedrawn, wuxiaFurniture, wuxiaRugColor } from './furniture';

const all: { kind: FurnitureKind; v?: string; st: number }[] = [];
for (const kind of Object.keys(FURNITURE) as FurnitureKind[]) {
  const def = FURNITURE[kind];
  for (const v of def.variants ?? [undefined]) for (let st = 0; st < (def.states ?? 1); st++) all.push({ kind, v, st });
}

describe('móveis giang hồ (wuxia)', () => {
  it('mantêm caixa, âncora e regiões dinâmicas do móvel moderno (caminhos, assentos e telas no lugar)', () => {
    for (const { kind, v, st } of all) {
      for (const seed of [0, 1, 2]) {
        const m = renderFurniture(kind, v, st, seed);
        const w = wuxiaFurniture(kind, v, st, seed);
        const at = `${kind}/${v ?? '-'}/${st}`;
        expect([w.base.buf.w, w.base.buf.h, w.base.ax, w.base.ay], at).toEqual([m.base.buf.w, m.base.buf.h, m.base.ax, m.base.ay]);
        expect(!!w.front, at).toBe(!!m.front);
        if (kind !== 'vending_machine') expect(w.base.rects, at).toEqual(m.base.rects);
        expect(w.base.buf.countOpaque(), at).toBeGreaterThan(0);
      }
    }
  });

  it('troca o material: o sprite muda e os redesenhados não reaproveitam o desenho moderno', () => {
    for (const { kind, v, st } of all) {
      const m = renderFurniture(kind, v, st, 1);
      const w = wuxiaFurniture(kind, v, st, 1);
      const same = Array.from(w.base.buf.data).join() === Array.from(m.base.buf.data).join();
      expect(same, `${kind}/${v ?? '-'}`).toBe(false);
    }
    expect(isRedrawn('plant_tall')).toBe(true);
    expect(isRedrawn('desk')).toBe(false);
  });

  it('a mesa mostra o "papel" do biombo no lugar da tela, e o tapete tem cor de época', () => {
    const w = wuxiaFurniture('desk', 'wood', 0, 0);
    const r = w.base.rects!.screen!;
    const i = ((r.y + 2) * w.base.buf.w + r.x + 2) * 4;
    expect(Array.from(w.base.buf.data.slice(i, i + 3))).toEqual([0xef, 0xe6, 0xcf]);
    expect(['#8e2f2a', '#2f4a6e', '#6e2f4a']).toContain(wuxiaRugColor(5));
  });
});
