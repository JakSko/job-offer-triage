// Kolejka zaległych (W-24): oferty Pracuj.pl już zapisane w arkuszu, które przeszły filtr, a nie mają
// oceny (pusta rekomendacja albo "NIEOCENIONE (LIMIT PRZEBIEGU)"), wykryte w ostatnich N dniach.
// Wracają do Etapu 4 przed nowymi ofertami, najstarsze pierwsze.
import { filtrujTytul } from '../filter/keywords.js';
import type { Wiersz } from '../sheets/client.js';
import { parsujDate } from '../sheets/dates.js';
import type { OfertaPoFiltrze } from '../types.js';

export const REKOMENDACJA_LIMIT = 'NIEOCENIONE (LIMIT PRZEBIEGU)';

export function czyZalegla(w: Record<string, string>, dni: number, teraz: number): boolean {
  if (w.zrodlo !== 'pracuj.pl' || w.przeszlo_filtr_slow_kluczowych !== 'tak') return false;
  const rekomendacja = String(w.rekomendacja || '').trim();
  if (rekomendacja !== '' && rekomendacja !== REKOMENDACJA_LIMIT) return false;
  const data = parsujDate(w.data_wykrycia);
  return data !== null && teraz - data <= dni * 24 * 60 * 60 * 1000;
}

export function wybierzZalegle(wiersze: Wiersz[], dni: number, teraz: number = Date.now()): OfertaPoFiltrze[] {
  return wiersze
    .filter(w => String(w.klucz_oferty || '').trim() && czyZalegla(w, dni, teraz))
    .sort((a, b) => (parsujDate(a.data_wykrycia)! - parsujDate(b.data_wykrycia)!) || (a._nr - b._nr))
    .map(w => {
      const klucz = w.klucz_oferty.trim();
      // profile z Etapu 2 liczone ponownie z tytułu; oferta zostaje w kolejce nawet, gdy dzisiejsze
      // reguły by ją odrzuciły (w arkuszu ma "tak")
      const f = filtrujTytul(w.tytul);
      return {
        source: 'pracuj.pl' as const, title: w.tytul, company: w.firma || null, location: w.lokalizacja || null,
        url: w.url, offerId: klucz.split(':')[1] ?? null, dedupKey: klucz,
        matchedProfiles: f.matchedProfiles, noiseReason: f.noiseReason, passesFilter: true,
      };
    });
}
