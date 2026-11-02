import * as THREE from 'three';

/**
 * The planet trick (globe-plan.md): every globe mesh lives on one flat, endlessly repeating plane (XZ, y = height)
 * and the vertex shader bends that plane into a ball. Nothing on the plane is ever moved to spin the planet; only
 * the scroll uniform changes.
 *
 * Bend: an azimuthal-equidistant wrap around the view centre. A plane point at offset (u, v) from the scroll lies on
 * the sphere at arc length |(u, v)| from the point facing the camera, in the same direction. The sphere's centre is
 * the world origin and the camera looks down -Z, so plane +u is screen right and plane +v is screen down.
 *
 * Wrap: each object (or instance) is shifted by whole periods so that its anchor sits within half a period of the
 * scroll. Whole tiles move together, so nothing tears at the seam, and no clones are needed. With the period equal to
 * the circumference, everything past the limb lands on the far side of the ball, behind the opaque core.
 */
export function createGlobeBend({ radius, period }) {
  const uniforms = {
    uGlobeRadius: { value: radius },
    uGlobeScroll: { value: new THREE.Vector2() },
    uGlobePeriod: { value: period.clone() },
  };

  const COMMON = /* glsl */ `
#include <common>
uniform float uGlobeRadius;
uniform vec2 uGlobeScroll;
uniform vec2 uGlobePeriod;
vec2 globeRel(vec2 p, vec2 anchor) {
  vec2 a = anchor - uGlobeScroll;
  vec2 w = mod(a + 0.5 * uGlobePeriod, uGlobePeriod) - 0.5 * uGlobePeriod;
  return p - uGlobeScroll + (w - a);
}
vec3 globeBend(vec2 rel, float h) {
  float d = length(rel);
  float th = d / uGlobeRadius;
  vec2 dir = d > 1e-5 ? rel / d : vec2(0.0);
  float r = uGlobeRadius + h;
  float s = sin(th);
  return vec3(dir.x * s * r, -dir.y * s * r, cos(th) * r);
}
`;

  // Runs before begin_vertex: plane position, anchor, and the bent tangent frame for the normal.
  const NORMAL = /* glsl */ `
mat4 globeModel = modelMatrix;
#ifdef USE_INSTANCING
  globeModel = modelMatrix * instanceMatrix;
#endif
vec3 globePlane = (globeModel * vec4(position, 1.0)).xyz;
vec2 globeAnchor = (globeModel * vec4(0.0, 0.0, 0.0, 1.0)).xz;
vec2 globeR = globeRel(globePlane.xz, globeAnchor);
vec3 globeP0 = globeBend(globeR, 0.0);
vec3 globeTu = normalize(globeBend(globeR + vec2(0.02, 0.0), 0.0) - globeP0);
vec3 globeTv = normalize(globeBend(globeR + vec2(0.0, 0.02), 0.0) - globeP0);
vec3 globeUp = normalize(globeP0);
vec3 globeN = normalize(mat3(globeModel) * objectNormal);
vec3 transformedNormal = normalize(mat3(viewMatrix) * (globeN.x * globeTu + globeN.y * globeUp + globeN.z * globeTv));
`;

  // Self-contained (Basic materials skip the normal chunks).
  const PROJECT = /* glsl */ `
mat4 globeM = modelMatrix;
#ifdef USE_INSTANCING
  globeM = modelMatrix * instanceMatrix;
#endif
vec3 globePos = (globeM * vec4(transformed, 1.0)).xyz;
vec3 globeWorld = globeBend(globeRel(globePos.xz, (globeM * vec4(0.0, 0.0, 0.0, 1.0)).xz), globePos.y);
vec4 mvPosition = viewMatrix * vec4(globeWorld, 1.0);
gl_Position = projectionMatrix * mvPosition;
`;

  /** Patch a built-in lit material (Standard / Lambert / Basic) so it runs the bend. Every globe mesh must use this. */
  function patch(material) {
    material.userData.flat = true; // the board's map-shape bend (curvature.js) never applies on the globe
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', COMMON)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + NORMAL)
        .replace('#include <defaultnormal_vertex>', '')
        .replace('#include <project_vertex>', PROJECT);
    };
    material.customProgramCacheKey = () => 'globe-bend';
    material.needsUpdate = true;
    return material;
  }

  const period2 = () => uniforms.uGlobePeriod.value;
  const scroll = () => uniforms.uGlobeScroll.value;

  /** Shortest periodic offset of a plane point from `from` (defaults to the scroll). */
  function wrapDelta(x, z, from = scroll(), out = new THREE.Vector2()) {
    const p = period2();
    const wrap = (a, n) => a - n * Math.floor(a / n + 0.5);
    return out.set(wrap(x - from.x, p.x), wrap(z - from.y, p.y));
  }

  /** JS twin of globeBend(): plane offset from the scroll (+ height) to a world point. */
  function bend(u, v, h = 0, out = new THREE.Vector3()) {
    const d = Math.hypot(u, v);
    const th = d / uniforms.uGlobeRadius.value;
    const r = uniforms.uGlobeRadius.value + h;
    const s = Math.sin(th);
    const dx = d > 1e-5 ? u / d : 0;
    const dz = d > 1e-5 ? v / d : 0;
    return out.set(dx * s * r, -dz * s * r, Math.cos(th) * r);
  }

  /** World point of an anchored plane position (x, z), wrapped to the copy nearest the view. */
  function project(x, z, h = 0, out = new THREE.Vector3()) {
    const rel = wrapDelta(x, z);
    return bend(rel.x, rel.y, h, out);
  }

  /** Inverse bend: a point on (or near) the sphere back to an absolute plane position. */
  function unbend(point, out = new THREE.Vector2()) {
    const n = point.clone().normalize();
    const th = Math.acos(THREE.MathUtils.clamp(n.z, -1, 1));
    const s = Math.sin(th);
    const arc = th * uniforms.uGlobeRadius.value;
    if (s < 1e-5) return out.copy(scroll());
    return out.set(scroll().x + (n.x / s) * arc, scroll().y + (-n.y / s) * arc);
  }

  // glsl: the bend functions (globeRel, globeBend) plus their uniforms, for custom ShaderMaterials.
  return { uniforms, glsl: COMMON, patch, wrapDelta, bend, project, unbend, scroll, period: period2 };
}
