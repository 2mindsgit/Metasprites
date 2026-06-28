/* ================================================================
   ZX7 — Optimal LZ compressor (Einar Saukas, 2012-2016)
   Faithful JS port of optimize.c + compress.c
   MAX_LEN = 255 (simplified decoder variant, per zx7.h)
   ================================================================ */

const ZX7_MAX_OFFSET = 2176;
const ZX7_MAX_LEN = 255;

function zx7_elias_gamma_bits(value) {
  let bits = 1;
  while (value > 1) { bits += 2; value >>= 1; }
  return bits;
}

function zx7_count_bits(offset, len) {
  return 1 + (offset > 128 ? 12 : 8) + zx7_elias_gamma_bits(len - 1);
}

/* ---- optimize() ---- */
function zx7Optimize(input, skip) {
  const inputSize = input.length;

  const min = new Array(ZX7_MAX_OFFSET + 1).fill(0);
  const max = new Array(ZX7_MAX_OFFSET + 1).fill(0);
  const matches = new Array(256 * 256).fill(0);
  const matchSlots = new Array(inputSize).fill(0);

  const optimal = new Array(inputSize);
  for (let k = 0; k < inputSize; k++) optimal[k] = { bits:0, offset:0, len:0 };

  let i;
  /* index skipped bytes */
  for (i = 1; i <= skip; i++) {
    const mi = (input[i - 1] << 8) | input[i];
    matchSlots[i] = matches[mi];
    matches[mi] = i;
  }

  /* first byte is always literal */
  optimal[skip].bits = 8;

  for (; i < inputSize; i++) {
    optimal[i].bits = optimal[i - 1].bits + 9;
    optimal[i].offset = 0;
    optimal[i].len = 0;

    const matchIndex = (input[i - 1] << 8) | input[i];
    let bestLen = 1;

    /* walk the linked list of previous positions sharing this 2-byte key.
       In C this uses pointer-to-slot so it can zero out stale entries; we
       emulate with a "cursor" that is either the head (matches) or a slot. */
    let usingHead = true;
    let prevCursorPos = -1;
    let cursor = matches[matchIndex];   /* value at *match */

    while (cursor !== 0 && bestLen < ZX7_MAX_LEN) {
      const offset = i - cursor;
      if (offset > ZX7_MAX_OFFSET) {
        /* *match = 0 */
        if (usingHead) matches[matchIndex] = 0;
        else matchSlots[prevCursorPos] = 0;
        break;
      }

      let len;
      for (len = 2; len <= ZX7_MAX_LEN && i >= skip + len; len++) {
        if (len > bestLen) {
          bestLen = len;
          const bits = optimal[i - len].bits + zx7_count_bits(offset, len);
          if (optimal[i].bits > bits) {
            optimal[i].bits = bits;
            optimal[i].offset = offset;
            optimal[i].len = len;
          }
        } else if (max[offset] !== 0 && i + 1 === max[offset] + len) {
          len = i - min[offset];
          if (len > bestLen) len = bestLen;
        }
        if (i < offset + len || input[i - len] !== input[i - len - offset]) {
          break;
        }
      }
      min[offset] = i + 1 - len;
      max[offset] = i;

      /* advance: match = &match_slots[*match] */
      prevCursorPos = cursor;
      usingHead = false;
      cursor = matchSlots[cursor];
    }

    matchSlots[i] = matches[matchIndex];
    matches[matchIndex] = i;
  }

  return optimal;
}

/* ---- compress() ---- */
function zx7Compress(optimal, input, skip) {
  const inputSize = input.length;
  let inputIndex = inputSize - 1;

  const outputSize = Math.floor((optimal[inputIndex].bits + 18 + 7) / 8);
  const output = new Uint8Array(outputSize + 8); /* small safety margin */
  let outputIndex = 0;
  let bitIndex = 0;
  let bitMask = 0;

  function writeByte(v) { output[outputIndex++] = v & 0xff; }
  function writeBit(v) {
    if (bitMask === 0) {
      bitMask = 128;
      bitIndex = outputIndex;
      writeByte(0);
    }
    if (v > 0) output[bitIndex] |= bitMask;
    bitMask >>= 1;
  }
  function writeEliasGamma(value) {
    let i;
    for (i = 2; i <= value; i <<= 1) writeBit(0);
    while ((i >>= 1) > 0) writeBit(value & i);
  }

  /* un-reverse optimal sequence */
  optimal[inputIndex].bits = 0;
  while (inputIndex !== skip) {
    const len = optimal[inputIndex].len > 0 ? optimal[inputIndex].len : 1;
    const inputPrev = inputIndex - len;
    optimal[inputPrev].bits = inputIndex;
    inputIndex = inputPrev;
  }

  outputIndex = 0;
  bitMask = 0;

  /* first byte literal */
  writeByte(input[inputIndex]);

  while ((inputIndex = optimal[inputIndex].bits) > 0) {
    if (optimal[inputIndex].len === 0) {
      writeBit(0);
      writeByte(input[inputIndex]);
    } else {
      writeBit(1);
      writeEliasGamma(optimal[inputIndex].len - 1);
      let offset1 = optimal[inputIndex].offset - 1;
      if (offset1 < 128) {
        writeByte(offset1);
      } else {
        offset1 -= 128;
        writeByte((offset1 & 127) | 128);
        for (let mask = 1024; mask > 127; mask >>= 1) writeBit(offset1 & mask);
      }
    }
  }

  /* sequence indicator + end marker (> MAX_LEN) */
  writeBit(1);
  for (let i = 0; i < 16; i++) writeBit(0);
  writeBit(1);

  return output.slice(0, outputIndex);
}

/* Public: compress a Uint8Array with ZX7 */
function compressZX7(input) {
  if (!input.length) return new Uint8Array(0);
  const optimal = zx7Optimize(input, 0);
  return zx7Compress(optimal, input, 0);
}
