// "Etap4: policz i sklasyfikuj" (config/etap4_policz_i_sklasyfikuj.js, W-10): kopia oceny z 30 dni,
// oferta do oceny AI albo ponad limit przebiegu. Wiersze "NIEOCENIONE (...)" nie są kopiowane.
import { parsujDate } from '../sheets/dates.js';

export function normalizeFirma(s: unknown): string {
  return String(s || '')
    .toLowerCase()
    .replace(/sp\.?\s*z\s*o\.?\s*o\.?/g, '')
    .replace(/\bs\.?a\.?\b/g, '')
    .replace(/[^a-z0-9ąćęłńóśźż]+/g, ' ')
    .trim();
}
export function normalizeTytul(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/g, ' ').trim();
}

const DNI_REUSE = 30;

const POLA_KOPII = [
  'dopasowanie_krok1', 'najlepszy_profil', 'dopasowanie_krok2', 'korekta_wzgledem_kroku1', 'uzasadnienie_krok2',
  'poziom_stanowiska', 'pewnosc_poziom_stanowiska', 'kraj_siedziby', 'pewnosc_kraj_siedziby', 'typ_firmy',
  'pewnosc_typ_firmy', 'wielkosc_firmy', 'pewnosc_wielkosc_firmy', 'tryb_pracy', 'widelki_placowe',
  'liczba_zer_twardych', 'niespelnione_wymagania_twarde', 'tryb_lokalizacji', 'sygnaly_do_sprawdzenia',
  'rekomendacja_ai', 'regula_kodu',
] as const;

export type Rekord = Record<string, any>;

export function sklasyfikuj(oferty: Rekord[], historia: Rekord[], limit: number, teraz: number = Date.now()): Rekord[] {
  let licznikDoOceny = 0;
  const wynik: Rekord[] = [];

  for (const it of oferty) {
    const firmaN = normalizeFirma(it.company || it.firma);
    const tytulN = normalizeTytul(it.title || it.tytul);

    const powtorzona = historia.find(h => {
      if (!h.rekomendacja || /^NIEOCENIONE/i.test(String(h.rekomendacja))) return false;
      if (normalizeFirma(h.firma) !== firmaN) return false;
      if (normalizeTytul(h.tytul) !== tytulN) return false;
      const data = h.data_wykrycia ? parsujDate(h.data_wykrycia) : null;
      if (!data) return false;
      return (teraz - data) <= DNI_REUSE * 24 * 60 * 60 * 1000;
    });

    if (powtorzona) {
      const kopia: Rekord = { ...it, etap4_klasa: 'kopia_powtorzonej_oferty',
        rekomendacja: powtorzona.rekomendacja || '',
        uzasadnienie_rekomendacji: 'Kopia oceny powtorzonej oferty (ta sama firma+tytul), oryginal z ' + (powtorzona.data_wykrycia || 'nieznanej daty'),
      };
      for (const p of POLA_KOPII) kopia[p] = powtorzona[p] || '';
      // wersja_promptu oryginału albo "przed-v3", żeby odróżnić kopie starych ocen
      kopia.wersja_promptu = powtorzona.wersja_promptu || 'przed-v3';
      kopia.zuzycie_tokenow = '';
      wynik.push(kopia);
      continue;
    }

    if (licznikDoOceny >= limit) {
      wynik.push({ ...it, etap4_klasa: 'limit_przebiegu',
        rekomendacja: 'NIEOCENIONE (LIMIT PRZEBIEGU)',
        uzasadnienie_rekomendacji: 'Przekroczony limit ' + limit + ' pelnych ocen AI na ten przebieg - ocen recznie albo poczekaj na kolejny przebieg.',
      });
      continue;
    }

    licznikDoOceny++;
    wynik.push({ ...it, etap4_klasa: 'do_oceny', firma_znormalizowana: firmaN, tytul_znormalizowany: tytulN });
  }

  return wynik;
}

/**
 * Powtórki w jednym przebiegu (decyzja produktowa): oferty o tej samej znormalizowanej firmie
 * i tytule, różniące się np. tylko lokalizacją. Do oceny AI idzie pierwsza ("wzorzec"), pozostałe
 * dostają kopię jej oceny i nie zużywają limitu. Gdy wzorzec ma już kopię z historii albo wypadł
 * ponad limit, powtórki są klasyfikowane zwykłą regułą (kopia z historii / limit).
 */
export interface Powtorka {
  oferta: Rekord;
  /** dedupKey oferty, której ocena zostanie skopiowana. */
  wzorzec: string;
}

export function sklasyfikujZPowtorkami(
  oferty: Rekord[], historia: Rekord[], limit: number, teraz: number = Date.now(),
): { sklasyfikowane: Rekord[]; powtorki: Powtorka[] } {
  const klucz = (it: Rekord) => {
    const f = normalizeFirma(it.company || it.firma);
    const t = normalizeTytul(it.title || it.tytul);
    return f && t ? f + '|' + t : null;
  };
  const pierwsze = new Map<string, Rekord>();
  const wzorce: Rekord[] = [];
  const dalsze: Rekord[] = [];
  for (const it of oferty) {
    const k = klucz(it);
    if (k && pierwsze.has(k)) { dalsze.push(it); continue; }
    if (k) pierwsze.set(k, it);
    wzorce.push(it);
  }

  const sklasyfikowane = sklasyfikuj(wzorce, historia, limit, teraz);
  const klasaWzorca = new Map(sklasyfikowane.map(x => [klucz(x), x] as const));
  const powtorki: Powtorka[] = [];
  for (const it of dalsze) {
    const wzorzec = klasaWzorca.get(klucz(it))!;
    if (wzorzec.etap4_klasa === 'do_oceny') powtorki.push({ oferta: it, wzorzec: wzorzec.dedupKey });
    else sklasyfikowane.push(...sklasyfikuj([it], historia, 0, teraz));
  }
  return { sklasyfikowane, powtorki };
}

/** Kopia świeżej oceny wzorca dla powtórki z tego samego przebiegu; null, gdy wzorzec nie został oceniony. */
export function kopiaZPrzebiegu(oferta: Rekord, wynikWzorca: Rekord | undefined): Rekord | null {
  if (!wynikWzorca || wynikWzorca.etap4_klasa !== 'ocenione') return null;
  const kopia: Rekord = { ...oferta, etap4_klasa: 'kopia_powtorzonej_oferty',
    rekomendacja: wynikWzorca.rekomendacja || '',
    uzasadnienie_rekomendacji: 'Kopia oceny z tego samego przebiegu (ta sama firma+tytul, inna lokalizacja lub numer oferty), wzorzec: ' + wynikWzorca.dedupKey,
  };
  for (const p of POLA_KOPII) kopia[p] = wynikWzorca[p] ?? '';
  kopia.wersja_promptu = wynikWzorca.wersja_promptu || '';
  kopia.zuzycie_tokenow = '';
  return kopia;
}
