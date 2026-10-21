/** Intel HEX -> flash image for an ATmega328P (32 KB). */
export function parseHex(text: string, flashBytes = 0x8000): Uint16Array {
  const bytes = new Uint8Array(flashBytes);
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith(':')) continue;
    const count = parseInt(line.substr(1, 2), 16);
    const addr = parseInt(line.substr(3, 4), 16);
    const type = parseInt(line.substr(7, 2), 16);
    if (type === 1) break;
    if (type !== 0) continue;
    for (let i = 0; i < count; i++) {
      bytes[addr + i] = parseInt(line.substr(9 + i * 2, 2), 16);
    }
  }
  return new Uint16Array(bytes.buffer);
}
