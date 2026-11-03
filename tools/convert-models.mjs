/**
 * Offline model conversion: art/models/*.fbx -> public/models/glb/*.glb + public/models/tex/*.webp
 * (models with a hexagonal version in art/models/hex/ take their geometry and textures from it: see HEX; models that
 * only exist as a hexagonal .glb, with their own animation, are listed in GLB_ONLY)
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
const { dedup, weld, prune } = await import('@gltf-transform/functions');

const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'art/models');
/**
 * Hexagonal versions (HiveCity_hexagon.blend, exported as static .glb with their textures): art/models/hex/<name>.glb
 * replaces the FBX of the same model. They are flat-top hexagons (corners on x), so they are turned HEX_YAW to the
 * board's pointy-top cells. They carry no animation: it is taken from the FBX (same node names, same places).
 */
const HEX_SRC = path.join(SRC, 'hex');
const HEX = {
  'CapitalCity01.fbx': 'Capital',
  'Village02City01.fbx': 'Village02',
  'HydroFarmCity01.fbx': 'HydroFarm',
  'WaterPump01.fbx': 'PumpStation',
  'OilStationCity01.fbx': 'OilStation',
  'RefineryCity01.fbx': 'Refinery',
  'Cliff01.fbx': 'SandCliffs',
  'ToxicCraterCity01.fbx': 'ToxicCrater',
  'LaborCampCity01.fbx': 'LaborCamp',
  'Camp01.fbx': 'RaiderCampGreen',
  'Camp02.fbx': 'RaiderCampBlue',
  'Camp03.fbx': 'RaiderCampRed',
  'Camp04.fbx': 'RaiderCampBrown',
  'Camp05.fbx': 'RaiderCampGray',
};
const HEX_YAW = Math.PI / 6;
/**
 * Hexagonal models with no FBX at all (newer Blender exports that carry their own animation): art/models/hex/<file>
 * -> public/models/glb/<file>, the same treatment as HEX (shared WebP images, three.js UVs, HEX_YAW, only the vertex
 * attributes the game reads) and only the animation channels that actually move. Value: the parts' name prefix.
 */
const GLB_ONLY = {
  'MilitaryFactory.glb': 'MissileFactory',
};
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

// ---- hexagonal .glb sources (HEX) ----
const WRAP = { 33071: THREE.ClampToEdgeWrapping, 33648: THREE.MirroredRepeatWrapping, 10497: THREE.RepeatWrapping };
const plainName = (n) => n.replace(/\.\d{3}$/, ''); // Blender's duplicate suffix: the game matches material names

function addImage(bytes, name, file) {
  const id = crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 20);
  if (!images.has(id)) images.set(id, { bytes, use: new Set(), files: new Set(), name });
  images.get(id).files.add(file);
  return id;
}

/** Same material description as describe(), from a glTF material (its tiling is in the UVs: no texture transform). */
function describeGltf(m, file) {
  const f = m.getBaseColorFactor();
  const spec = { name: plainName(m.getName()), color: 0xffffff, opacity: f[3], transparent: m.getAlphaMode() === 'BLEND', emissiveIntensity: 0, maps: {} };
  const slot = (tex, info, use) => {
    if (info.getExtension('KHR_texture_transform')) throw new Error(`${file}: ${m.getName()} has a texture transform`);
    const id = addImage(Buffer.from(tex.getImage()), tex.getName() || spec.name, file);
    images.get(id).use.add(use);
    return { id, wrapS: WRAP[info.getWrapS()], wrapT: WRAP[info.getWrapT()], repeat: [1, 1], offset: [0, 0] };
  };
  if (m.getBaseColorTexture()) spec.maps.map = slot(m.getBaseColorTexture(), m.getBaseColorTextureInfo(), 'color');
  else spec.color = new THREE.Color().setRGB(f[0], f[1], f[2], THREE.SRGBColorSpace).getHex(); // as the FBX path stored it
  if (m.getNormalTexture()) spec.maps.normalMap = slot(m.getNormalTexture(), m.getNormalTextureInfo(), 'normal');
  if (m.getEmissiveTexture()) {
    spec.maps.emissiveMap = slot(m.getEmissiveTexture(), m.getEmissiveTextureInfo(), 'color');
    const strength = m.getExtension('KHR_materials_emissive_strength')?.getEmissiveStrength() ?? 1;
    spec.emissiveIntensity = strength * Math.max(...m.getEmissiveFactor());
  }
  return spec;
}

/**
 * The FBX's animation, re-expressed for the .glb's nodes. Each key's world transform (FBX parent world × key) is
 * moved from the FBX's world (where <prefix>_HiveCity stands at its place on the Blender map) to the .glb's (where it
 * stands at the origin, turned by the yaw), then into the .glb parent's frame. The .glb's meshes are y-up in their
 * own frame, the FBX's z-up (Blender's): BASIS turns one into the other on the right of every key.
 * Parts the hexagonal layout moved (a stack, the pumpjack) keep their motion and follow the move: per group of parts
 * (smoke puffs of one stack share a name up to _NN), the median offset between the .glb pose and the FBX's first key
 * (the .glb was exported at the first frame) is added to every key. Constant channels just set the node's pose.
 */
const BASIS = new THREE.Matrix4().makeRotationX(Math.PI / 2); // inverse of glTF's (x, y, z) -> (x, z, -y)

/**
 * The ships leave their model and fly (src/traffic.js), steered by their local axes as the FBX had them (Blender's:
 * nose -Y). Put their geometry back in those axes: vertices × BASIS, node × BASIS⁻¹ (same look). Returns the nodes.
 */
function shipsToBlenderAxes(root) {
  const ships = new Set();
  const inv = BASIS.clone().invert();
  const v = new THREE.Vector3();
  for (const node of root.listNodes()) {
    if (!/_Ship$/.test(node.getName()) || !node.getMesh()) continue;
    const done = new Set();
    for (const p of node.getMesh().listPrimitives()) {
      for (const [sem, normal] of [['POSITION', false], ['NORMAL', true]]) {
        const a = p.getAttribute(sem);
        if (!a || done.has(a)) continue;
        done.add(a);
        const el = [];
        for (let i = 0; i < a.getCount(); i++) {
          a.getElement(i, el);
          v.fromArray(el).applyMatrix4(BASIS);
          if (normal) v.normalize();
          a.setElement(i, v.toArray());
        }
      }
    }
    const m = new THREE.Matrix4().fromArray(node.getMatrix()).multiply(inv);
    const t = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    m.decompose(t, q, s);
    node.setTranslation(t.toArray()).setRotation(q.toArray()).setScale(s.toArray());
    ships.add(node);
  }
  return ships;
}

/** Metres per texture repeat for textured parts exported without UVs (as tools/blender_apply_textures.py tiles them). */
const UV_TILE = { Deck: 3.0, BaseWall: 2.0, StoneDark: 1.5, Pad: 1.5, Frame: 1.0, WindowDark: 1.0, WindowLit: 1.0 };
const PAINTED = /(_Pad\d+|Ground)$/; // painted pads and grounds: one picture over the tile, the FBX's own planar mapping

/**
 * UVs for a primitive that has none (three.js convention). Painted pads: the FBX part with the same material's
 * mapping (a plane fitted to its UVs over x, z); everything else: box projection along each vertex's main normal axis.
 */
function generatedUvs(node, p, material, fbx, prefix) {
  const W = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  const pos = p.getAttribute('POSITION');
  const nrm = p.getAttribute('NORMAL');
  const n = pos.getCount();
  const out = new Float32Array(n * 2);
  const v = new THREE.Vector3();
  const nv = new THREE.Vector3();
  const N3 = new THREE.Matrix3().getNormalMatrix(W);
  const el = [];
  if (PAINTED.test(material) && fbx) {
    // Least squares u, v = a x + b z + c over the FBX pad (in this .glb's world: same place, root at the origin).
    let src = null;
    fbx.traverse((o) => o.isMesh && !src && [o.material].flat().some((m) => m.name === material) && o.geometry.attributes.uv && (src = o));
    if (src) {
      const at = new THREE.Vector3().setFromMatrixPosition(fbx.getObjectByName(`${prefix}_HiveCity`).matrixWorld);
      const sp = src.geometry.attributes.position;
      const su = src.geometry.attributes.uv;
      const A = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0).elements;
      const bu = [0, 0, 0];
      const bv = [0, 0, 0];
      for (let i = 0; i < sp.count; i++) {
        v.fromBufferAttribute(sp, i).applyMatrix4(src.matrixWorld).sub(at);
        const r = [v.x, v.z, 1];
        for (let a = 0; a < 3; a++) {
          for (let b = 0; b < 3; b++) A[a * 3 + b] += r[a] * r[b];
          bu[a] += r[a] * su.getX(i);
          bv[a] += r[a] * su.getY(i);
        }
      }
      const Mi = new THREE.Matrix3().set(...A).invert();
      const cu = new THREE.Vector3(...bu).applyMatrix3(Mi);
      const cv = new THREE.Vector3(...bv).applyMatrix3(Mi);
      for (let i = 0; i < n; i++) {
        v.fromArray(pos.getElement(i, el)).applyMatrix4(W);
        out[i * 2] = cu.x * v.x + cu.y * v.z + cu.z;
        out[i * 2 + 1] = cv.x * v.x + cv.y * v.z + cv.z;
      }
      return out;
    }
  }
  const role = material.replace(/^.*_/, '');
  const tile = UV_TILE[role] ?? 1;
  for (let i = 0; i < n; i++) {
    v.fromArray(pos.getElement(i, el)).applyMatrix4(W);
    nv.fromArray(nrm ? nrm.getElement(i, el) : [0, 1, 0]).applyMatrix3(N3);
    const ax = Math.abs(nv.x);
    const ay = Math.abs(nv.y);
    const az = Math.abs(nv.z);
    const [a, b] = ay >= ax && ay >= az ? [v.x, -v.z] : ax >= az ? [v.z * Math.sign(nv.x), v.y] : [-v.x * Math.sign(nv.z), v.y];
    out[i * 2] = a / tile;
    out[i * 2 + 1] = b / tile;
  }
  return out;
}

function graftAnimation(doc, fbx, clips, prefix, yaw, ships = new Set()) {
  const root = doc.getRoot();
  const byName = new Map(root.listNodes().map((n) => [n.getName(), n]));
  const buffer = root.listBuffers()[0];
  // Both worlds are y-up (the FBX root's axis rotation is already in its matrixWorld): only the root's place and
  // the yaw differ. (Its rotation must not be matched: the FBX keeps Blender's -90° X there, the .glb doesn't.)
  const oldAt = new THREE.Vector3().setFromMatrixPosition(fbx.getObjectByName(`${prefix}_HiveCity`).matrixWorld);
  const newAt = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(byName.get(`${prefix}_HiveCity`).getWorldMatrix()));
  const A = new THREE.Matrix4().makeTranslation(newAt).multiply(new THREE.Matrix4().makeRotationY(yaw)).multiply(new THREE.Matrix4().makeTranslation(oldAt.negate()));
  const tracks = new Map(); // node name -> { position, quaternion, scale }
  for (const clip of clips) {
    for (const t of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(t.name);
      if (!tracks.has(nodeName)) tracks.set(nodeName, {});
      tracks.get(nodeName)[propertyName] = t;
    }
  }
  const M = new THREE.Matrix4();
  const P = new THREE.Vector3();
  const Q = new THREE.Quaternion();
  const S = new THREE.Vector3();
  const missing = [];

  // 1. Every key as a world transform in the .glb's world.
  const parts = [];
  for (const [name, tr] of tracks) {
    const old = fbx.getObjectByName(name);
    const node = byName.get(name);
    if (!old || !node) {
      missing.push(name);
      continue;
    }
    const parent = node.getParentNode();
    const Pw = parent ? new THREE.Matrix4().fromArray(parent.getWorldMatrix()) : new THREE.Matrix4();
    const W = A.clone().multiply(old.parent.matrixWorld);
    const times = [...new Set(Object.values(tr).flatMap((t) => [...t.times]))].sort((a, b) => a - b);
    const sample = (prop, fallback) => {
      const t = tr[prop];
      if (!t) return () => fallback.toArray();
      const it = t.createInterpolant();
      return (time) => [...it.evaluate(time)];
    };
    const pos = sample('position', old.position);
    const rot = sample('quaternion', old.quaternion);
    const scl = sample('scale', old.scale);
    const basis = ships.has(node) ? new THREE.Matrix4() : BASIS; // ships: back in the FBX's own axes (shipsToBlenderAxes)
    const keys = times.map((time) => M.compose(P.fromArray(pos(time)), Q.fromArray(rot(time)), S.fromArray(scl(time))).clone().premultiply(W).multiply(basis));
    const here = new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(node.getWorldMatrix()));
    const offset = here.clone().sub(new THREE.Vector3().setFromMatrixPosition(keys[0]));
    parts.push({ name, node, Pw, times, keys, here, offset, group: name.replace(/_\d+$/, '') });
  }

  // 2. Moved groups: the median offset of their parts.
  const groups = new Map();
  for (const p of parts) (groups.get(p.group) ?? groups.set(p.group, []).get(p.group)).push(p.offset);
  const median = (vs, k) => vs.map((v) => v.getComponent(k)).sort((a, b) => a - b)[vs.length >> 1];
  const shift = new Map();
  const moved = [];
  for (const [g, vs] of groups) {
    const d = new THREE.Vector3(median(vs, 0), median(vs, 1), median(vs, 2));
    if (d.length() > 0.05) {
      shift.set(g, d);
      moved.push(`${g.replace(`${prefix}_`, '')} ${d.length().toFixed(2)} m`);
    }
  }

  // 3. Channels, in each part's .glb parent frame.
  const anim = doc.createAnimation(clips[0]?.name || 'Take');
  let channels = 0;
  let gap = 0;
  let gapNode = '';
  let turn = 0;
  for (const { name, node, Pw, times, keys, here, group } of parts) {
    const d = shift.get(group);
    const toLocal = Pw.clone().invert();
    const out = { translation: [], rotation: [], scale: [] };
    let prev = null;
    let near = Infinity;
    keys.forEach((K, i) => {
      if (d) K.premultiply(new THREE.Matrix4().makeTranslation(d));
      near = Math.min(near, here.distanceTo(new THREE.Vector3().setFromMatrixPosition(K)));
      K.premultiply(toLocal).decompose(P, Q, S);
      if (prev && prev.dot(Q) < 0) Q.set(-Q.x, -Q.y, -Q.z, -Q.w); // no flips between keys
      prev = Q.clone();
      if (i === 0) turn = Math.max(turn, Q.angleTo(new THREE.Quaternion(...node.getRotation()))); // spinning parts: one frame's turn
      out.translation.push(...P.toArray());
      out.rotation.push(...Q.toArray());
      out.scale.push(...S.toArray());
    });
    if (near > gap) (gap = near), (gapNode = name);
    let input = null;
    for (const [pathName, values] of Object.entries(out)) {
      const n = pathName === 'rotation' ? 4 : 3;
      const moves = values.some((v, i) => Math.abs(v - values[i % n]) > 1e-5);
      if (!moves) {
        node[{ translation: 'setTranslation', rotation: 'setRotation', scale: 'setScale' }[pathName]](values.slice(0, n));
        continue;
      }
      input ??= doc.createAccessor().setType('SCALAR').setArray(new Float32Array(times)).setBuffer(buffer);
      const output = doc.createAccessor().setType(n === 4 ? 'VEC4' : 'VEC3').setArray(new Float32Array(values)).setBuffer(buffer);
      const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
      anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath(pathName).setSampler(sampler));
      channels++;
    }
  }
  if (!channels) anim.dispose();
  return { channels, gap, gapNode, turn: (turn * 180) / Math.PI, moved, missing };
}

async function convertHex(file, src) {
  const prefix = HEX[file];
  // The animation, from the FBX (read exactly as convert() reads it).
  const buf = fs.readFileSync(path.join(SRC, file));
  const fbx = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  await new Promise((r) => setTimeout(r, 0));
  fbx.updateMatrixWorld(true);
  const clips = fbx.animations.map((c) => movingTracksOnly(c, new Set())).filter((c) => c.tracks.length);

  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.read(src);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  // Materials -> descriptions in extras; the images go to the shared WebP set.
  const textured = new Set();
  for (const m of root.listMaterials()) {
    if (m.getBaseColorTexture()) textured.add(m);
    const spec = describeGltf(m, file);
    m.setName(spec.name).setExtras({ spec });
    m.setBaseColorTexture(null).setNormalTexture(null).setEmissiveTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null);
  }
  for (const t of root.listTextures()) t.dispose();

  // Only the attributes the game reads; UVs flipped to three.js's convention (the game's textures keep flipY).
  // Textured parts exported without UVs get some (generatedUvs): the game's sand needs none (world-space desert).
  const flipped = new Set();
  const buffer = root.listBuffers()[0];
  let generated = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const p of mesh.listPrimitives()) {
      for (const sem of p.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(sem)) p.setAttribute(sem, null);
      for (const t of p.listTargets()) t.dispose();
      const uv = p.getAttribute('TEXCOORD_0');
      if (!uv) {
        const m = p.getMaterial();
        if (m && textured.has(m) && !/(_Sand|SandTrim)$/.test(m.getName())) {
          const made = generatedUvs(node, p, plainName(m.getName()), fbx, prefix);
          p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(made).setBuffer(buffer));
          flipped.add(p.getAttribute('TEXCOORD_0')); // already in three.js's convention
          generated++;
        }
        continue;
      }
      if (flipped.has(uv)) continue;
      flipped.add(uv);
      const el = [];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, el);
        el[1] = 1 - el[1];
        uv.setElement(i, el);
      }
    }
  }
  const ships = shipsToBlenderAxes(root);

  // Turn every top-level part HEX_YAW about the origin, under one root (the game's model root).
  const wrap = doc.createNode(`${prefix}_Hex`);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), HEX_YAW);
  for (const n of scene.listChildren()) {
    n.setTranslation(new THREE.Vector3(...n.getTranslation()).applyQuaternion(qy).toArray());
    n.setRotation(qy.clone().multiply(new THREE.Quaternion(...n.getRotation())).toArray());
    scene.removeChild(n);
    wrap.addChild(n);
  }
  scene.addChild(wrap);

  const anim = clips.length ? graftAnimation(doc, fbx, clips, prefix, HEX_YAW, ships) : { channels: 0, gap: 0, missing: [] };
  for (const n of root.listNodes()) n.setExtras({ n: n.getName() }); // see convert(): node names survive GLTFLoader

  // keepAttributes: the textures left for the game's shared images, so prune would think the UVs unused.
  await doc.transform(prune({ keepAttributes: true, keepLeaves: true }), dedup(), weld());
  const out = await io.writeBinary(doc);
  const name = file.replace(/\.fbx$/i, '.glb');
  fs.writeFileSync(path.join(OUT_GLB, name), out);
  const note = `hex ${prefix}.glb, gap ${anim.gap.toFixed(3)} ${anim.gapNode ?? ''}, first-key turn ${(anim.turn ?? 0).toFixed(1)}°${generated ? `, ${generated} parts given UVs` : ''}${anim.moved?.length ? `, moved: ${anim.moved.join(', ')}` : ''}${anim.missing.length ? `, ${anim.missing.length} animated parts missing: ${anim.missing.slice(0, 4).join(' ')}` : ''}`;
  return { name, bytes: out.byteLength, dust: 0, tracks: anim.channels, note };
}

/** A .glb-only model (GLB_ONLY): convertHex without the FBX; its own animation, trimmed to the channels that move. */
async function convertGlbOnly(file) {
  const prefix = GLB_ONLY[file];
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.read(path.join(HEX_SRC, file));
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];

  const textured = new Set();
  for (const m of root.listMaterials()) {
    if (m.getBaseColorTexture()) textured.add(m);
    const spec = describeGltf(m, file);
    m.setName(spec.name).setExtras({ spec });
    m.setBaseColorTexture(null).setNormalTexture(null).setEmissiveTexture(null).setMetallicRoughnessTexture(null).setOcclusionTexture(null);
  }
  for (const t of root.listTextures()) t.dispose();

  const flipped = new Set();
  const buffer = root.listBuffers()[0];
  let generated = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const p of mesh.listPrimitives()) {
      for (const sem of p.listSemantics()) if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(sem)) p.setAttribute(sem, null);
      for (const t of p.listTargets()) t.dispose();
      const uv = p.getAttribute('TEXCOORD_0');
      if (!uv) {
        const m = p.getMaterial();
        if (m && textured.has(m) && !/(_Sand|SandTrim)$/.test(m.getName())) {
          p.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(generatedUvs(node, p, plainName(m.getName()), null, prefix)).setBuffer(buffer));
          flipped.add(p.getAttribute('TEXCOORD_0'));
          generated++;
        }
        continue;
      }
      if (flipped.has(uv)) continue;
      flipped.add(uv);
      const el = [];
      for (let i = 0; i < uv.getCount(); i++) {
        uv.getElement(i, el);
        el[1] = 1 - el[1];
        uv.setElement(i, el);
      }
    }
  }

  // Animation channels that never move just set the node's pose (Blender bakes a key on every animated object).
  let channels = 0;
  let still = 0;
  const pathSetter = { translation: 'setTranslation', rotation: 'setRotation', scale: 'setScale' };
  for (const anim of root.listAnimations()) {
    for (const ch of anim.listChannels()) {
      const values = ch.getSampler().getOutput().getArray();
      const n = ch.getTargetPath() === 'rotation' ? 4 : 3;
      const node = ch.getTargetNode();
      const moves = values.some((v, i) => Math.abs(v - values[i % n]) > 1e-5);
      if (!moves && node && pathSetter[ch.getTargetPath()]) {
        node[pathSetter[ch.getTargetPath()]]([...values.slice(0, n)]);
        ch.dispose();
        still++;
      } else channels++;
    }
    if (!anim.listChannels().length) anim.dispose();
  }

  // Turn every top-level part HEX_YAW about the origin, under one root (the game's model root). Top-level parts must
  // not be animated themselves (their keys would undo the turn): their children carry the motion.
  const animated = new Set(root.listAnimations().flatMap((a) => a.listChannels().map((c) => c.getTargetNode())));
  const wrap = doc.createNode(`${prefix}_Hex`);
  const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), HEX_YAW);
  for (const n of scene.listChildren()) {
    if (animated.has(n)) throw new Error(`${file}: top-level part ${n.getName()} is animated`);
    n.setTranslation(new THREE.Vector3(...n.getTranslation()).applyQuaternion(qy).toArray());
    n.setRotation(qy.clone().multiply(new THREE.Quaternion(...n.getRotation())).toArray());
    scene.removeChild(n);
    wrap.addChild(n);
  }
  scene.addChild(wrap);
  for (const n of root.listNodes()) n.setExtras({ n: n.getName() });

  await doc.transform(prune({ keepAttributes: true, keepLeaves: true }), dedup(), weld());
  const out = await io.writeBinary(doc);
  fs.writeFileSync(path.join(OUT_GLB, file), out);
  const note = `glb only, own animation (${still} still channels dropped)${generated ? `, ${generated} parts given UVs` : ''}`;
  return { name: file, bytes: out.byteLength, dust: 0, tracks: channels, note };
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
  const hex = HEX[f] && path.join(HEX_SRC, `${HEX[f]}.glb`);
  const r = hex && fs.existsSync(hex) ? await convertHex(f, hex) : await convert(f);
  glbBytes += r.bytes;
  console.log(`${f.padEnd(26)} -> ${r.name.padEnd(26)} ${(r.bytes / 1e6).toFixed(2).padStart(6)} MB  ${r.tracks} tracks${r.dust ? `, ${r.dust} dust parts removed` : ''}${r.note ? `  (${r.note})` : ''}`);
}
for (const f of Object.keys(GLB_ONLY)) {
  srcBytes += fs.statSync(path.join(HEX_SRC, f)).size;
  const r = await convertGlbOnly(f);
  glbBytes += r.bytes;
  console.log(`${f.padEnd(26)} -> ${r.name.padEnd(26)} ${(r.bytes / 1e6).toFixed(2).padStart(6)} MB  ${r.tracks} tracks  (${r.note})`);
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
