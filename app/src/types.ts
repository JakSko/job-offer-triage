// Wspólne typy danych przebiegu (docs/migracja/01_specyfikacja_wymagan.md).

export type Zrodlo = 'pracuj.pl' | 'linkedin';

export interface Mail {
  html: string;
  subject: string;
  from: string;
  receivedAt: string;
  /** Skąd pochodzi mail: UID z IMAP albo ścieżka pliku .eml (do logów i oznaczania). */
  id: string;
}

export interface Oferta {
  source: Zrodlo;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  offerId: string | null;
  dedupKey: string | null;
  /** Data maila (nagłówek Date), z którego pochodzi oferta; ISO albo pusty tekst (W-36). */
  dataMaila?: string;
}

export interface OfertaPoFiltrze extends Oferta {
  matchedProfiles: string[];
  noiseReason: string | null;
  passesFilter: boolean;
}

/** Mail pominięty z powodu niespójnej struktury (W-05). Liczniki zależą od źródła. */
export interface PominietyMail {
  source: Zrodlo;
  subject: string | null;
  receivedAt: string | null;
  liczniki: Record<string, number>;
}
