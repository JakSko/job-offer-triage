// Push z ocenami z tego przebiegu (W-17). Na czas testów trafności AI w pushu są WSZYSTKIE rekomendacje:
// aplikuj, obserwuj i pomin. Źródła: świeże oceny (etap4_klasa = ocenione) i kopie ocen
// (kopia_powtorzonej_oferty: z historii 30 dni albo z tego samego przebiegu). Oferty NIEOCENIONE obsługuje
// raport problemów. LinkedIn (W-37, DJ-26): jeden wspólny push; oceny LinkedIn oznaczone [LI].
//
// Od 06.10.2026 (decyzja produktowa) zamiast skracania uzasadnień i obcinania listy do jednej wiadomości:
// - aplikuj: zawsze pełne uzasadnienie, zera twarde i reguła kodu,
// - obserwuj: uzasadnienie skrócone do 160 znaków, zera twarde i reguła kodu,
// - pomin i kopie ocen: tylko tytuł, firma i link,
// - gdy całość nie mieści się w jednej wiadomości ntfy, kolejne części idą osobnymi pushami ("1/2", "2/2"),
// - pierwsza linia z datą i godziną przebiegu (aplikacja ntfy na iPhonie pokazuje tylko czas względny).
// Priorytet high z DJ-32 wycofany 09.10.2026: na iPhonie przy priorytecie high powiadomienie nie przychodzi już
// dla ok. 2,7 KB (patrz MAX_BAJTOW_POWIADOMIENIA w ntfy.ts); "aplikuj" zawsze na początku części 1.
import type { Rekord } from '../eval/classify.js';
import { MAX_BAJTOW_POWIADOMIENIA } from './ntfy.js';

export const TYTUL_OCENY = 'Oferty pracy - nowe oceny (Pracuj.pl)';

/** Jedna wiadomość ntfy z ocenami. */
export interface PushOcen {
  tytul: string;
  tresc: string;
}

// limit treści jednej części: MAX_BAJTOW_POWIADOMIENIA (ntfy.ts); polskie znaki to 2 bajty
const SKROT_OBSERWUJ = 160;
const KOLEJNOSC = ['aplikuj', 'obserwuj', 'pomin'];

const bajty = (s: string) => Buffer.byteLength(s, 'utf8');
const jednaLinia = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
const przytnij = (s: string, n: number) => (s.length > n ? s.slice(0, n - 3) + '...' : s);

const zrodla = (rekordy: Rekord[]) => {
  const z = rekordy.filter(o => ['ocenione', 'kopia_powtorzonej_oferty'].includes(o.etap4_klasa));
  return { pracuj: z.some(o => o.source !== 'linkedin'), linkedin: z.some(o => o.source === 'linkedin') };
};
const etykieta = (zr: { pracuj: boolean; linkedin: boolean }) =>
  zr.linkedin ? (zr.pracuj ? 'Pracuj.pl, LinkedIn' : 'LinkedIn') : 'Pracuj.pl';

/** Tytuł pusha z ocenami: bez ocen LinkedIn taki sam jak przed W-37. */
export function tytulPushOcen(ocenione: Rekord[], kopie: Rekord[]): string {
  const zr = zrodla([...ocenione, ...kopie]);
  return zr.linkedin ? `Oferty pracy - nowe oceny (${etykieta(zr)})` : TYTUL_OCENY;
}

function blok(o: Rekord & { _rek: string }): string {
  const jestKopia = o.etap4_klasa === 'kopia_powtorzonej_oferty';
  const linie = [(o.source === 'linkedin' ? '[LI]' : '') + '[' + o._rek.toUpperCase() + (jestKopia ? ', kopia oceny' : '') + '] '
    + (o.title || '(brak tytulu)') + (o.company ? ' - ' + o.company : '')];
  if (!jestKopia && (o._rek === 'aplikuj' || o._rek === 'obserwuj')) {
    const uzasadnienie = jednaLinia(o.uzasadnienie_rekomendacji);
    if (uzasadnienie) linie.push(o._rek === 'aplikuj' ? uzasadnienie : przytnij(uzasadnienie, SKROT_OBSERWUJ));
    // audyt oceny: niespełnione wymagania twarde i reguła kodu (gdy uzasadnienie nie zaczyna się już od "[REGULA: ...]")
    const zera = Number(o.liczba_zer_twardych) || 0;
    const nazwy = jednaLinia(o.niespelnione_wymagania_twarde);
    if (zera > 0) linie.push('zera twarde: ' + zera + (nazwy ? ' (' + przytnij(nazwy, o._rek === 'aplikuj' ? 300 : 100) + ')' : ''));
    const regula = jednaLinia(o.regula_kodu);
    if (regula && uzasadnienie.indexOf('[REGULA:') !== 0) linie.push('regula: ' + przytnij(regula, 100));
  }
  if (o.url) linie.push(o.url);
  return linie.join('\n');
}

/** Wiadomości z ocenami (pusta lista, gdy nie ma czego wysłać). Żadna oferta nie jest pomijana. */
export function zbudujPusheOcen(ocenioneWszystkie: Rekord[], kopieWszystkie: Rekord[], opcje: { czas?: string } = {}): PushOcen[] {
  const ocenione = ocenioneWszystkie.filter(o => o.etap4_klasa === 'ocenione');
  const kopie = kopieWszystkie.filter(o => o.etap4_klasa === 'kopia_powtorzonej_oferty');
  const oferty = [...ocenione, ...kopie]
    .map((o): Rekord & { _rek: string } => ({ ...o, _rek: String(o.rekomendacja || '').trim().toLowerCase() }))
    .filter(o => KOLEJNOSC.includes(o._rek))
    .sort((a, b) => KOLEJNOSC.indexOf(a._rek) - KOLEJNOSC.indexOf(b._rek));
  if (oferty.length === 0) return [];

  const licznik: Record<string, number> = {};
  for (const o of oferty) licznik[o._rek] = (licznik[o._rek] || 0) + 1;
  const zr = zrodla(oferty);
  const naglowek = (zr.linkedin ? (zr.pracuj ? 'Pracuj.pl + LinkedIn' : 'LinkedIn') : 'Pracuj.pl') + ' - nowe oceny AI: ' + oferty.length + ' ('
    + KOLEJNOSC.filter(k => licznik[k]).map(k => k + ' ' + licznik[k]).join(', ') + ')' + (opcje.czas ? ' - ' + opcje.czas : '');
  const tytul = tytulPushOcen(ocenione, kopie);

  // pakowanie bloków w kolejne wiadomości; zapas na dopisek " - czesc 10/10" w nagłówku
  const miejsce = MAX_BAJTOW_POWIADOMIENIA - bajty(naglowek) - bajty(' - czesc 10/10') - 2;
  const czesci: string[][] = [];
  let biezaca: string[] = [];
  let zajete = 0;
  for (const o of oferty) {
    let b = blok(o);
    // pojedynczy blok dłuższy niż wiadomość (bardzo długie uzasadnienie): przycięty, link zostaje
    if (bajty(b) > miejsce) {
      const link = o.url ? '\n' + o.url : '';
      let tekst = b.slice(0, b.length - link.length);
      while (bajty(tekst + '...' + link) > miejsce) tekst = tekst.slice(0, -50);
      b = tekst + '...' + link;
    }
    if (biezaca.length && zajete + 2 + bajty(b) > miejsce) {
      czesci.push(biezaca);
      biezaca = [];
      zajete = 0;
    }
    biezaca.push(b);
    zajete += bajty(b) + 2;
  }
  czesci.push(biezaca);

  const ile = czesci.length;
  return czesci.map((bloki, i) => ({
    tytul: ile > 1 ? `${tytul} (${i + 1}/${ile})` : tytul,
    tresc: naglowek + (ile > 1 ? ` - czesc ${i + 1}/${ile}` : '') + '\n\n' + bloki.join('\n\n'),
  }));
}
