import "server-only";
import { deflateSync } from "node:zlib";

/**
 * Minimal, dependency-free PNG encoder.
 *
 * Produces genuine, spec-valid PNG bytes (signature + IHDR + IDAT + IEND)
 * using only Node's built-in zlib. This exists because the private
 * `generation-outputs` bucket accepts image/png but not image/svg+xml, and
 * writing SVG bytes into a .png file would be dishonest labeling.
 *
 * Colour type 2 (truecolour, 8-bit RGB), no interlacing.
 */

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds one PNG chunk: length + type + data + CRC(type+data). */
function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const payload = new Uint8Array(typeBytes.length + data.length);
  payload.set(typeBytes, 0);
  payload.set(data, typeBytes.length);

  const chunk = new Uint8Array(4 + payload.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(payload, 4);
  view.setUint32(4 + payload.length, crc32(payload));
  return chunk;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Encodes a raw RGB pixel buffer (width * height * 3 bytes) into a PNG.
 */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (rgb.length !== width * height * 3) {
    throw new Error("encodePng: pixel buffer size does not match dimensions");
  }

  // IHDR: width, height, bit depth 8, colour type 2 (RGB), deflate,
  // adaptive filtering, no interlace.
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width);
  ihdrView.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Each scanline is prefixed with its filter-type byte (0 = None).
  const stride = width * 3;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    raw.set(rgb.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const idatData = new Uint8Array(deflateSync(raw));

  const ihdrChunk = buildChunk("IHDR", ihdr);
  const idatChunk = buildChunk("IDAT", idatData);
  const iendChunk = buildChunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(
    PNG_SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length
  );
  let offset = 0;
  for (const part of [PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk]) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

/**
 * Paints a deterministic Cinefield-branded test card: dark field, accent
 * border, and a marker strip whose block pattern is derived from `seed` so
 * different generations render visibly different images.
 */
export function paintMockCard(params: {
  width: number;
  height: number;
  background: Rgb;
  accent: Rgb;
  seed: string;
}): Uint8Array {
  const { width, height, background, accent, seed } = params;
  const rgb = new Uint8Array(width * height * 3);

  // Background fill.
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = background.r;
    rgb[i * 3 + 1] = background.g;
    rgb[i * 3 + 2] = background.b;
  }

  const setPixel = (x: number, y: number, colour: Rgb): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const index = (y * width + x) * 3;
    rgb[index] = colour.r;
    rgb[index + 1] = colour.g;
    rgb[index + 2] = colour.b;
  };

  // Accent border.
  const borderWidth = Math.max(3, Math.floor(Math.min(width, height) / 40));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const onBorder =
        x < borderWidth ||
        y < borderWidth ||
        x >= width - borderWidth ||
        y >= height - borderWidth;
      if (onBorder) setPixel(x, y, accent);
    }
  }

  // Deterministic marker strip derived from the seed.
  const blockCount = 16;
  const blockWidth = Math.max(1, Math.floor((width - borderWidth * 4) / blockCount));
  const blockHeight = Math.max(2, Math.floor(height / 12));
  const stripTop = Math.floor(height / 2 - blockHeight / 2);
  const stripLeft = borderWidth * 2;

  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  for (let block = 0; block < blockCount; block += 1) {
    const filled = ((hash >>> block % 32) & 1) === 1;
    if (!filled) continue;
    const x0 = stripLeft + block * blockWidth;
    for (let y = stripTop; y < stripTop + blockHeight; y += 1) {
      for (let x = x0; x < x0 + blockWidth - 1; x += 1) {
        setPixel(x, y, accent);
      }
    }
  }

  return rgb;
}
