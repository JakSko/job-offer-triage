// Konwersja CV z pliku master (.docx) na tekst Markdown wstawiany do promptu oceny.
// Zasady (decyzja produktowa): bez danych kontaktowych i bez sekcji z zainteresowaniami,
// z sekcją języków. Konwersja pilnuje kompletności: każdy znak tekstu z dokumentu trafia do wyniku
// albo na jawną listę usuniętych linii; konstrukcje, których nie umiemy poprawnie odczytać
// (pola tekstowe, śledzenie zmian), przerywają konwersję zamiast po cichu zgubić treść.
import { unzipSync, strFromU8 } from 'fflate';

export interface WynikKonwersji {
  /** Treść CV dla modelu (Markdown). */
  markdown: string;
  /** Linie celowo pominięte (kontakt, sekcja zainteresowań). */
  usuniete: string[];
  /** Nagłówki sekcji w wyniku, z liczbą linii. */
  sekcje: { nazwa: string; linie: number }[];
  ostrzezenia: string[];
}

const WZORZEC_KONTAKTU = /@|\+\d{2}[\s\d]{9,}|linkedin\.com\/in\//i;
const WZORZEC_SEKCJI_USUWANEJ = /INTEREST/i;

function dekoduj(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

const bezBialych = (s: string) => s.replace(/\s+/g, '');
const porzadkuj = (s: string) => s.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();

function czyNaglowekSekcji(tekst: string, lista: boolean): boolean {
  if (lista || tekst.includes('\t')) return false;
  const litery = tekst.replace(/[^\p{L}]/gu, '');
  return litery.length >= 4 && litery === litery.toUpperCase();
}

interface Akapit { tekst: string; lista: boolean }

function akapity(xml: string): Akapit[] {
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).map(p => ({
    lista: /<w:numPr>/.test(p),
    tekst: dekoduj(p
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>|<[^>]+>/g, (_, t) => t ?? '')),
  }));
}

export function konwertujDocx(plik: Uint8Array): WynikKonwersji {
  const zip = unzipSync(plik);
  const dokument = zip['word/document.xml'];
  if (!dokument) throw new Error('To nie jest plik .docx (brak word/document.xml).');
  const xml = strFromU8(dokument);
  const ostrzezenia: string[] = [];

  for (const [znacznik, opis] of [
    ['<w:txbxContent', 'pola tekstowe'], ['<mc:AlternateContent', 'obiekty z treścią zastępczą'],
    ['<w:del ', 'śledzenie zmian (usunięcia)'], ['<w:ins ', 'śledzenie zmian (wstawienia)'],
  ] as const) {
    if (xml.includes(znacznik)) throw new Error(`CV zawiera ${opis}; konwersja mogłaby zgubić lub zdublować tekst. Zaakceptuj zmiany / usuń pola tekstowe w Wordzie i spróbuj ponownie.`);
  }
  for (const nazwa of Object.keys(zip)) {
    if (/^word\/(header|footer)\d*\.xml$/.test(nazwa) && bezBialych(dekoduj(strFromU8(zip[nazwa]).replace(/<[^>]+>/g, '')))) {
      ostrzezenia.push(`Nagłówek/stopka strony (${nazwa}) zawiera tekst, który nie trafia do CV dla modelu.`);
    }
  }

  const linie: string[] = [];
  const usuniete: string[] = [];
  /** Surowe teksty akapitów, które trafiły do wyniku (do kontroli kompletności). */
  const zachowane: string[] = [];
  const sekcje: { nazwa: string; linie: number }[] = [];
  let wSekcjiUsuwanej = false;
  let pierwszy = true;

  const lista = akapity(xml);
  for (const a of lista) {
    // tabulator (stanowisko <TAB> okres) zachowujemy do rozpoznania linii stanowiska
    const tekst = a.tekst.split('\t').map(porzadkuj).filter(Boolean).join('\t');
    if (!tekst) continue;

    if (pierwszy) {
      pierwszy = false;
      zachowane.push(tekst);
      linie.push('# ' + tekst);
      continue;
    }
    if (czyNaglowekSekcji(tekst, a.lista)) {
      wSekcjiUsuwanej = WZORZEC_SEKCJI_USUWANEJ.test(tekst);
      if (wSekcjiUsuwanej) { usuniete.push(tekst); continue; }
      zachowane.push(tekst);
      linie.push('', '## ' + tekst);
      sekcje.push({ nazwa: tekst, linie: 0 });
      continue;
    }
    if (wSekcjiUsuwanej || (sekcje.length === 0 && WZORZEC_KONTAKTU.test(tekst))) {
      usuniete.push(tekst);
      continue;
    }
    zachowane.push(tekst);
    if (sekcje.length) sekcje[sekcje.length - 1].linie++;
    if (a.lista) linie.push('- ' + tekst.replace(/\t/g, ' '));
    else if (tekst.includes('\t')) linie.push('', '### ' + tekst.replace(/\t/g, ' | ')); // stanowisko | okres
    else linie.push(tekst);
  }

  const markdown = linie.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  // --- kontrola jakości: nic nie zginęło i nic niepożądanego nie zostało
  const tekstDokumentu = bezBialych(dekoduj(
    (xml.match(/<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join('')).replace(/ /g, ''));
  const tekstWyniku = bezBialych(zachowane.join(''));
  const tekstUsuniety = bezBialych(usuniete.join(''));
  if (tekstWyniku.length + tekstUsuniety.length !== tekstDokumentu.length) {
    throw new Error(`Kontrola kompletności CV nie przeszła: dokument ma ${tekstDokumentu.length} znaków tekstu, a wynik ${tekstWyniku.length} + usunięte ${tekstUsuniety.length}. Plik ma konstrukcję, której konwerter nie obsługuje.`);
  }
  const nazwy = sekcje.map(s => s.nazwa).join(' | ');
  const bledy: string[] = [];
  if (markdown.length < 4000) bledy.push(`wynik za krótki (${markdown.length} znaków)`);
  for (const [wzorzec, opis] of [[/EXPERIENCE/i, 'doświadczenie (EXPERIENCE)'], [/EDUCATION/i, 'wykształcenie (EDUCATION)'], [/LANGUAGES/i, 'języki (LANGUAGES)']] as const) {
    if (!wzorzec.test(nazwy)) bledy.push(`brak sekcji: ${opis}`);
  }
  if (WZORZEC_KONTAKTU.test(markdown)) bledy.push('w wyniku zostały dane kontaktowe');
  if (/<w:|&amp;|&#\d+;/.test(markdown)) bledy.push('w wyniku zostały znaczniki XML');
  if (sekcje.some(s => s.linie === 0)) bledy.push('pusta sekcja: ' + sekcje.filter(s => s.linie === 0).map(s => s.nazwa).join(', '));
  if (bledy.length) throw new Error('Kontrola CV nie przeszła: ' + bledy.join('; ') + '. Sekcje: ' + nazwy);

  return { markdown, usuniete, sekcje, ostrzezenia };
}
