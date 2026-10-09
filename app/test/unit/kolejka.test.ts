// Kolejka zaległych (W-24): oferty Pracuj.pl bez oceny (pusta rekomendacja albo limit przebiegu) z ostatnich N dni
// wracają do oceny w kolejnym przebiegu, najstarsze pierwsze. Statusy NIEOCENIONE nie są kopiowane jako ocena.
import { describe, expect, it } from 'vitest';
import { sklasyfikuj } from '../../src/eval/classify.js';
import { czyZalegla, REKOMENDACJA_LIMIT, wybierzZalegle } from '../../src/eval/queue.js';
import { wyslijPush } from '../../src/notify/ntfy.js';
import { vi } from 'vitest';

const TERAZ = Date.parse('2026-10-05T18:00:00Z');
const wiersz = (pola: Record<string, string>, nr = 2) => ({ _nr: nr, klucz_oferty: 'pracuj.pl:1', zrodlo: 'pracuj.pl',
  tytul: 'Operations Excellence Manager', firma: 'Przyklad Sp. z o.o.', lokalizacja: 'Poznań', url: 'https://www.pracuj.pl/praca/x,oferta,1',
  data_wykrycia: '2026-10-05T10:00:00.000+02:00', przeszlo_filtr_slow_kluczowych: 'tak', rekomendacja: '', ...pola });

describe('kolejka zaległych', () => {
  it('wraca: pusta rekomendacja albo limit przebiegu, przeszła filtr, w oknie dni', () => {
    expect(czyZalegla(wiersz({}), 7, TERAZ)).toBe(true);
    expect(czyZalegla(wiersz({ rekomendacja: REKOMENDACJA_LIMIT }), 7, TERAZ)).toBe(true);
  });

  it('nie wraca: ocenione, brak treści, LinkedIn, odrzucone filtrem, starsze niż okno', () => {
    expect(czyZalegla(wiersz({ rekomendacja: 'aplikuj' }), 7, TERAZ)).toBe(false);
    expect(czyZalegla(wiersz({ rekomendacja: 'NIEOCENIONE (BRAK PELNEJ TRESCI)' }), 7, TERAZ)).toBe(false);
    expect(czyZalegla(wiersz({ zrodlo: 'linkedin' }), 7, TERAZ)).toBe(false);
    expect(czyZalegla(wiersz({ przeszlo_filtr_slow_kluczowych: 'nie' }), 7, TERAZ)).toBe(false);
    expect(czyZalegla(wiersz({ data_wykrycia: '2026-09-20T10:00:00.000+02:00' }), 7, TERAZ)).toBe(false);
  });

  it('najstarsze pierwsze; profile liczone ponownie z tytułu', () => {
    const z = wybierzZalegle([
      wiersz({ klucz_oferty: 'pracuj.pl:2', data_wykrycia: '2026-10-05T12:00:00.000+02:00' }, 3),
      wiersz({ klucz_oferty: 'pracuj.pl:1', data_wykrycia: '2026-10-04T12:00:00.000+02:00' }, 2),
    ], 7, TERAZ);
    expect(z.map(x => x.dedupKey)).toEqual(['pracuj.pl:1', 'pracuj.pl:2']);
    expect(z[0]).toMatchObject({ source: 'pracuj.pl', offerId: '1', passesFilter: true });
    expect(z[0].matchedProfiles.length).toBeGreaterThan(0);
  });

  it('statusy NIEOCENIONE nie są kopiowane jako ocena powtórzonej oferty (W-10)', () => {
    const historia = [{ firma: 'Przyklad Sp. z o.o.', tytul: 'Operations Excellence Manager', rekomendacja: REKOMENDACJA_LIMIT, data_wykrycia: '2026-10-05T10:00:00.000+02:00' }];
    expect(sklasyfikuj([{ company: 'Przyklad Sp. z o.o.', title: 'Operations Excellence Manager' }], historia, 30, TERAZ)[0].etap4_klasa).toBe('do_oceny');
  });
});

describe('ntfy', () => {
  it('push: tytuł w nagłówku Title, treść jako tekst; bez nagłówka priorytetu', async () => {
    const wywolania: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { wywolania.push({ url, init }); return { ok: true, status: 200 }; });
    try {
      await wyslijPush('https://ntfy.sh/temat-przykladowy', 'Tytul', 'tresc');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(wywolania[0].init).toMatchObject({ method: 'POST', body: 'tresc', headers: { Title: 'Tytul', 'Content-Type': 'text/plain; charset=utf-8' } });
  });
});
