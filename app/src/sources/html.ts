// Ekstrakcja z HTML maila selektorami CSS (odpowiednik węzłów "Ekstrakcja HTML: X" w n8n).
// W-04: tekst przycięty, ciągi białych znaków zbite do jednej spacji.
import * as cheerio from 'cheerio';

export type Dokument = cheerio.CheerioAPI;

export function wczytajHtml(html: string): Dokument {
  return cheerio.load(html || '');
}

export function oczyscTekstHtml(s: string): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function teksty($: Dokument, selektor: string): string[] {
  return $(selektor).toArray().map(el => oczyscTekstHtml($(el).text()));
}

export function atrybuty($: Dokument, selektor: string, atrybut: string): string[] {
  return $(selektor).toArray().map(el => oczyscTekstHtml($(el).attr(atrybut) ?? ''));
}
