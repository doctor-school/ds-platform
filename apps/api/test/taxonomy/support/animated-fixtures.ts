import sharp from "sharp";

// 012 EARS-1 test support (012-design §2.2) — REAL animated-container fixtures.
//
// The normalizer must refuse an animated WebP and an APNG from the container
// header, before allocating frames. Proving that needs genuinely multi-frame
// bytes, and `sharp` cannot write either format, so the two builders below
// assemble the containers directly from a still frame `sharp` DOES write. Both
// are pure byte assembly against the published container layouts, so what makes
// each fixture "animated" is visible in the code rather than hidden in a
// committed binary a reviewer cannot inspect.
//
// It lives under `test/` on purpose: `apps/api/tsconfig.json` includes `src/**/*`
// and excludes `test`, so a fixture GENERATOR next to the normalizer would ship in
// the api build. Its only importer is `../still-image-normalizer.spec.ts`.

/** A solid still frame in the requested container. */
async function stillFrame(
  format: "png" | "webp",
  width: number,
  height: number,
): Promise<Buffer> {
  const base = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 30, g: 90, b: 180 },
    },
  });
  return format === "png" ? base.png().toBuffer() : base.webp().toBuffer();
}

// ── Animated WebP (RIFF: VP8X with the ANIMATION flag + ANIM + two ANMF) ─────

function riffChunk(fourcc: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, "ascii");
  header.writeUInt32LE(payload.length, 4);
  // RIFF chunks are padded to an even length.
  const pad = payload.length % 2 === 1 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([header, payload, pad]);
}

function uint24LE(value: number): Buffer {
  const b = Buffer.alloc(3);
  b.writeUIntLE(value, 0, 3);
  return b;
}

/** Extract the single bitstream chunk (`VP8 ` / `VP8L`) of a simple still WebP. */
function extractWebpBitstream(still: Buffer): Buffer {
  let offset = 12; // skip "RIFF" + size + "WEBP"
  while (offset + 8 <= still.length) {
    const fourcc = still.toString("ascii", offset, offset + 4);
    const size = still.readUInt32LE(offset + 4);
    if (fourcc === "VP8 " || fourcc === "VP8L") {
      return still.subarray(offset, offset + 8 + size + (size % 2));
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error("no VP8/VP8L chunk in the still WebP fixture");
}

/**
 * A REAL two-frame animated WebP: an extended (`VP8X`) container whose flags
 * byte sets the ANIMATION bit, followed by an `ANIM` global header and two
 * `ANMF` frames that reuse one encoded bitstream.
 */
export async function animatedWebpFixture(size = 32): Promise<Buffer> {
  const bitstream = extractWebpBitstream(await stillFrame("webp", size, size));

  const vp8x = Buffer.concat([
    Buffer.from([0x02, 0x00, 0x00, 0x00]), // flags: ANIMATION; 24 reserved bits
    uint24LE(size - 1), // canvas width  - 1
    uint24LE(size - 1), // canvas height - 1
  ]);
  const anim = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff]), // background colour (BGRA)
    Buffer.from([0x00, 0x00]), // loop count: infinite
  ]);
  const frame = Buffer.concat([
    uint24LE(0), // frame x / 2
    uint24LE(0), // frame y / 2
    uint24LE(size - 1), // frame width  - 1
    uint24LE(size - 1), // frame height - 1
    uint24LE(100), // duration ms
    Buffer.from([0x00]), // blend + dispose flags
    bitstream,
  ]);

  const body = Buffer.concat([
    Buffer.from("WEBP", "ascii"),
    riffChunk("VP8X", vp8x),
    riffChunk("ANIM", anim),
    riffChunk("ANMF", frame),
    riffChunk("ANMF", frame),
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

// ── APNG (PNG + acTL + two fcTL-delimited frames, the second as fdAT) ────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, crc]);
}

interface PngChunk {
  type: string;
  payload: Buffer;
}

function readPngChunks(png: Buffer): PngChunk[] {
  const chunks: PngChunk[] = [];
  let offset = 8; // skip the PNG signature
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString("ascii", offset + 4, offset + 8);
    chunks.push({
      type,
      payload: png.subarray(offset + 8, offset + 8 + length),
    });
    offset += 12 + length;
  }
  return chunks;
}

/** A REAL two-frame APNG built from a still PNG's own IDAT data. */
export async function apngFixture(size = 32): Promise<Buffer> {
  const still = await stillFrame("png", size, size);
  const chunks = readPngChunks(still);
  const ihdr = chunks.find((c) => c.type === "IHDR");
  const idats = chunks.filter((c) => c.type === "IDAT");
  if (!ihdr || idats.length === 0) throw new Error("malformed PNG fixture");
  const imageData = Buffer.concat(idats.map((c) => c.payload));

  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(2, 0); // num_frames
  actl.writeUInt32BE(0, 4); // num_plays: infinite

  const fctl = (sequence: number): Buffer => {
    const b = Buffer.alloc(26);
    b.writeUInt32BE(sequence, 0);
    b.writeUInt32BE(size, 4); // width
    b.writeUInt32BE(size, 8); // height
    b.writeUInt32BE(0, 12); // x_offset
    b.writeUInt32BE(0, 16); // y_offset
    b.writeUInt16BE(1, 20); // delay_num
    b.writeUInt16BE(10, 22); // delay_den
    b.writeUInt8(0, 24); // dispose_op: none
    b.writeUInt8(0, 25); // blend_op: source
    return b;
  };

  const fdatSequence = Buffer.alloc(4);
  fdatSequence.writeUInt32BE(2, 0);

  return Buffer.concat([
    still.subarray(0, 8), // PNG signature
    pngChunk("IHDR", ihdr.payload),
    pngChunk("acTL", actl),
    pngChunk("fcTL", fctl(0)),
    pngChunk("IDAT", imageData), // frame 1 doubles as the default image
    pngChunk("fcTL", fctl(1)),
    pngChunk("fdAT", Buffer.concat([fdatSequence, imageData])), // frame 2
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
