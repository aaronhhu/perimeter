// Draws the tray template images. Committed output, regenerated with `pnpm icons` — the alternative
// was a binary asset nobody can edit or explain.
//
// Template images are black-with-alpha: macOS throws the colour away and uses the alpha as a mask,
// so it can invert them for a dark menu bar and dim them when the bar is inactive. Anything but
// black here would be silently discarded.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "tray");

/** The menu bar's slot is 22pt tall; @2x is the Retina variant macOS picks up by filename. */
const SIZES = [
  { suffix: "", px: 22 },
  { suffix: "@2x", px: 44 },
];

/** Geometry is written in 22pt units and scaled, so the two sizes can't drift apart. */
const UNIT = 22;

const RING_RADIUS = 6.5;
const STROKE = 2;

/**
 * Each glyph is a predicate over a point in 22pt space. Four states have to be told apart at a
 * glance in a monochrome 22px square, so they differ in *shape*, not weight: a solid disc reads as
 * loud (phone on the desk), a hollow ring as quiet (phone gone), a broken ring as uncertain.
 */
const GLYPHS = {
  // Nothing measured yet. A bare dot says "running, no verdict" without looking like a verdict.
  idle: (x, y) => distance(x, y) <= 2.5,
  present: (x, y) => distance(x, y) <= RING_RADIUS + STROKE / 2,
  away: (x, y) => onRing(x, y),
  // A ring plus a bar struck through it. `unknown` always arrives with a nudge attached, so it has
  // to read as a problem rather than as a third neutral state.
  unknown: (x, y) => onRing(x, y) || onSlash(x, y),
};

function distance(x, y) {
  return Math.hypot(x - UNIT / 2, y - UNIT / 2);
}

function onRing(x, y) {
  return Math.abs(distance(x, y) - RING_RADIUS) <= STROKE / 2;
}

/** Distance from the 45° diagonal through the centre, clipped to the ring's outer edge. */
function onSlash(x, y) {
  const dx = x - UNIT / 2;
  const dy = y - UNIT / 2;
  const along = (dx + dy) / Math.SQRT2;
  const across = (dx - dy) / Math.SQRT2;
  return Math.abs(across) <= STROKE / 2 && Math.abs(along) <= RING_RADIUS + STROKE / 2;
}

/** 4×4 supersampling: a hard predicate would alias badly at this size, and macOS does not smooth it for us. */
const SUBSAMPLES = 4;

function rasterize(glyph, px) {
  const scale = UNIT / px;
  const rgba = Buffer.alloc(px * px * 4);

  for (let row = 0; row < px; row += 1) {
    for (let column = 0; column < px; column += 1) {
      let covered = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
        for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
          const x = (column + (sx + 0.5) / SUBSAMPLES) * scale;
          const y = (row + (sy + 0.5) / SUBSAMPLES) * scale;
          if (glyph(x, y)) covered += 1;
        }
      }
      const offset = (row * px + column) * 4;
      rgba[offset + 3] = Math.round((covered / (SUBSAMPLES * SUBSAMPLES)) * 255);
    }
  }

  return rgba;
}

function encodePng(rgba, px) {
  // Filter byte 0 (none) per scanline: these images are tiny, so a real filter buys nothing.
  const raw = Buffer.alloc(px * (px * 4 + 1));
  for (let row = 0; row < px; row += 1) {
    rgba.copy(raw, row * (px * 4 + 1) + 1, row * px * 4, (row + 1) * px * 4);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0);
  ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA


  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

mkdirSync(OUT_DIR, { recursive: true });

for (const [state, glyph] of Object.entries(GLYPHS)) {
  for (const { suffix, px } of SIZES) {
    // The "Template" in the filename is what tells macOS to treat the alpha as a mask.
    const file = join(OUT_DIR, `${state}Template${suffix}.png`);
    writeFileSync(file, encodePng(rasterize(glyph, px), px));
    console.log(`${file}  ${px}x${px}`);
  }
}
