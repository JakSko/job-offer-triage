// CV dla modelu: plik app/dane/cv.md (w repo, ten sam na laptopie i na Railway), generowany komendą
// `odswiez-cv` z pliku master .docx. Przy przebiegu na laptopie aplikacja sprawdza, czy master nie
// zmienił się od ostatniego odświeżenia, i ostrzega; ocenia zawsze na tym, co jest w cv.md.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { czasWarszawa } from '../sheets/dates.js';
import { konwertujDocx, type WynikKonwersji } from './docx.js';

const KATALOG_APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const PLIK_CV = path.join(KATALOG_APP, 'dane', 'cv.md');
export const DOMYSLNY_MASTER = path.resolve(KATALOG_APP, 'dane/cv_master.docx');

export interface Cv {
  tresc: string;
  /** Data ostatniej zmiany pliku master w chwili odświeżenia (RRRR-MM-DD); trafia do wersja_promptu. */
  masterZmieniony: string;
  skrot: string;
}

const skrot = (tresc: string) => createHash('sha256').update(tresc).digest('hex').slice(0, 12);

export function wczytajCv(plik: string = PLIK_CV): Cv {
  if (!fs.existsSync(plik)) throw new Error(`Brak pliku CV dla modelu (${plik}). Uruchom: node dist/cli.js odswiez-cv`);
  const m = fs.readFileSync(plik, 'utf8').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Plik ${plik} nie ma nagłówka (---). Uruchom: node dist/cli.js odswiez-cv`);
  const meta = Object.fromEntries(m[1].split('\n').map(l => l.split(/:\s*/, 2) as [string, string]));
  const tresc = m[2].trim() + '\n';
  if (meta.skrot !== skrot(tresc)) {
    throw new Error(`Plik ${plik} został zmieniony ręcznie (skrót się nie zgadza). Zmiany wprowadzaj w pliku master i uruchom: node dist/cli.js odswiez-cv`);
  }
  return { tresc, masterZmieniony: meta.master_zmieniony ?? '', skrot: meta.skrot };
}

export interface WynikOdswiezenia extends WynikKonwersji {
  zmienione: boolean;
  dodane: string[];
  usunieteWzgledemPoprzedniej: string[];
  masterZmieniony: string;
}

/** Buduje cv.md z pliku master. Zapisuje tylko, gdy konwersja przeszła kontrolę jakości. */
export function odswiezCv(master: string, plik: string = PLIK_CV, zapisz = true): WynikOdswiezenia {
  if (!fs.existsSync(master)) throw new Error(`Nie znaleziono pliku master CV: ${master}`);
  const wynik = konwertujDocx(fs.readFileSync(master));
  // data w czasie polskim (zapis o 00:28 to już nowy dzień, choć w UTC jeszcze poprzedni)
  const masterZmieniony = czasWarszawa(fs.statSync(master).mtime).dzien;

  let poprzednia = '';
  let poprzedniaData = '';
  try { const cv = wczytajCv(plik); poprzednia = cv.tresc; poprzedniaData = cv.masterZmieniony; } catch { /* brak albo uszkodzony plik: traktujemy jak pierwsze odświeżenie */ }
  const stare = new Set(poprzednia.split('\n').filter(Boolean));
  const nowe = new Set(wynik.markdown.split('\n').filter(Boolean));
  const dodane = [...nowe].filter(l => !stare.has(l));
  const usunieteWzgledemPoprzedniej = [...stare].filter(l => !nowe.has(l));
  const zmienione = poprzednia !== wynik.markdown || poprzedniaData !== masterZmieniony;

  if (zapisz && zmienione) {
    fs.mkdirSync(path.dirname(plik), { recursive: true });
    fs.writeFileSync(plik, [
      '---',
      `zrodlo: ${path.basename(master)}`,
      `master_zmieniony: ${masterZmieniony}`,
      `skrot: ${skrot(wynik.markdown)}`,
      '---',
      wynik.markdown,
    ].join('\n'));
  }
  return { ...wynik, zmienione, dodane, usunieteWzgledemPoprzedniej, masterZmieniony };
}

/**
 * Czy plik master różni się od cv.md? Zwraca opis do ostrzeżenia albo null (aktualne / brak pliku
 * master, np. na Railway). Błąd konwersji mastera też jest ostrzeżeniem, nie awarią przebiegu.
 */
export function ostrzezenieONieaktualnymCv(master: string, cv: Cv): string | null {
  if (!fs.existsSync(master)) return null;
  try {
    const swieze = konwertujDocx(fs.readFileSync(master)).markdown;
    if (swieze === cv.tresc) return null;
    return `Plik master CV (${path.basename(master)}) rozni sie od wersji uzywanej do ocen (CV ${cv.masterZmieniony}). Uruchom: node dist/cli.js odswiez-cv`;
  } catch (e) {
    return `Nie udalo sie sprawdzic pliku master CV: ${e instanceof Error ? e.message : e}`;
  }
}
