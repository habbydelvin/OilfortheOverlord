import * as THREE from 'three';

/**
 * Dust kicked up when a tile slams into the ground. Puffs start under the
 * tile's edges, roll outward low along the sand, grow and fade. Sprites come
 * from a fixed pool, so a burst never allocates.
 */

const POOL = 240;
// Sand as it reads on screen under the board lights (the texture itself is darker).
const COLORS = [0xcfae84, 0xbf9b6e, 0xdcc29c];

/** Soft cloudy blob: a few overlapping radial gradients so puffs are not perfect circles. */
function puffTexture() {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const blobs = [
    [0.5, 0.5, 0.42],
    [0.38, 0.44, 0.26],
    [0.63, 0.42, 0.24],
    [0.45, 0.62, 0.25],
    [0.62, 0.6, 0.22],
  ];
  for (const [x, y, r] of blobs) {
    const g = ctx.createRadialGradient(x * size, y * size, 0, x * size, y * size, r * size);
    g.addColorStop(0, 'rgba(255,255,255,0.85)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.4)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const rand = (a, b) => a + Math.random() * (b - a);

export class Dust {
  #free = [];
  #live = [];

  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'dust';
    scene.add(this.group);
    const map = puffTexture();
    for (let i = 0; i < POOL; i++) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, opacity: 0 }),
      );
      sprite.visible = false;
      this.group.add(sprite);
      this.#free.push({ sprite, vel: new THREE.Vector3() });
    }
  }

  /**
   * One impact at cell (x, z). `strength` scales count, spread, and size
   * (1 = a normal tile landing).
   */
  burst(x, z, strength = 1) {
    const count = Math.round(26 * strength);
    const half = 0.47; // just inside the tile footprint
    for (let i = 0; i < count; i++) {
      const p = this.#free.pop();
      if (!p) return;
      // Start on a random point of the footprint's edge and push outward from it.
      const side = Math.floor(Math.random() * 4);
      const along = rand(-half, half);
      const nx = side === 0 ? 1 : side === 1 ? -1 : 0;
      const nz = side === 2 ? 1 : side === 3 ? -1 : 0;
      const sx = nx ? nx * half : along;
      const sz = nz ? nz * half : along;
      // Blend the edge normal with the radial direction, so corners fan out instead of making a cross.
      const dir = new THREE.Vector2(nx + sx * 0.9, nz + sz * 0.9).normalize();
      const speed = rand(1.1, 2.4) * strength;
      // Most puffs hug the ground; about one in four billows up so the cloud reads over the tile's edges.
      const up = Math.random() < 0.25 ? rand(0.9, 1.5) : rand(0.25, 0.7);
      p.vel.set(dir.x * speed, up, dir.y * speed);
      p.sprite.position.set(x + sx, rand(0.02, 0.08), z + sz);
      p.size0 = rand(0.2, 0.34) * (0.7 + 0.3 * strength);
      p.grow = rand(2.4, 3.4);
      p.life = rand(0.6, 1.05);
      p.age = 0;
      p.peak = rand(0.75, 0.95);
      p.spin = rand(-1.5, 1.5);
      const m = p.sprite.material;
      m.color.setHex(COLORS[i % COLORS.length]);
      m.rotation = rand(0, Math.PI * 2);
      m.opacity = 0;
      p.sprite.scale.setScalar(p.size0);
      p.sprite.visible = true;
      this.#live.push(p);
    }
  }

  update(dt) {
    // Drag that lets the puffs shoot out fast and then hang in the air.
    const drag = Math.exp(-5.5 * dt);
    const lift = Math.exp(-3 * dt);
    for (let i = this.#live.length - 1; i >= 0; i--) {
      const p = this.#live[i];
      p.age += dt;
      const t = p.age / p.life;
      if (t >= 1) {
        p.sprite.visible = false;
        this.#live.splice(i, 1);
        this.#free.push(p);
        continue;
      }
      p.vel.x *= drag;
      p.vel.z *= drag;
      p.vel.y *= lift;
      p.sprite.position.addScaledVector(p.vel, dt);
      // Grow fast at first, then slow (ease-out).
      const g = 1 - (1 - t) * (1 - t);
      p.sprite.scale.setScalar(p.size0 * (1 + (p.grow - 1) * g));
      const m = p.sprite.material;
      m.rotation += p.spin * dt;
      // Pop in over the first few frames, then fade out.
      m.opacity = p.peak * Math.min(1, p.age / 0.05) * Math.pow(1 - t, 1.6);
    }
  }

  clear() {
    for (const p of this.#live) {
      p.sprite.visible = false;
      this.#free.push(p);
    }
    this.#live.length = 0;
  }
}
