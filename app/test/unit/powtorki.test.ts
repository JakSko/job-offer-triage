// Powtórki w jednym przebiegu (W-35): ta sama firma i tytuł, inna lokalizacja = jedna ocena AI + kopie.
import { describe, expect, it } from 'vitest';
import { kopiaZPrzebiegu, sklasyfikujZPowtorkami } from '../../src/eval/classify.js';

const o = (nr: number, title: string, company: string, location = 'X') => ({ dedupKey: `pracuj.pl:${nr}`, title, company, location });
const teraz = Date.parse('2026-10-03T10:00:00Z');

describe('powtórki w przebiegu', () => {
  const oferty = [
    o(1, 'HR Business Transformation Senior Consultant', 'Capgemini Polska', 'Kraków'),
    o(2, 'AI Lead', 'Google'),
    o(3, 'HR Business Transformation Senior Consultant', 'Capgemini Polska Sp. z o.o.', 'Opole'),
    o(4, 'HR  Business Transformation - Senior Consultant', 'CAPGEMINI POLSKA', 'Lublin'),
    o(5, 'AI Lead', 'Inna Firma'),
  ];

  it('pierwsza oferta grupy to wzorzec, kolejne to powtórki i nie zużywają limitu', () => {
    const { sklasyfikowane, powtorki } = sklasyfikujZPowtorkami(oferty, [], 30, teraz);
    expect(sklasyfikowane.map(x => [x.dedupKey, x.etap4_klasa])).toEqual([
      ['pracuj.pl:1', 'do_oceny'], ['pracuj.pl:2', 'do_oceny'], ['pracuj.pl:5', 'do_oceny']]);
    expect(powtorki.map(p => [p.oferta.dedupKey, p.wzorzec])).toEqual([['pracuj.pl:3', 'pracuj.pl:1'], ['pracuj.pl:4', 'pracuj.pl:1']]);
    // limit 2 liczy tylko wzorce: 1 i 2 do oceny, 5 ponad limit; powtórki oferty 1 nadal są powtórkami
    const zLimitem = sklasyfikujZPowtorkami(oferty, [], 2, teraz);
    expect(zLimitem.sklasyfikowane.map(x => x.etap4_klasa)).toEqual(['do_oceny', 'do_oceny', 'limit_przebiegu']);
    expect(zLimitem.powtorki).toHaveLength(2);
  });

  it('wzorzec ponad limitem: powtórki też dostają limit', () => {
    const { sklasyfikowane, powtorki } = sklasyfikujZPowtorkami(oferty, [], 0, teraz);
    expect(powtorki).toEqual([]);
    expect(sklasyfikowane).toHaveLength(5);
    expect(sklasyfikowane.every(x => x.etap4_klasa === 'limit_przebiegu')).toBe(true);
  });

  it('wzorzec z kopią z historii (30 dni): powtórki też kopiują z historii', () => {
    const historia = [{ firma: 'Capgemini Polska', tytul: 'HR Business Transformation Senior Consultant', rekomendacja: 'obserwuj', data_wykrycia: '2026-10-01T10:00:00.000+02:00' }];
    const { sklasyfikowane, powtorki } = sklasyfikujZPowtorkami(oferty, historia, 30, teraz);
    expect(powtorki).toEqual([]);
    expect(sklasyfikowane.filter(x => x.etap4_klasa === 'kopia_powtorzonej_oferty').map(x => x.dedupKey).sort()).toEqual(['pracuj.pl:1', 'pracuj.pl:3', 'pracuj.pl:4']);
  });

  it('oferty bez firmy albo tytułu nie są grupowane', () => {
    const { powtorki } = sklasyfikujZPowtorkami([o(1, '', 'F'), o(2, '', 'F'), o(3, 'T', ''), o(4, 'T', '')], [], 30, teraz);
    expect(powtorki).toEqual([]);
  });

  it('kopia przenosi ocenę wzorca, zachowuje dane powtórki i nie ma zużycia tokenów', () => {
    const wzorzec = { ...oferty[0], etap4_klasa: 'ocenione', rekomendacja: 'obserwuj', dopasowanie_krok2: 'czesciowe', liczba_zer_twardych: 2,
      niespelnione_wymagania_twarde: 'A; B', tryb_lokalizacji: 'hybryda poza Poznaniem', regula_kodu: 'sufit: 2 zer twardych',
      wersja_promptu: 'Z13-v3-2026-09-21 / CV 2026-10-02', zuzycie_tokenow: 'wejscie 1', opis_oferty: 'dlugi opis' };
    const k = kopiaZPrzebiegu(oferty[2], wzorzec)!;
    expect(k).toMatchObject({ dedupKey: 'pracuj.pl:3', location: 'Opole', etap4_klasa: 'kopia_powtorzonej_oferty', rekomendacja: 'obserwuj',
      dopasowanie_krok2: 'czesciowe', liczba_zer_twardych: 2, tryb_lokalizacji: 'hybryda poza Poznaniem',
      wersja_promptu: 'Z13-v3-2026-09-21 / CV 2026-10-02', zuzycie_tokenow: '' });
    expect(k.uzasadnienie_rekomendacji).toContain('wzorzec: pracuj.pl:1');
    expect(k.opis_oferty).toBeUndefined();
  });

  it('wzorzec bez udanej oceny (brak treści, błąd AI, limit czasu): brak kopii', () => {
    expect(kopiaZPrzebiegu(oferty[2], { ...oferty[0], etap4_klasa: 'brak_tresci', rekomendacja: 'NIEOCENIONE (BRAK PELNEJ TRESCI)' })).toBeNull();
    expect(kopiaZPrzebiegu(oferty[2], undefined)).toBeNull();
  });
});
