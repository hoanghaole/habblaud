import { describe, expect, it } from 'vitest';
import { coreAreaName } from './area-names';
import { CAFE_ID, LOUNGE_ID, RECEPTION_ID, RESTROOM_ID } from './layout/core';

describe('nomes das áreas comuns', () => {
  it('moderno por padrão, de época no giang hồ, nada para salas de projeto', () => {
    expect(coreAreaName(RECEPTION_ID, undefined)).toBe('Recepção');
    expect(coreAreaName(LOUNGE_ID, 'modern')).toBe('Lounge');
    expect(coreAreaName(RECEPTION_ID, 'giangho')).toBe('Estalagem');
    expect(coreAreaName(CAFE_ID, 'giangho')).toBe('Casa de chá');
    expect(coreAreaName(LOUNGE_ID, 'giangho')).toBe('Pavilhão');
    expect(coreAreaName(RESTROOM_ID, 'giangho')).toBe('Casa de banhos');
    expect(coreAreaName('room:abc', 'giangho')).toBeUndefined();
  });
});
