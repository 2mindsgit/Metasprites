/* ================================================================
   COMPRESS — PS Gaiden tile compression (.psgcompr)
   JS port of gfxcomp_phantasystargaiden.cpp
   ================================================================

   Input to compressTilesPSG(): a flat Uint8Array of N tiles, each
   32 bytes in *interleaved* SMS VRAM format (4 bytes per row:
   plane0,plane1,plane2,plane3 × 8 rows).

   The original C tool deinterleaves each 32-byte tile (interleaving=4)
   so that the 4 bitplanes become contiguous (8 bytes each) before
   compressing. We replicate that exactly.
   ================================================================ */

/* Deinterleave a 32-byte tile (interleaving = 4) in place.
   Mirrors Utils::deinterleave:
     dest = src/interleaving + (src%interleaving)*bitplaneSize */
function deinterleave32(buffer, interleaving) {
  const out = new Uint8Array(buffer.length);
  const bitplaneSize = buffer.length / interleaving;
  for (let src = 0; src < buffer.length; src++) {
    const dest = Math.floor(src / interleaving) + (src % interleaving) * bitplaneSize;
    out[dest] = buffer[src];
  }
  return out;
}

/* findMostCommonValue over 8 bytes starting at offset */
function findMostCommonValue(data, off) {
  const counts = new Map();
  for (let i = 0; i < 8; i++) {
    const v = data[off + i];
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let value = 0, count = 0;
  /* iterate in ascending key order to match std::map traversal */
  const keys = [...counts.keys()].sort((a,b)=>a-b);
  for (const k of keys) {
    const c = counts.get(k);
    if (c > count) { value = k; count = c; }
  }
  return { value, count };
}

/* countMatches between two 8-byte runs, optionally inverting other */
function countMatches(data, offMe, offOther, invert) {
  let count = 0;
  const mask = invert ? 0xff : 0x00;
  for (let i = 0; i < 8; i++) {
    if (data[offMe + i] === ((data[offOther + i] ^ mask) & 0xff)) count++;
  }
  return count;
}

/* Compress one deinterleaved 32-byte tile, appending to destination array */
function compressTilePSG(source, destination) {
  let bitplaneMethods = 0;
  const tileData = [];

  for (let bp = 0; bp < 4; bp++) {
    const off = bp * 8;
    const { value: mostCommonByte, count: mostCommonByteCount } =
      findMostCommonValue(source, off);

    /* match against previous bitplanes */
    let matchIndex = 0, matchCount = 0, matchInverse = false;
    for (let other = 0; other < bp; other++) {
      const oOff = other * 8;
      let c = countMatches(source, off, oOff, false);
      if (c > matchCount) { matchIndex = other; matchCount = c; matchInverse = false; }
      c = countMatches(source, off, oOff, true);
      if (c > matchCount) { matchIndex = other; matchCount = c; matchInverse = true; }
    }

    bitplaneMethods = (bitplaneMethods << 2) & 0xff;

    if (mostCommonByteCount === 8 && mostCommonByte === 0x00) {
      bitplaneMethods |= 0x00;                       /* all 0 */
    } else if (mostCommonByteCount === 8 && mostCommonByte === 0xff) {
      bitplaneMethods |= 0x01;                       /* all ff */
    } else if (mostCommonByteCount <= 2 && matchCount <= 2) {
      bitplaneMethods |= 0x03;                       /* raw */
      for (let i = 0; i < 8; i++) tileData.push(source[off + i]);
    } else {
      bitplaneMethods |= 0x02;                       /* compressed */

      if (matchCount === 8) {
        /* whole bitplane duplicate: %000f00nn */
        tileData.push((matchInverse ? 0x10 : 0x00) | matchIndex);
      } else if (matchCount > mostCommonByteCount) {
        /* copy (and maybe invert) matching bytes from other bitplane */
        tileData.push((matchInverse ? 0x40 : 0x20) | matchIndex);
        const mask = matchInverse ? 0xff : 0x00;
        const oOff = matchIndex * 8;
        /* bitmask of which bytes match */
        let bitmask = 0;
        for (let i = 0; i < 8; i++) {
          bitmask = (bitmask << 1) & 0xff;
          if (source[off + i] === ((source[oOff + i] ^ mask) & 0xff)) bitmask |= 1;
        }
        tileData.push(bitmask);
        /* output non-matching bytes */
        for (let i = 0; i < 8; i++) {
          if (source[off + i] !== ((source[oOff + i] ^ mask) & 0xff))
            tileData.push(source[off + i]);
        }
      } else {
        /* common byte run */
        let bitmask = 0;
        for (let i = 0; i < 8; i++) {
          bitmask = (bitmask << 1) & 0xff;
          if (source[off + i] === mostCommonByte) bitmask |= 1;
        }
        tileData.push(bitmask);
        tileData.push(mostCommonByte);
        for (let i = 0; i < 8; i++) {
          if (source[off + i] !== mostCommonByte) tileData.push(source[off + i]);
        }
      }
    }
  }

  destination.push(bitplaneMethods);
  for (const b of tileData) destination.push(b);
}

/* Compress an array of 32-byte interleaved tiles.
   Returns a Uint8Array: [tileCountLo, tileCountHi, ...compressed tiles].
   `tiles32` is an array of Uint8Array(32). */
function compressTilesPSG(tiles32) {
  const numTiles = tiles32.length;
  if (numTiles > 0xffff) { toast('Trop de tiles (>65535)'); return null; }

  const destination = [];
  destination.push(numTiles & 0xff);
  destination.push((numTiles >> 8) & 0xff);

  for (const t of tiles32) {
    const tile = new Uint8Array(32);
    tile.set(t.subarray(0, 32));
    const di = deinterleave32(tile, 4);
    compressTilePSG(di, destination);
  }

  return Uint8Array.from(destination);
}
