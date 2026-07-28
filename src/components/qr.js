// Minimal QR Code encoder — the one piece of vendored algorithm in the tree.
//
// It exists because the idle screen needs a scannable code for the mobile
// order page and the project takes no npm dependencies. This is textbook
// ISO/IEC 18004 (Reed-Solomon over GF(256), the eight mask patterns, BCH
// format/version info); it is transcribed rather than invented, and it is not
// meant to be maintained by hand. Treat it as a black box with a test: the
// scratch suite round-trips encode -> decode and checks the published format
// strings, which is what should be re-run if anything here is ever touched.
//
// Deliberately narrow, which is what keeps the spec tables small enough to
// audit:
//   * byte mode only (UTF-8) — covers "WIFI:S:...;" join strings and URLs
//   * error-correction level M (~15% recovery), the usual choice for both
//   * versions 1-10, i.e. up to 213 bytes; throws past that rather than
//     silently truncating
//
// Exports a boolean matrix, plus an SVG renderer for the common case.

// [ecCodewordsPerBlock, group1Blocks, group1DataCodewords, group2Blocks, group2DataCodewords]
// ISO/IEC 18004 Table 9, level M rows only.
const EC_M = {
  1: [10, 1, 16, 0, 0],
  2: [16, 1, 28, 0, 0],
  3: [26, 1, 44, 0, 0],
  4: [18, 2, 32, 0, 0],
  5: [24, 2, 43, 0, 0],
  6: [16, 4, 27, 0, 0],
  7: [18, 4, 31, 0, 0],
  8: [22, 2, 38, 2, 39],
  9: [22, 3, 36, 2, 37],
  10: [26, 4, 43, 1, 44],
};

// Alignment-pattern centre coordinates per version (none for version 1).
const ALIGN = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const MAX_VERSION = 10;

// --- GF(256) arithmetic, primitive polynomial 0x11d ------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(function initTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

// Generator polynomial for `degree` EC codewords, highest power first.
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// Remainder of data * x^ecLen divided by the generator — the EC codewords.
function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen);
  const res = new Uint8Array(ecLen);
  for (const byte of data) {
    const factor = byte ^ res[0];
    res.copyWithin(0, 1);
    res[ecLen - 1] = 0;
    for (let j = 0; j < ecLen; j++) res[j] ^= gfMul(gen[j + 1], factor);
  }
  return res;
}

// --- bitstream -> codewords ------------------------------------------------

function dataCodewordCount(version) {
  const [, b1, d1, b2, d2] = EC_M[version];
  return b1 * d1 + b2 * d2;
}

// Byte-mode payload capacity, after the 4-bit mode and the length indicator
// (8 bits below version 10, 16 bits from version 10 up).
function byteCapacity(version) {
  const lenBits = version >= 10 ? 16 : 8;
  return Math.floor((dataCodewordCount(version) * 8 - 4 - lenBits) / 8);
}

function chooseVersion(byteLen) {
  for (let v = 1; v <= MAX_VERSION; v++) {
    if (byteLen <= byteCapacity(v)) return v;
  }
  throw new Error(
    `qr: ${byteLen} bytes exceeds the version-${MAX_VERSION} capacity of ${byteCapacity(MAX_VERSION)}`
  );
}

function buildDataCodewords(bytes, version) {
  const total = dataCodewordCount(version);
  const capacityBits = total * 8;
  const bits = [];
  const push = (value, count) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte mode
  push(bytes.length, version >= 10 ? 16 : 8);
  for (const b of bytes) push(b, 8);

  // Terminator (up to four zeros), then pad to a byte boundary.
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const out = new Uint8Array(total);
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out[i / 8] = v;
  }
  // Alternating pad codewords fill the remainder.
  const PAD = [0xec, 0x11];
  for (let i = bits.length / 8, p = 0; i < total; i++, p++) out[i] = PAD[p % 2];
  return out;
}

// Split into blocks, compute EC per block, then interleave both — the order
// the spec requires so a burst of damage spreads across blocks.
function interleave(data, version) {
  const [ecPer, b1, d1, b2, d2] = EC_M[version];
  const blocks = [];
  let off = 0;
  for (let i = 0; i < b1; i++, off += d1) blocks.push(data.subarray(off, off + d1));
  for (let i = 0; i < b2; i++, off += d2) blocks.push(data.subarray(off, off + d2));
  const ec = blocks.map((b) => rsEncode(b, ecPer));

  const out = [];
  const widest = Math.max(d1, d2);
  for (let i = 0; i < widest; i++) {
    for (const b of blocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecPer; i++) {
    for (const e of ec) out.push(e[i]);
  }
  return Uint8Array.from(out);
}

// --- BCH-protected metadata ------------------------------------------------

// 15-bit format info: 2 bits EC level (M = 00) + 3 bits mask, BCH(15,5),
// XORed with the spec's 0x5412 so an all-zero format is never all-zero.
function formatBits(mask) {
  const data = (0b00 << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

// 18-bit version info, BCH(18,6). Only present from version 7 up.
function versionBits(version) {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (version << 12) | rem;
}

// --- module placement ------------------------------------------------------

function blankGrid(size, fill) {
  return Array.from({ length: size }, () => new Array(size).fill(fill));
}

// Finder pattern plus its separator ring, anchored at a corner.
function drawFinder(mods, fixed, size, row, col) {
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
      const ring = (r === 0 || r === 6) && c >= 0 && c <= 6;
      const side = (c === 0 || c === 6) && r >= 0 && r <= 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      mods[rr][cc] = ring || side || core ? 1 : 0;
      fixed[rr][cc] = true;
    }
  }
}

function drawAlignment(mods, fixed, row, col) {
  for (let r = -2; r <= 2; r++) {
    for (let c = -2; c <= 2; c++) {
      const edge = Math.max(Math.abs(r), Math.abs(c));
      mods[row + r][col + c] = edge !== 1 ? 1 : 0;
      fixed[row + r][col + c] = true;
    }
  }
}

// Everything that isn't payload: finders, timing, alignment, the dark module,
// version info, and the format-info area (reserved here, written after the
// mask is chosen).
function drawFunctionPatterns(version) {
  const size = 17 + 4 * version;
  const mods = blankGrid(size, 0);
  const fixed = blankGrid(size, false);

  drawFinder(mods, fixed, size, 0, 0);
  drawFinder(mods, fixed, size, 0, size - 7);
  drawFinder(mods, fixed, size, size - 7, 0);

  for (let i = 8; i < size - 8; i++) {
    const v = i % 2 === 0 ? 1 : 0;
    mods[6][i] = v;
    fixed[6][i] = true;
    mods[i][6] = v;
    fixed[i][6] = true;
  }

  const centres = ALIGN[version];
  for (const r of centres) {
    for (const c of centres) {
      // The three finder corners already own these positions.
      const atFinder =
        (r === 6 && c === 6) ||
        (r === 6 && c === size - 7) ||
        (r === size - 7 && c === 6);
      if (!atFinder) drawAlignment(mods, fixed, r, c);
    }
  }

  mods[size - 8][8] = 1; // always-dark module
  fixed[size - 8][8] = true;

  // Reserve the format strips so data placement skips them.
  for (let i = 0; i < 15; i++) reserveFormat(fixed, size, i);

  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = (bits >>> i) & 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      mods[b][a] = bit;
      fixed[b][a] = true;
      mods[a][b] = bit;
      fixed[a][b] = true;
    }
  }
  return { size, mods, fixed };
}

// The two cells carrying format bit `i` — one in each copy of the strip.
function formatCells(size, i) {
  let first;
  if (i < 6) first = [i, 8];
  else if (i === 6) first = [7, 8];
  else if (i === 7) first = [8, 8];
  else if (i === 8) first = [8, 7];
  else first = [8, 14 - i];
  const second = i < 8 ? [8, size - 1 - i] : [size - 15 + i, 8];
  return [first, second];
}

function reserveFormat(fixed, size, i) {
  for (const [r, c] of formatCells(size, i)) fixed[r][c] = true;
}

function writeFormat(mods, size, mask) {
  const bits = formatBits(mask);
  for (let i = 0; i < 15; i++) {
    const bit = (bits >>> i) & 1;
    for (const [r, c] of formatCells(size, i)) mods[r][c] = bit;
  }
}

// Zigzag the message through the free modules: two columns at a time, right
// to left, alternating upward and downward, skipping the vertical timing line.
function placeData(mods, fixed, size, msg) {
  const totalBits = msg.length * 8;
  let idx = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      const row = upward ? size - 1 - vert : vert;
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        if (fixed[row][col]) continue;
        // Past the end of the message the remainder bits are zero.
        mods[row][col] =
          idx < totalBits ? (msg[idx >>> 3] >>> (7 - (idx & 7))) & 1 : 0;
        idx++;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(mods, fixed, size, mask) {
  const fn = MASKS[mask];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!fixed[r][c] && fn(r, c)) mods[r][c] ^= 1;
    }
  }
}

// The spec's four penalty rules. Lower is better; the encoder keeps the mask
// that scores lowest, which is what stops a code degenerating into stripes or
// large blank fields that scanners struggle with.
function penalty(mods, size) {
  let score = 0;

  // Rule 1: runs of five or more identical modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const readRow of [true, false]) {
      let run = 1;
      for (let j = 1; j < size; j++) {
        const prev = readRow ? mods[i][j - 1] : mods[j - 1][i];
        const cur = readRow ? mods[i][j] : mods[j][i];
        if (cur === prev) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: every 2x2 block of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = mods[r][c];
      if (v === mods[r][c + 1] && v === mods[r + 1][c] && v === mods[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // Rule 3: the finder-lookalike 1:1:3:1:1 sequence with four light modules
  // on either side, which a scanner could mistake for a position marker.
  const A = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
  const B = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      let rowA = true, rowB = true, colA = true, colB = true;
      for (let k = 0; k < 11; k++) {
        const rv = mods[i][j + k];
        const cv = mods[j + k][i];
        if (rv !== A[k]) rowA = false;
        if (rv !== B[k]) rowB = false;
        if (cv !== A[k]) colA = false;
        if (cv !== B[k]) colB = false;
      }
      if (rowA) score += 40;
      if (rowB) score += 40;
      if (colA) score += 40;
      if (colB) score += 40;
    }
  }

  // Rule 4: drift away from a 50/50 light/dark balance.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark += mods[r][c];
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

// --- public API ------------------------------------------------------------

// Encode `text` and return the finished module matrix as boolean[][], where
// true is a dark module. No quiet zone — the renderer adds it.
export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = chooseVersion(bytes.length);
  const msg = interleave(buildDataCodewords(bytes, version), version);
  const { size, mods, fixed } = drawFunctionPatterns(version);
  placeData(mods, fixed, size, msg);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const trial = mods.map((row) => row.slice());
    applyMask(trial, fixed, size, mask);
    writeFormat(trial, size, mask);
    const score = penalty(trial, size);
    if (!best || score < best.score) best = { score, grid: trial };
  }
  return best.grid.map((row) => row.map((v) => v === 1));
}

// Render as a self-contained <svg>. One <rect> per dark module would bloat the
// DOM, so dark runs are merged into horizontal bars — typically a third of the
// nodes, and identical on screen.
export function qrSvg(text, { size = 120, quiet = 2, dark = "#000", light = "#fff" } = {}) {
  const matrix = qrMatrix(text);
  const n = matrix.length;
  const span = n + quiet * 2;

  let path = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!matrix[r][c]) { c++; continue; }
      let end = c;
      while (end + 1 < n && matrix[r][end + 1]) end++;
      path += `M${c + quiet} ${r + quiet}h${end - c + 1}v1h-${end - c + 1}z`;
      c = end + 1;
    }
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${span} ${span}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  // Modules are whole units in viewBox space; crisp edges stop the scaler
  // smearing them into a blur that scanners read poorly.
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.innerHTML =
    `<rect width="${span}" height="${span}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/>`;
  return svg;
}
