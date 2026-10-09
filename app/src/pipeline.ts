// Przebieg aplikacji (docs/migracja/03_architektura_i_konfiguracja.md, "Przepływ przebiegu").
// Stan F3: maile z plików .eml, arkusz (dedup, zapis nowych ofert, zapis wyników), LinkedIn bez AI,
// klasyfikacja Pracuj.pl (kopia / limit / do oceny), kolejka zaległych, ocena AI (Jina + OpenAI + reguły
// kodu, cache firm), "Przebiegi" i blokada. Pushe z ocenami i problemami (F4) oraz IMAP (F5) dochodzą
// w kolejnych fazach.
import type { Konfiguracja } from './config.js';
import { DOMYSLNY_MASTER, ostrzezenieONieaktualnymCv, wczytajCv } from './cv/cv.js';
import { kopiaZPrzebiegu, sklasyfikujZPowtorkami, type Rekord } from './eval/classify.js';
import { KOLUMNY_FIRMY, wierszeNowychFirm, ZAKLADKA_FIRMY } from './eval/companies.js';
import { ocenOferty } from './eval/evaluate.js';
import { pobierzBezposrednio, pobierzPrzezJina } from './eval/fetch.js';
import { wywolajOpenAI } from './eval/openai.js';
import { zlozPrompt } from './eval/prompt.js';
import { wersjaPromptu } from './eval/rules.js';
import { wpisLinkedinBezAi } from './eval/linkedin.js';
import { czyZalegla, wybierzZalegle } from './eval/queue.js';
import { filtruj } from './filter/keywords.js';
import { oznaczPrzeczytane, pobierzAlerty } from './mail/imap.js';
import { zrodloMaila } from './mail/route.js';
import { zbudujPusheOcen } from './notify/digest.js';
import { czyWyslacHeartbeat, TYTUL_HEARTBEAT, zbudujHeartbeat } from './notify/heartbeat.js';
import { dopasujDoPowiadomienia, wyslijPush, wyslijPushAwarii } from './notify/ntfy.js';
import { TYTUL_PROBLEMY_LINKEDIN, TYTUL_PROBLEMY_PRACUJ, zbudujPushProblemowLinkedin, zbudujPushProblemowPracuj } from './notify/problems.js';
import { rozpocznijPrzebieg, zakonczPrzebieg, ZAKLADKA_PRZEBIEGI, type Liczniki, type Przebieg } from './runlog.js';
import { Arkusz } from './sheets/client.js';
import { krotkiCzasWarszawa } from './sheets/dates.js';
import {
  brakujaceKolumny, dopiszNoweOferty, KOLUMNY_WYMAGANE_OFERTY, oznaczNowe, ZAKLADKA_OFERTY, zmianyWynikow, type Wynik,
} from './sheets/oferty.js';
import { ekstrakcjaLinkedin, polaczLinkedin } from './sources/linkedin.js';
import { ekstrakcjaPracuj, polaczPracuj } from './sources/pracuj.js';
import type { Mail, Oferta, OfertaPoFiltrze, PominietyMail, Zrodlo } from './types.js';

export interface WynikParsowania {
  oferty: OfertaPoFiltrze[];
  pominieteMaile: PominietyMail[];
  /** Maile od innych nadawców (W-01): nie są przetwarzane ani oznaczane. */
  ignorowaneMaile: Mail[];
  maileWgZrodla: Record<Zrodlo, number>;
}

export function parsujMaile(maile: Mail[]): WynikParsowania {
  const oferty: Oferta[] = [];
  const pominieteMaile: PominietyMail[] = [];
  const ignorowaneMaile: Mail[] = [];
  const maileWgZrodla: Record<Zrodlo, number> = { 'pracuj.pl': 0, linkedin: 0 };

  for (const mail of maile) {
    const zrodlo = zrodloMaila(mail);
    if (!zrodlo) {
      ignorowaneMaile.push(mail);
      continue;
    }
    maileWgZrodla[zrodlo]++;
    const wynik = zrodlo === 'pracuj.pl'
      ? polaczPracuj(ekstrakcjaPracuj(mail.html), mail)
      : polaczLinkedin(ekstrakcjaLinkedin(mail.html), mail);
    if (wynik.pominiety) pominieteMaile.push(wynik.pominiety);
    oferty.push(...wynik.oferty.map(x => ({ ...x, dataMaila: mail.receivedAt })));
  }

  return { oferty: filtruj(oferty), pominieteMaile, ignorowaneMaile, maileWgZrodla };
}

export interface OpcjePrzebiegu {
  konfiguracja: Konfiguracja;
  /** Maile już wczytane (tryb --eml). Brak = nieprzeczytane alerty ze skrzynki IMAP (W-01, W-21). */
  maile?: Mail[];
  dryRun: boolean;
  /** W przebiegu na sucho: mimo wszystko pobierz treść i wywołaj AI (kosztuje), nadal bez zapisu. */
  zAi?: boolean;
  limitAi: number;
  /** Wyślij podsumowanie dnia niezależnie od godziny (test W-31). */
  wymusHeartbeat?: boolean;
  log: (linia: string) => void;
}

export interface Push {
  nazwa: 'oceny' | 'problemy-pracuj' | 'problemy-linkedin' | 'heartbeat';
  tytul: string;
  tresc: string;
  wyslany?: boolean;
}

export interface PodsumowaniePrzebiegu {
  status: 'ok' | 'pominiety-blokada';
  liczniki: Liczniki;
  pominieteMaile: PominietyMail[];
  noweOferty: OfertaPoFiltrze[];
  wyniki: Wynik[];
  /** Pushe przygotowane w przebiegu (na sucho: tylko treść, bez wysyłki). */
  pushe: Push[];
  /** Ostrzeżenia przebiegu (np. nieaktualne CV); od F4 trafiają też do pusha o problemach. */
  ostrzezenia: string[];
  /** Oferty zakwalifikowane do oceny AI, które nie zostały ocenione (przebieg na sucho bez AI, limit czasu). */
  bezOceny: Rekord[];
}

export async function wykonajPrzebieg(o: OpcjePrzebiegu): Promise<PodsumowaniePrzebiegu> {
  const { konfiguracja: k, dryRun, log } = o;
  const start = new Date();
  const arkusz = new Arkusz(k.SHEET_ID, k);
  let etap = 'start';
  let przebieg: Przebieg | null = null;
  const liczniki: Liczniki = {};
  const ostrzezenia: string[] = [];

  try {
    if (!dryRun) {
      etap = 'blokada i log przebiegu';
      przebieg = await rozpocznijPrzebieg(arkusz, k.TRYB, start);
      if (!przebieg) {
        log(`Inny przebieg jest w toku - koncze bez pracy (zakladka "${ZAKLADKA_PRZEBIEGI}").`);
        return { status: 'pominiety-blokada', liczniki, pominieteMaile: [], noweOferty: [], wyniki: [], bezOceny: [], ostrzezenia: [], pushe: [] };
      }
    }

    etap = 'odczyt arkusza';
    const tabela = await arkusz.czytaj(ZAKLADKA_OFERTY);
    const brak = brakujaceKolumny(tabela, KOLUMNY_WYMAGANE_OFERTY);
    if (brak.length) throw new Error(`Zakladka "${ZAKLADKA_OFERTY}": brak kolumn: ${brak.join(', ')}. Nic nie zapisano.`);
    log(`Arkusz: ${tabela.wiersze.length} wierszy w "${ZAKLADKA_OFERTY}".`);

    etap = 'parsowanie maili';
    let maile = o.maile;
    const zeSkrzynki = !maile;
    if (!maile) {
      etap = 'skrzynka IMAP';
      const pobrane = await pobierzAlerty(k, k.MAX_MAILI);
      maile = pobrane.maile;
      log(`Skrzynka: ${pobrane.wszystkich} nieprzeczytanych alertow, pobrane ${maile.length} (limit ${k.MAX_MAILI}), inne nieprzeczytane maile: ${pobrane.inne} (nie sa ruszane).`);
      if (pobrane.wszystkich > maile.length) log(`W skrzynce zostaje ${pobrane.wszystkich - maile.length} alertow na kolejne przebiegi.`);
      etap = 'parsowanie maili';
    }
    const parsowanie = parsujMaile(maile);
    liczniki.maile_pracuj = parsowanie.maileWgZrodla['pracuj.pl'];
    liczniki.maile_linkedin = parsowanie.maileWgZrodla.linkedin;
    liczniki.maile_pominiete = parsowanie.pominieteMaile.length;
    log(`Maile: Pracuj.pl ${liczniki.maile_pracuj}, LinkedIn ${liczniki.maile_linkedin}, inne ${parsowanie.ignorowaneMaile.length}, niespojne ${liczniki.maile_pominiete}. Oferty w mailach: ${parsowanie.oferty.length}.`);
    for (const m of parsowanie.pominieteMaile) log(`NIESPOJNY MAIL [${m.source}] "${m.subject}" (${m.receivedAt}): ${JSON.stringify(m.liczniki)}`);

    etap = 'dedup i zapis nowych ofert';
    const nowe = oznaczNowe(parsowanie.oferty, tabela.wiersze.map(w => w.klucz_oferty));
    liczniki.oferty_nowe_pracuj = nowe.filter(x => x.source === 'pracuj.pl').length;
    liczniki.oferty_nowe_linkedin = nowe.filter(x => x.source === 'linkedin').length;
    liczniki.przeszly_filtr = nowe.filter(x => x.passesFilter).length;
    log(`Nowe oferty: ${nowe.length} (Pracuj.pl ${liczniki.oferty_nowe_pracuj}, LinkedIn ${liczniki.oferty_nowe_linkedin}), przeszly filtr: ${liczniki.przeszly_filtr}.`);

    const nrWiersza = new Map(tabela.wiersze.map(w => [w.klucz_oferty.trim(), w._nr] as const));
    if (!dryRun) {
      const { numery, bezDatyMaila } = await dopiszNoweOferty(arkusz, tabela, nowe, start);
      nowe.forEach((x, i) => nrWiersza.set(x.dedupKey!, numery[i]));
      if (bezDatyMaila && nowe.length) ostrzezenia.push('Arkusz "Oferty" nie ma kolumny data_maila - data maila nie zostala zapisana.');
      if (zeSkrzynki) {
        // W-20: dopiero teraz, gdy oferty są w arkuszu. Także maile niespójne (zgłoszone w raporcie problemów).
        etap = 'oznaczanie maili jako przeczytanych';
        const przetworzone = maile.filter(m => zrodloMaila(m)).map(m => m.id);
        await oznaczPrzeczytane(k, przetworzone);
        log(`Oznaczone jako przeczytane: ${przetworzone.length} maili.`);
        etap = 'dedup i zapis nowych ofert';
      }
    }

    etap = 'ocena';
    const zalegle = wybierzZalegle(tabela.wiersze, k.ZALEGLE_DNI, start.getTime());
    liczniki.zalegle_wziete = zalegle.length;
    const nowePoFiltrze = nowe.filter(x => x.passesFilter);
    const { sklasyfikowane, powtorki } = sklasyfikujZPowtorkami(
      [...zalegle, ...nowePoFiltrze.filter(x => x.source === 'pracuj.pl')], tabela.wiersze, o.limitAi, start.getTime());
    const kopie = sklasyfikowane.filter(x => x.etap4_klasa === 'kopia_powtorzonej_oferty');
    const ponadLimit = sklasyfikowane.filter(x => x.etap4_klasa === 'limit_przebiegu');
    const doOceny = sklasyfikowane.filter(x => x.etap4_klasa === 'do_oceny');
    const linkedin = wpisLinkedinBezAi(nowePoFiltrze.filter(x => x.source === 'linkedin'));
    liczniki.limit = ponadLimit.length;
    log(`Pracuj.pl do Etapu 4: ${sklasyfikowane.length + powtorki.length} (zalegle ${zalegle.length}): kopie ocen z historii ${kopie.length}, do oceny AI ${doOceny.length}, powtorki w przebiegu ${powtorki.length}, ponad limit ${ponadLimit.length}. LinkedIn bez AI: ${linkedin.length}.`);

    let ocenione: Rekord[] = [];
    let bezOceny: Rekord[] = doOceny;
    if (doOceny.length && (!dryRun || o.zAi)) {
      etap = 'ocena AI';
      if (!k.OPENAI_API_KEY) throw new Error('Brak OPENAI_API_KEY - nie mozna ocenic ofert.');
      const apiKey = k.OPENAI_API_KEY;
      const cv = wczytajCv();
      const nieaktualne = ostrzezenieONieaktualnymCv(k.CV_MASTER_FILE ?? DOMYSLNY_MASTER, cv);
      if (nieaktualne) { ostrzezenia.push(nieaktualne); log('UWAGA: ' + nieaktualne); }
      log(`CV dla modelu: wersja z ${cv.masterZmieniony} (${cv.tresc.length} znakow).`);
      const tabelaFirm = await arkusz.czytaj(ZAKLADKA_FIRMY);
      const brakFirmy = brakujaceKolumny(tabelaFirm, KOLUMNY_FIRMY);
      if (brakFirmy.length) throw new Error(`Zakladka "${ZAKLADKA_FIRMY}": brak kolumn: ${brakFirmy.join(', ')}.`);

      const blokada = /just a moment|attention required|access denied|cf-chl|challenge-platform|target url returned error/i;
      const pobierzTresc = async (url: string) => {
        const zJina = await pobierzPrzezJina(url, k.JINA_API_KEY);
        if (k.FETCH_MODE === 'jina-then-direct' && (zJina === null || blokada.test(zJina.slice(0, 1500)))) return pobierzBezposrednio(url);
        return zJina;
      };
      const ocena = await ocenOferty(doOceny, tabelaFirm.wiersze,
        { model: k.OPENAI_MODEL, instrukcja: zlozPrompt(cv.tresc), wersja: wersjaPromptu(cv.masterZmieniony), termin: start.getTime() + k.LIMIT_CZASU_MIN * 60_000, log },
        { pobierzTresc, wywolajModel: zadanie => wywolajOpenAI(zadanie, apiKey) });
      ocenione = ocena.wyniki;
      bezOceny = ocena.nieZdazyly;

      etap = 'zapis nowych firm';
      const noweFirmy = wierszeNowychFirm(ocenione, new Date());
      if (!dryRun) await arkusz.dopisz(tabelaFirm, noweFirmy);
      log(`Nowe firmy w cache: ${noweFirmy.length}.`);
    } else if (doOceny.length) {
      log(`Na sucho bez AI: ${doOceny.length} ofert czekaloby na ocene (dodaj --z-ai, zeby je ocenic bez zapisu).`);
    }
    // powtórki z tego przebiegu: kopia świeżej oceny wzorca; bez oceny wzorca zostają w kolejce zaległych
    const wynikWgKlucza = new Map(ocenione.map(x => [x.dedupKey, x] as const));
    for (const pw of powtorki) {
      const kopia = kopiaZPrzebiegu(pw.oferta, wynikWgKlucza.get(pw.wzorzec));
      if (kopia) kopie.push(kopia);
      else bezOceny = [...bezOceny, pw.oferta];
    }
    liczniki.kopie = kopie.length;
    liczniki.ocenione_ai = ocenione.filter(x => x.etap4_klasa === 'ocenione').length;
    liczniki.brak_tresci = ocenione.filter(x => x.etap4_klasa === 'brak_tresci').length;
    liczniki.bledy_ai = ocenione.filter(x => x.etap4_klasa === 'blad_parsowania').length;

    etap = 'zapis wynikow';
    const wyniki = [...kopie, ...ponadLimit, ...ocenione, ...linkedin] as Wynik[];
    const { zmiany, bezWiersza } = zmianyWynikow(wyniki, nrWiersza);
    if (!dryRun) {
      await arkusz.zmien(tabela, zmiany);
    }
    if (!dryRun) for (const klucz of bezWiersza) ostrzezenia.push(`Brak wiersza dla ${klucz} w arkuszu - wynik nie zapisany.`);
    for (const r of ['aplikuj', 'obserwuj', 'pomin'] as const) {
      liczniki[r] = [...kopie, ...ocenione].filter(x => String(x.rekomendacja).trim().toLowerCase() === r).length;
    }
    // zaległe po przebiegu: stan arkusza po zapisach tego przebiegu (wiersze zmienione + dopisane)
    const poZapisie = new Map<string, Record<string, string>>(tabela.wiersze.map(w => [w.klucz_oferty.trim(), w]));
    for (const x of nowe) poZapisie.set(x.dedupKey!, { zrodlo: x.source, przeszlo_filtr_slow_kluczowych: x.passesFilter ? 'tak' : 'nie', rekomendacja: '', data_wykrycia: start.toISOString() });
    for (const w of wyniki) poZapisie.set(w.dedupKey, { ...poZapisie.get(w.dedupKey)!, rekomendacja: String(w.rekomendacja ?? '') });
    liczniki.zalegle_czekajace = [...poZapisie.values()].filter(w => czyZalegla(w, k.ZALEGLE_DNI, start.getTime())).length;

    etap = 'pushe';
    const pushe: Push[] = [];
    // data i godzina przebiegu w pierwszej linii; treść w limicie powiadomień iPhone'a (MAX_BAJTOW_POWIADOMIENIA)
    const czas = krotkiCzasWarszawa(start);
    const dodaj = (nazwa: Push['nazwa'], tytul: string, tresc: string | null) => {
      if (tresc) pushe.push({ nazwa, tytul, tresc: nazwa === 'heartbeat' ? dopasujDoPowiadomienia(tresc) : dopasujDoPowiadomienia(tresc, czas) });
    };
    // oceny: jedna albo kilka wiadomości (gdy nie mieszczą się w limicie ntfy), żadna oferta nie jest pomijana
    for (const p of zbudujPusheOcen(ocenione, kopie, { czas })) pushe.push({ nazwa: 'oceny', ...p });
    dodaj('problemy-pracuj', TYTUL_PROBLEMY_PRACUJ, zbudujPushProblemowPracuj({
      pominieteMaile: parsowanie.pominieteMaile.filter(m => m.source === 'pracuj.pl'),
      pobrane: ocenione, ocenione, ponadLimit: ponadLimit.length,
      zalegleCzekajace: Number(liczniki.zalegle_czekajace) || 0, ostrzezenia,
    }));
    dodaj('problemy-linkedin', TYTUL_PROBLEMY_LINKEDIN, zbudujPushProblemowLinkedin(parsowanie.pominieteMaile.filter(m => m.source === 'linkedin')));
    let wierszePrzebiegow = przebieg?.tabela.wiersze ?? [];
    if (!przebieg) wierszePrzebiegow = await arkusz.czytaj(ZAKLADKA_PRZEBIEGI).then(x => x.wiersze, () => []);
    if (czyWyslacHeartbeat(wierszePrzebiegow, start, k.HEARTBEAT_GODZINA, o.wymusHeartbeat)) {
      dodaj('heartbeat', TYTUL_HEARTBEAT, zbudujHeartbeat(wierszePrzebiegow, liczniki, start, k.TRYB));
    }
    if (!dryRun) {
      for (const push of pushe) {
        if (!k.NTFY_URL) { ostrzezenia.push('Brak NTFY_URL - pushe nie wyslane.'); break; }
        try {
          await wyslijPush(k.NTFY_URL, push.tytul, push.tresc);
          push.wyslany = true;
        } catch (e) {
          ostrzezenia.push(e instanceof Error ? e.message : String(e));
        }
      }
    }
    liczniki.pushe = pushe.filter(x => x.wyslany).map(x => x.nazwa).join(', ');
    if (pushe.some(x => x.nazwa === 'heartbeat' && x.wyslany)) liczniki.heartbeat_wyslany = 'tak';
    log(`Pushe: ${pushe.length ? pushe.map(x => x.nazwa + (dryRun ? ' (na sucho)' : x.wyslany ? '' : ' (NIE WYSLANY)')).join(', ') : 'brak'}.`);
    for (const o of ostrzezenia) log('UWAGA: ' + o);

    etap = 'koniec';
    if (przebieg) await zakonczPrzebieg(arkusz, przebieg, 'ok', liczniki, ostrzezenia.join(' | '));
    log(dryRun ? 'PRZEBIEG NA SUCHO: nic nie zapisano, nic nie wyslano.' : `Zapisano: ${nowe.length} nowych wierszy, ${zmiany.length} wynikow.`);
    return { status: 'ok', liczniki, pominieteMaile: parsowanie.pominieteMaile, noweOferty: nowe, wyniki, bezOceny, ostrzezenia, pushe };
  } catch (blad) {
    const komunikat = blad instanceof Error ? blad.message : String(blad);
    if (!dryRun) {
      const pushWyslany = await wyslijPushAwarii(k.NTFY_URL, k.TRYB, etap, blad);
      if (przebieg) {
        await zakonczPrzebieg(arkusz, przebieg, 'awaria', { ...liczniki, pushe: pushWyslany ? 'awaria' : '' }, `[${etap}] ${komunikat}`)
          .catch(() => log('Nie udalo sie zapisac awarii w zakladce "Przebiegi".'));
      }
    }
    throw new Error(`[etap: ${etap}] ${komunikat}`);
  }
}
