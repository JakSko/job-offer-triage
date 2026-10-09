// Push przez ntfy: POST zwykłego tekstu na adres tematu, tytuł w nagłówku Title (jak węzły ntfy w n8n).
// Temat działa jak hasło, więc nigdy nie trafia do logów (W-32).

/**
 * Maksymalna treść pusha w bajtach, przy której iPhone użytkownika pokazuje powiadomienie (testy 07 i 09.10.2026 na
 * temacie TEST i produkcji: zwykły priorytet do 3000 B - tak, ok. 3700 B - nie; priorytet high już przy 2675 B - nie).
 * Dlatego pushe idą ze zwykłym priorytetem i treścią do 2800 B.
 */
export const MAX_BAJTOW_POWIADOMIENIA = 2800;

/** Pierwsza linia + " - " + czas, całość przycięta do MAX_BAJTOW_POWIADOMIENIA (pushe o problemach). */
export function dopasujDoPowiadomienia(tresc: string, czas?: string): string {
  const pierwsza = tresc.split('\n')[0];
  const zCzasem = pierwsza.endsWith(':') ? `${pierwsza.slice(0, -1)} - ${czas}:` : `${pierwsza} - ${czas}`;
  let t = czas ? zCzasem + tresc.slice(pierwsza.length) : tresc;
  if (Buffer.byteLength(t, 'utf8') <= MAX_BAJTOW_POWIADOMIENIA) return t;
  while (Buffer.byteLength(t + '...', 'utf8') > MAX_BAJTOW_POWIADOMIENIA) t = t.slice(0, -20);
  return t + '...';
}

/** `priorytet` "high" = nagłówek ntfy Priority (np. oceny "aplikuj", DJ-32); brak = priorytet domyślny jak dotąd. */
export async function wyslijPush(ntfyUrl: string, tytul: string, tresc: string, priorytet?: 'high' | 'default'): Promise<void> {
  let odp: Response;
  try {
    odp = await fetch(ntfyUrl, {
      method: 'POST',
      headers: { Title: tytul, 'Content-Type': 'text/plain; charset=utf-8', ...(priorytet === 'high' ? { Priority: 'high' } : {}) },
      body: tresc,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    throw new Error(`ntfy: wyslanie pusha "${tytul}" nie powiodlo sie (${e instanceof Error ? e.name : 'blad'})`);
  }
  if (!odp.ok) throw new Error(`ntfy: push "${tytul}" odrzucony, status ${odp.status}`);
}

export const TYTUL_AWARIA = 'Oferty pracy - awaria przebiegu';

/** Push o awarii całego przebiegu (W-19). Sam nigdy nie rzuca: awaria pusha nie może przykryć pierwotnej. */
export async function wyslijPushAwarii(ntfyUrl: string | undefined, tryb: string, etap: string, blad: unknown): Promise<boolean> {
  if (!ntfyUrl) return false;
  const komunikat = blad instanceof Error ? blad.message : String(blad);
  try {
    await wyslijPush(ntfyUrl, TYTUL_AWARIA, `Tryb: ${tryb}\nEtap: ${etap}\nBlad: ${komunikat.slice(0, 1500)}`);
    return true;
  } catch {
    return false;
  }
}
