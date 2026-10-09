// Pobranie treści oferty Pracuj.pl (W-11). Domyślnie przez czytnik stron Jina (https://r.jina.ai/<url>),
// BEZ nagłówka User-Agent przeglądarki (Cloudflare przed Jina blokuje podszyty UA). Błąd lub przekroczenie
// czasu nie przerywa przebiegu: zwracamy null, a description.ts zamienia to na "blad_pobrania".
import * as cheerio from 'cheerio';

export const ODSTEP_JINA_MS = 4000;
const LIMIT_CZASU_MS = 30_000;

export interface OpcjePobrania {
  jinaApiKey?: string;
  tryb: 'jina' | 'jina-then-direct';
}

async function pobierzTekst(url: string, naglowki: Record<string, string> = {}): Promise<string | null> {
  try {
    // jak "neverError" w n8n: treść odpowiedzi bierzemy także przy statusie błędu (blokadę wykrywa description.ts)
    const odp = await fetch(url, { headers: naglowki, signal: AbortSignal.timeout(LIMIT_CZASU_MS) });
    return await odp.text();
  } catch {
    return null;
  }
}

export function pobierzPrzezJina(urlOferty: string, jinaApiKey?: string): Promise<string | null> {
  return pobierzTekst('https://r.jina.ai/' + urlOferty, jinaApiKey ? { Authorization: 'Bearer ' + jinaApiKey } : {});
}

/** Zapas (FETCH_MODE=jina-then-direct): strona pobrana wprost, tekst sekcji oferty. Działa z domowego IP. */
export async function pobierzBezposrednio(urlOferty: string): Promise<string | null> {
  const html = await pobierzTekst(urlOferty);
  if (html === null) return null;
  const $ = cheerio.load(html);
  const sekcje = $('section[data-test^="section-"]').toArray().map(el => $(el).text().replace(/[ \t]+/g, ' ').trim()).filter(Boolean);
  return sekcje.length ? sekcje.join('\n\n') : $('body').text().replace(/[ \t]+/g, ' ').trim();
}
