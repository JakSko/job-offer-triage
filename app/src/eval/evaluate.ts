// Ocena ofert zakwalifikowanych jako "do_oceny" (Etap 4, W-11..W-14, W-26; LinkedIn: W-37):
// pobranie treści (szeregowo, z odstępem) -> opis -> cache firm -> OpenAI (do 2 naraz) -> reguły kodu.
// Błąd pojedynczej oferty nie przerywa przebiegu. Po przekroczeniu limitu czasu nie zaczyna kolejnych
// ofert: zostają bez oceny i wrócą z kolejki zaległych w następnym przebiegu.
import pLimit from 'p-limit';
import type { Rekord } from './classify.js';
import { sprawdzFirme } from './companies.js';
import { zbudujOpis } from './description.js';
import { ODSTEP_JINA_MS } from './fetch.js';
import { zbudujZapytanie } from './openai.js';
import { sparsujOdpowiedz } from './rules.js';

const ROWNOLEGLE_OCENY = 2;

export interface ZaleznosciOceny {
  pobierzTresc: (url: string) => Promise<string | null>;
  wywolajModel: (zadanie: unknown) => Promise<any>;
  czekaj?: (ms: number) => Promise<void>;
  teraz?: () => number;
  /** Budowa opisu z pobranej treści; domyślnie zbudujOpis (Pracuj.pl). LinkedIn: zbudujOpisLinkedin. */
  zbudujOpis?: (oferta: Rekord, surowy: string | null) => Rekord;
  /** Odstęp między pobraniami; domyślnie ODSTEP_JINA_MS. */
  odstepMs?: number;
  /** Powód zatrzymania pobierania (np. hamulec LinkedIn) albo null; reszta ofert trafia do nieZdazyly. */
  czyPrzerwac?: () => string | null;
}

export interface OpcjeOceny {
  model: string;
  /** Pełny prompt systemowy (zlozPrompt) i wartość kolumny wersja_promptu dla ocen z tego przebiegu. */
  instrukcja: string;
  wersja: string;
  /** Moment, po którym nie zaczynamy kolejnych ofert (ms od epoki). */
  termin: number;
  log: (linia: string) => void;
}

export async function ocenOferty(
  doOceny: Rekord[], firmy: Rekord[], opcje: OpcjeOceny, z: ZaleznosciOceny,
): Promise<{ wyniki: Rekord[]; nieZdazyly: Rekord[] }> {
  const czekaj = z.czekaj ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const teraz = z.teraz ?? Date.now;
  const budujOpis = z.zbudujOpis ?? zbudujOpis;
  const odstepMs = z.odstepMs ?? ODSTEP_JINA_MS;
  const kolejka = pLimit(ROWNOLEGLE_OCENY);
  const wyniki: (Rekord | undefined)[] = new Array(doOceny.length);
  const zadania: Promise<void>[] = [];
  let nieZdazyly: Rekord[] = [];
  let ostatniePobranie = 0;

  for (let i = 0; i < doOceny.length; i++) {
    if (teraz() > opcje.termin) {
      nieZdazyly = doOceny.slice(i);
      opcje.log(`Limit czasu przebiegu: ${nieZdazyly.length} ofert zostaje bez oceny do nastepnego przebiegu.`);
      break;
    }
    const przerwa = z.czyPrzerwac?.();
    if (przerwa) {
      nieZdazyly = doOceny.slice(i);
      opcje.log(`Pobieranie zatrzymane (${przerwa}): ${nieZdazyly.length} ofert zostaje bez oceny do nastepnego przebiegu.`);
      break;
    }
    const oferta = doOceny[i];
    const odstep = ostatniePobranie + odstepMs - teraz();
    if (ostatniePobranie && odstep > 0) await czekaj(odstep);
    ostatniePobranie = teraz();

    const opis = budujOpis(oferta, await z.pobierzTresc(String(oferta.url || '')));
    if (opis.etap4_klasa !== 'do_oceny_ai') {
      opcje.log(`  [${i + 1}/${doOceny.length}] ${oferta.dedupKey}: brak tresci (${opis.powod_braku_tresci})`);
      wyniki[i] = opis;
      continue;
    }

    zadania.push(kolejka(async () => {
      const zapytanie = zbudujZapytanie(sprawdzFirme(opis, firmy), opcje.model, opcje.instrukcja);
      let wynik: Rekord;
      try {
        wynik = sparsujOdpowiedz(zapytanie, await z.wywolajModel(zapytanie.openai_request), opcje.wersja);
      } catch (e) {
        wynik = sparsujOdpowiedz(zapytanie, { error: { message: e instanceof Error ? e.message : String(e) } }, opcje.wersja);
      }
      opcje.log(`  [${i + 1}/${doOceny.length}] ${oferta.dedupKey}: ${wynik.rekomendacja}${wynik.regula_kodu ? ' (regula: ' + wynik.regula_kodu + ')' : ''} | opis ${String(opis.opis_oferty).length} zn. | ${wynik.zuzycie_tokenow || 'brak danych o zuzyciu'}`);
      wyniki[i] = wynik;
    }));
  }

  await Promise.all(zadania);
  return { wyniki: wyniki.filter((w): w is Rekord => w !== undefined), nieZdazyly };
}
