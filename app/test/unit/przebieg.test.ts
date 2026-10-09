// Cały przebieg na atrapach (dane przykładowe): maile z alertami -> parsowanie -> filtr słów kluczowych ->
// dedup i zapis do arkusza -> pobranie treści -> ocena AI z regułami kodu -> zapis wyników -> pushe -> "Przebiegi".
// Arkusz w pamięci, czytnik stron (fetch) i OpenAI to atrapy; żadnych wywołań sieciowych.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { wczytajKonfiguracje } from '../../src/config.js';
import { KOLUMNY_FIRMY } from '../../src/eval/companies.js';
import { parsujMaile, wykonajPrzebieg } from '../../src/pipeline.js';
import { KOLUMNY_PRZEBIEGI } from '../../src/runlog.js';
import { KOLUMNA_DATA_MAILA, KOLUMNY_WYMAGANE_OFERTY } from '../../src/sheets/oferty.js';
import type { Mail } from '../../src/types.js';

const stan = vi.hoisted(() => ({
  tabele: {} as Record<string, { naglowki: string[]; wiersze: Record<string, string>[] }>,
}));

// arkusz w pamięci; jak prawdziwy klient: nieznana kolumna = błąd
vi.mock('../../src/sheets/client.js', async importOriginal => {
  const oryginal = await importOriginal<typeof import('../../src/sheets/client.js')>();
  class Arkusz {
    async zakladki() { return Object.keys(stan.tabele); }
    async utworzZakladke(nazwa: string, naglowki: string[]) { stan.tabele[nazwa] = { naglowki, wiersze: [] }; }
    async czytaj(zakladka: string) {
      const t = stan.tabele[zakladka];
      return { zakladka, naglowki: t.naglowki, kolumny: new Map(t.naglowki.map((n, i) => [n, i] as const)),
        wiersze: t.wiersze.map((w, i) => ({ ...Object.fromEntries(t.naglowki.map(n => [n, w[n] ?? ''])), _nr: i + 2 })) };
    }
    async dopisz(tabela: { zakladka: string }, rekordy: Record<string, string | number>[]) {
      const t = stan.tabele[tabela.zakladka];
      return rekordy.map(r => {
        for (const k of Object.keys(r)) if (!t.naglowki.includes(k)) throw new Error(`brak kolumny "${k}"`);
        t.wiersze.push(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)])));
        return t.wiersze.length + 1;
      });
    }
    async zmien(tabela: { zakladka: string }, zmiany: { nrWiersza: number; wartosci: Record<string, string | number> }[]) {
      const t = stan.tabele[tabela.zakladka];
      for (const z of zmiany) {
        for (const k of Object.keys(z.wartosci)) if (!t.naglowki.includes(k)) throw new Error(`brak kolumny "${k}"`);
        Object.assign(t.wiersze[z.nrWiersza - 2], Object.fromEntries(Object.entries(z.wartosci).map(([k, v]) => [k, String(v)])));
      }
    }
  }
  return { ...oryginal, Arkusz };
});

const openai = vi.hoisted(() => ({ wywolania: 0, pola: {} as Record<string, unknown> }));
vi.mock('../../src/eval/openai.js', async importOriginal => {
  const oryginal = await importOriginal<typeof import('../../src/eval/openai.js')>();
  return { ...oryginal, wywolajOpenAI: async () => {
    openai.wywolania++;
    const ocena = { dopasowanie_krok1: 'mocne', najlepszy_profil: '1. Operations Excellence Manager', wymaga_zaawansowanego_pythona: false,
      niespelnione_wymagania_twarde: '', liczba_zer_twardych: 0, dopasowanie_krok2: 'mocne', korekta_wzgledem_kroku1: 'brak',
      uzasadnienie_krok2: 'CV pokrywa program doskonalenia procesow.', tryb_lokalizacji: 'hybryda Poznan', sygnaly_do_sprawdzenia: 'brak widelek',
      rekomendacja: 'aplikuj', uzasadnienie_rekomendacji: 'Mocne dopasowanie do profilu 1.', poziom_stanowiska: 'srednio-wysoki',
      pewnosc_poziom_stanowiska: 'srednia', firma_dane_juz_znane: false, kraj_siedziby: 'Polska', pewnosc_kraj_siedziby: 'wysoka',
      typ_firmy: 'logistyka', pewnosc_typ_firmy: 'srednia', wielkosc_firmy: 'srednia', pewnosc_wielkosc_firmy: 'niska', ...openai.pola };
    return { status: 'completed', usage: { input_tokens: 1, output_tokens: 1 },
      output: [{ type: 'function_call', name: 'ocena_oferty', arguments: JSON.stringify(ocena) }] };
  } };
});

// maile z alertami w uproszczonym HTML (te same selektory co w prawdziwych szablonach)
const pracujOferta = (nr: number, tytul: string, firma: string, miasto: string) =>
  `<a class="anchor" href="https://www.pracuj.pl/praca/x,oferta,${nr}">${tytul}</a>`
  + `<a class="anchor employer_color" href="https://www.pracuj.pl/praca/x,oferta,${nr}">${firma}</a><span class="city_text">${miasto}</span>`;
const MAIL_PRACUJ: Mail = { id: 'eml-1', from: 'Pracuj.pl <jobalert@wysylka.pracuj.pl>', subject: 'Oferty na ktore czekasz', receivedAt: '2026-10-05T03:00:00.000Z',
  html: pracujOferta(1001, 'Operations Excellence Manager', 'Przyklad Logistyka Sp. z o.o.', 'Poznań') + pracujOferta(1002, 'Kierowca kat. C', 'Transport Demo', 'Gniezno') };
const MAIL_LINKEDIN: Mail = { id: 'eml-2', from: 'LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>', subject: 'AI Transformation Lead', receivedAt: '2026-10-05T04:00:00.000Z',
  html: '<a class="text-color-brand" href="https://www.linkedin.com/comm/jobs/view/4400000001/?trackingId=abc">AI Transformation Lead</a>'
    + '<p class="text-system-gray-100">Sample Corp · Poznań (Hybrid)</p>' };
const MAIL_INNY: Mail = { id: 'eml-3', from: 'Newsletter <news@example.com>', subject: 'Promocja', receivedAt: '2026-10-05T05:00:00.000Z', html: '<p>x</p>' };

const TRESC_STRONY = 'Title: Oferta pracy Operations Excellence Manager, Przyklad Logistyka\n\nMarkdown Content:\n'
  + 'Prowadzenie programu doskonalenia procesow w 3 magazynach. Praca hybrydowa w Poznaniu. '.repeat(10);

let zadania: string[] = [];
beforeEach(() => {
  stan.tabele = {
    Oferty: { naglowki: [...KOLUMNY_WYMAGANE_OFERTY, KOLUMNA_DATA_MAILA], wiersze: [] },
    Firmy: { naglowki: [...KOLUMNY_FIRMY], wiersze: [] },
    Przebiegi: { naglowki: [...KOLUMNY_PRZEBIEGI], wiersze: [] },
  };
  openai.wywolania = 0;
  openai.pola = {};
  zadania = [];
  vi.stubGlobal('fetch', async (url: string) => {
    zadania.push(String(url));
    if (String(url).startsWith('https://r.jina.ai/https://www.pracuj.pl/')) return { ok: true, status: 200, text: async () => TRESC_STRONY };
    throw new Error('nieoczekiwane zadanie sieciowe: ' + url);
  });
});

const konfiguracja = () => wczytajKonfiguracje({ TRYB: 'laptop', SHEET_ID: 'arkusz-przykladowy-123', GOOGLE_SA_FILE: 'sa.json', OPENAI_API_KEY: 'k',
  CV_MASTER_FILE: 'brak-pliku.docx', HEARTBEAT_GODZINA: '23' } as NodeJS.ProcessEnv);
const przebieg = (o: { dryRun?: boolean; zAi?: boolean } = {}) => wykonajPrzebieg({ konfiguracja: konfiguracja(), maile: [MAIL_PRACUJ, MAIL_LINKEDIN, MAIL_INNY],
  dryRun: o.dryRun ?? false, zAi: o.zAi, limitAi: 30, log: () => {} });
const wiersz = (klucz: string) => stan.tabele.Oferty.wiersze.find(w => w.klucz_oferty === klucz)!;

describe('parsowanie maili i filtr', () => {
  it('routing po nadawcy, czyste klucze i adresy (bez parametrów śledzących), filtr słów kluczowych', () => {
    const p = parsujMaile([MAIL_PRACUJ, MAIL_LINKEDIN, MAIL_INNY]);
    expect(p.maileWgZrodla).toEqual({ 'pracuj.pl': 1, linkedin: 1 });
    expect(p.ignorowaneMaile.map(m => m.id)).toEqual(['eml-3']);
    expect(p.oferty.map(o => [o.dedupKey, o.passesFilter])).toEqual([['pracuj.pl:1001', true], ['pracuj.pl:1002', false], ['linkedin:4400000001', true]]);
    expect(p.oferty[2]).toMatchObject({ url: 'https://www.linkedin.com/jobs/view/4400000001/', company: 'Sample Corp', location: 'Poznań (Hybrid)' });
  });
});

describe('przebieg', () => {
  it('nowe oferty w arkuszu, ocena AI tylko po filtrze, LinkedIn bez AI, push z datą, wiersz w "Przebiegi"', async () => {
    const wynik = await przebieg();
    expect(stan.tabele.Oferty.wiersze.map(w => w.klucz_oferty)).toEqual(['pracuj.pl:1001', 'pracuj.pl:1002', 'linkedin:4400000001']);
    expect(zadania).toEqual(['https://r.jina.ai/https://www.pracuj.pl/praca/x,oferta,1001']);
    expect(openai.wywolania).toBe(1);
    expect(wiersz('pracuj.pl:1001')).toMatchObject({ rekomendacja: 'aplikuj', tryb_pracy: 'hybrydowo', wersja_promptu: 'Z13-v3.2-przyklad / CV 2026-10-01' });
    expect(wiersz('pracuj.pl:1002').przeszlo_filtr_slow_kluczowych).toBe('nie');
    expect(wiersz('pracuj.pl:1002').rekomendacja ?? '').toBe(''); // odrzucona filtrem: bez oceny
    expect(wiersz('linkedin:4400000001').rekomendacja).toBe('NIEOCENIONE (BRAK PELNEJ TRESCI - LINKEDIN)');
    expect(stan.tabele.Firmy.wiersze.map(f => f.firma_znormalizowana)).toEqual(['przyklad logistyka']);

    const oceny = wynik.pushe.filter(p => p.nazwa === 'oceny');
    expect(oceny).toHaveLength(1);
    expect(oceny[0].tresc).toMatch(/^Pracuj\.pl - nowe oceny AI: 1 \(aplikuj 1\) - \d\d\.\d\d \d\d:\d\d\n\n\[APLIKUJ\] Operations Excellence Manager - Przyklad Logistyka/);
    expect(stan.tabele.Przebiegi.wiersze[0]).toMatchObject({ tryb: 'laptop', status: 'ok', ocenione_ai: '1', aplikuj: '1', oferty_nowe_pracuj: '2', oferty_nowe_linkedin: '1' });
  });

  it('drugi przebieg z tymi samymi mailami: dedup, nic nowego, bez AI', async () => {
    await przebieg();
    await przebieg();
    expect(stan.tabele.Oferty.wiersze).toHaveLength(3);
    expect(openai.wywolania).toBe(1);
    expect(stan.tabele.Przebiegi.wiersze[1]).toMatchObject({ status: 'ok', ocenione_ai: '0', oferty_nowe_pracuj: '0' });
  });

  it('reguła kodu: model oznacza wymagany zaawansowany Python -> pomin, ocena modelu w śladzie audytowym', async () => {
    openai.pola = { wymaga_zaawansowanego_pythona: true };
    await przebieg();
    expect(wiersz('pracuj.pl:1001')).toMatchObject({ rekomendacja: 'pomin', rekomendacja_ai: 'aplikuj', dopasowanie_krok2: 'brak',
      regula_kodu: 'zaawansowany Python (dopasowanie modelu: mocne)' });
  });

  it('na sucho: nic nie zapisane, bez pobierania stron i bez AI (chyba że --z-ai)', async () => {
    const wynik = await przebieg({ dryRun: true });
    expect(stan.tabele.Oferty.wiersze).toEqual([]);
    expect(stan.tabele.Przebiegi.wiersze).toEqual([]);
    expect(zadania).toEqual([]);
    expect(wynik.bezOceny.map(x => x.dedupKey)).toEqual(['pracuj.pl:1001']);
    await przebieg({ dryRun: true, zAi: true });
    expect(openai.wywolania).toBe(1);
    expect(stan.tabele.Oferty.wiersze).toEqual([]);
  });
});
