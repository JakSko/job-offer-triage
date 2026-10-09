// Pracuj.pl: selektory z węzła "Ekstrakcja HTML: Pracuj.pl" + logika "Wyczyść i połącz: Pracuj.pl"
// (config/etap1_wyczysc_polacz_pracuj_pl.js). W-02, W-04, W-05.
import type { Mail, Oferta, PominietyMail } from '../types.js';
import { atrybuty, teksty, wczytajHtml } from './html.js';
import { fixMojibake } from './mojibake.js';

const SEL_TYTUL = 'a.anchor[href*=",oferta,"]:not(.employer_color):not(.salary_color)';
const SEL_FIRMA = 'a.anchor.employer_color[href*=",oferta,"]';
const SEL_LOKALIZACJA = 'span.city_text';

export interface PolaPracuj {
  titles: string[];
  companies: string[];
  urls: string[];
  locations: string[];
}

export function ekstrakcjaPracuj(html: string): PolaPracuj {
  const $ = wczytajHtml(html);
  return {
    titles: teksty($, SEL_TYTUL),
    companies: teksty($, SEL_FIRMA),
    urls: atrybuty($, SEL_FIRMA, 'href'),
    locations: teksty($, SEL_LOKALIZACJA),
  };
}

export function polaczPracuj(
  pola: PolaPracuj,
  mail: Pick<Mail, 'subject' | 'receivedAt'>,
): { oferty: Oferta[]; pominiety: PominietyMail | null } {
  const { titles, companies, urls, locations } = pola;

  if (titles.length !== companies.length || titles.length !== urls.length) {
    return {
      oferty: [],
      pominiety: {
        source: 'pracuj.pl',
        subject: mail.subject || null,
        receivedAt: mail.receivedAt || null,
        liczniki: { titles: titles.length, companies: companies.length, urls: urls.length },
      },
    };
  }

  const oferty = titles.map((rawTitle, i): Oferta => {
    const title = fixMojibake(String(rawTitle).replace(/^!\s*/, '').trim());
    const rawUrl = String(urls[i] || '').replace(/&amp;/g, '&');
    const cleanUrl = rawUrl.split('?')[0];
    const idMatch = cleanUrl.match(/,oferta,(\d+)/);
    const offerId = idMatch ? idMatch[1] : null;
    return {
      source: 'pracuj.pl',
      title,
      company: fixMojibake(String(companies[i] || '').trim()),
      location: fixMojibake(String(locations[i] || '').trim()),
      url: cleanUrl,
      offerId,
      dedupKey: offerId ? `pracuj.pl:${offerId}` : null,
    };
  });
  return { oferty, pominiety: null };
}
