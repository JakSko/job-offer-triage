// Rozbiór surowego maila (MIME) na pola używane dalej: html, temat, nadawca, data.
// Odpowiednik węzłów "Mapuj html: X" (config/etap1_mapuj_html_*.js).
import fs from 'node:fs/promises';
import path from 'node:path';
import { simpleParser } from 'mailparser';
import type { Mail } from '../types.js';

export async function rozbierzMail(surowy: Buffer | string, id: string): Promise<Mail> {
  const m = await simpleParser(surowy);
  return {
    html: typeof m.html === 'string' ? m.html : '',
    subject: m.subject || '',
    from: m.from?.text || '',
    receivedAt: m.date ? m.date.toISOString() : '',
    id,
  };
}

/** Maile z pliku .eml albo z katalogu z plikami .eml (tryb `run --eml`, W-29). */
export async function wczytajEml(sciezka: string): Promise<Mail[]> {
  const stat = await fs.stat(sciezka);
  const pliki = stat.isDirectory()
    ? (await fs.readdir(sciezka)).filter(f => f.toLowerCase().endsWith('.eml')).sort().map(f => path.join(sciezka, f))
    : [sciezka];
  const maile: Mail[] = [];
  for (const plik of pliki) {
    maile.push(await rozbierzMail(await fs.readFile(plik), plik));
  }
  return maile;
}
