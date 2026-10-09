// Skrzynka z alertami przez IMAP (W-01, W-20, W-21). Pobieramy tylko NIEPRZECZYTANE maile od nadawców
// alertów (inne maile nie są ani pobierane, ani oznaczane), od najstarszych, maks. MAX_MAILI na przebieg.
// Pobranie treści nie zmienia flag (BODY.PEEK). Flagę przeczytania ustawia osobne wywołanie
// oznaczPrzeczytane() - przebieg robi to dopiero po zapisaniu ofert do arkusza.
// Każda operacja otwiera i zamyka własne połączenie: przebieg może trwać kilkanaście minut.
import { ImapFlow } from 'imapflow';
import type { Konfiguracja } from '../config.js';
import type { Mail } from '../types.js';
import { rozbierzMail } from './mime.js';
import { zrodloMaila } from './route.js';

type UstawieniaImap = Pick<Konfiguracja, 'IMAP_HOST' | 'IMAP_PORT' | 'IMAP_USER' | 'IMAP_PASSWORD' | 'IMAP_MAILBOX'>;

async function zPolaczeniem<T>(k: UstawieniaImap, praca: (klient: ImapFlow) => Promise<T>): Promise<T> {
  if (!k.IMAP_HOST || !k.IMAP_USER || !k.IMAP_PASSWORD) {
    throw new Error('Brak danych IMAP (IMAP_HOST, IMAP_USER, IMAP_PASSWORD) w app/.env lub zmiennych srodowiskowych.');
  }
  const klient = new ImapFlow({
    host: k.IMAP_HOST, port: k.IMAP_PORT, secure: true,
    auth: { user: k.IMAP_USER, pass: k.IMAP_PASSWORD },
    logger: false,
  });
  try {
    await klient.connect();
  } catch (e) {
    throw new Error(`IMAP: logowanie do ${k.IMAP_HOST} nie powiodlo sie (${e instanceof Error ? e.message : e})`);
  }
  try {
    const blokada = await klient.getMailboxLock(k.IMAP_MAILBOX);
    try {
      return await praca(klient);
    } finally {
      blokada.release();
    }
  } finally {
    await klient.logout().catch(() => klient.close());
  }
}

export interface StanSkrzynki {
  /** UID nieprzeczytanych alertów (rosnąco = od najstarszych). */
  alerty: number[];
  /** Liczba nieprzeczytanych maili od innych nadawców (nie są ruszane). */
  inne: number;
}

async function nieprzeczytaneAlerty(klient: ImapFlow): Promise<StanSkrzynki> {
  const uids = (await klient.search({ seen: false }, { uid: true })) || [];
  if (uids.length === 0) return { alerty: [], inne: 0 };
  const alerty: number[] = [];
  let inne = 0;
  for await (const m of klient.fetch(uids, { uid: true, envelope: true }, { uid: true })) {
    const od = (m.envelope?.from ?? []).map(a => `${a.name ?? ''} <${a.address ?? ''}>`).join(', ');
    if (zrodloMaila({ from: od })) alerty.push(m.uid);
    else inne++;
  }
  return { alerty: alerty.sort((a, b) => a - b), inne };
}

/** Diagnostyka (`sprawdz`) i log: ile alertów czeka, bez pobierania treści. */
export function stanSkrzynki(k: UstawieniaImap): Promise<StanSkrzynki> {
  return zPolaczeniem(k, nieprzeczytaneAlerty);
}

/** Pobiera do `max` najstarszych nieprzeczytanych alertów. Mail.id = UID w skrzynce. */
export function pobierzAlerty(k: UstawieniaImap, max: number): Promise<{ maile: Mail[]; wszystkich: number; inne: number }> {
  return zPolaczeniem(k, async klient => {
    const stan = await nieprzeczytaneAlerty(klient);
    const wybrane = stan.alerty.slice(0, max);
    const maile: Mail[] = [];
    if (wybrane.length) {
      for await (const m of klient.fetch(wybrane, { uid: true, source: true }, { uid: true })) {
        if (m.source) maile.push(await rozbierzMail(m.source, String(m.uid)));
      }
    }
    maile.sort((a, b) => Number(a.id) - Number(b.id));
    return { maile, wszystkich: stan.alerty.length, inne: stan.inne };
  });
}

/** Ustawia flagę przeczytania (W-20). */
export async function oznaczPrzeczytane(k: UstawieniaImap, ids: string[]): Promise<void> {
  const uids = ids.map(Number).filter(n => Number.isInteger(n) && n > 0);
  if (uids.length === 0) return;
  await zPolaczeniem(k, async klient => {
    await klient.messageFlagsAdd(uids, ['\\Seen'], { uid: true });
  });
}
