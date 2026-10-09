// LinkedIn: selektory z węzła "Ekstrakcja HTML: LinkedIn" (docs/linkedin_selektory.md) + logika
// "Wyczyść i połącz: LinkedIn" (config/etap1_wyczysc_polacz_linkedin.js). W-03, W-04, W-05.
// Nowy szablon maila LinkedIn: dopisz wariant do SEL_TYTUL (lista OR), nie nadpisuj istniejących.
import type { Mail, Oferta, PominietyMail } from '../types.js';
import { atrybuty, teksty, wczytajHtml } from './html.js';
import { fixMojibake } from './mojibake.js';

const SEL_TYTUL = 'a.text-color-brand, a.font-bold.text-md.leading-regular.text-system-blue-50';
const SEL_FIRMA_LOKALIZACJA = 'p.text-system-gray-100';

export interface PolaLinkedin {
  titles: string[];
  urls: string[];
  companyLines: string[];
}

export function ekstrakcjaLinkedin(html: string): PolaLinkedin {
  const $ = wczytajHtml(html);
  return {
    titles: teksty($, SEL_TYTUL),
    urls: atrybuty($, SEL_TYTUL, 'href'),
    companyLines: teksty($, SEL_FIRMA_LOKALIZACJA),
  };
}

export function polaczLinkedin(
  pola: PolaLinkedin,
  mail: Pick<Mail, 'subject' | 'receivedAt'>,
): { oferty: Oferta[]; pominiety: PominietyMail | null } {
  const { titles, urls, companyLines } = pola;

  if (titles.length !== urls.length || titles.length !== companyLines.length) {
    return {
      oferty: [],
      pominiety: {
        source: 'linkedin',
        subject: mail.subject || null,
        receivedAt: mail.receivedAt || null,
        liczniki: { titles: titles.length, urls: urls.length, companyLines: companyLines.length },
      },
    };
  }

  const oferty = titles.map((rawTitle, i): Oferta => {
    const title = fixMojibake(String(rawTitle).replace(/\s*\|\s*Poland\s*$/i, '').trim());
    const rawUrl = String(urls[i] || '').replace(/&amp;/g, '&');
    const idMatch = rawUrl.match(/\/jobs\/view\/(\d+)/);
    const offerId = idMatch ? idMatch[1] : null;
    const url = offerId ? `https://www.linkedin.com/jobs/view/${offerId}/` : rawUrl.split('?')[0];
    const line = String(companyLines[i] || '').replace(/&middot;/g, '·');
    const parts = line.split('·').map(s => fixMojibake(s.trim()));
    return {
      source: 'linkedin',
      title,
      company: parts[0] || null,
      location: parts[1] || null,
      url,
      offerId,
      dedupKey: offerId ? `linkedin:${offerId}` : null,
    };
  });
  return { oferty, pominiety: null };
}
