// Filtr słów kluczowych w tytule (Etap 2, W-06). Logika 1:1 z config/etap2_filtr_*.js.
import type { Oferta, OfertaPoFiltrze } from '../types.js';
import { NOISE_PATTERNS, PROFILES } from './profiles.js';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PL_DIACRITICS: Record<string, string> = { 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' };
function stripDiacritics(s: string): string {
  return String(s).toLowerCase().split('').map(ch => PL_DIACRITICS[ch] || ch).join('');
}

// Pełne słowa/frazy (głównie angielskie): pojedynczy token z granicą słowa, fraza jako podciąg.
function keywordMatches(text: string, keyword: string): boolean {
  const kw = stripDiacritics(keyword.trim());
  const normText = stripDiacritics(text);
  if (!kw.includes(' ')) {
    const re = new RegExp('\\b' + escapeRegex(kw) + '\\b', 'i');
    return re.test(normText);
  }
  return normText.includes(kw);
}

// Polskie rdzenie: granica tylko na początku słowa (łapie odmiany); przy frazie każdy rdzeń
// musi wystąpić gdziekolwiek w tytule.
function stemMatches(text: string, stemPhrase: string): boolean {
  const normText = stripDiacritics(text);
  const stems = stripDiacritics(stemPhrase.trim()).split(' ').filter(Boolean);
  return stems.every(stem => new RegExp('\\b' + escapeRegex(stem)).test(normText));
}

export interface WynikFiltra {
  matchedProfiles: string[];
  noiseReason: string | null;
  passesFilter: boolean;
}

export function filtrujTytul(tytul: string): WynikFiltra {
  const title = String(tytul || '');

  let noiseReason: string | null = null;
  for (const np of NOISE_PATTERNS) {
    if (np.pattern.test(title)) { noiseReason = np.reason; break; }
  }

  const matchedProfiles: string[] = [];
  for (const p of PROFILES) {
    let hit = false;
    for (const kw of p.keywords) {
      if (keywordMatches(title, kw)) { hit = true; break; }
    }
    if (!hit) {
      for (const stem of (p.stems || [])) {
        if (stemMatches(title, stem)) { hit = true; break; }
      }
    }
    if (hit) matchedProfiles.push(p.id + '. ' + p.name);
  }

  return { matchedProfiles, noiseReason, passesFilter: !noiseReason && matchedProfiles.length > 0 };
}

export function filtruj(oferty: Oferta[]): OfertaPoFiltrze[] {
  return oferty.map(o => ({ ...o, ...filtrujTytul(o.title) }));
}
