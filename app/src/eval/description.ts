// "Etap4: zbuduj opis + ekstrakcja kodem" (config/etap4_zbuduj_opis.js, W-11): z surowej odpowiedzi
// czytnika Jina robi opis oferty dla modelu, wykrywa blokadę / pustą stronę / błąd pobrania i wyciąga
// kodem tryb pracy, widełki oraz podpowiedź poziomu stanowiska.
import type { Rekord } from './classify.js';

const MAX_ZNAKOW_OPISU = 15000;
const WZORZEC_BLOKADY = /just a moment|attention required|access denied|enable javascript and cookies|cf-chl|challenge-platform|target url returned error/i;

export function extractTrybPracy(text: string): string {
  const t = text.toLowerCase();
  if (/zdaln|remote/.test(t)) return 'zdalnie';
  if (/hybryd|hybrid/.test(t)) return 'hybrydowo';
  if (/stacjonarn|on-site|onsite|w biurze|office based/.test(t)) return 'stacjonarnie';
  return '';
}
export function extractWidelki(text: string): string {
  const m = text.match(/(\d[\d\s]{2,})\s*[-–]\s*(\d[\d\s]{2,})\s*(PLN|zł|EUR|USD)/i);
  return m ? (m[1].trim() + '-' + m[2].trim() + ' ' + m[3].toUpperCase()) : '';
}
export function poziomStanowiskaPodpowiedz(tytul: unknown): string {
  const t = String(tytul || '').toLowerCase();
  if (/\b(head of|director|dyrektor|\bvp\b|chief)\b/.test(t)) return 'wysoki (podpowiedz z tytulu, nie ostateczna ocena)';
  if (/\bjunior\b/.test(t)) return 'podstawowy (podpowiedz z tytulu, nie ostateczna ocena)';
  return '';
}

// Markdown z Jina: bez nagłówka "Title/URL Source", bez obrazków i adresów linków, bez klauzuli RODO
// na końcu strony, z limitem długości (kontrola kosztu tokenów OpenAI).
function oczyscTekst(surowy: string): string {
  let t = String(surowy || '');
  const znacznik = 'Markdown Content:';
  const start = t.indexOf(znacznik);
  if (start !== -1) t = t.slice(start + znacznik.length);
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  const rodo = t.search(/Informujemy, że administratorem danych|Pursuant to Article 13/i);
  if (rodo > 500) t = t.slice(0, rodo);
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > MAX_ZNAKOW_OPISU ? t.slice(0, MAX_ZNAKOW_OPISU) : t;
}

// Nowe względem n8n (03.10.2026): oferta wygasła albo nieistniejąca przekierowuje na listę ofert
// ("Title: Oferty pracy – Pracuj.pl", dziesiątki tysięcy znaków), a dotąd szła do oceny AI jako
// "pełna treść". Strona oferty ma w nagłówku Jina zawsze "Title: Oferta pracy <stanowisko>, <firma>".
// Bez nagłówka Title (np. pobranie bezpośrednie) nic nie rozstrzygamy.
export function czyStronaOferty(surowy: string): boolean {
  const tytul = surowy.slice(0, 1000).match(/^Title:\s*(.*)$/m);
  return !tytul || /^Oferta pracy\b/i.test(tytul[1].trim());
}

const UZASADNIENIA_BRAKU: Record<string, string> = {
  blokada: 'Strona oferty zablokowala pobranie tresci (Cloudflare / blokada botow) - ocen recznie pod linkiem z arkusza.',
  blad_pobrania: 'Pobranie tresci oferty nie powiodlo sie (blad lub przekroczony czas) - ocen recznie pod linkiem z arkusza.',
  pusta_strona: 'Pobrana strona nie zawiera pelnej tresci oferty (oferta wygasla lub zmienil sie uklad strony) - ocen recznie pod linkiem z arkusza.',
};

/** `surowy` = treść odpowiedzi pobrania albo null, gdy pobranie się nie powiodło. */
export function zbudujOpis(src: Rekord, surowy: string | null): Rekord {
  let powod = '';
  let opis = '';
  if (surowy === null) {
    powod = 'blad_pobrania';
  } else if (WZORZEC_BLOKADY.test(surowy.slice(0, 1500))) {
    powod = 'blokada';
  } else if (!czyStronaOferty(surowy)) {
    powod = 'pusta_strona';
  } else {
    opis = oczyscTekst(surowy);
    if (opis.length < 200) powod = 'pusta_strona';
  }

  const bazowy = { ...src, opis_oferty: opis,
    tryb_pracy: opis ? extractTrybPracy(opis) : '',
    widelki_placowe: opis ? extractWidelki(opis) : '',
    poziom_stanowiska_podpowiedz: poziomStanowiskaPodpowiedz(src.title) };

  if (powod) {
    return { ...bazowy, etap4_klasa: 'brak_tresci', powod_braku_tresci: powod,
      rekomendacja: 'NIEOCENIONE (BRAK PELNEJ TRESCI)',
      uzasadnienie_rekomendacji: UZASADNIENIA_BRAKU[powod],
    };
  }
  return { ...bazowy, etap4_klasa: 'do_oceny_ai' };
}
