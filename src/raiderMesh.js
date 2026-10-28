import * as THREE from 'three';

/**
 * Procedural mockup for the Raider Camp until a real model exists:
 * scorched ground, a few ragged tents, a spiked palisade and a glowing campfire.
 * Sits on top of the regular soil block (top surface at y = 0).
 */
const mats = {
  ground: new THREE.MeshStandardMaterial({ color: 0x6b4a36, roughness: 1 }),
  tentA: new THREE.MeshStandardMaterial({ color: 0x8c2f22, roughness: 0.9, flatShading: true }),
  tentB: new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.9, flatShading: true }),
  wood: new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1, flatShading: true }),
  rust: new THREE.MeshStandardMaterial({ color: 0x7a4b2a, roughness: 0.7, metalness: 0.4, flatShading: true }),
  fire: new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 1.6 }),
  stone: new THREE.MeshStandardMaterial({ color: 0x4a4440, roughness: 1, flatShading: true }),
};

const shadow = (m) => {
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
};

const tintMats = new Map();
/** Tent/banner material in a camp type's colour (shared per colour). */
function tinted(color) {
  if (color == null) return mats.tentA;
  if (!tintMats.has(color)) tintMats.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true }));
  return tintMats.get(color);
}

/** `tent`: optional colour for the main tent and banner, so each bandit camp type reads differently. */
export function buildRaiderCamp(soilGeo, soilMat, tent) {
  const g = new THREE.Group();
  const tentMat = tinted(tent);
  g.add(shadow(new THREE.Mesh(soilGeo, soilMat)));

  const ground = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.97, 0.12, 0.97), mats.ground));
  ground.position.y = -0.06;
  g.add(ground);

  // Tents: low square pyramids, slightly tilted.
  const tents = [
    [-0.22, -0.2, 0.2, tentMat, 0.3],
    [0.24, -0.16, 0.16, mats.tentB, -0.4],
    [-0.18, 0.24, 0.15, mats.tentB, 0.9],
  ];
  for (const [x, z, r, mat, yaw] of tents) {
    const tent = shadow(new THREE.Mesh(new THREE.ConeGeometry(r, r * 1.5, 4), mat));
    tent.position.set(x, (r * 1.5) / 2, z);
    tent.rotation.set(0.06, yaw, -0.05);
    g.add(tent);
  }

  // Campfire: stone ring with a glowing core.
  const fx = 0.16;
  const fz = 0.18;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = shadow(new THREE.Mesh(new THREE.DodecahedronGeometry(0.03), mats.stone));
    s.position.set(fx + Math.cos(a) * 0.07, 0.02, fz + Math.sin(a) * 0.07);
    g.add(s);
  }
  const fire = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.11, 5), mats.fire);
  fire.position.set(fx, 0.055, fz);
  g.add(fire);
  const glow = new THREE.PointLight(0xff6a1a, 0.6, 1.2, 2);
  glow.position.set(fx, 0.15, fz);
  g.add(glow);

  // Spiked palisade along two edges, with a rusty scrap sheet.
  for (let i = 0; i < 7; i++) {
    const h = 0.16 + ((i * 37) % 5) * 0.015;
    const stake = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.025, h, 4), mats.wood));
    stake.position.set(-0.42 + i * 0.14, h / 2, 0.44);
    stake.rotation.z = ((i % 3) - 1) * 0.12;
    g.add(stake);
    const side = stake.clone();
    side.position.set(0.44, h / 2, -0.42 + i * 0.12);
    g.add(side);
  }
  const sheet = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.015), mats.rust));
  sheet.position.set(0.05, 0.06, -0.4);
  sheet.rotation.set(-0.15, 0.2, 0.05);
  g.add(sheet);

  // Banner pole with a red rag.
  const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.36), mats.wood));
  pole.position.set(0.3, 0.18, 0.26);
  g.add(pole);
  const rag = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.005), tentMat));
  rag.position.set(0.35, 0.32, 0.26);
  g.add(rag);

  return g;
}
