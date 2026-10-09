// Zapytanie do OpenAI Responses API (W-13): "Etap4: zbuduj zapytanie do OpenAI"
// (config/etap4_zbuduj_zapytanie_openai.js) + węzeł "Etap4: wywolanie OpenAI API".
// max_output_tokens 25000 obejmuje tokeny rozumowania. Błąd wywołania nie przerywa przebiegu:
// zwracamy { error }, a rules.ts zamienia to na "NIEOCENIONE (BLAD ODPOWIEDZI AI)".
import type { Rekord } from './classify.js';
import { TOOL_SCHEMA } from './prompt.js';

const ADRES = 'https://api.openai.com/v1/responses';
const LIMIT_CZASU_MS = 180_000;
const MAKS_PONOWIEN = 2;

/** `instrukcja` = pełny prompt systemowy z prompt.ts/zlozPrompt (metodyka + profile + aktualne CV). */
export function zbudujZapytanie(it: Rekord, model: string, instrukcja: string): Rekord {
  const firmaInfo = it.firma_znana
    ? ('ZNANA - kraj_siedziby: ' + it.kraj_siedziby + ' (' + it.pewnosc_kraj_siedziby + '), typ_firmy: ' + it.typ_firmy + ' (' + it.pewnosc_typ_firmy + '), wielkosc_firmy: ' + it.wielkosc_firmy + ' (' + it.pewnosc_wielkosc_firmy + ') - NIE zgaduj tych pol ponownie, ustaw firma_dane_juz_znane=true i zostaw je puste w odpowiedzi')
    : 'NOWA - ustal wszystkie 4 kategorie informacyjne samodzielnie, ustaw firma_dane_juz_znane=false';

  const userMessage = 'Tytul: ' + (it.title || '') + '\n' +
    'Firma: ' + (it.company || '') + ' [' + firmaInfo + ']\n' +
    'Lokalizacja: ' + (it.location || '') + '\n' +
    'Link: ' + (it.url || '') + '\n' +
    'Wstepnie dopasowane profile (Etap 2, mechanicznie): ' + (JSON.stringify(it.matchedProfiles || [])) + '\n' +
    'Tryb pracy (wyciagniety automatycznie kodem): ' + (it.tryb_pracy || 'nieznany') + '\n' +
    'Podpowiedz poziomu stanowiska z tytulu (nie traktuj jako ostatecznej): ' + (it.poziom_stanowiska_podpowiedz || 'brak') + '\n\n' +
    'Pelna tresc oferty:\n' + (it.opis_oferty || '');

  const openai_request = {
    model,
    instructions: instrukcja,
    input: userMessage,
    max_output_tokens: 25000,
    tools: [TOOL_SCHEMA],
    tool_choice: { type: 'function', name: 'ocena_oferty' },
  };

  return { ...it, openai_request };
}

const czekaj = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Zwraca treść odpowiedzi API albo { error: { message } }. Ponawia przy 429, 5xx i błędach sieci. */
export async function wywolajOpenAI(zadanie: unknown, apiKey: string): Promise<any> {
  let ostatni = 'nieznany blad';
  for (let proba = 0; proba <= MAKS_PONOWIEN; proba++) {
    if (proba > 0) await czekaj(proba * 5000);
    try {
      const odp = await fetch(ADRES, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + apiKey },
        body: JSON.stringify(zadanie),
        signal: AbortSignal.timeout(LIMIT_CZASU_MS),
      });
      const tekst = await odp.text();
      let tresc: any = null;
      try { tresc = JSON.parse(tekst); } catch { /* odpowiedź nie jest JSON-em */ }
      if (odp.ok && tresc) return tresc;
      ostatni = `HTTP ${odp.status}: ${tresc?.error?.message ?? tekst.slice(0, 300)}`;
      if (odp.status !== 429 && odp.status < 500) break; // błąd trwały (np. zły model, zły klucz)
    } catch (e) {
      ostatni = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
  }
  return { error: { message: ostatni } };
}

/** Sprawdzenie klucza bez kosztu oceny: lista modeli. Zwraca informację, czy skonfigurowany model jest dostępny. */
export async function sprawdzKluczOpenAI(apiKey: string, model: string): Promise<string> {
  const odp = await fetch('https://api.openai.com/v1/models/' + encodeURIComponent(model), {
    headers: { Authorization: 'Bearer ' + apiKey }, signal: AbortSignal.timeout(30_000),
  });
  if (odp.ok) return `klucz dziala, model ${model} dostepny`;
  const tresc: any = await odp.json().catch(() => null);
  throw new Error(`HTTP ${odp.status}: ${tresc?.error?.message ?? 'brak opisu'}`);
}
