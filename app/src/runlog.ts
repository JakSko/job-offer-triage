// Zakładka "Przebiegi" (W-27): jeden wiersz na przebieg, oraz blokada przed dwoma przebiegami naraz (W-28).
import type { Arkusz, Tabela } from './sheets/client.js';
import { isoWarszawa, parsujDate } from './sheets/dates.js';

export const ZAKLADKA_PRZEBIEGI = 'Przebiegi';

export const KOLUMNY_PRZEBIEGI = [
  'start', 'koniec', 'tryb', 'status', 'maile_pracuj', 'maile_linkedin', 'maile_pominiete',
  'oferty_nowe_pracuj', 'oferty_nowe_linkedin', 'przeszly_filtr', 'zalegle_wziete', 'ocenione_ai',
  'aplikuj', 'obserwuj', 'pomin', 'kopie', 'brak_tresci', 'bledy_ai', 'limit', 'zalegle_czekajace',
  'pushe', 'heartbeat_wyslany', 'czas_s', 'komunikat',
] as const;

export type Liczniki = Partial<Record<(typeof KOLUMNY_PRZEBIEGI)[number], string | number>>;

const BLOKADA_MIN = 45;

export interface Przebieg {
  tabela: Tabela;
  nrWiersza: number;
  start: Date;
}

/** Tworzy zakładkę "Przebiegi", jeśli jej nie ma. Zwraca true, gdy utworzono. */
export async function zapewnijZakladkePrzebiegi(arkusz: Arkusz): Promise<boolean> {
  if ((await arkusz.zakladki()).includes(ZAKLADKA_PRZEBIEGI)) return false;
  await arkusz.utworzZakladke(ZAKLADKA_PRZEBIEGI, [...KOLUMNY_PRZEBIEGI]);
  return true;
}

/** Wiersz "w toku" młodszy niż 45 min blokuje; starsze "w toku" to przebiegi przerwane. */
export function ocenBlokade(tabela: Tabela, teraz: number): { blokuje: boolean; przerwane: number[] } {
  let blokuje = false;
  const przerwane: number[] = [];
  for (const w of tabela.wiersze) {
    if (w.status !== 'w toku') continue;
    const start = parsujDate(w.start);
    if (start !== null && teraz - start < BLOKADA_MIN * 60 * 1000) blokuje = true;
    else przerwane.push(w._nr);
  }
  return { blokuje, przerwane };
}

/**
 * Start przebiegu: sprawdza blokadę i dopisuje wiersz "w toku". Zwraca null, gdy inny przebieg trwa
 * (wtedy dopisuje wiersz "pominiety-blokada").
 */
export async function rozpocznijPrzebieg(arkusz: Arkusz, tryb: string, start: Date): Promise<Przebieg | null> {
  await zapewnijZakladkePrzebiegi(arkusz);
  const tabela = await arkusz.czytaj(ZAKLADKA_PRZEBIEGI);
  const brak = KOLUMNY_PRZEBIEGI.filter(k => !tabela.kolumny.has(k));
  if (brak.length) throw new Error(`Zakladka "${ZAKLADKA_PRZEBIEGI}": brak kolumn: ${brak.join(', ')}`);

  const { blokuje, przerwane } = ocenBlokade(tabela, start.getTime());
  if (przerwane.length) {
    await arkusz.zmien(tabela, przerwane.map(nr => ({ nrWiersza: nr, wartosci: { status: 'przerwany' } })));
  }
  const teraz = isoWarszawa(start);
  if (blokuje) {
    await arkusz.dopisz(tabela, [{ start: teraz, koniec: teraz, tryb, status: 'pominiety-blokada',
      komunikat: `Inny przebieg jest w toku (wiersz "w toku" mlodszy niz ${BLOKADA_MIN} min).` }]);
    return null;
  }
  const [nrWiersza] = await arkusz.dopisz(tabela, [{ start: teraz, tryb, status: 'w toku' }]);
  return { tabela, nrWiersza, start };
}

export async function zakonczPrzebieg(arkusz: Arkusz, p: Przebieg, status: 'ok' | 'awaria', liczniki: Liczniki, komunikat = ''): Promise<void> {
  const koniec = new Date();
  await arkusz.zmien(p.tabela, [{ nrWiersza: p.nrWiersza, wartosci: {
    ...liczniki, koniec: isoWarszawa(koniec), status,
    czas_s: Math.round((koniec.getTime() - p.start.getTime()) / 1000),
    komunikat: komunikat.slice(0, 500),
  } }]);
}
