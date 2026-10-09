// Daty w arkuszu (W-23): zapis jako ISO 8601 z przesunięciem strefy Europe/Warsaw,
// np. 2026-09-26T08:30:00.000+02:00 (ten sam format zapisywał n8n). Odczyt toleruje też inne formaty.

const STREFA = 'Europe/Warsaw';

function czesciWStrefie(d: Date): Record<string, number> {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: STREFA, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const c: Record<string, number> = {};
  for (const p of fmt.formatToParts(d)) if (p.type !== 'literal') c[p.type] = Number(p.value);
  return c;
}

const dwa = (n: number) => String(n).padStart(2, '0');

export function isoWarszawa(d: Date = new Date()): string {
  const c = czesciWStrefie(d);
  const lokalnieJakoUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  const przesuniecieMin = Math.round((lokalnieJakoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
  const znak = przesuniecieMin >= 0 ? '+' : '-';
  const abs = Math.abs(przesuniecieMin);
  return `${c.year}-${dwa(c.month)}-${dwa(c.day)}T${dwa(c.hour)}:${dwa(c.minute)}:${dwa(c.second)}.`
    + `${String(d.getMilliseconds()).padStart(3, '0')}${znak}${dwa(Math.floor(abs / 60))}:${dwa(abs % 60)}`;
}

/** "DD.MM GG:MM" w czasie polskim (data i godzina przebiegu w treści pushy; aplikacja ntfy pokazuje tylko czas względny). */
export function krotkiCzasWarszawa(d: Date = new Date()): string {
  const iso = isoWarszawa(d);
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)} ${iso.slice(11, 16)}`;
}

/** Godzina (0-23) i dzień (RRRR-MM-DD) w czasie polskim. */
export function czasWarszawa(d: Date = new Date()): { godzina: number; dzien: string } {
  const c = czesciWStrefie(d);
  return { godzina: c.hour, dzien: `${c.year}-${dwa(c.month)}-${dwa(c.day)}` };
}

/**
 * Czas z komórki arkusza jako liczba ms albo null, gdy nieczytelny. Obsługuje ISO,
 * "RRRR-MM-DD GG:MM:SS" i "DD.MM.RRRR GG:MM:SS" (dwa ostatnie traktowane jak czas polski).
 */
export function parsujDate(tekst: unknown): number | null {
  const s = String(tekst ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) {
    const pl = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (pl) m = [s, pl[3], pl[2], pl[1], pl[4] ?? '0', pl[5] ?? '0', pl[6] ?? '0'] as unknown as RegExpMatchArray;
  }
  if (m) {
    const [, r, mi, d, g, min, sek] = m;
    const jakoUtc = Date.UTC(+r, +mi - 1, +d, +g, +min, +(sek ?? 0));
    // przesunięcie strefy w tym momencie: różnica między "ścianą zegara" w Warszawie a UTC
    const c = czesciWStrefie(new Date(jakoUtc));
    const przesuniecie = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - jakoUtc;
    return jakoUtc - przesuniecie;
  }
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}
