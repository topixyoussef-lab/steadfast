import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import sharp from "sharp";

const [SRC, PROJECT] = process.argv.slice(2);
if (!SRC || !PROJECT) {
  console.error("usage: node scripts/generate-apk-icons.mjs <artwork> <bubblewrap-project-dir>");
  process.exit(1);
}
if (!existsSync(join(PROJECT, "twa-manifest.json"))) {
  console.error(`${PROJECT} has no twa-manifest.json — not a Bubblewrap project`);
  process.exit(1);
}

/**
 * Pixel sizes Bubblewrap wrote for each density band, read off the project it
 * generated. The maskable canvas is deliberately larger than the launcher tile:
 * ic_launcher.xml pads it by 8.5dp inside the 108dp adaptive frame.
 */
const DENSITIES = {
  mdpi: { launcher: 48, maskable: 82, splash: 300 },
  hdpi: { launcher: 72, maskable: 123, splash: 450 },
  xhdpi: { launcher: 96, maskable: 164, splash: 600 },
  xxhdpi: { launcher: 144, maskable: 246, splash: 900 },
  xxxhdpi: { launcher: 192, maskable: 328, splash: 1200 },
};

/** The fist head alone, measured from the artwork's ink box. */
const FIST = { left: 200, top: 80, width: 640, height: 640 };
/** Same steep ramp as the favicon: at 48-192px the grey field swallows the fist. */
const RAMP = [2, -200];

const png = (pipeline) =>
  pipeline.png({ palette: true, quality: 90, effort: 8 }).toBuffer();

function square(size, { box, ramp } = {}) {
  let pipeline = sharp(SRC);
  if (box) pipeline = pipeline.extract(box);
  pipeline = pipeline.resize(size, size, { fit: "cover", position: "centre" });
  if (ramp) pipeline = pipeline.linear(ramp[0], ramp[1]);
  return pipeline;
}

/** Artwork in a rounded tile, corners knocked out to transparency. */
async function tile(size, { box, ramp, radiusRatio = 0.28 }) {
  const mask = Buffer.from(
    `<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * radiusRatio)}" fill="#fff"/></svg>`,
  );
  return png(
    sharp(await square(size, { box, ramp }).png().toBuffer()).composite([
      { input: await sharp(mask).png().toBuffer(), blend: "dest-in" },
    ]),
  );
}

function put(relative, buffer) {
  const path = join(PROJECT, "app/src/main/res", relative);
  writeFileSync(path, buffer);
  console.log(`${relative}  ${buffer.length}b`);
}

async function main() {
  for (const [density, sizes] of Object.entries(DENSITIES)) {
    put(
      `mipmap-${density}/ic_launcher.png`,
      await square(sizes.launcher, { box: FIST, ramp: RAMP }).png({ palette: true, quality: 90, effort: 8 }).toBuffer(),
    );
    put(
      `mipmap-${density}/ic_maskable.png`,
      await png(square(sizes.maskable)),
    );
    put(
      `drawable-${density}/splash.png`,
      await tile(sizes.splash, { radiusRatio: 0.18 }),
    );
  }

  // Bubblewrap's own copy of the icon. `bubblewrap update` regenerates every
  // resource above from this file, so leaving it stale would undo the rebuild.
  writeFileSync(join(PROJECT, "store_icon.png"), await png(square(512)));
  console.log("store_icon.png  (512x512)");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
