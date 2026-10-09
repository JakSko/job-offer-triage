// Codzienny push "podsumowanie dnia" (W-31): pierwszy przebieg po godzinie HEARTBEAT_GODZINA
// czasu polskiego wysyła sumy z zakładki "Przebiegi" z bieżącego dnia. Brak tego pusha wieczorem
// = sygnał, że aplikacja nie działa.
import type { Liczniki } from '../runlog.js';
import type { Wiersz } from '../sheets/client.js';
import { czasWarszawa, parsujDate } from '../sheets/dates.js';

export const TYTUL_HEARTBEAT = 'Oferty pracy - podsumowanie dnia';

const dzienWiersza = (w: Wiersz) => {
  const t = parsujDate(w.start);
  return t === null ? null : czasWarszawa(new Date(t)).dzien;
};

/** Czy ten przebieg ma wysłać podsumowanie dnia. */
export function czyWyslacHeartbeat(wierszePrzebiegow: Wiersz[], teraz: Date, godzina: number, wymus = false): boolean {
  if (wymus) return true;
  const { godzina: g, dzien } = czasWarszawa(teraz);
  if (g < godzina) return false;
  return !wierszePrzebiegow.some(w => dzienWiersza(w) === dzien && w.heartbeat_wyslany === 'tak');
}

/** Treść podsumowania: wcześniejsze przebiegi z dziś (z arkusza) + bieżący przebieg (liczniki w pamięci). */
export function zbudujHeartbeat(wierszePrzebiegow: Wiersz[], biezacy: Liczniki, teraz: Date, tryb: string): string {
  const { dzien } = czasWarszawa(teraz);
  const dzis = wierszePrzebiegow.filter(w => dzienWiersza(w) === dzien);
  const rekordy: Record<string, string | number | undefined>[] = [...dzis, { ...biezacy, status: 'ok' }];
  const suma = (k: string) => rekordy.reduce((s, w) => s + (Number(w[k]) || 0), 0);
  const ile = (status: string) => rekordy.filter(w => w.status === status).length;

  const awarie = ile('awaria') + ile('przerwany');
  const linie = [
    `${dzien}, tryb ${tryb}: aplikacja dziala.`,
    `Przebiegi: ${rekordy.length} (ok ${ile('ok')}, awarie ${awarie}, pominiete ${ile('pominiety-blokada')})`,
    `Maile: Pracuj.pl ${suma('maile_pracuj')}, LinkedIn ${suma('maile_linkedin')}${suma('maile_pominiete') ? `, niespojne ${suma('maile_pominiete')}` : ''}`,
    `Nowe oferty: Pracuj.pl ${suma('oferty_nowe_pracuj')}, LinkedIn ${suma('oferty_nowe_linkedin')} (przeszly filtr ${suma('przeszly_filtr')})`,
    `Oceny: aplikuj ${suma('aplikuj')}, obserwuj ${suma('obserwuj')}, pomin ${suma('pomin')} (ocen AI ${suma('ocenione_ai')}, kopii ${suma('kopie')})`,
    `Nieocenione: brak tresci ${suma('brak_tresci')}, blad AI ${suma('bledy_ai')}, limit ${suma('limit')}`,
    `Czeka w kolejce: ${Number(biezacy.zalegle_czekajace) || 0}`,
  ];
  if (awarie) linie.push('Sprawdz zakladke "Przebiegi" (kolumna komunikat).');
  return linie.join('\n');
}
