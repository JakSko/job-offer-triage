// "Etap4: LinkedIn - przygotuj wpis (bez AI)" (config/etap4_linkedin_bez_ai.js, W-09).
import type { Rekord } from './classify.js';

export function wpisLinkedinBezAi(oferty: Rekord[]): Rekord[] {
  return oferty.map(it => ({ ...it, etap4_klasa: 'linkedin_brak_tresci',
    rekomendacja: 'NIEOCENIONE (BRAK PELNEJ TRESCI - LINKEDIN)',
    uzasadnienie_rekomendacji: 'LinkedIn blokuje pobranie pelnej tresci oferty (robots.txt), a e-mail alertowy nie zawiera opisu - ocen recznie pod linkiem z arkusza.',
  }));
}
