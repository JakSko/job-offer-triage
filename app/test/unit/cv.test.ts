// Konwersja CV z .docx na Markdown dla modelu i plik app/dane/cv.md.
// Dokumenty testowe są budowane w locie (minimalny .docx = zip z word/document.xml).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { DOMYSLNY_MASTER, odswiezCv, ostrzezenieONieaktualnymCv, PLIK_CV, wczytajCv } from '../../src/cv/cv.js';
import { konwertujDocx } from '../../src/cv/docx.js';

const p = (tekst: string, lista = false) =>
  `<w:p>${lista ? '<w:pPr><w:pStyle w:val="Akapitzlist"/><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr>' : '<w:pPr><w:jc w:val="left"/></w:pPr>'}`
  + tekst.split('\t').map(t => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`).join('<w:r><w:tab/></w:r>') + '</w:p>';

function docx(akapity: string[], dodatki: Record<string, string> = {}): Uint8Array {
  const pliki: Record<string, Uint8Array> = { 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document><w:body>${akapity.join('')}</w:body></w:document>`) };
  for (const [n, t] of Object.entries(dodatki)) pliki[n] = strToU8(t);
  return zipSync(pliki);
}

const WYPELNIACZ = 'Led transformation initiatives across the organization and delivered measurable outcomes for stakeholders. ';
const TYPOWE = [
  p('JAN TESTOWY'),
  p('Transformation Leader  |  People &amp; Operations'),
  p('Poznań, Poland   •   +48 500 600 700   •   jan@example.com'),
  p('linkedin.com/in/jantestowy'),
  p('Summary with    extra   spaces. ' + WYPELNIACZ.repeat(20)),
  p('PROFESSIONAL EXPERIENCE'),
  p('Senior Manager - Firma S.A.\tJun 2023 – Present'),
  p('Manage 55 engineers; R&amp;D &lt;core&gt; team. ' + WYPELNIACZ.repeat(15), true),
  p('TECHNICAL SKILLS'),
  p('Development: Python, Node.js, Git, GitHub'),
  p('LANGUAGES'),
  p('English: B2+ • Polish: native', true),
  p('EDUCATION'),
  p('M.Sc. Computer Science (2005–2007)'),
  p('ADDITIONAL ACTIVITIES &amp; INTERESTS'),
  p('Klub - Local Community Lead.', true),
  p('Interests: chess, squash.', true),
];

describe('konwersja .docx -> Markdown', () => {
  it('struktura: tytuł, sekcje, stanowiska, listy; encje i spacje uporządkowane', () => {
    const w = konwertujDocx(docx(TYPOWE));
    const linie = w.markdown.split('\n');
    expect(linie[0]).toBe('# JAN TESTOWY');
    expect(linie[1]).toBe('Transformation Leader | People & Operations');
    expect(w.markdown).toContain('Summary with extra spaces.');
    expect(w.markdown).toContain('\n\n## PROFESSIONAL EXPERIENCE\n\n### Senior Manager - Firma S.A. | Jun 2023 – Present\n- Manage 55 engineers; R&D <core> team.');
    expect(w.markdown).toContain('## TECHNICAL SKILLS\nDevelopment: Python, Node.js, Git, GitHub');
    expect(w.markdown).toContain('## LANGUAGES\n- English: B2+ • Polish: native');
    expect(w.sekcje.map(s => s.nazwa)).toEqual(['PROFESSIONAL EXPERIENCE', 'TECHNICAL SKILLS', 'LANGUAGES', 'EDUCATION']);
  });

  it('pomija kontakt i sekcję zainteresowań, zostawia języki', () => {
    const w = konwertujDocx(docx(TYPOWE));
    expect(w.usuniete).toEqual([
      'Poznań, Poland • +48 500 600 700 • jan@example.com', 'linkedin.com/in/jantestowy',
      'ADDITIONAL ACTIVITIES & INTERESTS', 'Klub - Local Community Lead.', 'Interests: chess, squash.',
    ]);
    expect(w.markdown).not.toMatch(/example\.com|\+48|linkedin|INTERESTS|chess|Klub/);
  });

  it('sekcja po zainteresowaniach wraca do wyniku', () => {
    const w = konwertujDocx(docx([...TYPOWE, p('CERTIFICATIONS'), p('PRINCE2 Foundation', true)]));
    expect(w.markdown.trimEnd().endsWith('## CERTIFICATIONS\n- PRINCE2 Foundation')).toBe(true);
  });

  it('odmawia konwersji, gdy mogłaby zgubić treść albo wynik jest niepełny', () => {
    const zPolem = TYPOWE.join('') + '<w:p><w:r><w:txbxContent><w:p><w:r><w:t>W ramce</w:t></w:r></w:p></w:txbxContent></w:r></w:p>';
    expect(() => konwertujDocx(docx([zPolem]))).toThrow(/pola tekstowe/);
    expect(() => konwertujDocx(docx([...TYPOWE, '<w:p><w:ins w:id="1"><w:r><w:t>x</w:t></w:r></w:ins></w:p>']))).toThrow(/śledzenie zmian/);
    expect(() => konwertujDocx(docx(TYPOWE.filter(a => !a.includes('LANGUAGES') && !a.includes('B2+'))))).toThrow(/brak sekcji: języki/);
    expect(() => konwertujDocx(docx(TYPOWE.filter(a => !a.includes('WYPELNIACZ') && !a.includes(WYPELNIACZ.slice(0, 20)))))).toThrow(/za krótki/);
    expect(() => konwertujDocx(docx([...TYPOWE.slice(0, 13), p('EDUCATION')]))).toThrow(/Kontrola CV|pusta sekcja/);
    expect(() => konwertujDocx(zipSync({ 'inny.txt': strToU8('x') }))).toThrow(/nie jest plik .docx/);
  });

  it('ostrzega o tekście w nagłówku strony', () => {
    const w = konwertujDocx(docx(TYPOWE, { 'word/header1.xml': '<w:hdr><w:p><w:r><w:t>Poufne</w:t></w:r></w:p></w:hdr>' }));
    expect(w.ostrzezenia.join(' ')).toMatch(/header1/);
  });
});

describe('plik cv.md: zapis, odczyt, wykrywanie nieaktualności', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-test-'));
  const master = path.join(tmp, 'CV.docx');
  const plik = path.join(tmp, 'dane', 'cv.md');

  it('odświeżenie zapisuje plik z nagłówkiem; drugi raz bez zmian', () => {
    fs.writeFileSync(master, docx(TYPOWE));
    const w1 = odswiezCv(master, plik);
    expect(w1.zmienione).toBe(true);
    const cv = wczytajCv(plik);
    expect(cv.tresc).toBe(w1.markdown);
    expect(cv.masterZmieniony).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(odswiezCv(master, plik).zmienione).toBe(false);
    expect(ostrzezenieONieaktualnymCv(master, cv)).toBeNull();
  });

  it('zmiana w pliku master jest wykrywana, a odświeżenie pokazuje różnicę', () => {
    const cv = wczytajCv(plik);
    fs.writeFileSync(master, docx(TYPOWE.map(a => a.replace('Git, GitHub', 'Git, GitHub, Docker'))));
    expect(ostrzezenieONieaktualnymCv(master, cv)).toMatch(/rozni sie.*odswiez-cv/);
    const podglad = odswiezCv(master, plik, false);
    expect(podglad.dodane).toEqual(['Development: Python, Node.js, Git, GitHub, Docker']);
    expect(podglad.usunieteWzgledemPoprzedniej).toEqual(['Development: Python, Node.js, Git, GitHub']);
    expect(wczytajCv(plik).tresc).toBe(cv.tresc); // podgląd niczego nie zapisał
  });

  it('brak pliku master (Railway) nie jest problemem; uszkodzony master to ostrzeżenie', () => {
    const cv = wczytajCv(plik);
    expect(ostrzezenieONieaktualnymCv(path.join(tmp, 'nie-ma.docx'), cv)).toBeNull();
    fs.writeFileSync(master, 'to nie jest zip');
    expect(ostrzezenieONieaktualnymCv(master, cv)).toMatch(/Nie udalo sie sprawdzic/);
  });

  it('ręczna edycja cv.md jest odrzucana', () => {
    fs.writeFileSync(plik, fs.readFileSync(plik, 'utf8').replace('Python', 'Rust'));
    expect(() => wczytajCv(plik)).toThrow(/zmieniony ręcznie/);
    expect(() => wczytajCv(path.join(tmp, 'brak.md'))).toThrow(/odswiez-cv/);
  });
});

describe.skipIf(!fs.existsSync(PLIK_CV))('plik app/dane/cv.md (w repozytorium: CV przykładowe)', () => {
  it('wczytuje się, zawiera kluczowe sekcje, bez kontaktu i zainteresowań', () => {
    const cv = wczytajCv();
    expect(cv.tresc.length).toBeGreaterThan(1000);
    for (const s of ['## PROFESSIONAL EXPERIENCE', '## LANGUAGES', '## EDUCATION']) expect(cv.tresc).toContain(s);
    expect(cv.tresc).not.toMatch(/@|\+48|linkedin\.com\/in|INTERESTS/i);
  });

  it.skipIf(!fs.existsSync(DOMYSLNY_MASTER))('jest zgodny z plikiem master na dysku', () => {
    expect(ostrzezenieONieaktualnymCv(DOMYSLNY_MASTER, wczytajCv())).toBeNull();
  });
});
