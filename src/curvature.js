/**
 * A small-planet look: the world is drawn bent over a sphere around the point the camera looks at, so the ground
 * falls away toward the horizon as you pan and zoom. Only the drawing bends: positions, sizes and the board stay
 * flat in the game (each point drops by distance² / 2R, measured flat from the camera's target).
 *
 * Every material gets it: Material's onBeforeCompile is wrapped once, for all materials (now and later), to end its
 * vertex shader with one step that drops the final position. Shadow-map materials stay flat (they draw from the
 * light, and the flat shadows then land in the right place on the bent world). Things that place HTML over the 3D
 * view (labels, icons) go through Vector3.project, which bends the same way, and picking cells under the pointer
 * goes through intersectGround().
 *
 * Materials with userData.horizon (the "?" sites' light shafts) also fade out once their spot goes over the horizon
 * (where the bent ground turns away from the camera), so they don't shine up from behind the planet.
 */
import * as THREE from 'three';

export const CURVE = {
  radius: 40, // the planet's radius in cells (0: flat); set from Game Debug → Graphics (graphics.js)
  cullMargin: 1, // world units (one tile) added to every culling bound, so nothing pops at the screen edge
};

const uniforms = {
  uCurveInvProj: { value: new THREE.Matrix4() },
  uCurveT: { value: new THREE.Vector4() }, // the camera's target in view space; w: 1 / 2R (0: flat)
  uCurveU: { value: new THREE.Vector3(0, 1, 0) }, // world up in view space
};
const state = { k: 0, cx: 0, cz: 0, camera: null };

// Back from clip space to view space (the inverse projection, set per frame), drop along world up by the squared
// flat distance from the target, and project again. Works whatever the shader did to get gl_Position.
const GLSL = /* glsl */ `
uniform mat4 uCurveInvProj;
uniform vec4 uCurveT;
uniform vec3 uCurveU;
varying float vCurveFacing; // > 0 while the bent ground under this point faces the camera (this side of the horizon)
vec4 curveClip(vec4 clip) {
  vCurveFacing = 1.0;
  if (uCurveT.w == 0.0) return clip;
  vec4 v = uCurveInvProj * clip;
  vec3 d = v.xyz / v.w - uCurveT.xyz;
  vec3 h = d - dot(d, uCurveU) * uCurveU;
  v.xyz -= uCurveU * (uCurveT.w * dot(h, h) * v.w);
  vCurveFacing = dot(normalize(uCurveU + 2.0 * uCurveT.w * h), normalize(-v.xyz / v.w));
  return projectionMatrix * v;
}
`;

/** Shadow passes draw from the light: they stay flat. Screen-space quads (userData.flat) too. */
const bends = (m) => !m.isMeshDepthMaterial && !m.isMeshDistanceMaterial && !m.userData?.flat;

function bend(material, shader) {
  // Once only: a material whose callback wraps another material's (the idle grey copies) would bend it twice.
  if (!bends(material) || shader.vertexShader.includes('curveClip(')) return;
  Object.assign(shader.uniforms, uniforms);
  const src = shader.vertexShader;
  const end = src.lastIndexOf('}'); // main() is the last function of every vertex shader here
  shader.vertexShader = `${GLSL}${src.slice(0, end)}  gl_Position = curveClip(gl_Position);\n${src.slice(end)}`;
  if (material.userData?.horizon) {
    // Fade out over the horizon (the last thing the fragment shader does).
    const frag = shader.fragmentShader;
    const close = frag.lastIndexOf('}');
    shader.fragmentShader = `varying float vCurveFacing;\n${frag.slice(0, close)}  gl_FragColor *= smoothstep(0.0, 0.12, vCurveFacing);\n${frag.slice(close)}`;
  }
}

// Material.onBeforeCompile becomes an accessor: what a material sets is kept, and three gets a wrapper that runs it,
// then bends the shader. The default cache key (the function's source) keys on what the material set.
const proto = THREE.Material.prototype;
const OWN = Symbol('onBeforeCompile');
const WRAP = Symbol('curveWrap');
Object.defineProperty(proto, 'onBeforeCompile', {
  configurable: true,
  get() {
    const own = this[OWN];
    if (!this[WRAP] || this[WRAP].own !== own) {
      const material = this;
      this[WRAP] = {
        own,
        fn(shader, renderer) {
          own?.call(material, shader, renderer);
          bend(material, shader);
        },
      };
    }
    return this[WRAP].fn;
  },
  set(fn) {
    this[OWN] = fn;
  },
});
proto.customProgramCacheKey = function () {
  // Same as three's default, but on the material's own callback (not the shared wrapper); bent programs apart.
  const own = this.customProgramCacheKey === proto.customProgramCacheKey ? String(this[OWN] ?? '') : '';
  return `${own}|${bends(this) ? 'curve' : 'flat'}${this.userData?.horizon ? '-horizon' : ''}`;
};

const tmp = new THREE.Vector3();
/** Every frame, before rendering: bend around `target` (world, on the ground) as seen by `camera`. */
export function updateCurve(camera, target) {
  const k = CURVE.radius > 0 ? 1 / (2 * CURVE.radius) : 0;
  camera.updateMatrixWorld();
  uniforms.uCurveInvProj.value.copy(camera.projectionMatrixInverse);
  tmp.copy(target).applyMatrix4(camera.matrixWorldInverse);
  uniforms.uCurveT.value.set(tmp.x, tmp.y, tmp.z, k);
  uniforms.uCurveU.value.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
  Object.assign(state, { k, cx: target.x, cz: target.z, camera });
}

/** Turn the bend off for the next renders (views with their own camera, e.g. the War Map globe). */
export function flattenCurve() {
  uniforms.uCurveT.value.w = 0;
  Object.assign(state, { k: 0, camera: null });
}

/** How far the drawing drops a ground point at (x, z). */
export const curveDrop = (x, z) => state.k * ((x - state.cx) ** 2 + (z - state.cz) ** 2);

const bentSphere = new THREE.Sphere();
/**
 * Conservative union of a flat world sphere and its paraboloid-bent image, including the drop across its radius,
 * grown by CURVE.cullMargin.
 */
export function includeCurvedBounds(sphere) {
  if (sphere.isEmpty()) return sphere;
  sphere.radius += CURVE.cullMargin;
  if (!state.k) return sphere;
  bentSphere.copy(sphere);
  const d = Math.hypot(sphere.center.x - state.cx, sphere.center.z - state.cz);
  bentSphere.center.y -= curveDrop(sphere.center.x, sphere.center.z);
  bentSphere.radius += state.k * (2 * d * sphere.radius + sphere.radius ** 2);
  return sphere.union(bentSphere);
}

// Ordinary meshes are culled by three.js on their flat bounds, but drawn bent: one just past the top of the screen
// in the flat world can drop into view and pop in and out as the camera moves. Cull them on the bent bounds too.
const meshSphere = new THREE.Sphere();
THREE.Mesh.prototype.intersectsFrustum = function (frustum) {
  const g = this.geometry;
  if (!g) return true;
  if (this.boundingSphere !== undefined) {
    // Instanced and skinned meshes keep their own bound (as three.js's Frustum.intersectsObject).
    if (this.boundingSphere === null) this.computeBoundingSphere();
    meshSphere.copy(this.boundingSphere);
  } else {
    if (g.boundingSphere === null) g.computeBoundingSphere();
    meshSphere.copy(g.boundingSphere);
  }
  meshSphere.applyMatrix4(this.matrixWorld);
  return frustum.intersectsSphere(includeCurvedBounds(meshSphere));
};

// HTML over the 3D view (labels, icons, the tutorial's hand...) projects world points: bend them the same way.
const project = THREE.Vector3.prototype.project;
THREE.Vector3.prototype.project = function (camera) {
  if (state.k && camera === state.camera) this.y -= curveDrop(this.x, this.z);
  return project.call(this, camera);
};

const flatGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const bentGround = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
/** The flat ground point (y = 0) the ray sees on the bent ground, or null. */
export function intersectGround(ray, out) {
  if (!ray.intersectPlane(flatGround, out)) return null;
  // Settle on where the ray meets the dropped ground: a few steps converge (the drop changes slowly).
  for (let i = 0; i < 5 && state.k; i++) {
    bentGround.constant = curveDrop(out.x, out.z); // the plane y = -drop
    if (!ray.intersectPlane(bentGround, out)) return null;
  }
  out.y = 0;
  return out;
}
