/**
 * Offline model conversion: art/models/*.fbx -> public/models/glb/*.glb + public/models/tex/*.webp
 *
 *   npm run models            (re-run whenever an FBX is re-exported, then bump MODEL_VERSION in src/models.js)
 *
 * The FBX files embed every texture, and the same textures are pasted into many files (95% of the old 646 MB
 * download was images, 40% of it repeats). This reads each FBX with the game's own loader (three.js FBXLoader,
 * so node names, transforms and animation match what the game always saw) and writes:
 *  - one .glb per model with geometry, nodes and animation only (no images), and
 *  - every distinct image once, as WebP no larger than MAX_SIZE, named by a hash of the original file.
 * Each material keeps what the game reads from it (colour, opacity, emissive strength, which image goes in which
 * slot and how it is tiled) in its glTF extras; src/models.js rebuilds the materials from that and loads the
 * images itself, sharing them across every model.
 * Also done here: the Wasteland / Tar Pit dust parts are removed, animation tracks that never move are dropped,
 * vertex attributes the game never uses are dropped, and identical vertices are welded.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveObjectURL } from 'node:buffer';
import sharp from 'sharp';

// ---- Node stand-ins for the browser bits FBXLoader and GLTFExporter touch ----
globalThis.document = {
  createElementNS: () => ({
    addEventListener(type, fn) {
      if (type === 'load') setTimeout(() => fn.call(this, {}), 0); // ImageLoader reads the image from `this`
    },
    removeEventListener() {},
  }),
};
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = r;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((r) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(r).toString('base64')}`;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
};

const THREE = await import('three');
const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
const { NodeIO, VertexLayout } = await import('@gltf-transform/core');
const { dedup, weld } = await import('@gltf-transform/functions');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'art/models');
const OUT_GLB = path.join(ROOT, 'public/models/glb');
const OUT_TEX = path.join(ROOT, 'public/models/tex');
const MAX_SIZE = Number(process.env.MAX_SIZE ?? 2048); // the game never shows a texture larger than this
const QUALITY = { color: Number(process.env.Q_COLOR ?? 82), normal: Number(process.env.Q_NORMAL ?? 90) };
const KEEP_ATTRS = new Set(['position', 'normal', 'uv']); // all the game's materials and merges read
const SLOTS = ['map', 'normalMap', 'emissiveMap'];

/** Dust parts (Waste<Name>_DustNN_NN). The Tar Pit's _Dust group also holds its tar bubbles and fumes: those stay. */
const DUST_PART = /_Dust\d+_\d+$/;

function stripDust(root) {
  const parts = [];
  root.traverse((o) => DUST_PART.test(o.name) && parts.push(o));
  const removed = new Set();
  for (const p of parts) {
    p.traverse((o) => removed.add(o.name));
    p.removeFromParent();
  }
  // Groups left empty (the Wasteland pieces' Waste<Name>_Dust) go too.
  const empty = [];
  root.traverse((o) => /_Dust$/.test(o.name) && !o.children.length && !o.isMesh && empty.push(o));
  for (const o of empty) {
    removed.add(o.name);
    o.removeFromParent();
  }
  return removed;
}

/** Same as the game's movingTracksOnly: Blender bakes a key on every object; keep only tracks that move. */
function movingTracksOnly(clip, removed) {
  const tracks = clip.tracks.filter((track) => {
    if (removed.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)) return false;
    const { values } = track;
    const n = track.getValueSize();
    for (let i = n; i < values.length; i++) if (Math.abs(values[i] - values[i % n]) > 1e-5) return true;
    return false;
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

const images = new Map(); // id -> { bytes, use: Set('color' | 'normal'), files: Set }

function imageId(texture, file) {
  const src = texture.image?._s ?? texture.image?.src;
  const blob = typeof src === 'string' && src.startsWith('blob:') ? resolveObjectURL(src) : null;
  if (!blob) throw new Error(`${file}: texture ${texture.name} is not embedded`);
  return blob.arrayBuffer().then((ab) => {
    const bytes = Buffer.from(ab);
    const id = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20);
    if (!images.has(id)) images.set(id, { bytes, use: new Set(), files: new Set(), name: texture.name });
    images.get(id).files.add(file);
    return id;
  });
}

/** Material -> plain description of what the game reads (see toStandard in src/models.js). */
async function describe(m, file) {
  const spec = {
    name: m.name,
    color: m.color ? m.color.getHex() : 0xffffff,
    opacity: m.opacity,
    transparent: m.transparent,
    emissiveIntensity: m.emissiveIntensity ?? 0,
    maps: {},
  };
  for (const k of SLOTS) {
    const t = m[k];
    if (!t) continue;
    const id = await imageId(t, file);
    images.get(id).use.add(k === 'normalMap' ? 'normal' : 'color');
    spec.maps[k] = { id, wrapS: t.wrapS, wrapT: t.wrapT, repeat: t.repeat.toArray(), offset: t.offset.toArray() };
  }
  return spec;
}

async function convert(file) {
  const buf = fs.readFileSync(path.join(SRC, file));
  const root = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  await new Promise((r) => setTimeout(r, 0)); // let the stub images "load"
  const removed = stripDust(root);
  const animations = root.animations.map((c) => movingTracksOnly(c, removed)).filter((c) => c.tracks.length);

  // Materials: swap each for a bare placeholder carrying its description in userData (-> glTF extras).
  const swap = new Map();
  const meshes = [];
  root.traverse((o) => o.isMesh && meshes.push(o));
  for (const o of meshes) {
    for (const m of [o.material].flat()) {
      if (swap.has(m)) continue;
      const placeholder = new THREE.MeshStandardMaterial({ name: m.name });
      placeholder.userData = { spec: await describe(m, file) };
      swap.set(m, placeholder);
    }
    o.material = Array.isArray(o.material) ? o.material.map((m) => swap.get(m)) : swap.get(o.material);
    const g = o.geometry;
    for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.has(name)) g.deleteAttribute(name);
    g.morphAttributes = {};
    g.userData = {};
  }
  // Node names go in extras too: GLTFLoader renames clashing names and splits multi-material meshes.
  root.traverse((o) => (o.userData = { n: o.name }));

  const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations, onlyVisible: false, trs: true });
  // Separate (not interleaved) vertex buffers: the game clones and merges attributes, and three.js would
  // de-interleave each one on the way.
  const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.readBinary(new Uint8Array(glb));
  await doc.transform(dedup(), weld());
  const out = await io.writeBinary(doc);
  const name = file.replace(/\.fbx$/i, '.glb');
  fs.writeFileSync(path.join(OUT_GLB, name), out);
  return { name, bytes: out.byteLength, dust: [...removed].filter((n) => DUST_PART.test(n)).length, tracks: animations.reduce((s, c) => s + c.tracks.length, 0) };
}

async function writeImage(id, { bytes, use }) {
  const normal = use.has('normal');
  const out = path.join(OUT_TEX, `${id}.webp`);
  const info = await sharp(bytes)
    .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: normal ? QUALITY.normal : QUALITY.color, effort: 5 })
    .toFile(out);
  return info.size;
}

// ---- run ----
fs.mkdirSync(OUT_GLB, { recursive: true });
fs.rmSync(OUT_TEX, { recursive: true, force: true });
fs.mkdirSync(OUT_TEX, { recursive: true });
for (const f of fs.readdirSync(OUT_GLB)) if (f.endsWith('.glb')) fs.rmSync(path.join(OUT_GLB, f));

const files = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith('.fbx')).sort();
if (!files.length) throw new Error(`No FBX files in ${SRC}`);
let srcBytes = 0;
let glbBytes = 0;
for (const f of files) {
  srcBytes += fs.statSync(path.join(SRC, f)).size;
  const r = await convert(f);
  glbBytes += r.bytes;
  console.log(`${f.padEnd(26)} -> ${r.name.padEnd(26)} ${(r.bytes / 1e6).toFixed(2).padStart(6)} MB  ${r.tracks} tracks${r.dust ? `, ${r.dust} dust parts removed` : ''}`);
}

let rawImg = 0;
let texBytes = 0;
const ids = [...images.keys()];
for (let i = 0; i < ids.length; i += 8) {
  const sizes = await Promise.all(ids.slice(i, i + 8).map((id) => writeImage(id, images.get(id))));
  texBytes += sizes.reduce((a, b) => a + b, 0);
}
for (const { bytes } of images.values()) rawImg += bytes.byteLength;
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;
console.log(`\n${files.length} FBX (${mb(srcBytes)}) -> ${mb(glbBytes)} of .glb + ${images.size} images ${mb(texBytes)} (originals ${mb(rawImg)}, max ${MAX_SIZE}px WebP)`);
console.log(`Total ${mb(glbBytes + texBytes)}`);
