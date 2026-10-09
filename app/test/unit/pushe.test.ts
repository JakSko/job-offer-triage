// Pushe: oceny (w częściach, w limicie powiadomień), problemy przebiegu i podsumowanie dnia (W-31).
import { describe, expect, it } from 'vitest';
import { zbudujPusheOcen } from '../../src/notify/digest.js';
import { dopasujDoPowiadomienia, MAX_BAJTOW_POWIADOMIENIA } from '../../src/notify/ntfy.js';
import { czyWyslacHeartbeat, zbudujHeartbeat } from '../../src/notify/heartbeat.js';
import { zbudujPushProblemowLinkedin, zbudujPushProblemowPracuj } from '../../src/notify/problems.js';
import type { Wiersz } from '../../src/sheets/client.js';
import type { PominietyMail } from '../../src/types.js';

const ocena = (nr: number, rek: string, pola: Record<string, unknown> = {}) => ({
  dedupKey: `pracuj.pl:${nr}`, title: `Stanowisko ${nr} z dosc dlugim tytulem`, company: `Firma ${nr} Sp. z o.o.`, url: `https://www.pracuj.pl/praca/x,oferta,${nr}`,
  etap4_klasa: 'ocenione', rekomendacja: rek,
  uzasadnienie_rekomendacji: `Uzasadnienie ${nr}: ` + 'konkretne dopasowanie do profilu i CV, '.repeat(6), ...pola,
});
const kopia = (nr: number, rek: string) => ({ ...ocena(nr, rek), etap4_klasa: 'kopia_powtorzonej_oferty', uzasadnienie_rekomendacji: 'Kopia oceny ...' });

// Push z ocenami (decyzja produktowa): zamiast skracać uzasadnienia i obcinać listę, dzieli się na części.
const bajty = (s: string) => Buffer.byteLength(s, 'utf8');

describe('push z ocenami (W-17, DJ-32)', () => {
  it('brak ofert albo tylko NIEOCENIONE: brak pusha', () => {
    const przypadki: [unknown[], unknown[]][] = [[[], []],
      [[ocena(1, 'NIEOCENIONE (BLAD ODPOWIEDZI AI)', { etap4_klasa: 'blad_parsowania' })], [{ etap4_klasa: 'do_oceny' }, { etap4_klasa: 'limit_przebiegu', rekomendacja: 'NIEOCENIONE (LIMIT PRZEBIEGU)' }]]];
    for (const [ocenione, kopie] of przypadki) {
      expect(zbudujPusheOcen(ocenione as any[], kopie as any[])).toEqual([]);
    }
  });

  it('kolejność aplikuj, obserwuj, pomin; aplikuj z pełnym uzasadnieniem, obserwuj skrócone, pomin i kopie bez uzasadnienia', () => {
    const [p, ...reszta] = zbudujPusheOcen([ocena(1, 'pomin'), ocena(2, 'aplikuj'), ocena(3, 'Obserwuj ')], [kopia(4, 'aplikuj')]);
    expect(reszta).toEqual([]);
    expect(p.tytul).toBe('Oferty pracy - nowe oceny (Pracuj.pl)');
    const u = (nr: number) => `Uzasadnienie ${nr}: ` + 'konkretne dopasowanie do profilu i CV, '.repeat(6);
    expect(p.tresc).toBe([
      'Pracuj.pl - nowe oceny AI: 4 (aplikuj 2, obserwuj 1, pomin 1)',
      '',
      '[APLIKUJ] Stanowisko 2 z dosc dlugim tytulem - Firma 2 Sp. z o.o.\n' + u(2).trim() + '\nhttps://www.pracuj.pl/praca/x,oferta,2',
      '',
      '[APLIKUJ, kopia oceny] Stanowisko 4 z dosc dlugim tytulem - Firma 4 Sp. z o.o.\nhttps://www.pracuj.pl/praca/x,oferta,4',
      '',
      '[OBSERWUJ] Stanowisko 3 z dosc dlugim tytulem - Firma 3 Sp. z o.o.\n' + u(3).slice(0, 157) + '...\nhttps://www.pracuj.pl/praca/x,oferta,3',
      '',
      '[POMIN] Stanowisko 1 z dosc dlugim tytulem - Firma 1 Sp. z o.o.\nhttps://www.pracuj.pl/praca/x,oferta,1',
    ].join('\n'));
  });

  it('data i godzina przebiegu w pierwszej linii, przed numerem części; bez pola priorytetu', () => {
    const [p] = zbudujPusheOcen([ocena(1, 'obserwuj'), ocena(2, 'pomin')], [], { czas: '09.10 07:01' });
    expect(p.tresc.split('\n')[0]).toBe('Pracuj.pl - nowe oceny AI: 2 (obserwuj 1, pomin 1) - 09.10 07:01');
    expect(p).not.toHaveProperty('priorytet');
    const czesci = zbudujPusheOcen(Array.from({ length: 40 }, (_, i) => ocena(i + 1, 'aplikuj')), [], { czas: '09.10 07:01' });
    expect(czesci[1].tresc.split('\n')[0]).toBe(`Pracuj.pl - nowe oceny AI: 40 (aplikuj 40) - 09.10 07:01 - czesc 2/${czesci.length}`);
  });

  it('pushe o problemach: czas w pierwszej linii (przed dwukropkiem) i przycięcie do limitu powiadomień', () => {
    expect(dopasujDoPowiadomienia('LinkedIn - problemy w przebiegu:\nPominiete maile (1):', '09.10 07:01'))
      .toBe('LinkedIn - problemy w przebiegu - 09.10 07:01:\nPominiete maile (1):');
    expect(dopasujDoPowiadomienia('Krotki tekst')).toBe('Krotki tekst');
    const dlugi = dopasujDoPowiadomienia('Pracuj.pl - problemy w przebiegu:\n' + 'Uwaga: zażółć gęślą jaźń. '.repeat(200), '09.10 07:01');
    expect(bajty(dlugi)).toBeLessThanOrEqual(MAX_BAJTOW_POWIADOMIENIA);
    expect(dlugi.endsWith('...')).toBe(true);
  });

  it('zera twarde i reguła kodu przy aplikuj i obserwuj (bez powtórzenia reguły z prefiksu uzasadnienia)', () => {
    const [p] = zbudujPusheOcen([
      ocena(1, 'obserwuj', { liczba_zer_twardych: 2, niespelnione_wymagania_twarde: 'Python; GCP', regula_kodu: 'sufit: 2 zer twardych', uzasadnienie_rekomendacji: '[REGULA: sufit: 2 zer twardych] Dobre.' }),
      ocena(2, 'aplikuj', { liczba_zer_twardych: 1, niespelnione_wymagania_twarde: 'Git', regula_kodu: 'uwaga: lista ma 1 poz., pole liczbowe 0 (przyjeto 1)' }),
      ocena(3, 'pomin', { liczba_zer_twardych: 4, niespelnione_wymagania_twarde: 'A; B; C; D', regula_kodu: 'zaawansowany Python (dopasowanie modelu: mocne)' })], []);
    expect(p.tresc).toContain('\nzera twarde: 1 (Git)\nregula: uwaga: lista ma 1 poz., pole liczbowe 0 (przyjeto 1)\nhttps://www.pracuj.pl/praca/x,oferta,2');
    expect(p.tresc).toContain('[REGULA: sufit: 2 zer twardych] Dobre.\nzera twarde: 2 (Python; GCP)\nhttps://www.pracuj.pl/praca/x,oferta,1');
    expect(p.tresc).toContain('[POMIN] Stanowisko 3 z dosc dlugim tytulem - Firma 3 Sp. z o.o.\nhttps://www.pracuj.pl/praca/x,oferta,3');
  });

  it('długi push: kilka części w limicie ntfy, każda oferta dokładnie raz, aplikuj z pełnym uzasadnieniem', () => {
    const ocenione = Array.from({ length: 30 }, (_, i) => ocena(i + 1, ['aplikuj', 'obserwuj', 'pomin'][i % 3]));
    const kopie = Array.from({ length: 10 }, (_, i) => kopia(100 + i, 'pomin'));
    const czesci = zbudujPusheOcen(ocenione, kopie);
    expect(czesci.length).toBeGreaterThan(1);
    const ile = czesci.length;
    czesci.forEach((c, i) => {
      expect(bajty(c.tresc)).toBeLessThanOrEqual(2800);
      expect(c.tytul).toBe(`Oferty pracy - nowe oceny (Pracuj.pl) (${i + 1}/${ile})`);
      expect(c.tresc.split('\n')[0]).toBe(`Pracuj.pl - nowe oceny AI: 40 (aplikuj 10, obserwuj 10, pomin 20) - czesc ${i + 1}/${ile}`);
    });
    const wszystko = czesci.map(c => c.tresc).join('\n');
    const linki = wszystko.match(/https:\/\/www\.pracuj\.pl\/praca\/x,oferta,\d+/g)!;
    expect(linki).toHaveLength(40);
    expect(new Set(linki).size).toBe(40);
    for (const o of ocenione.filter(o => o.rekomendacja === 'aplikuj')) expect(wszystko).toContain(o.uzasadnienie_rekomendacji.trim());
  });

  it('bardzo długie uzasadnienie aplikuj: przycięte do jednej wiadomości, link zostaje', () => {
    const [p] = zbudujPusheOcen([ocena(1, 'aplikuj', { uzasadnienie_rekomendacji: 'Długie uzasadnienie z polskimi znakami ąęść. '.repeat(200) })], []);
    expect(bajty(p.tresc)).toBeLessThanOrEqual(2800);
    expect(p.tresc).toMatch(/\.\.\.\nhttps:\/\/www\.pracuj\.pl\/praca\/x,oferta,1$/);
  });
});

const pom = (source: 'pracuj.pl' | 'linkedin', liczniki: Record<string, number>): PominietyMail =>
  ({ source, subject: 'Oferty na ktore czekasz', receivedAt: '2026-10-03T01:00:00.000Z', liczniki });

describe('push z problemami', () => {
  const brak = (nr: number, powod: string) => ({ ...ocena(nr, 'NIEOCENIONE (BRAK PELNEJ TRESCI)'), etap4_klasa: 'brak_tresci', powod_braku_tresci: powod });
  const blad = (nr: number) => ({ ...ocena(nr, 'NIEOCENIONE (BLAD ODPOWIEDZI AI)'), etap4_klasa: 'blad_parsowania', uzasadnienie_rekomendacji: 'Wywolanie OpenAI zakonczylo sie bledem: HTTP 400 ' + 'x'.repeat(200) });

  const przypadki: Record<string, { pominiete: PominietyMail[]; pobrane: any[]; limit: number }> = {
    'brak problemów': { pominiete: [], pobrane: [ocena(1, 'aplikuj')], limit: 0 },
    'wszystkie rodzaje problemów': {
      pominiete: [pom('pracuj.pl', { titles: 3, companies: 2, urls: 3 })],
      pobrane: [ocena(1, 'aplikuj'), brak(2, 'blokada'), brak(3, 'pusta_strona'), brak(4, 'blokada'), blad(5), { ...brak(6, ''), powod_braku_tresci: undefined }],
      limit: 4,
    },
    'dużo braków treści i błędów: przykłady i skróty': {
      pominiete: [], pobrane: [...Array.from({ length: 8 }, (_, i) => brak(i + 1, 'blad_pobrania')), ...Array.from({ length: 7 }, (_, i) => blad(50 + i))], limit: 0,
    },
  };
  const push = (p: { pominiete: PominietyMail[]; pobrane: any[]; limit: number }) =>
    zbudujPushProblemowPracuj({ pominieteMaile: p.pominiete, pobrane: p.pobrane, ocenione: p.pobrane, ponadLimit: p.limit });

  it('brak problemów: brak pusha', () => {
    expect(push(przypadki['brak problemów'])).toBeNull();
  });

  it('wszystkie rodzaje problemów: pominięte maile, brak treści wg powodu, błąd AI, limit', () => {
    const t = push(przypadki['wszystkie rodzaje problemów'])!;
    expect(t.split('\n')[0]).toBe('Pracuj.pl - problemy w przebiegu:');
    expect(t).toContain('Pominiete maile (1):\n- "Oferty na ktore czekasz" (2026-10-03T01:00:00.000Z): titles=3, companies=2, urls=3');
    expect(t).toContain('Brak pelnej tresci oferty: 4 z 6 pobranych');
    expect(t).toContain('- strona zablokowala pobranie (Cloudflare): 2');
    expect(t).toContain('Blad odpowiedzi AI (1):');
    expect(t).toContain('Oferty ponad limit przebiegu (nieocenione): 4');
  });

  it('dużo braków treści i błędów: maks. 5 przykładów, reszta jako liczba', () => {
    const t = push(przypadki['dużo braków treści i błędów: przykłady i skróty'])!;
    expect(t).toContain('... i 3 kolejnych (wszystkie w arkuszu: NIEOCENIONE (BRAK PELNEJ TRESCI))');
    expect(t).toContain('  ... i 2 kolejnych');
  });

  it('kolejka zaległych i ostrzeżenia na końcu', () => {
    const t = zbudujPushProblemowPracuj({ pominieteMaile: [], pobrane: [], ocenione: [], ponadLimit: 0, zalegleCzekajace: 3, ostrzezenia: ['Plik master CV rozni sie'] })!;
    expect(t).toBe('Pracuj.pl - problemy w przebiegu:\nOferty czekajace w kolejce do oceny w nastepnym przebiegu: 3\nUwaga: Plik master CV rozni sie');
  });

  it('LinkedIn: tylko niespójne maile (oferty LinkedIn trafiają do arkusza bez oceny AI)', () => {
    expect(zbudujPushProblemowLinkedin([])).toBeNull();
    expect(zbudujPushProblemowLinkedin([pom('linkedin', { titles: 2, urls: 2, companyLines: 1 })])).toBe(
      'LinkedIn - problemy w przebiegu:\nPominiete maile (1):\n- "Oferty na ktore czekasz" (2026-10-03T01:00:00.000Z): titles=2, urls=2, companyLines=1');
  });
});

describe('podsumowanie dnia (W-31)', () => {
  const w = (start: string, pola: Record<string, string> = {}) => ({ _nr: 2, start, status: 'ok', ...pola }) as unknown as Wiersz;
  const wieczor = new Date('2026-10-03T19:30:00Z'); // 21:30 w Warszawie
  const poludnie = new Date('2026-10-03T10:00:00Z');

  it('kiedy wysłać', () => {
    expect(czyWyslacHeartbeat([], poludnie, 21)).toBe(false);
    expect(czyWyslacHeartbeat([], wieczor, 21)).toBe(true);
    expect(czyWyslacHeartbeat([w('2026-10-03T21:05:00.000+02:00', { heartbeat_wyslany: 'tak' })], wieczor, 21)).toBe(false);
    expect(czyWyslacHeartbeat([w('2026-10-02T21:05:00.000+02:00', { heartbeat_wyslany: 'tak' })], wieczor, 21)).toBe(true); // wczoraj
    expect(czyWyslacHeartbeat([w('2026-10-03T21:05:00.000+02:00', { heartbeat_wyslany: 'tak' })], poludnie, 21, true)).toBe(true);
  });

  it('treść: sumy z dziś + bieżący przebieg, bez wczoraj', () => {
    const wiersze = [
      w('2026-10-02T23:30:00.000+02:00', { maile_pracuj: '9' }), // wczoraj
      w('2026-10-03T03:00:00.000+02:00', { maile_pracuj: '3', maile_linkedin: '1', oferty_nowe_pracuj: '20', oferty_nowe_linkedin: '4', przeszly_filtr: '10', ocenione_ai: '5', kopie: '2', aplikuj: '2', obserwuj: '1', pomin: '4', brak_tresci: '1' }),
      w('2026-10-03T03:30:00.000+02:00', { status: 'awaria' }),
      w('2026-10-03T04:00:00.000+02:00', { status: 'pominiety-blokada' }),
    ];
    const t = zbudujHeartbeat(wiersze, { maile_linkedin: 2, oferty_nowe_linkedin: 3, zalegle_czekajace: 4 }, wieczor, 'laptop');
    expect(t).toBe([
      '2026-10-03, tryb laptop: aplikacja dziala.',
      'Przebiegi: 4 (ok 2, awarie 1, pominiete 1)',
      'Maile: Pracuj.pl 3, LinkedIn 3',
      'Nowe oferty: Pracuj.pl 20, LinkedIn 7 (przeszly filtr 10)',
      'Oceny: aplikuj 2, obserwuj 1, pomin 4 (ocen AI 5, kopii 2)',
      'Nieocenione: brak tresci 1, blad AI 0, limit 0',
      'Czeka w kolejce: 4',
      'Sprawdz zakladke "Przebiegi" (kolumna komunikat).',
    ].join('\n'));
  });
});
