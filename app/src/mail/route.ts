// Routing maila po nadawcy (W-01). Odpowiednik węzłów "Filtr nadawcy: X".
import type { Mail, Zrodlo } from '../types.js';

const NADAWCY: { fragment: string; zrodlo: Zrodlo }[] = [
  { fragment: 'wysylka.pracuj.pl', zrodlo: 'pracuj.pl' },
  { fragment: 'jobalerts-noreply@linkedin.com', zrodlo: 'linkedin' },
];

/** Źródło maila albo null, gdy nadawca nie jest alertem ofert (taki mail jest ignorowany). */
export function zrodloMaila(mail: Pick<Mail, 'from'>): Zrodlo | null {
  const from = String(mail.from || '').toLowerCase();
  return NADAWCY.find(n => from.includes(n.fragment))?.zrodlo ?? null;
}
