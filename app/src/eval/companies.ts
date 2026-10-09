// Cache firm w zakładce "Firmy" (W-12, W-15, W-25). Kraj siedziby, typ i wielkość to cechy firmy:
// model ustala je tylko dla nowych firm, dla znanych bierzemy dane z zakładki.
// "Etap4: sprawdz firme (cache)" = config/etap4_sprawdz_firme_cache.js; zapis nowej firmy = węzły
// "Etap4: czy nowa firma" i "Firmy: zapisz nową firmę".
import { isoWarszawa } from '../sheets/dates.js';
import type { Rekord } from './classify.js';

export const ZAKLADKA_FIRMY = 'Firmy';
export const KOLUMNY_FIRMY = [
  'firma_znormalizowana', 'kraj_siedziby', 'typ_firmy', 'wielkosc_firmy',
  'pewnosc_kraj', 'pewnosc_typ', 'pewnosc_wielkosc', 'data_ustalenia', 'liczba_ofert',
] as const;

export function sprawdzFirme(oferta: Rekord, firmy: Rekord[]): Rekord {
  const znaleziona = firmy.filter(f => f.firma_znormalizowana).find(f => f.firma_znormalizowana === oferta.firma_znormalizowana);
  if (znaleziona) {
    return { ...oferta, firma_znana: true,
      kraj_siedziby: znaleziona.kraj_siedziby || '', pewnosc_kraj_siedziby: znaleziona.pewnosc_kraj || '',
      typ_firmy: znaleziona.typ_firmy || '', pewnosc_typ_firmy: znaleziona.pewnosc_typ || '',
      wielkosc_firmy: znaleziona.wielkosc_firmy || '', pewnosc_wielkosc_firmy: znaleziona.pewnosc_wielkosc || '',
    };
  }
  return { ...oferta, firma_znana: false };
}

/** Wiersze do dopisania w "Firmy": udane oceny nieznanych firm, jedna firma = jeden wiersz (W-25). */
export function wierszeNowychFirm(wyniki: Rekord[], teraz: Date): Record<string, string>[] {
  const widziane = new Set<string>();
  const wiersze: Record<string, string>[] = [];
  for (const w of wyniki) {
    if (w.firma_znana !== false || w.etap4_klasa !== 'ocenione') continue;
    const klucz = String(w.firma_znormalizowana || '');
    if (!klucz || widziane.has(klucz)) continue;
    widziane.add(klucz);
    wiersze.push({
      firma_znormalizowana: klucz,
      kraj_siedziby: String(w.kraj_siedziby ?? ''),
      typ_firmy: String(w.typ_firmy ?? ''),
      wielkosc_firmy: String(w.wielkosc_firmy ?? ''),
      pewnosc_kraj: String(w.pewnosc_kraj_siedziby ?? ''),
      pewnosc_typ: String(w.pewnosc_typ_firmy ?? ''),
      pewnosc_wielkosc: String(w.pewnosc_wielkosc_firmy ?? ''),
      data_ustalenia: isoWarszawa(teraz),
      liczba_ofert: '1',
    });
  }
  return wiersze;
}
