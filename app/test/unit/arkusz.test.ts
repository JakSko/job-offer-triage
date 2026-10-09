// Testy jednostkowe warstwy arkusza: daty (W-23), kontrakt zapisu (W-16, W-22), kolejka zaległych (W-24),
// blokada (W-28). Bez połączenia z Google.
import { describe, expect, it } from 'vitest';
import { czyZalegla, wybierzZalegle } from '../../src/eval/queue.js';
import { KOLUMNY_PRZEBIEGI, ocenBlokade } from '../../src/runlog.js';
import { literaKolumny, type Tabela, type Wiersz } from '../../src/sheets/client.js';
import { czasWarszawa, isoWarszawa, parsujDate } from '../../src/sheets/dates.js';
import { parsujMaile } from '../../src/pipeline.js';
import { KOLUMNY_WYNIKU, oznaczNowe, wierszNowejOferty, zmianyWynikow } from '../../src/sheets/oferty.js';

describe('daty', () => {
  it('zapis: ISO ze strefą Europe/Warsaw, format jak w arkuszu', () => {
    expect(isoWarszawa(new Date('2026-09-18T16:41:07.538Z'))).toBe('2026-09-18T18:41:07.538+02:00'); // czas letni
    expect(isoWarszawa(new Date('2026-12-01T08:00:00.000Z'))).toBe('2026-12-01T09:00:00.000+01:00'); // czas zimowy
    expect(isoWarszawa(new Date('2026-10-25T00:30:00.000Z'))).toBe('2026-10-25T02:30:00.000+02:00'); // tuż przed zmianą czasu
    expect(isoWarszawa(new Date('2026-10-25T01:30:00.000Z'))).toBe('2026-10-25T02:30:00.000+01:00'); // tuż po zmianie
    expect(isoWarszawa()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0[12]:00$/);
  });

  it('odczyt: zapis i odczyt są zgodne, obsługa innych formatów', () => {
    const t = Date.parse('2026-09-18T16:41:07.538Z');
    expect(parsujDate(isoWarszawa(new Date(t)))).toBe(t);
    expect(parsujDate('2026-09-18 18:41:07')).toBe(Date.parse('2026-09-18T16:41:07Z'));
    expect(parsujDate('18.09.2026 18:41:07')).toBe(Date.parse('2026-09-18T16:41:07Z'));
    expect(parsujDate('01.12.2026')).toBe(Date.parse('2026-11-30T23:00:00Z'));
    expect(parsujDate('')).toBeNull();
    expect(parsujDate('wczoraj')).toBeNull();
  });

  it('czas polski do heartbeatu', () => {
    expect(czasWarszawa(new Date('2026-10-02T19:30:00Z'))).toEqual({ godzina: 21, dzien: '2026-10-02' });
    expect(czasWarszawa(new Date('2026-12-31T23:30:00Z'))).toEqual({ godzina: 0, dzien: '2027-01-01' });
  });
});

describe('kontrakt zapisu', () => {
  it('litery kolumn', () => {
    expect([0, 25, 26, 33, 36, 701, 702].map(literaKolumny)).toEqual(['A', 'Z', 'AA', 'AH', 'AK', 'ZZ', 'AAA']);
  });

  it('nowa oferta: 9 kolumn jak w n8n + data maila (W-36)', () => {
    const oferta = { source: 'pracuj.pl' as const, title: 'AI Lead', company: 'X', location: null, url: 'u', offerId: '1',
      dedupKey: 'pracuj.pl:1', matchedProfiles: ['6. A', '7. B'], noiseReason: null, passesFilter: true };
    const w = wierszNowejOferty({ ...oferta, dataMaila: '2026-09-18T01:12:45.000Z' }, new Date('2026-09-18T16:41:07.538Z'));
    expect(w).toEqual({ klucz_oferty: 'pracuj.pl:1', zrodlo: 'pracuj.pl', tytul: 'AI Lead', firma: 'X', lokalizacja: '', url: 'u',
      data_wykrycia: '2026-09-18T18:41:07.538+02:00', przeszlo_filtr_slow_kluczowych: 'tak', dopasowane_profile: '6. A, 7. B',
      data_maila: '2026-09-18T03:12:45.000+02:00' });
    // brak albo nieczytelna data maila: pusta komórka, bez błędu
    expect(wierszNowejOferty(oferta, new Date()).data_maila).toBe('');
    expect(wierszNowejOferty({ ...oferta, dataMaila: 'bzdura' }, new Date()).data_maila).toBe('');
  });

  it('data maila: oferta z kilku maili w przebiegu dostaje datę najstarszego (pierwszego) maila', () => {
    const mail = (id: string, data: string) => ({ id, from: '"Wyszukiwane w Pracuj.pl" <jobalert@wysylka.pracuj.pl>', subject: 's', receivedAt: data,
      html: '<a class="anchor" href="https://www.pracuj.pl/praca/x,oferta,77">AI Lead</a><a class="anchor employer_color" href="https://www.pracuj.pl/praca/x,oferta,77">Firma</a><span class="city_text">Poznań</span>' });
    const { oferty } = parsujMaile([mail('1', '2026-10-01T05:00:00.000Z'), mail('2', '2026-10-02T05:00:00.000Z')]);
    const nowe = oznaczNowe(oferty, []);
    expect(nowe).toHaveLength(1);
    expect(nowe[0].dataMaila).toBe('2026-10-01T05:00:00.000Z');
  });

  it('wynik: zawsze 25 kolumn, braki jako pusty tekst, nigdy kolumny ręczne', () => {
    expect(KOLUMNY_WYNIKU.length).toBe(25);
    const { zmiany, bezWiersza } = zmianyWynikow(
      [{ dedupKey: 'a', rekomendacja: 'pomin', liczba_zer_twardych: 3, status_aplikacji: 'NIE', notatki: 'NIE', title: 'x' },
       { dedupKey: 'nie-ma', rekomendacja: 'aplikuj' }],
      new Map([['a', 7]]));
    expect(bezWiersza).toEqual(['nie-ma']);
    expect(zmiany).toHaveLength(1);
    expect(zmiany[0].nrWiersza).toBe(7);
    expect(Object.keys(zmiany[0].wartosci).sort()).toEqual([...KOLUMNY_WYNIKU].sort());
    expect(zmiany[0].wartosci.rekomendacja).toBe('pomin');
    expect(zmiany[0].wartosci.liczba_zer_twardych).toBe('3');
    expect(zmiany[0].wartosci.uzasadnienie_krok2).toBe('');
  });
});

describe('kolejka zaległych (W-24)', () => {
  const teraz = Date.parse('2026-10-02T12:00:00Z');
  const w = (nr: number, pola: Record<string, string>): Wiersz => ({ _nr: nr, klucz_oferty: `pracuj.pl:${nr}`, zrodlo: 'pracuj.pl', tytul: 'AI Lead',
    firma: 'F', lokalizacja: 'L', url: 'u', przeszlo_filtr_slow_kluczowych: 'tak', rekomendacja: '', data_wykrycia: '2026-10-01T10:00:00.000+02:00', ...pola } as Wiersz);

  it('warunki wejścia', () => {
    expect(czyZalegla(w(1, {}), 7, teraz)).toBe(true);
    expect(czyZalegla(w(2, { rekomendacja: 'NIEOCENIONE (LIMIT PRZEBIEGU)' }), 7, teraz)).toBe(true);
    expect(czyZalegla(w(3, { rekomendacja: 'NIEOCENIONE (BRAK PELNEJ TRESCI)' }), 7, teraz)).toBe(false);
    expect(czyZalegla(w(4, { rekomendacja: 'NIEOCENIONE (BLAD ODPOWIEDZI AI)' }), 7, teraz)).toBe(false);
    expect(czyZalegla(w(5, { rekomendacja: 'pomin' }), 7, teraz)).toBe(false);
    expect(czyZalegla(w(6, { zrodlo: 'linkedin' }), 7, teraz)).toBe(false);
    expect(czyZalegla(w(7, { przeszlo_filtr_slow_kluczowych: 'nie' }), 7, teraz)).toBe(false);
    expect(czyZalegla(w(8, { data_wykrycia: '2026-09-20T10:00:00.000+02:00' }), 7, teraz)).toBe(false);
    expect(czyZalegla(w(9, { data_wykrycia: '' }), 7, teraz)).toBe(false);
  });

  it('najstarsze pierwsze, profile liczone z tytułu', () => {
    const z = wybierzZalegle([
      w(10, { data_wykrycia: '2026-10-01T12:00:00.000+02:00' }),
      w(11, { data_wykrycia: '2026-09-30T12:00:00.000+02:00', tytul: 'Chief of Staff' }),
      w(12, { rekomendacja: 'aplikuj' }),
    ], 7, teraz);
    expect(z.map(x => x.dedupKey)).toEqual(['pracuj.pl:11', 'pracuj.pl:10']);
    expect(z[0].matchedProfiles).toEqual(['3. Chief of Staff']);
    expect(z[0]).toMatchObject({ source: 'pracuj.pl', title: 'Chief of Staff', company: 'F', url: 'u', offerId: '11', passesFilter: true });
  });
});

describe('blokada (W-28)', () => {
  const teraz = Date.parse('2026-10-02T12:00:00Z');
  const tabela = (wiersze: Partial<Wiersz>[]): Tabela => ({ zakladka: 'Przebiegi', naglowki: [...KOLUMNY_PRZEBIEGI], kolumny: new Map(),
    wiersze: wiersze.map((x, i) => ({ _nr: i + 2, ...x }) as Wiersz) });

  it('świeży "w toku" blokuje, stary jest przerwany, zakończone nie mają znaczenia', () => {
    expect(ocenBlokade(tabela([{ status: 'ok', start: isoWarszawa(new Date(teraz - 60_000)) }]), teraz)).toEqual({ blokuje: false, przerwane: [] });
    expect(ocenBlokade(tabela([{ status: 'w toku', start: isoWarszawa(new Date(teraz - 10 * 60_000)) }]), teraz)).toEqual({ blokuje: true, przerwane: [] });
    expect(ocenBlokade(tabela([
      { status: 'w toku', start: isoWarszawa(new Date(teraz - 50 * 60_000)) },
      { status: 'w toku', start: '' },
    ]), teraz)).toEqual({ blokuje: false, przerwane: [2, 3] });
  });
});
