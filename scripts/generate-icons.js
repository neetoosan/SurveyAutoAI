import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Precomputed CRC32 table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const len = data.length;
  const chunk = Buffer.alloc(4 + 4 + len + 4);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  const typeAndData = chunk.subarray(4, 8 + len);
  const crc = crc32(typeAndData);
  chunk.writeUInt32BE(crc, 8 + len);
  return chunk;
}

function generateIconPng(size) {
  // RGBA buffer for raw scanlines
  const rowLength = 1 + size * 4;
  const rawData = Buffer.alloc(rowLength * size);

  const center = size / 2;
  const radius = size * 0.44;

  for (let y = 0; y < size; y++) {
    const rowOffset = y * rowLength;
    rawData[rowOffset] = 0; // Filter: None

    for (let x = 0; x < size; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      const dx = x - center + 0.5;
      const dy = y - center + 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Rounded container / shield
      if (dist <= radius) {
        // Gradient from Deep Slate (0x0f, 0x17, 0x2a) to Royal Sky (0x03, 0x69, 0xa1)
        const t = (x + y) / (size * 2);
        let r = Math.round(15 + t * (3 - 15));
        let g = Math.round(23 + t * (105 - 23));
        let b = Math.round(42 + t * (161 - 42));

        // Checkmark / AI spark emblem in the center
        // Normalize coordinates to -1..1
        const nx = (x - center) / radius;
        const ny = (y - center) / radius;

        // Checkmark geometry: short stroke from (-0.45, -0.05) to (-0.1, 0.35),
        // long stroke from (-0.1, 0.35) to (0.5, -0.35)
        const inShortStroke =
          nx >= -0.45 &&
          nx <= -0.05 &&
          Math.abs(ny - (0.35 + (nx - -0.1) * 1.1)) < (size < 32 ? 0.3 : 0.18);
        const inLongStroke =
          nx >= -0.15 &&
          nx <= 0.52 &&
          Math.abs(ny - (0.35 - (nx - -0.15) * 1.1)) < (size < 32 ? 0.3 : 0.18);

        if (inShortStroke || inLongStroke) {
          // Bright cyan / emerald checkmark
          r = 56;
          g = 189;
          b = 248; // #38bdf8
        }

        // Border glow
        if (dist > radius - (size < 32 ? 1.5 : 2.5)) {
          r = 14;
          g = 165;
          b = 233; // #0ea5e9
        }

        rawData[pxOffset] = r;
        rawData[pxOffset + 1] = g;
        rawData[pxOffset + 2] = b;
        rawData[pxOffset + 3] = 255;
      } else {
        // Transparent
        rawData[pxOffset] = 0;
        rawData[pxOffset + 1] = 0;
        rawData[pxOffset + 2] = 0;
        rawData[pxOffset + 3] = 0;
      }
    }
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // Bit depth
  ihdrData[9] = 6; // Color type: RGBA
  ihdrData[10] = 0; // Compression
  ihdrData[11] = 0; // Filter
  ihdrData[12] = 0; // Interlace
  const ihdrChunk = makeChunk('IHDR', ihdrData);

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const outDir = path.resolve(__dirname, '../src/public/icons');
fs.mkdirSync(outDir, { recursive: true });

const sizes = [16, 32, 48, 128];
for (const s of sizes) {
  const png = generateIconPng(s);
  const dest = path.join(outDir, `icon-${s}.png`);
  fs.writeFileSync(dest, png);
  console.log(`Generated ${dest} (${png.length} bytes)`);
}

console.log('All icons generated successfully!');
