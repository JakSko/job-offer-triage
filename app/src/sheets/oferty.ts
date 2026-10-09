// Zakładka "Oferty": kontrakt kolumn (docs/migracja/02_kontrakt_arkusza.md), dopisywanie nowych ofert
// (W-08) i zapis wyniku oceny do istniejącego wiersza (W-16). Kolumn ręcznych aplikacja nie dotyka.
import type { OfertaPoFiltrze } from '../types.js';
import type { Arkusz, Tabela, ZmianaKomorek } from './client.js';
import { isoWarszawa } from './dates.js';

export const ZAKLADKA_OFERTY = 'Oferty';

export const KOLUMNY_NOWEJ_OFERTY = [
  'klucz_oferty', 'zrodlo', 'tytul', 'firma', 'lokalizacja', 'url', 'data_wykrycia',
  'przeszlo_filtr_slow_kluczowych', 'dopasowane_profile',
] as const;

/** 25 kolumn wyniku (te same pola mapował węzeł "Etap5: zapisz wynik do arkusz"). */
export const KOLUMNY_WYNIKU = [
  'rekomendacja', 'uzasadnienie_rekomendacji', 'dopasowanie_krok1', 'najlepszy_profil', 'dopasowanie_krok2',
  'korekta_wzgledem_kroku1', 'uzasadnienie_krok2', 'poziom_stanowiska', 'pewnosc_poziom_stanowiska',
  'kraj_siedziby', 'pewnosc_kraj_siedziby', 'typ_firmy', 'pewnosc_typ_firmy', 'wielkosc_firmy',
  'pewnosc_wielkosc_firmy', 'tryb_pracy', 'widelki_placowe', 'liczba_zer_twardych',
  'niespelnione_wymagania_twarde', 'tryb_lokalizacji', 'sygnaly_do_sprawdzenia', 'rekomendacja_ai',
  'regula_kodu', 'wersja_promptu', 'zuzycie_tokenow',
] as const;

export const KOLUMNY_WYMAGANE_OFERTY: readonly string[] = [...KOLUMNY_NOWEJ_OFERTY, ...KOLUMNY_WYNIKU];

/** Kolumna nieobowiązkowa (W-36): data maila, z którego oferta trafiła do arkusza po raz pierwszy. */
export const KOLUMNA_DATA_MAILA = 'data_maila';

function dataMailaWarszawa(iso: string | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? '' : isoWarszawa(new Date(t));
}

export function brakujaceKolumny(tabela: Tabela, wymagane: readonly string[]): string[] {
  return wymagane.filter(k => !tabela.kolumny.has(k));
}

export function wierszNowejOferty(o: OfertaPoFiltrze, teraz: Date): Record<string, string> {
  return {
    klucz_oferty: o.dedupKey ?? '',
    zrodlo: o.source,
    tytul: o.title,
    firma: o.company ?? '',
    lokalizacja: o.location ?? '',
    url: o.url,
    data_wykrycia: isoWarszawa(teraz),
    przeszlo_filtr_slow_kluczowych: o.passesFilter ? 'tak' : 'nie',
    dopasowane_profile: o.matchedProfiles.join(', '),
    [KOLUMNA_DATA_MAILA]: dataMailaWarszawa(o.dataMaila),
  };
}

/** Dedup (W-07): nowe = klucza nie ma w arkuszu ani wcześniej w tym przebiegu. Oferta bez klucza odpada. */
export function oznaczNowe<T extends { dedupKey: string | null }>(oferty: T[], kluczeWArkuszu: Iterable<string>): T[] {
  const istniejace = new Set([...kluczeWArkuszu].map(k => String(k).trim()).filter(Boolean));
  const wPrzebiegu = new Set<string>();
  return oferty.filter(o => {
    if (!o.dedupKey) return false;
    const k = String(o.dedupKey).trim();
    if (istniejace.has(k) || wPrzebiegu.has(k)) return false;
    wPrzebiegu.add(k);
    return true;
  });
}

/** Wynik oceny jednej oferty: płaski rekord jak w n8n (pola wyniku + dedupKey). */
export type Wynik = Record<string, any> & { dedupKey: string };

export function zmianyWynikow(wyniki: Wynik[], nrWierszaWgKlucza: Map<string, number>): { zmiany: ZmianaKomorek[]; bezWiersza: string[] } {
  const zmiany: ZmianaKomorek[] = [];
  const bezWiersza: string[] = [];
  for (const w of wyniki) {
    const nr = nrWierszaWgKlucza.get(String(w.dedupKey).trim());
    if (!nr) { bezWiersza.push(w.dedupKey); continue; }
    const wartosci: Record<string, string> = {};
    for (const k of KOLUMNY_WYNIKU) wartosci[k] = w[k] === undefined || w[k] === null ? '' : String(w[k]);
    zmiany.push({ nrWiersza: nr, wartosci });
  }
  return { zmiany, bezWiersza };
}

/** Dopisuje nowe oferty. Gdy arkusz nie ma kolumny `data_maila`, pomija ją (W-36) i zwraca `bezDatyMaila`. */
export async function dopiszNoweOferty(arkusz: Arkusz, tabela: Tabela, oferty: OfertaPoFiltrze[], teraz: Date): Promise<{ numery: number[]; bezDatyMaila: boolean }> {
  const bezDatyMaila = !tabela.kolumny.has(KOLUMNA_DATA_MAILA);
  const wiersze = oferty.map(o => {
    const w = wierszNowejOferty(o, teraz);
    if (bezDatyMaila) delete w[KOLUMNA_DATA_MAILA];
    return w;
  });
  return { numery: await arkusz.dopisz(tabela, wiersze), bezDatyMaila };
}
