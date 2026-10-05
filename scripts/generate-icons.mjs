import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

/** The artwork lives in the repo so regeneration never depends on Downloads. */
const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(process.argv[2] ?? join(REPO, "assets/brand/fist.jpeg"));
if (!existsSync(SRC)) {
  console.error(`no artwork at ${SRC}`);
  process.exit(1);
}
console.log(`artwork: ${SRC}`);

/**
 * The fist head on its own. Measured from the artwork's ink box; the full
 * composition runs down to the wrist, which at 16-32px collapses into a blob.
 */
const FIST = { left: 200, top: 80, width: 640, height: 640 };

/**
 * Tone ramps for the small surfaces, as [multiplier, offset] per channel. The
 * artwork's mid-grey field sits barely below the fist's own shading, so at tab
 * size the two merge into one pale mass; steepening the ramp drops the field to
 * near-black and holds the fist up as a light shape. The 192/512 icons keep the
 * original tones — there is room for the gradient there.
 */
const RAMPS = { header: [2, -200], favicon: [2.6, -290] };

/** Centred square crop, independent of the source's aspect ratio. */
function square(size, { box, ramp } = {}) {
  let pipeline = sharp(SRC);
  if (box) pipeline = pipeline.extract(box);
  pipeline = pipeline.resize(size, size, { fit: "cover", position: "centre" });
  if (ramp) pipeline = pipeline.linear(ramp[0], ramp[1]);
  return pipeline;
}

/**
 * The artwork is grayscale, so an 8-bit palette holds it exactly and shrinks
 * the files by ~5x — these download on a phone installing the PWA.
 */
const png = (pipeline) =>
  pipeline.png({ palette: true, quality: 90, effort: 8 }).toBuffer();

async function write(buffer, path) {
  writeFileSync(path, buffer);
  const { width, height } = await sharp(buffer).metadata();
  console.log(`${path}  ${width}x${height}`);
}

/** sharp 0.35 cannot read ICO back, so verify the container by parsing it. */
function writeIco(buffer, path) {
  writeFileSync(path, buffer);
  const count = buffer.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i += 1) {
    const entry = 6 + i * 16;
    sizes.push(buffer.readUInt8(entry) || 256);
  }
  console.log(`${path}  ${count} page(s): ${sizes.join("/")} px, ${buffer.length} bytes`);
}

/**
 * ICO container around already-encoded PNGs. sharp 0.35 dropped its ICO
 * encoder, and a PNG-in-ICO is what every current browser reads anyway.
 */
function ico(pages) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pages.length, 4);

  let offset = header.length + pages.length * 16;
  const entries = pages.map(({ size, buffer }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...pages.map((page) => page.buffer)]);
}

/** Artwork cropped square and given transparent rounded corners. */
async function roundedSquare(size, radiusRatio, options) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * radiusRatio)}" fill="#fff"/></svg>`,
  );
  return png(
    sharp(await square(size, options).png().toBuffer()).composite([
      { input: await sharp(mask).png().toBuffer(), blend: "dest-in" },
    ]),
  );
}

async function main() {
  // The fist sits well inside a launcher's circular mask, so the full-bleed
  // crop serves `any` and `maskable` alike; insetting it only shows a seam.
  for (const size of [192, 512]) {
    const buffer = await png(square(size));
    await write(buffer, `public/icons/icon-${size}.png`);
    await write(buffer, `public/icons/icon-maskable-${size}.png`);
  }

  // iOS home-screen tile; the OS applies its own mask, so keep it square.
  await write(await png(square(180)), "src/app/apple-icon.png");

  // Header / auth-card mark, shown at 32px. The corners are baked at the same
  // 28% radius the BrandMark ring is drawn with, so image and border align.
  await write(
    await roundedSquare(96, 0.28, { box: FIST, ramp: RAMPS.header }),
    "public/icons/brand-mark.png",
  );

  // Favicon. Rounded corners read as deliberate at 16px; the ICO carries the
  // sizes, the SVG is the modern, crisp fallback.
  const pages = [];
  for (const size of [16, 32, 48]) {
    pages.push({
      size,
      buffer: await roundedSquare(size, 0.2, { box: FIST, ramp: RAMPS.favicon }),
    });
  }

  writeIco(ico(pages), "src/app/favicon.ico");

  // The largest page, so the tab renders it crisply at 32px rather than
  // upscaling a 16px bitmap.
  const favicon = pages[pages.length - 1].buffer.toString("base64");
  writeFileSync(
    "src/app/icon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">
  <image width="32" height="32" xlink:href="data:image/png;base64,${favicon}"/>
</svg>
`,
  );
  console.log(`src/app/icon.svg  48px page in a 32 viewBox, ${favicon.length} b64 chars`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
