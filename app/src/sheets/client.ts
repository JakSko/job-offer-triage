// Dostęp do Google Sheets API przez konto serwisowe (W-22): zapis RAW, kolumny po nazwie nagłówka,
// zmiany tylko we wskazanych komórkach, wiele zmian w jednym żądaniu.
import { GoogleAuth } from 'google-auth-library';
import type { Konfiguracja } from '../config.js';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export type Wiersz = Record<string, string> & { _nr: number };

export interface Tabela {
  zakladka: string;
  naglowki: string[];
  /** nazwa kolumny -> indeks (0 = A); tylko niepuste nagłówki */
  kolumny: Map<string, number>;
  wiersze: Wiersz[];
}

export interface ZmianaKomorek {
  nrWiersza: number;
  wartosci: Record<string, string | number>;
}

export function literaKolumny(indeks: number): string {
  let s = '';
  for (let n = indeks + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const zakres = (zakladka: string, a1 = '') => encodeURIComponent(`'${zakladka.replace(/'/g, "''")}'` + (a1 ? '!' + a1 : ''));

export class Arkusz {
  private auth: GoogleAuth;

  constructor(private sheetId: string, konfiguracja: Pick<Konfiguracja, 'GOOGLE_SA_FILE' | 'GOOGLE_SA_JSON_BASE64'>) {
    const scopes = ['https://www.googleapis.com/auth/spreadsheets'];
    this.auth = konfiguracja.GOOGLE_SA_JSON_BASE64
      ? new GoogleAuth({ credentials: JSON.parse(Buffer.from(konfiguracja.GOOGLE_SA_JSON_BASE64, 'base64').toString('utf8')), scopes })
      : new GoogleAuth({ keyFile: konfiguracja.GOOGLE_SA_FILE, scopes });
  }

  private async zadanie<T = any>(metoda: 'GET' | 'POST', sciezka: string, tresc?: unknown): Promise<T> {
    const klient = await this.auth.getClient();
    for (let proba = 1; ; proba++) {
      try {
        const odp = await klient.request<T>({ url: `${API}/${this.sheetId}${sciezka}`, method: metoda, data: tresc });
        return odp.data;
      } catch (e: any) {
        const status = e?.response?.status;
        if ((status === 429 || status >= 500) && proba < 4) {
          await new Promise(r => setTimeout(r, proba * 5000));
          continue;
        }
        const opis = e?.response?.data?.error?.message || e?.message || String(e);
        throw new Error(`Google Sheets (${status ?? 'brak odpowiedzi'}): ${opis}`);
      }
    }
  }

  async zakladki(): Promise<string[]> {
    const meta = await this.zadanie<{ sheets: { properties: { title: string } }[] }>('GET', '?fields=sheets.properties.title');
    return meta.sheets.map(s => s.properties.title);
  }

  async utworzZakladke(nazwa: string, naglowki: string[]): Promise<void> {
    await this.zadanie('POST', ':batchUpdate', { requests: [{ addSheet: { properties: { title: nazwa, gridProperties: { frozenRowCount: 1 } } } }] });
    await this.zadanie('POST', `/values/${zakres(nazwa, 'A1')}:append?valueInputOption=RAW`, { values: [naglowki] });
  }

  async czytaj(zakladka: string): Promise<Tabela> {
    const dane = await this.zadanie<{ values?: string[][] }>('GET', `/values/${zakres(zakladka)}?valueRenderOption=FORMATTED_VALUE`);
    const [naglowkiSurowe = [], ...reszta] = dane.values ?? [];
    const naglowki = naglowkiSurowe.map(n => String(n ?? '').trim());
    const kolumny = new Map<string, number>();
    naglowki.forEach((n, i) => {
      if (!n) return;
      if (kolumny.has(n)) throw new Error(`Zakladka "${zakladka}": zdublowany naglowek "${n}"`);
      kolumny.set(n, i);
    });
    const wiersze = reszta.map((w, i) => {
      const wiersz = { _nr: i + 2 } as Wiersz;
      for (const [n, idx] of kolumny) wiersz[n] = String(w[idx] ?? '');
      return wiersz;
    });
    return { zakladka, naglowki, kolumny, wiersze };
  }

  /** Dopisuje wiersze na końcu tabeli; zwraca numery nowych wierszy (w kolejności podanych rekordów). */
  async dopisz(tabela: Tabela, rekordy: Record<string, string | number>[]): Promise<number[]> {
    if (rekordy.length === 0) return [];
    const values = rekordy.map(r => {
      const w: (string | number)[] = new Array(tabela.naglowki.length).fill('');
      for (const [k, v] of Object.entries(r)) {
        const idx = tabela.kolumny.get(k);
        if (idx === undefined) throw new Error(`Zakladka "${tabela.zakladka}": brak kolumny "${k}"`);
        w[idx] = v;
      }
      return w;
    });
    const odp = await this.zadanie<{ updates: { updatedRange: string } }>(
      'POST', `/values/${zakres(tabela.zakladka, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values });
    const m = odp.updates.updatedRange.match(/!\D+(\d+)(?::\D+(\d+))?$/);
    if (!m) throw new Error('Google Sheets: nieczytelny zakres po dopisaniu: ' + odp.updates.updatedRange);
    const pierwszy = Number(m[1]);
    return rekordy.map((_, i) => pierwszy + i);
  }

  /** Zmienia tylko wskazane komórki (po nazwie kolumny); sąsiadujące kolumny łączy w jeden zakres. */
  async zmien(tabela: Tabela, zmiany: ZmianaKomorek[]): Promise<void> {
    const data: { range: string; values: (string | number)[][] }[] = [];
    for (const z of zmiany) {
      const pola = Object.entries(z.wartosci).map(([k, v]) => {
        const idx = tabela.kolumny.get(k);
        if (idx === undefined) throw new Error(`Zakladka "${tabela.zakladka}": brak kolumny "${k}"`);
        return { idx, v };
      }).sort((a, b) => a.idx - b.idx);
      for (let i = 0; i < pola.length;) {
        let j = i;
        while (j + 1 < pola.length && pola[j + 1].idx === pola[j].idx + 1) j++;
        data.push({
          range: `'${tabela.zakladka}'!${literaKolumny(pola[i].idx)}${z.nrWiersza}:${literaKolumny(pola[j].idx)}${z.nrWiersza}`,
          values: [pola.slice(i, j + 1).map(p => p.v)],
        });
        i = j + 1;
      }
    }
    if (data.length === 0) return;
    await this.zadanie('POST', '/values:batchUpdate', { valueInputOption: 'RAW', data });
  }
}
