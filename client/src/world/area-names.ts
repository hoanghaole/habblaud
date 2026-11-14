// Nomes das áreas comuns do prédio (rótulos no mapa e o "onde" das rodas no feed). No estilo giang hồ (wuxia) elas
// viram lugares de época: a recepção vira a estalagem, a copa a casa de chá, o lounge o pavilhão e os banheiros a
// casa de banhos. As salas de projeto continuam com o nome do projeto.
import { tr } from '../../../shared/i18n';
import type { OfficeStyle } from './api';
import { CAFE_ID, LOUNGE_ID, RECEPTION_ID, RESTROOM_ID } from './layout/core';

const MODERN: Readonly<Record<string, string>> = {
  [RECEPTION_ID]: tr('Recepção'),
  [RESTROOM_ID]: tr('Banheiros'),
  [CAFE_ID]: tr('Copa'),
  [LOUNGE_ID]: tr('Lounge'),
};

const WUXIA: Readonly<Record<string, string>> = {
  [RECEPTION_ID]: tr('Estalagem'),
  [RESTROOM_ID]: tr('Casa de banhos'),
  [CAFE_ID]: tr('Casa de chá'),
  [LOUNGE_ID]: tr('Pavilhão'),
};

/** Nome de uma área comum no estilo dado (undefined para salas de projeto e corredor). */
export function coreAreaName(id: string, style: OfficeStyle | undefined): string | undefined {
  return (style === 'giangho' ? WUXIA : MODERN)[id];
}
