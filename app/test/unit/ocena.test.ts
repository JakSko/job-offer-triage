// Ocena AI (Etap 4): opis oferty z treści strony, cache firm, zapytanie do OpenAI, parsowanie odpowiedzi
// i reguły egzekwowane kodem (sufit zer twardych, eliminator lokalizacji, reguła zaawansowanego Pythona).
// Odpowiedzi OpenAI to atrapy; żadne wywołanie sieciowe. Dane przykładowe (fikcyjna kandydatka).
import { describe, expect, it } from 'vitest';
import { sprawdzFirme, wierszeNowychFirm } from '../../src/eval/companies.js';
import { zbudujOpis } from '../../src/eval/description.js';
import { ocenOferty } from '../../src/eval/evaluate.js';
import { zbudujZapytanie } from '../../src/eval/openai.js';
import { PROMPT_PO_CV, PROMPT_PRZED_CV, TOOL_SCHEMA, zlozPrompt } from '../../src/eval/prompt.js';
import { sparsujOdpowiedz, WERSJA_METODYKI, wersjaPromptu } from '../../src/eval/rules.js';

const CV = '# MARTA NOWICKA (SAMPLE DATA)\nOperations & Business Transformation Manager\n';
const PROMPT = zlozPrompt(CV);
const POLE_PYTHONA = 'wymaga_zaawansowanego_pythona';

describe('prompt i schemat', () => {
  it('CV trafia między stałe części promptu; wersja promptu niesie datę CV', () => {
    expect(PROMPT).toBe(PROMPT_PRZED_CV + CV + PROMPT_PO_CV);
    expect(PROMPT_PRZED_CV.endsWith('CV KANDYDATKI (zrodlo: app/dane/cv.md, dane przykladowe):\n')).toBe(true);
    expect(wersjaPromptu('2026-10-01')).toBe(`${WERSJA_METODYKI} / CV 2026-10-01`);
    expect(wersjaPromptu('')).toBe(WERSJA_METODYKI);
  });

  it('kolejność sekcji metodyki: kroki, zasady wymagań (z regułą Pythona), warunki brzegowe, profile', () => {
    const i = (s: string) => PROMPT_PRZED_CV.indexOf(s);
    expect(i('METODYKA OCENY')).toBeGreaterThan(-1);
    expect(i('ZASADY OCENY WYMAGAN')).toBeGreaterThan(i('METODYKA OCENY'));
    expect(i('ZAAWANSOWANY PYTHON')).toBeGreaterThan(i('ZASADY OCENY WYMAGAN'));
    expect(i('WARUNKI BRZEGOWE KANDYDATKI')).toBeGreaterThan(i('ZAAWANSOWANY PYTHON'));
    expect(i('PROFILE (dane przykladowe')).toBeGreaterThan(i('WARUNKI BRZEGOWE KANDYDATKI'));
  });

  it('schemat: ścisły, wszystkie pola wymagane, pole Pythona zaraz po najlepszy_profil, lokalizacja kandydatki', () => {
    const p = TOOL_SCHEMA.parameters;
    expect(TOOL_SCHEMA.strict).toBe(true);
    expect([...p.required].sort()).toEqual(Object.keys(p.properties).sort());
    expect(Object.keys(p.properties).indexOf(POLE_PYTHONA)).toBe(Object.keys(p.properties).indexOf('najlepszy_profil') + 1);
    expect((p.properties as any).tryb_lokalizacji.enum).toContain('onsite poza Poznaniem');
  });
});

const TRESC = 'Opis stanowiska. '.repeat(40);
const jina = (cialo: string) => `Title: Oferta pracy\n\nURL Source: https://www.pracuj.pl/x\n\nMarkdown Content:\n${cialo}`;
const OFERTA = { dedupKey: 'pracuj.pl:1', source: 'pracuj.pl', title: 'Head of AI Adoption', company: 'Nowa Sp. z o.o.',
  location: 'Poznań', url: 'https://www.pracuj.pl/praca/x,oferta,1', matchedProfiles: ['3. AI Adoption Program Manager'],
  etap4_klasa: 'do_oceny', firma_znormalizowana: 'nowa', tytul_znormalizowany: 'head of ai adoption' };

describe('opis oferty z treści strony (czytnik Jina) i ekstrakcja kodem', () => {
  it('pełna treść: tryb pracy i widełki wyciągnięte kodem, obrazki i adresy linków usunięte', () => {
    const o = zbudujOpis(OFERTA, jina(`${TRESC}\nPraca hybrydowa, 2 dni w biurze.\nWynagrodzenie 18 000 - 22 000 zł brutto.\n![logo](https://x/y.png) [Aplikuj](https://x/apply)`));
    expect(o).toMatchObject({ etap4_klasa: 'do_oceny_ai', tryb_pracy: 'hybrydowo', widelki_placowe: '18 000-22 000 ZŁ' });
    expect(o.opis_oferty).toContain('Aplikuj');
    expect(o.opis_oferty).not.toMatch(/!\[|https:\/\/x\//);
  });

  it('zdalnie / stacjonarnie, widełki w EUR, klauzula RODO obcięta, limit 15 000 znaków', () => {
    expect(zbudujOpis(OFERTA, jina(`${TRESC}\nFully remote. Salary 5000 – 7000 EUR.`))).toMatchObject({ tryb_pracy: 'zdalnie', widelki_placowe: '5000-7000 EUR' });
    expect(zbudujOpis(OFERTA, jina(`${TRESC}\nPraca stacjonarna w biurze.`))).toMatchObject({ tryb_pracy: 'stacjonarnie', widelki_placowe: '' });
    const rodo = zbudujOpis(OFERTA, jina(`${TRESC.repeat(3)}\nInformujemy, że administratorem danych jest X. Praca zdalna tylko w klauzuli.`));
    expect(rodo.opis_oferty).not.toContain('administratorem danych');
    expect(rodo.tryb_pracy).toBe('');
    expect(zbudujOpis(OFERTA, jina('Długi opis oferty. '.repeat(1200))).opis_oferty).toHaveLength(15000);
  });

  it('brak treści: blokada, błąd pobrania, pusta strona i przekierowanie na listę ofert (oferta wygasła)', () => {
    const powod = (surowy: string | null) => zbudujOpis(OFERTA, surowy).powod_braku_tresci;
    expect(powod('Just a moment...\nEnable JavaScript and cookies to continue')).toBe('blokada');
    expect(powod('Warning: Target URL returned error 403: Forbidden')).toBe('blokada');
    expect(powod(null)).toBe('blad_pobrania');
    expect(powod(jina('Oferta wygasła.'))).toBe('pusta_strona');
    expect(powod('Title: Oferty pracy – Pracuj.pl\n\nMarkdown Content:\n' + TRESC.repeat(10))).toBe('pusta_strona');
    expect(zbudujOpis(OFERTA, null)).toMatchObject({ etap4_klasa: 'brak_tresci', rekomendacja: 'NIEOCENIONE (BRAK PELNEJ TRESCI)', opis_oferty: '' });
  });

  it('podpowiedź poziomu stanowiska z tytułu', () => {
    const poziom = (title: string) => zbudujOpis({ ...OFERTA, title }, jina(TRESC)).poziom_stanowiska_podpowiedz;
    for (const t of ['Director of Operations', 'VP Engineering', 'Dyrektor ds. Transformacji']) expect(poziom(t)).toMatch(/^wysoki/);
    expect(poziom('Junior Product Manager')).toMatch(/^podstawowy/);
    expect(poziom('Operations Manager')).toBe('');
  });
});

const FIRMY = [
  { firma_znormalizowana: 't mobile', kraj_siedziby: 'Polska', typ_firmy: 'telekom', wielkosc_firmy: 'duża',
    pewnosc_kraj: 'wysoka', pewnosc_typ: 'srednia', pewnosc_wielkosc: 'niska', data_ustalenia: 'x', liczba_ofert: '1' },
  {},
];
const zOpisem = (pola: Record<string, unknown> = {}) => ({ ...zbudujOpis(OFERTA, jina(`${TRESC}\nPraca hybrydowa.`)), ...pola });

describe('cache firm i zapytanie do OpenAI', () => {
  it('znana firma: dane z cache trafiają do wiadomości, model ich nie zgaduje', () => {
    const [znana, nowa] = [sprawdzFirme(zOpisem({ firma_znormalizowana: 't mobile' }), FIRMY), sprawdzFirme(zOpisem(), FIRMY)];
    expect([znana.firma_znana, nowa.firma_znana]).toEqual([true, false]);
    expect(zbudujZapytanie(znana, 'm', PROMPT).openai_request.input).toContain('[ZNANA - kraj_siedziby: Polska (wysoka)');
    expect(zbudujZapytanie(nowa, 'm', PROMPT).openai_request.input).toContain('[NOWA - ustal wszystkie 4 kategorie');
  });

  it('zapytanie: stały prefiks (instrukcja + narzędzie) i wymuszone wywołanie funkcji', () => {
    const z = zbudujZapytanie(sprawdzFirme(zOpisem(), FIRMY), 'gpt-test', PROMPT).openai_request;
    expect(z).toMatchObject({ model: 'gpt-test', instructions: PROMPT, tools: [TOOL_SCHEMA], tool_choice: { type: 'function', name: 'ocena_oferty' } });
    expect(z.input).toMatch(/^Tytul: Head of AI Adoption\nFirma: Nowa Sp\. z o\.o\. \[NOWA/);
    expect(z.input).toContain('Tryb pracy (wyciagniety automatycznie kodem): hybrydowo');
    expect(z.input).toContain('\n\nPelna tresc oferty:\n');
  });
});

const ZAPYTANIE = zbudujZapytanie(sprawdzFirme(zOpisem(), FIRMY), 'm', PROMPT);
const ZAPYTANIE_ZNANA = zbudujZapytanie(sprawdzFirme(zOpisem({ firma_znormalizowana: 't mobile' }), FIRMY), 'm', PROMPT);
const USAGE = { input_tokens: 12167, output_tokens: 1043, input_tokens_details: { cached_tokens: 8775 }, output_tokens_details: { reasoning_tokens: 482 } };

function ocena(pola: Record<string, unknown> = {}) {
  return { dopasowanie_krok1: 'mocne', najlepszy_profil: '3. AI Adoption Program Manager', niespelnione_wymagania_twarde: '', liczba_zer_twardych: 0,
    dopasowanie_krok2: 'mocne', korekta_wzgledem_kroku1: 'brak', uzasadnienie_krok2: 'CV pokrywa.', tryb_lokalizacji: 'hybryda Poznan',
    sygnaly_do_sprawdzenia: 'brak widelek, do zapytania rekrutera', rekomendacja: 'aplikuj', uzasadnienie_rekomendacji: 'Mocne dopasowanie.',
    poziom_stanowiska: 'wysoki', pewnosc_poziom_stanowiska: 'wysoka', firma_dane_juz_znane: false, kraj_siedziby: 'Niemcy',
    pewnosc_kraj_siedziby: 'srednia', typ_firmy: 'software house', pewnosc_typ_firmy: 'niska', wielkosc_firmy: 'srednia', pewnosc_wielkosc_firmy: 'niska', ...pola };
}
const odpowiedz = (argumenty: unknown, pola: Record<string, unknown> = {}) => ({ status: 'completed', usage: USAGE,
  output: [{ type: 'reasoning' }, { type: 'function_call', name: 'ocena_oferty', arguments: typeof argumenty === 'string' ? argumenty : JSON.stringify(argumenty) }], ...pola });

describe('parsowanie odpowiedzi i reguły kodu (sufit zer twardych, lokalizacja)', () => {
  const przypadki: Record<string, { odp: unknown; zap?: any; oczekiwane: Record<string, unknown> }> = {
    '0 zer: bez zmian': { odp: odpowiedz(ocena()), oczekiwane: { rekomendacja: 'aplikuj', rekomendacja_ai: 'aplikuj', regula_kodu: '', etap4_klasa: 'ocenione' } },
    '1 zero: bez sufitu': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'SAP', liczba_zer_twardych: 1 })), oczekiwane: { rekomendacja: 'aplikuj' } },
    '2 zera: sufit obserwuj / slabe': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'SAP; GCP', liczba_zer_twardych: 2 })),
      oczekiwane: { rekomendacja: 'obserwuj', rekomendacja_ai: 'aplikuj', dopasowanie_krok2: 'slabe', korekta_wzgledem_kroku1: 'w dol', regula_kodu: 'sufit: 2 zer twardych' } },
    '3 zera: pomin / brak': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'A; B; C', liczba_zer_twardych: 3 })), oczekiwane: { rekomendacja: 'pomin', dopasowanie_krok2: 'brak' } },
    '4 zera, model już zastosował sufit: reguła pusta': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'A; B; C; D', liczba_zer_twardych: 4, dopasowanie_krok2: 'brak', rekomendacja: 'pomin' })),
      oczekiwane: { rekomendacja: 'pomin', regula_kodu: '' } },
    '2 zera, model niżej niż sufit: kod nigdy nie podnosi': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'A; B', liczba_zer_twardych: 2, dopasowanie_krok2: 'brak', rekomendacja: 'pomin' })),
      oczekiwane: { rekomendacja: 'pomin', dopasowanie_krok2: 'brak' } },
    'lista dłuższa niż liczba: liczy się lista': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'A; B; C', liczba_zer_twardych: 1 })), oczekiwane: { liczba_zer_twardych: 3, rekomendacja: 'pomin' } },
    'liczba większa niż lista: liczy się liczba': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'A', liczba_zer_twardych: 2 })), oczekiwane: { liczba_zer_twardych: 2, rekomendacja: 'obserwuj' } },
    'zły separator (przecinki)': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'A, B, C', liczba_zer_twardych: 3 })), oczekiwane: { rekomendacja: 'pomin' } },
    'liczba jako tekst': { odp: odpowiedz(ocena({ niespelnione_wymagania_twarde: 'A; B', liczba_zer_twardych: '2' })), oczekiwane: { rekomendacja: 'obserwuj' } },
    'onsite poza Poznaniem: pomin, dopasowanie bez zmian': { odp: odpowiedz(ocena({ tryb_lokalizacji: 'onsite poza Poznaniem' })),
      oczekiwane: { rekomendacja: 'pomin', dopasowanie_krok2: 'mocne', regula_kodu: 'onsite poza Poznaniem' } },
    'onsite poza Poznaniem + 2 zera': { odp: odpowiedz(ocena({ tryb_lokalizacji: 'onsite poza Poznaniem', niespelnione_wymagania_twarde: 'A; B', liczba_zer_twardych: 2 })),
      oczekiwane: { rekomendacja: 'pomin', dopasowanie_krok2: 'slabe' } },
    'hybryda poza Poznaniem: bez eliminacji': { odp: odpowiedz(ocena({ tryb_lokalizacji: 'hybryda poza Poznaniem' })), oczekiwane: { rekomendacja: 'aplikuj' } },
    'znana firma: dane z cache zamiast modelu': { zap: ZAPYTANIE_ZNANA, odp: odpowiedz(ocena({ firma_dane_juz_znane: true, kraj_siedziby: '', typ_firmy: '', wielkosc_firmy: '' })),
      oczekiwane: { kraj_siedziby: 'Polska', pewnosc_kraj_siedziby: 'wysoka', typ_firmy: 'telekom', pewnosc_wielkosc_firmy: 'niska' } },
    'status incomplete': { odp: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, usage: USAGE, output: [] },
      oczekiwane: { etap4_klasa: 'blad_parsowania', rekomendacja: 'NIEOCENIONE (BLAD ODPOWIEDZI AI)' } },
    'błąd wywołania': { odp: { error: { message: 'HTTP 400: model not found' } }, oczekiwane: { etap4_klasa: 'blad_parsowania' } },
    'brak wywołania funkcji': { odp: { status: 'completed', usage: USAGE, output: [{ type: 'message', content: 'tekst' }] }, oczekiwane: { etap4_klasa: 'blad_parsowania' } },
    'zepsuty JSON w argumentach': { odp: odpowiedz('{"dopasowanie_krok1": "moc'), oczekiwane: { etap4_klasa: 'blad_parsowania' } },
  };
  for (const [nazwa, p] of Object.entries(przypadki)) {
    it(nazwa, () => {
      const w = sparsujOdpowiedz(p.zap ?? ZAPYTANIE, p.odp, 'W');
      expect(w).toMatchObject(p.oczekiwane);
      expect(w.openai_request).toBeUndefined();
      expect(w.dedupKey).toBe('pracuj.pl:1');
    });
  }

  it('ślad audytowy: wersja promptu i zużycie tokenów (z cache promptu)', () => {
    const w = sparsujOdpowiedz(ZAPYTANIE, odpowiedz(ocena()));
    expect(w.wersja_promptu).toBe(WERSJA_METODYKI);
    expect(w.zuzycie_tokenow).toBe('wejscie 12167 (cache 8775) / wyjscie 1043 (reasoning 482)');
  });
});

describe('reguła zaawansowanego Pythona: model tylko oznacza, decyzję podejmuje kod', () => {
  const sparsuj = (pola: Record<string, unknown>) => sparsujOdpowiedz(ZAPYTANIE, odpowiedz(ocena(pola)));

  it('true: brak i pomin, mimo 0 zer i "aplikuj" od modelu; dopasowanie modelu zostaje w regula_kodu', () => {
    const w = sparsuj({ [POLE_PYTHONA]: true });
    expect(w).toMatchObject({ dopasowanie_krok2: 'brak', rekomendacja: 'pomin', rekomendacja_ai: 'aplikuj', korekta_wzgledem_kroku1: 'w dol',
      regula_kodu: 'zaawansowany Python (dopasowanie modelu: mocne)', etap4_klasa: 'ocenione' });
    expect(w.uzasadnienie_rekomendacji).toBe('[REGULA: zaawansowany Python (dopasowanie modelu: mocne)] Mocne dopasowanie.');
  });

  it('false albo brak pola: zwykłe zasady; tekst "true" też działa', () => {
    expect(sparsuj({ [POLE_PYTHONA]: false })).toMatchObject({ rekomendacja: 'aplikuj', regula_kodu: '' });
    expect(sparsuj({})).toMatchObject({ rekomendacja: 'aplikuj', regula_kodu: '' });
    expect(sparsuj({ [POLE_PYTHONA]: 'true' })).toMatchObject({ rekomendacja: 'pomin' });
  });

  it('true + 3 zera: obie reguły w śladzie audytowym', () => {
    expect(sparsuj({ [POLE_PYTHONA]: true, niespelnione_wymagania_twarde: 'A; B; C', liczba_zer_twardych: 3, dopasowanie_krok2: 'czesciowe' }))
      .toMatchObject({ dopasowanie_krok2: 'brak', rekomendacja: 'pomin', regula_kodu: 'sufit: 3+ zer twardych; zaawansowany Python (dopasowanie modelu: czesciowe)' });
  });
});

describe('ocena ofert: kolejność, odporność na błędy, limit czasu, nowe firmy', () => {
  const log = () => {};
  const oferty = [1, 2, 3, 4].map(i => ({ ...OFERTA, dedupKey: `pracuj.pl:${i}`, url: `https://x/${i}`, firma_znormalizowana: i <= 2 ? 'ta sama nowa' : `firma ${i}` }));

  it('brak treści nie woła modelu, błąd modelu nie przerywa, wyniki w kolejności ofert; jedna firma = jeden wiersz cache', async () => {
    const wolania: string[] = [];
    const { wyniki, nieZdazyly } = await ocenOferty(oferty, FIRMY, { model: 'm', instrukcja: PROMPT, wersja: 'W', termin: Infinity, log }, {
      pobierzTresc: async url => (url.endsWith('/3') ? null : jina(`${TRESC} oferta ${url}`)),
      wywolajModel: async (z: any) => {
        wolania.push(z.input.match(/Link: (\S+)/)[1]);
        if (z.input.includes('https://x/4')) throw new Error('siec');
        return odpowiedz(ocena());
      },
      czekaj: async () => {},
    });
    expect(nieZdazyly).toEqual([]);
    expect(wyniki.map(w => [w.dedupKey, w.etap4_klasa])).toEqual([
      ['pracuj.pl:1', 'ocenione'], ['pracuj.pl:2', 'ocenione'], ['pracuj.pl:3', 'brak_tresci'], ['pracuj.pl:4', 'blad_parsowania']]);
    expect(wolania.sort()).toEqual(['https://x/1', 'https://x/2', 'https://x/4']);
    const firmy = wierszeNowychFirm(wyniki, new Date('2026-10-02T10:00:00Z'));
    expect(firmy.map(f => f.firma_znormalizowana)).toEqual(['ta sama nowa']);
  });

  it('odstęp między pobraniami i miękki limit czasu: reszta czeka na kolejny przebieg', async () => {
    let zegar = 1_000_000;
    const przerwy: number[] = [];
    const { wyniki, nieZdazyly } = await ocenOferty(oferty, FIRMY, { model: 'm', instrukcja: PROMPT, wersja: 'W', termin: zegar + 8_500, log }, {
      pobierzTresc: async () => { zegar += 1000; return jina(TRESC); },
      wywolajModel: async () => odpowiedz(ocena()),
      czekaj: async ms => { przerwy.push(ms); zegar += ms; },
      teraz: () => zegar,
    });
    expect(przerwy).toEqual([3000, 3000]);
    expect(wyniki.map(w => w.dedupKey)).toEqual(['pracuj.pl:1', 'pracuj.pl:2', 'pracuj.pl:3']);
    expect(nieZdazyly.map(w => w.dedupKey)).toEqual(['pracuj.pl:4']);
  });
});
