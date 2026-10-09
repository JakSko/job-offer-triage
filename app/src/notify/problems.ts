// Pushe z problemami przebiegu (W-18), logika 1:1 z config/n1_raport_problemow_pracuj_pl.js
// i config/n1_raport_problemow_linkedin.js. W n8n dane łączyła "workflow static data"; tu wszystko
// jest w pamięci przebiegu. Nowe względem n8n: liczba ofert czekających w kolejce zaległych (W-24)
// i ostrzeżenia przebiegu (np. nieaktualne CV, W-34) dopisywane na końcu raportu Pracuj.pl.
import type { Rekord } from '../eval/classify.js';
import type { PominietyMail } from '../types.js';

export const TYTUL_PROBLEMY_PRACUJ = 'Oferty pracy - problemy (Pracuj.pl)';
export const TYTUL_PROBLEMY_LINKEDIN = 'Oferty pracy - problemy (LinkedIn)';

const PRZYKLADOW = 5;
const MAX_ZNAKOW_WIADOMOSCI = 3500;

const ETYKIETY_POWODU: Record<string, string> = {
  blokada: 'strona zablokowala pobranie (Cloudflare)',
  pusta_strona: 'strona bez pelnej tresci (wygasla oferta / inny uklad)',
  blad_pobrania: 'blad pobrania lub przekroczony czas',
  nieznany: 'nieznany powod',
};

export interface DaneProblemowPracuj {
  pominieteMaile: PominietyMail[];
  /** Wyniki etapu "zbuduj opis" dla wszystkich pobranych ofert (do liczby "z N pobranych"). */
  pobrane: Rekord[];
  /** Wyniki oceny AI (szukamy w nich blad_parsowania). */
  ocenione: Rekord[];
  ponadLimit: number;
  /** Nowe względem n8n. */
  zalegleCzekajace?: number;
  ostrzezenia?: string[];
}

/** Treść pusha albo null, gdy nie ma problemów. */
export function zbudujPushProblemowPracuj(d: DaneProblemowPracuj): string | null {
  const brakTresci = d.pobrane.filter(o => o.etap4_klasa === 'brak_tresci');
  const bladParsowania = d.ocenione.filter(o => o.etap4_klasa === 'blad_parsowania');
  const linie: string[] = [];

  if (d.pominieteMaile.length > 0) {
    linie.push(`Pominiete maile (${d.pominieteMaile.length}):`);
    for (const m of d.pominieteMaile) {
      linie.push(`- "${m.subject || 'brak tematu'}" (${m.receivedAt || 'brak daty'}): titles=${m.liczniki.titles}, companies=${m.liczniki.companies}, urls=${m.liczniki.urls}`);
    }
  }

  if (brakTresci.length > 0) {
    linie.push(`Brak pelnej tresci oferty: ${brakTresci.length} z ${d.pobrane.length} pobranych`);
    const wgPowodu: Record<string, number> = {};
    for (const o of brakTresci) {
      const p = o.powod_braku_tresci || 'nieznany';
      wgPowodu[p] = (wgPowodu[p] || 0) + 1;
    }
    for (const [p, ile] of Object.entries(wgPowodu)) {
      linie.push(`- ${ETYKIETY_POWODU[p] || p}: ${ile}`);
    }
    for (const o of brakTresci.slice(0, PRZYKLADOW)) {
      linie.push(`  * ${o.title || '(brak tytulu)'} - ${o.url || ''}`);
    }
    if (brakTresci.length > PRZYKLADOW) {
      linie.push(`  ... i ${brakTresci.length - PRZYKLADOW} kolejnych (wszystkie w arkuszu: NIEOCENIONE (BRAK PELNEJ TRESCI))`);
    }
  }

  if (bladParsowania.length > 0) {
    linie.push(`Blad odpowiedzi AI (${bladParsowania.length}):`);
    for (const o of bladParsowania.slice(0, PRZYKLADOW)) {
      linie.push(`- ${o.title || '(brak tytulu)'} - ${o.url || ''}: ${String(o.uzasadnienie_rekomendacji || '').slice(0, 120)}`);
    }
    if (bladParsowania.length > PRZYKLADOW) {
      linie.push(`  ... i ${bladParsowania.length - PRZYKLADOW} kolejnych`);
    }
  }

  if (d.ponadLimit > 0) {
    linie.push(`Oferty ponad limit przebiegu (nieocenione): ${d.ponadLimit}`);
  }
  if (d.zalegleCzekajace && d.zalegleCzekajace > 0) {
    linie.push(`Oferty czekajace w kolejce do oceny w nastepnym przebiegu: ${d.zalegleCzekajace}`);
  }
  for (const o of d.ostrzezenia ?? []) linie.push(`Uwaga: ${o}`);

  if (linie.length === 0) return null;

  let message = 'Pracuj.pl - problemy w przebiegu:\n' + linie.join('\n');
  if (message.length > MAX_ZNAKOW_WIADOMOSCI) {
    message = message.slice(0, MAX_ZNAKOW_WIADOMOSCI - 3) + '...';
  }
  return message;
}

/** Treść pusha albo null, gdy nie ma problemów. LinkedIn nie jest oceniany, więc jedyny problem to niespójne maile. */
export function zbudujPushProblemowLinkedin(pominieteMaile: PominietyMail[]): string | null {
  if (pominieteMaile.length === 0) return null;
  const linie = [`Pominiete maile (${pominieteMaile.length}):`];
  for (const m of pominieteMaile) {
    linie.push(`- "${m.subject || 'brak tematu'}" (${m.receivedAt || 'brak daty'}): titles=${m.liczniki.titles}, urls=${m.liczniki.urls}, companyLines=${m.liczniki.companyLines}`);
  }
  return 'LinkedIn - problemy w przebiegu:\n' + linie.join('\n');
}
