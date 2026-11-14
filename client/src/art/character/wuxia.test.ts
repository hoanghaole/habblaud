import { describe, expect, it } from 'vitest';
import { appearanceFromSeed } from './appearance';
import { renderCharacter } from './render';
import { wuxiaLook, type Sect } from './wuxia';
import type { Dir, Pose } from '../api';

describe('estilo giang hồ (wuxia)', () => {
  it('é determinístico e não mexe na aparência original', () => {
    const a = appearanceFromSeed(42);
    const before = JSON.stringify(a);
    const l1 = wuxiaLook(a);
    const l2 = wuxiaLook({ ...a });
    expect(l1.sect).toBe(l2.sect);
    expect(l1.appearance).toEqual(l2.appearance);
    expect(JSON.stringify(a)).toBe(before);
  });

  it('sorteia todas as escolas e respeita o look', () => {
    const seen = new Set<Sect>();
    for (let s = 0; s < 400; s++) {
      const a = appearanceFromSeed(s);
      const l = wuxiaLook(a);
      seen.add(l.sect);
      if (l.sect === 'heroine') expect(a.look).toBe('f');
      if (l.sect === 'monk') expect(l.appearance.hairStyle).toBe('bald');
      expect(l.appearance.topStyle).toBe('jacket');
      expect(l.appearance.accessory === 'none' || l.sect === 'heroine').toBe(true);
    }
    expect([...seen].sort()).toEqual(['beggar', 'heroine', 'monk', 'scholar', 'swordsman', 'taoist']);
  });

  it('subagente vira discípulo: a cor do crachá vai para a faixa', () => {
    const a = appearanceFromSeed(7, { sub: true });
    const l = wuxiaLook({ ...a, lanyard: '#e2604f' });
    expect(l.sub).toBe(true);
    expect(l.sash.base.toLowerCase()).toBe('#e2604f');
    expect(l.appearance.lanyard).toBeNull();
  });

  it('desenha todas as poses e direções sem erro e muda o sprite', () => {
    const poses: Pose[] = ['stand', 'walk', 'run', 'sit', 'type', 'sleep', 'drink', 'read', 'talk', 'wait', 'cheer'];
    const dirs: Dir[] = ['down', 'up', 'left', 'right'];
    for (let s = 0; s < 24; s++) {
      const a = appearanceFromSeed(s);
      for (const pose of poses) {
        for (const dir of dirs) {
          const modern = renderCharacter({ appearance: a, dir, pose, frame: 0, held: 'coffee' });
          const wx = renderCharacter({ appearance: a, dir, pose, frame: 0, held: 'coffee', style: 'giangho' });
          expect(wx.buf.w).toBe(modern.buf.w);
          expect(Array.from(wx.buf.data).join()).not.toBe(Array.from(modern.buf.data).join());
        }
      }
    }
  });
});
