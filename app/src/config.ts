// Konfiguracja ze zmiennych środowiskowych (docs/migracja/03_architektura_i_konfiguracja.md).
// Na laptopie zmienne ładuje plik app/.env; na Railway ustawia je platforma.
import 'dotenv/config';
import { z } from 'zod';

const liczba = (domyslna: number) =>
  z.preprocess(v => (v === undefined || v === '' ? domyslna : Number(v)), z.number().int().nonnegative());
const opcjonalny = z.preprocess(v => (v === '' ? undefined : v), z.string().optional());

const Schemat = z.object({
  TRYB: z.enum(['laptop', 'railway']),
  IMAP_HOST: opcjonalny,
  IMAP_PORT: liczba(993),
  IMAP_USER: opcjonalny,
  IMAP_PASSWORD: opcjonalny,
  IMAP_MAILBOX: z.preprocess(v => v || 'INBOX', z.string()),
  MAX_MAILI: liczba(20),
  GOOGLE_SA_FILE: opcjonalny,
  GOOGLE_SA_JSON_BASE64: opcjonalny,
  SHEET_ID: z.string().min(10, 'brak SHEET_ID'),
  OPENAI_API_KEY: opcjonalny,
  OPENAI_MODEL: z.preprocess(v => v || 'gpt-5.6-luna', z.string()),
  NTFY_URL: opcjonalny,
  JINA_API_KEY: opcjonalny,
  CV_MASTER_FILE: opcjonalny,
  FETCH_MODE: z.preprocess(v => v || 'jina', z.enum(['jina', 'jina-then-direct'])),
  LIMIT_AI: liczba(30),
  LIMIT_CZASU_MIN: liczba(20),
  ZALEGLE_DNI: liczba(7),
  HEARTBEAT_GODZINA: liczba(20),
}).refine(c => c.GOOGLE_SA_FILE || c.GOOGLE_SA_JSON_BASE64, {
  message: 'ustaw GOOGLE_SA_FILE (laptop) albo GOOGLE_SA_JSON_BASE64 (Railway)',
});

export type Konfiguracja = z.infer<typeof Schemat>;

export function wczytajKonfiguracje(env: NodeJS.ProcessEnv = process.env): Konfiguracja {
  const wynik = Schemat.safeParse(env);
  if (!wynik.success) {
    const bledy = wynik.error.issues.map(i => `${i.path.join('.') || 'konfiguracja'}: ${i.message}`).join('; ');
    throw new Error('Bledna konfiguracja (app/.env lub zmienne srodowiskowe): ' + bledy);
  }
  return wynik.data;
}
