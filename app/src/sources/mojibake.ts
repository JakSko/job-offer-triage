// Naprawa "mojibake": UTF-8 błędnie odczytany jako Windows-1252 (np. "GdaÅ„sk" -> "Gdańsk").
// Przeniesione 1:1 z config/etap1_wyczysc_polacz_*.js. Nie rusza poprawnego tekstu.

const CP1252_HIGH: Record<string, number> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84,
  '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88,
  '‰': 0x89, 'Š': 0x8A, '‹': 0x8B, 'Œ': 0x8C,
  'Ž': 0x8E, '‘': 0x91, '’': 0x92, '“': 0x93,
  '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B,
  'œ': 0x9C, 'ž': 0x9E, 'Ÿ': 0x9F,
};

export function fixMojibake(str: string): string {
  if (typeof str !== 'string' || !str) return str;
  const bytes: number[] = [];
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (CP1252_HIGH[ch] !== undefined) bytes.push(CP1252_HIGH[ch]);
    else if (code <= 0xFF) bytes.push(code);
    else return str;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return str;
  }
}
