// "Etap4: sparsuj odpowiedz OpenAI" (config/etap4_sparsuj_odpowiedz_openai.js, W-14).
// TWARDE PROGI STOSUJE TU KOD, nie model. Model dostarcza listę i liczbę niespełnionych wymagań
// twardych oraz tryb_lokalizacji; kod egzekwuje sufit (2 zera: dopasowanie_krok2 co najwyżej "slabe",
// rekomendacja co najwyżej "obserwuj"; 3+ zer: "brak" i "pomin"), eliminator "onsite poza Poznaniem"
// => "pomin" i od Z13-v3.2 regułę zaawansowanego Pythona (wymaga_zaawansowanego_pythona = true => "brak"
// i "pomin", dopasowanie modelu zapisane w regula_kodu). Kod nigdy nie podnosi oceny. Ślad audytowy:
// rekomendacja_ai (surowa odpowiedź modelu), regula_kodu (co zmieniła reguła), wersja_promptu, zuzycie_tokenow.
import type { Rekord } from './classify.js';

/**
 * Wersja metodyki i profili w prompcie (prompt.ts). v3.1 (05.10.2026): profil 9 zsynchronizowany z plikiem 01.
 * v3.2 (06.10.2026): reguła zaawansowanego Pythona (decyzja produktowa).
 */
export const WERSJA_METODYKI = 'Z13-v3.2-przyklad';

/** Wartość kolumny wersja_promptu: wersja metodyki + data pliku master CV, na którym powstała ocena. */
export function wersjaPromptu(dataCv: string): string {
  return dataCv ? `${WERSJA_METODYKI} / CV ${dataCv}` : WERSJA_METODYKI;
}
const RANGA_DOPASOWANIA = ['brak', 'slabe', 'czesciowe', 'mocne'];
const RANGA_REKOMENDACJI = ['pomin', 'obserwuj', 'aplikuj'];

// Zwraca wartość nie wyższą niż limit (nieznana wartość też jest sprowadzana do limitu).
function obetnij(wartosc: string, limit: string, ranga: string[]): string {
  const i = ranga.indexOf(wartosc);
  return (i === -1 || i > ranga.indexOf(limit)) ? limit : wartosc;
}

export function opisZuzycia(usage: any): string {
  if (!usage) return '';
  const f = (v: unknown) => (v === undefined || v === null) ? '?' : v;
  const cache = usage.input_tokens_details && usage.input_tokens_details.cached_tokens;
  const rea = usage.output_tokens_details && usage.output_tokens_details.reasoning_tokens;
  return 'wejscie ' + f(usage.input_tokens) + ' (cache ' + f(cache) + ') / wyjscie ' + f(usage.output_tokens) + ' (reasoning ' + f(rea) + ')';
}

export function zastosujReguly(f: Rekord): void {
  const zmiany: string[] = [];
  const uwagi: string[] = [];
  f.rekomendacja_ai = f.rekomendacja;

  const lista = String(f.niespelnione_wymagania_twarde || '').split(';').map(s => s.trim()).filter(Boolean);
  const liczbaModelu = Number.isInteger(f.liczba_zer_twardych) ? f.liczba_zer_twardych : (parseInt(f.liczba_zer_twardych, 10) || 0);
  const zera = Math.max(liczbaModelu, lista.length);
  if (liczbaModelu !== lista.length) {
    uwagi.push('uwaga: lista ma ' + lista.length + ' poz., pole liczbowe ' + liczbaModelu + ' (przyjeto ' + zera + ')');
  }
  f.liczba_zer_twardych = zera;

  let krok2 = f.dopasowanie_krok2;
  let rek = f.rekomendacja;
  if (zera >= 3) {
    krok2 = obetnij(krok2, 'brak', RANGA_DOPASOWANIA);
    rek = obetnij(rek, 'pomin', RANGA_REKOMENDACJI);
  } else if (zera === 2) {
    krok2 = obetnij(krok2, 'slabe', RANGA_DOPASOWANIA);
    rek = obetnij(rek, 'obserwuj', RANGA_REKOMENDACJI);
  }
  if (krok2 !== f.dopasowanie_krok2 || rek !== f.rekomendacja) {
    zmiany.push('sufit: ' + (zera >= 3 ? '3+' : '2') + ' zer twardych');
  }

  // Z13-v3.2 (decyzja produktowa): oferta wymaga Pythona na poziomie zawodowym => od razu
  // "brak" i "pomin", niezależnie od liczby zer. Model ocenia ofertę tak, jakby tego wymagania nie było;
  // jego dopasowanie_krok2 zostaje w regula_kodu, żeby było widać, jak oferta pasuje poza Pythonem.
  if (f.wymaga_zaawansowanego_pythona === true || f.wymaga_zaawansowanego_pythona === 'true') {
    krok2 = 'brak';
    rek = 'pomin';
    zmiany.push('zaawansowany Python (dopasowanie modelu: ' + (String(f.dopasowanie_krok2 || '') || '?') + ')');
  }

  if (f.tryb_lokalizacji === 'onsite poza Poznaniem' && rek !== 'pomin') {
    rek = 'pomin';
    zmiany.push('onsite poza Poznaniem');
  }

  if (krok2 !== f.dopasowanie_krok2) {
    f.dopasowanie_krok2 = krok2;
    if (RANGA_DOPASOWANIA.indexOf(krok2) < RANGA_DOPASOWANIA.indexOf(f.dopasowanie_krok1)) {
      f.korekta_wzgledem_kroku1 = 'w dol';
    }
  }
  if (rek !== f.rekomendacja) {
    f.rekomendacja = rek;
    f.uzasadnienie_rekomendacji = '[REGULA: ' + zmiany.join('; ') + '] ' + String(f.uzasadnienie_rekomendacji || '');
  }
  f.regula_kodu = zmiany.concat(uwagi).join('; ');
}

/**
 * `zapytanie` = oferta po zbudujZapytanie (z polem openai_request), `odpowiedz` = treść odpowiedzi
 * Responses API albo { error } przy nieudanym wywołaniu.
 */
export function sparsujOdpowiedz(zapytanie: Rekord, odpowiedz: any, wersja: string = WERSJA_METODYKI): Rekord {
  const { openai_request, ...oryginal } = zapytanie;
  const it = odpowiedz || {};
  const meta = { wersja_promptu: wersja, zuzycie_tokenow: opisZuzycia(it.usage) };

  const blad = (uzasadnienie: string): Rekord => ({ ...oryginal, ...meta, etap4_klasa: 'blad_parsowania',
    rekomendacja: 'NIEOCENIONE (BLAD ODPOWIEDZI AI)', uzasadnienie_rekomendacji: uzasadnienie });

  if (it.error) {
    return blad('Wywolanie OpenAI zakonczylo sie bledem: ' + String((it.error && it.error.message) || it.error) + ' - ocen recznie.');
  }

  if (it.status && it.status !== 'completed') {
    const powod = it.incomplete_details && it.incomplete_details.reason ? ' (powod: ' + it.incomplete_details.reason + ')' : '';
    return blad('OpenAI zwrocilo status "' + it.status + '"' + powod + ' zamiast "completed" (np. przekroczony limit tokenow) - ocen recznie.');
  }

  let wynik: Rekord | null = null;
  try {
    const output: any[] = it.output || [];
    const funcCall = output.find(o => o.type === 'function_call' && o.name === 'ocena_oferty');
    wynik = funcCall ? JSON.parse(funcCall.arguments) : null;
  } catch {
    wynik = null;
  }

  if (!wynik) {
    return blad('Odpowiedz OpenAI nie zawierala oczekiwanego wywolania funkcji ocena_oferty - ocen recznie.');
  }

  const finalne: Rekord = { ...oryginal, ...wynik, ...meta };
  if (oryginal.firma_znana) {
    finalne.kraj_siedziby = oryginal.kraj_siedziby;
    finalne.pewnosc_kraj_siedziby = oryginal.pewnosc_kraj_siedziby;
    finalne.typ_firmy = oryginal.typ_firmy;
    finalne.pewnosc_typ_firmy = oryginal.pewnosc_typ_firmy;
    finalne.wielkosc_firmy = oryginal.wielkosc_firmy;
    finalne.pewnosc_wielkosc_firmy = oryginal.pewnosc_wielkosc_firmy;
  }
  zastosujReguly(finalne);
  finalne.etap4_klasa = 'ocenione';
  return finalne;
}
