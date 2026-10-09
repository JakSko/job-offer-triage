// Wejście aplikacji (W-29): komendy `run`, `sprawdz`, `odswiez-cv`; opis flag w UZYCIE niżej.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { wczytajKonfiguracje, type Konfiguracja } from './config.js';
import { DOMYSLNY_MASTER, odswiezCv, ostrzezenieONieaktualnymCv, PLIK_CV, wczytajCv } from './cv/cv.js';
import { stanSkrzynki } from './mail/imap.js';
import { wczytajEml } from './mail/mime.js';
import { sprawdzKluczOpenAI } from './eval/openai.js';
import { wyslijPush } from './notify/ntfy.js';
import { wykonajPrzebieg } from './pipeline.js';
import { zapewnijZakladkePrzebiegi, ZAKLADKA_PRZEBIEGI } from './runlog.js';
import { Arkusz } from './sheets/client.js';
import { isoWarszawa } from './sheets/dates.js';
import { brakujaceKolumny, KOLUMNY_WYMAGANE_OFERTY, ZAKLADKA_OFERTY } from './sheets/oferty.js';

const UZYCIE = `Uzycie (z katalogu app):
  node dist/cli.js sprawdz
      diagnostyka: konfiguracja, arkusz, naglowki, zakladka "Przebiegi", testowy push
  node dist/cli.js odswiez-cv [--podglad]
      buduje app/dane/cv.md (CV dla modelu) z pliku master .docx; --podglad niczego nie zapisuje
  node dist/cli.js run [--eml <plik lub katalog .eml>] [--dry-run [--z-ai]] [--limit-ai N] [--wymus-heartbeat] [--szczegoly]
      przebieg: nieprzeczytane alerty ze skrzynki IMAP (maks. MAX_MAILI) albo maile z plikow (--eml);
      --dry-run niczego nie zapisuje, nie wysyla i nie oznacza maili (bez AI, chyba ze --z-ai)

Opis: README.md.`;

const KOLUMNY_FIRMY = ['firma_znormalizowana', 'kraj_siedziby', 'typ_firmy', 'wielkosc_firmy', 'pewnosc_kraj', 'pewnosc_typ', 'pewnosc_wielkosc', 'data_ustalenia', 'liczba_ofert'];

const log = (linia: string) => console.log(`${isoWarszawa().slice(11, 19)} ${linia}`);

async function sprawdz(k: Konfiguracja): Promise<number> {
  let bledy = 0;
  const krok = async (nazwa: string, f: () => Promise<string>) => {
    try {
      console.log(`[OK]   ${nazwa}: ${await f()}`);
    } catch (e) {
      bledy++;
      console.log(`[BLAD] ${nazwa}: ${e instanceof Error ? e.message : e}`);
    }
  };

  console.log(`[OK]   konfiguracja: tryb ${k.TRYB}, limit AI ${k.LIMIT_AI}, zalegle ${k.ZALEGLE_DNI} dni`);
  const arkusz = new Arkusz(k.SHEET_ID, k);
  await krok('dostep do arkusza', async () => `zakladki: ${(await arkusz.zakladki()).join(', ')}`);
  await krok(`naglowki "${ZAKLADKA_OFERTY}"`, async () => {
    const t = await arkusz.czytaj(ZAKLADKA_OFERTY);
    const brak = brakujaceKolumny(t, KOLUMNY_WYMAGANE_OFERTY);
    if (brak.length) throw new Error('brak kolumn: ' + brak.join(', '));
    return `komplet (${KOLUMNY_WYMAGANE_OFERTY.length} kolumn), ${t.wiersze.length} wierszy`;
  });
  await krok('naglowki "Firmy"', async () => {
    const t = await arkusz.czytaj('Firmy');
    const brak = brakujaceKolumny(t, KOLUMNY_FIRMY);
    if (brak.length) throw new Error('brak kolumn: ' + brak.join(', '));
    return `komplet, ${t.wiersze.length} wierszy`;
  });
  await krok(`zakladka "${ZAKLADKA_PRZEBIEGI}"`, async () => (await zapewnijZakladkePrzebiegi(arkusz)) ? 'utworzona' : 'istnieje');
  await krok('push ntfy', async () => {
    if (!k.NTFY_URL) throw new Error('brak NTFY_URL');
    await wyslijPush(k.NTFY_URL, 'Oferty pracy - test konfiguracji', `Komenda "sprawdz", tryb ${k.TRYB}, ${isoWarszawa()}`);
    return 'wyslany - sprawdz telefon';
  });
  await krok('CV dla modelu', async () => {
    const cv = wczytajCv();
    const master = k.CV_MASTER_FILE ?? DOMYSLNY_MASTER;
    const nieaktualne = ostrzezenieONieaktualnymCv(master, cv);
    if (nieaktualne) throw new Error(nieaktualne);
    const zgodnosc = fs.existsSync(master) ? 'zgodna z plikiem master' : 'pliku master tu nie ma (np. Railway), zgodnosci nie sprawdzano';
    return `wersja z ${cv.masterZmieniony}, ${cv.tresc.length} znakow, ${zgodnosc}`;
  });
  await krok('OpenAI', async () => {
    if (!k.OPENAI_API_KEY) throw new Error('brak OPENAI_API_KEY');
    return sprawdzKluczOpenAI(k.OPENAI_API_KEY, k.OPENAI_MODEL);
  });
  await krok('skrzynka IMAP', async () => {
    const s = await stanSkrzynki(k);
    return `logowanie OK, nieprzeczytane alerty: ${s.alerty.length}, inne nieprzeczytane: ${s.inne}`;
  });
  console.log(bledy ? `\nWYNIK: ${bledy} blad(y)` : '\nWYNIK: wszystko OK');
  return bledy ? 1 : 0;
}

function odswiez(master: string, podglad: boolean): number {
  const w = odswiezCv(master, PLIK_CV, !podglad);
  console.log(`Plik master: ${master} (zmieniony ${w.masterZmieniony})`);
  console.log(`CV dla modelu: ${w.markdown.length} znakow, ${w.sekcje.length} sekcji:`);
  for (const s of w.sekcje) console.log(`  ${String(s.linie).padStart(3)} linii  ${s.nazwa}`);
  console.log(`Pominiete celowo (${w.usuniete.length}):`);
  for (const l of w.usuniete) console.log('  x ' + l.slice(0, 110));
  for (const o of w.ostrzezenia) console.log('UWAGA: ' + o);
  if (!w.zmienione) {
    console.log('');
    console.log('Bez zmian: app/dane/cv.md jest zgodny z plikiem master.');
    return 0;
  }
  console.log('');
  console.log(`Zmiany wzgledem poprzedniej wersji: +${w.dodane.length} linii, -${w.usunieteWzgledemPoprzedniej.length} linii`);
  for (const l of w.usunieteWzgledemPoprzedniej) console.log('  - ' + l.slice(0, 150));
  for (const l of w.dodane) console.log('  + ' + l.slice(0, 150));
  console.log('');
  if (podglad) {
    console.log('PODGLAD: niczego nie zapisano.');
  } else {
    console.log(`Zapisano: ${PLIK_CV}`);
    console.log(`Nowe oceny beda oznaczone w arkuszu wersja CV ${w.masterZmieniony}. Zrob commit pliku, zeby Railway uzywal tej samej wersji.`);
  }
  return 0;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      eml: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      'z-ai': { type: 'boolean', default: false },
      'wymus-heartbeat': { type: 'boolean', default: false },
      'limit-ai': { type: 'string' },
      szczegoly: { type: 'boolean', default: false },
      podglad: { type: 'boolean', default: false },
    },
  });
  const komenda = positionals[0];
  if (komenda === 'odswiez-cv') {
    return odswiez(process.env.CV_MASTER_FILE || DOMYSLNY_MASTER, values.podglad);
  }
  if (komenda !== 'run' && komenda !== 'sprawdz') {
    console.log(UZYCIE);
    return 2;
  }

  const konfiguracja = wczytajKonfiguracje();
  if (komenda === 'sprawdz') return sprawdz(konfiguracja);

  const limitAi = values['limit-ai'] === undefined ? konfiguracja.LIMIT_AI : Number(values['limit-ai']);
  if (!Number.isInteger(limitAi) || limitAi < 0) throw new Error('--limit-ai musi byc liczba calkowita >= 0');

  const dryRun = values['dry-run'];
  log(`Start przebiegu: tryb ${konfiguracja.TRYB}${dryRun ? ', NA SUCHO' : ''}, limit AI ${limitAi}, maile z: ${values.eml ?? `skrzynki ${konfiguracja.IMAP_USER}`}`);
  const maile = values.eml ? await wczytajEml(values.eml) : undefined;
  const wynik = await wykonajPrzebieg({ konfiguracja, maile, dryRun, zAi: values['z-ai'], wymusHeartbeat: values['wymus-heartbeat'], limitAi, log });

  if (values.szczegoly || dryRun) {
    for (const o of wynik.noweOferty) {
      console.log(`  NOWA [${o.passesFilter ? 'TAK' : 'nie'}] ${o.dedupKey} | ${o.title} | ${o.company ?? ''} | ${o.location ?? ''}`);
    }
    // oferty czekające na kolejny przebieg z powodu limitu: kilka przykładów zamiast setek linii
    const PRZYKLADOW_LIMITU = 5;
    const zLimitu = (w: Record<string, any>) => /^Przekroczony limit/.test(String(w.uzasadnienie_rekomendacji ?? ''));
    const limitowe = wynik.wyniki.filter(zLimitu);
    for (const w of wynik.wyniki.filter(w => !zLimitu(w))) {
      if (w.etap4_klasa !== 'ocenione') {
        console.log(`  WYNIK ${w.dedupKey} | ${w.rekomendacja} | ${String(w.uzasadnienie_rekomendacji ?? '').slice(0, 140)}`);
        continue;
      }
      // świeża ocena AI: pełne uzasadnienie i ślad oceny (jak w arkuszu)
      console.log(`  WYNIK ${w.dedupKey} | ${w.rekomendacja} | ${w.title ?? ''} | ${w.company ?? ''}`);
      console.log(`        uzasadnienie: ${String(w.uzasadnienie_rekomendacji ?? '').replace(/\s+/g, ' ').trim()}`);
      console.log(`        profil: ${w.najlepszy_profil || '-'} | krok1 ${w.dopasowanie_krok1 || '-'} -> krok2 ${w.dopasowanie_krok2 || '-'} | lokalizacja: ${w.tryb_lokalizacji || '-'}`);
      console.log(`        zera twarde: ${w.liczba_zer_twardych || 0}${w.niespelnione_wymagania_twarde ? ` (${w.niespelnione_wymagania_twarde})` : ''}${w.regula_kodu ? ` | regula kodu: ${w.regula_kodu}` : ''}`);
      if (w.sygnaly_do_sprawdzenia) console.log(`        sygnaly: ${String(w.sygnaly_do_sprawdzenia).replace(/\s+/g, ' ').trim()}`);
    }
    for (const w of limitowe.slice(0, PRZYKLADOW_LIMITU)) console.log(`  WYNIK ${w.dedupKey} | ${w.rekomendacja} | ${String(w.uzasadnienie_rekomendacji ?? '').slice(0, 140)}`);
    if (limitowe.length > PRZYKLADOW_LIMITU) console.log(`  ... i ${limitowe.length - PRZYKLADOW_LIMITU} kolejnych ofert ponad limit przebiegu`);
    for (const d of wynik.bezOceny) console.log(`  BEZ OCENY ${d.dedupKey} | ${d.title}`);
  }
  if (dryRun) {
    for (const push of wynik.pushe) {
      console.log('');
      console.log(`----- PUSH (na sucho): ${push.tytul} -----`);
      console.log(push.tresc);
    }
  }
  return 0;
}

main().then(
  kod => { process.exitCode = kod; },
  blad => {
    console.error('AWARIA:', blad instanceof Error ? blad.message : blad);
    process.exitCode = 1;
  },
);
