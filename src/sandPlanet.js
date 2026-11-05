/**
 * The main screen's planet (titleScreen.js), painted after a reference ("Sand Planet" by rabieshund): a smooth
 * desert world of pale ochre and yellow-green plains with rust-red and orange basins, dark rust basins, fine cracked detail, swirling white cloud bands, a white haze at the rim and a deep night side.
 *
 * All procedural (3D noise on the sphere, so no seams or poles): the surface, a cloud shell just above it and an
 * atmosphere shell around both. Lit by its own sun direction (from the upper right), it turns slowly.
 */
import * as THREE from 'three';

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT), then fBm, ridged and warped variants.
const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    s += a * snoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
float ridged(vec3 p, int oct) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * (1.0 - abs(snoise(p)));
    p = p * 2.1 + vec3(5.3, 1.1, 7.7);
    a *= 0.5;
  }
  return s;
}
`;

const SURFACE_VERT = /* glsl */ `
varying vec3 vPos;     // on the unit sphere, in the planet's own (turning) frame: where the pattern lives
varying vec3 vNormalW; // world normal
varying vec3 vViewW;   // world direction to the camera
void main() {
  vPos = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - w.xyz);
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform vec3 uSun, uSeaDir;
uniform float uSeed;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vViewW;
${NOISE}

// Land height: the low ground (below 0) is dry, dark rust basins, not water.
float landHeight(vec3 p) {
  vec3 q = p * 1.35 + uSeed;
  vec3 warp = vec3(fbm(q + 3.1, 4), fbm(q + 7.3, 4), fbm(q + 11.9, 4));
  float h = fbm(q + warp * 0.9, 7);
  // The basins gather on one side, with a few scattered hollows elsewhere.
  float side = dot(p, uSeaDir);
  return h + 0.42 - smoothstep(0.25, 0.85, side) * 0.85;
}

void main() {
  vec3 p = normalize(vPos);
  float h = landHeight(p);
  vec3 q = p * 2.2 + uSeed * 1.7;
  float region = fbm(q * 0.6 + vec3(fbm(q * 0.5, 3)), 4) * 0.5 + 0.5 + dot(p, -uSeaDir) * 0.12; // which kind of land
  float grain = fbm(p * 18.0 + uSeed, 5) * 0.5 + 0.5;            // fine mottling
  float cracks = ridged(p * 9.0 + uSeed * 0.3, 5);                // dried river beds and ridges
  vec3 sand = vec3(0.93, 0.74, 0.48);
  vec3 amber = vec3(0.9, 0.6, 0.3);
  vec3 orange = vec3(0.84, 0.46, 0.2);
  vec3 rust = vec3(0.62, 0.27, 0.12);
  vec3 col = mix(sand, amber, smoothstep(0.3, 0.52, region));
  col = mix(col, orange, smoothstep(0.48, 0.64, region));
  col = mix(col, rust, smoothstep(0.62, 0.8, region) * 0.9);
  // Basins: deep red-brown in the hollows, rust toward their rims.
  col = mix(col, vec3(0.55, 0.24, 0.11), smoothstep(0.08, -0.05, h) * 0.8);
  col = mix(col, vec3(0.32, 0.13, 0.07), smoothstep(-0.05, -0.3, h) * 0.85);
  col *= 0.9 + 0.16 * grain;
  col *= 1.0 - smoothstep(0.86, 0.99, cracks) * 0.3;

  col = pow(col, vec3(2.2)); // the palette above is in display (sRGB) values: lighting works in linear
  // Bump from the land relief (cheap: two offset samples along the tangents).
  vec3 n = normalize(vNormalW);
  vec3 t1 = normalize(cross(p, vec3(0.0, 1.0, 0.0)) + 1e-4);
  vec3 t2 = cross(p, t1);
  float e = 0.004;
  float dx = fbm(p * 9.0 + t1 * e * 9.0, 4) - fbm(p * 9.0 - t1 * e * 9.0, 4);
  float dy = fbm(p * 9.0 + t2 * e * 9.0, 4) - fbm(p * 9.0 - t2 * e * 9.0, 4);
  n = normalize(n - (dx * t1 + dy * t2) * 0.55);

  vec3 sun = normalize(uSun);
  float light = smoothstep(-0.12, 0.75, dot(n, sun)); // a soft terminator
  vec3 lit = col * (0.008 + 1.05 * light);
  // Haze toward the rim: warm dusty white on the day side.
  float rim = pow(1.0 - max(dot(normalize(vNormalW), vViewW), 0.0), 2.4);
  lit = mix(lit, vec3(0.95, 0.72, 0.48) * (0.03 + 0.9 * light), rim * 0.6);
  gl_FragColor = vec4(lit, 1.0);
  #include <colorspace_fragment>
}
`;

const CLOUD_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform float uSeed, uTime;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vViewW;
${NOISE}
void main() {
  vec3 p = normalize(vPos);
  // Swirls: warp the domain by a slowly drifting field, then stretch along latitude for the long cloud bands.
  vec3 q = p * vec3(1.6, 7.0, 1.6) + uSeed * 2.3;
  vec3 warp = vec3(fbm(q * 0.7 + uTime * 0.01, 4), fbm(q * 0.7 + 5.2, 4), fbm(q * 0.7 + 9.4 - uTime * 0.008, 4));
  float c = fbm(q + warp * 1.1, 7) * 0.5 + 0.5;
  float wisps = fbm(p * 14.0 + warp * 2.0, 4) * 0.5 + 0.5;
  float a = smoothstep(0.42, 0.75, c) * (0.45 + 0.7 * wisps);
  a = clamp(a, 0.0, 0.92);
  float light = smoothstep(-0.12, 0.75, dot(normalize(vNormalW), normalize(uSun)));
  // Thinner seen edge-on at the rim, so the limb keeps its haze rather than a hard cloud edge.
  float facing = max(dot(normalize(vNormalW), vViewW), 0.0);
  a *= smoothstep(0.0, 0.35, facing);
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.84) * (0.02 + 1.05 * light), a * (0.35 + 0.65 * light));
  #include <colorspace_fragment>
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uSun;
varying vec3 vNormalW;
varying vec3 vViewW;
void main() {
  // Seen from outside through the back faces: brightest just past the limb, fading out.
  float f = pow(1.0 - abs(dot(normalize(vNormalW), vViewW)), 3.0);
  float light = smoothstep(-0.35, 0.6, dot(normalize(vNormalW), normalize(uSun)));
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.45) * f * (0.2 + light) * 1.1, 1.0);
}
`;

// The baked versions of SURFACE_FRAG / CLOUD_FRAG: the same planet, read from cube maps (BAKE_SURFACE /
// BAKE_CLOUDS below) instead of ~75 noise evaluations per pixel every frame.
const BAKED_SURFACE_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform samplerCube uMap; // rgb: the sand colours (display values), a: the bump relief (fbm(p * 9, 4) * 0.5 + 0.5)
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vViewW;
void main() {
  vec3 p = normalize(vPos);
  vec4 tex = texture(uMap, p);
  vec3 col = pow(tex.rgb, vec3(2.2));
  vec3 n = normalize(vNormalW);
  vec3 t1 = normalize(cross(p, vec3(0.0, 1.0, 0.0)) + 1e-4);
  vec3 t2 = cross(p, t1);
  float e = 0.004;
  float dx = (texture(uMap, p + t1 * e).a - texture(uMap, p - t1 * e).a) * 2.0;
  float dy = (texture(uMap, p + t2 * e).a - texture(uMap, p - t2 * e).a) * 2.0;
  n = normalize(n - (dx * t1 + dy * t2) * 0.55);
  float light = smoothstep(-0.12, 0.75, dot(n, normalize(uSun)));
  vec3 lit = col * (0.008 + 1.05 * light);
  float rim = pow(1.0 - max(dot(normalize(vNormalW), vViewW), 0.0), 2.4);
  lit = mix(lit, vec3(0.95, 0.72, 0.48) * (0.03 + 0.9 * light), rim * 0.6);
  gl_FragColor = vec4(lit, 1.0);
  #include <colorspace_fragment>
}
`;

const BAKED_CLOUD_FRAG = /* glsl */ `
uniform vec3 uSun;
uniform samplerCube uClouds; // r: the cloud cover
uniform samplerCube uFlow;   // rgb: a smooth, low-detail noise field that warps where the clouds are read
uniform float uTime;
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vViewW;
vec3 turnY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
// The flow field, drifting over the planet: the cover is read through it, so the shapes swirl and change.
vec3 flowAt(vec3 p, float a) { return texture(uFlow, turnY(p, a)).rgb - 0.5; }
void main() {
  float facing = max(dot(normalize(vNormalW), vViewW), 0.0);
  vec3 p = normalize(vPos);
  // Two phases of the field, each fading in and out in turn, so the warp never just slides one way.
  float t = uTime * 0.02;
  float k = 0.5 + 0.5 * sin(t * 2.0);
  vec3 w = mix(flowAt(p, t), flowAt(p.zxy, -t * 0.8), k);
  float a = texture(uClouds, normalize(p + w * 0.1)).r * smoothstep(0.0, 0.35, facing);
  if (a < 0.003) discard;
  float light = smoothstep(-0.12, 0.75, dot(normalize(vNormalW), normalize(uSun)));
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.84) * (0.02 + 1.05 * light), a * (0.35 + 0.65 * light));
  #include <colorspace_fragment>
}
`;

/**
 * The main screen's planet. With `renderer`, its surface and clouds are baked once into cube maps (cheap to draw);
 * without, the original live procedural shaders.
 */
export function createSandPlanet(radius, { renderer = null, seed = 3.7, sun = new THREE.Vector3(0.62, 0.42, 0.66), sea = new THREE.Vector3(-0.9, -0.2, 0.35) } = {}) {
  const group = new THREE.Group();
  group.name = 'sand planet';
  const shared = {
    uSun: { value: sun.clone().normalize() },
    uSeaDir: { value: sea.clone().normalize() }, // the seas gather on this side (the planet's own frame)
    uSeed: { value: seed },
    uTime: { value: 0 },
  };
  const flat = (m) => ((m.userData.flat = true), m); // its own projection: never the board's map-shape bend
  let surfaceFrag = SURFACE_FRAG;
  let cloudFrag = CLOUD_FRAG;
  if (renderer) {
    shared.uMap = { value: bakeCube(renderer, BAKE_SURFACE, { uSeed: shared.uSeed, uSeaDir: shared.uSeaDir }, 1024) };
    shared.uClouds = { value: bakeCube(renderer, BAKE_CLOUDS, { uSeed: shared.uSeed }, 1024) };
    shared.uFlow = { value: bakeCube(renderer, BAKE_FLOW, { uSeed: shared.uSeed }, 128) };
    surfaceFrag = BAKED_SURFACE_FRAG;
    cloudFrag = BAKED_CLOUD_FRAG;
  }

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 160, 120),
    flat(new THREE.ShaderMaterial({ uniforms: shared, vertexShader: SURFACE_VERT, fragmentShader: surfaceFrag })),
  );
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.012, 160, 120),
    flat(
      new THREE.ShaderMaterial({
        uniforms: shared,
        vertexShader: SURFACE_VERT,
        fragmentShader: cloudFrag,
        transparent: true,
        depthWrite: false,
      }),
    ),
  );
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.045, 96, 64),
    flat(
      new THREE.ShaderMaterial({
        uniforms: shared,
        vertexShader: SURFACE_VERT,
        fragmentShader: ATMO_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  group.add(surface, clouds, atmo);
  group.rotation.z = 0.32; // a tilted axis

  return {
    group,
    update(dt) {
      shared.uTime.value += dt;
      surface.rotation.y += dt * 0.006; // a slow turn
      clouds.rotation.y += dt * 0.0085; // the clouds a little faster than the ground
    },
  };
}

// ---------- the War Map's planet, painted the same way ----------
// The main screen's painting, baked once into cube maps (the very same shader code, so the very same planet), laid on
// the War Map's plane in repeating bands (paint), so the ground is pinned under the hexes and cities and never
// stretched. One sphere reads them, with the hex lines drawn in the same shader (no tiles); the clouds drift on their own.

const BAKE_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Cube face texel -> direction (GL cube map layout: +X, -X, +Y, -Y, +Z, -Z).
const BAKE_CUBE = /* glsl */ `
uniform int uFace;
uniform float uSize;
vec3 cubeDir() {
  vec2 st = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  float s = st.x, t = st.y;
  if (uFace == 0) return normalize(vec3(1.0, -t, -s));
  if (uFace == 1) return normalize(vec3(-1.0, -t, s));
  if (uFace == 2) return normalize(vec3(s, 1.0, t));
  if (uFace == 3) return normalize(vec3(s, -1.0, -t));
  if (uFace == 4) return normalize(vec3(s, -t, 1.0));
  return normalize(vec3(-s, -t, -1.0));
}
`;

// Exactly the main screen's surface colours (SURFACE_FRAG) in rgb, its bump relief in a.
const BAKE_SURFACE = /* glsl */ `
uniform vec3 uSeaDir;
uniform float uSeed;
${BAKE_CUBE}
${NOISE}
float landHeight(vec3 p) {
  vec3 q = p * 1.35 + uSeed;
  vec3 warp = vec3(fbm(q + 3.1, 4), fbm(q + 7.3, 4), fbm(q + 11.9, 4));
  float h = fbm(q + warp * 0.9, 7);
  float side = dot(p, uSeaDir);
  return h + 0.42 - smoothstep(0.25, 0.85, side) * 0.85;
}
void main() {
  vec3 p = cubeDir();
  float h = landHeight(p);
  vec3 q = p * 2.2 + uSeed * 1.7;
  float region = fbm(q * 0.6 + vec3(fbm(q * 0.5, 3)), 4) * 0.5 + 0.5 + dot(p, -uSeaDir) * 0.12;
  float grain = fbm(p * 18.0 + uSeed, 5) * 0.5 + 0.5;
  float cracks = ridged(p * 9.0 + uSeed * 0.3, 5);
  vec3 sand = vec3(0.93, 0.74, 0.48);
  vec3 amber = vec3(0.9, 0.6, 0.3);
  vec3 orange = vec3(0.84, 0.46, 0.2);
  vec3 rust = vec3(0.62, 0.27, 0.12);
  vec3 col = mix(sand, amber, smoothstep(0.3, 0.52, region));
  col = mix(col, orange, smoothstep(0.48, 0.64, region));
  col = mix(col, rust, smoothstep(0.62, 0.8, region) * 0.9);
  col = mix(col, vec3(0.55, 0.24, 0.11), smoothstep(0.08, -0.05, h) * 0.8);
  col = mix(col, vec3(0.32, 0.13, 0.07), smoothstep(-0.05, -0.3, h) * 0.85);
  col *= 0.9 + 0.16 * grain;
  col *= 1.0 - smoothstep(0.86, 0.99, cracks) * 0.3;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(fbm(p * 9.0, 4) * 0.5 + 0.5, 0.0, 1.0));
}
`;

// Exactly the main screen's cloud cover (CLOUD_FRAG, at its start), in r.
const BAKE_CLOUDS = /* glsl */ `
uniform float uSeed;
${BAKE_CUBE}
${NOISE}
void main() {
  vec3 p = cubeDir();
  vec3 q = p * vec3(1.6, 7.0, 1.6) + uSeed * 2.3;
  vec3 warp = vec3(fbm(q * 0.7, 4), fbm(q * 0.7 + 5.2, 4), fbm(q * 0.7 + 9.4, 4));
  float c = fbm(q + warp * 1.1, 7) * 0.5 + 0.5;
  float wisps = fbm(p * 14.0 + warp * 2.0, 4) * 0.5 + 0.5;
  float a = clamp(smoothstep(0.42, 0.75, c) * (0.45 + 0.7 * wisps), 0.0, 0.92);
  gl_FragColor = vec4(a, a, a, 1.0);
}
`;

// The main screen's cloud flow field: three smooth noise values (0..1) to warp the baked cover with.
const BAKE_FLOW = /* glsl */ `
uniform float uSeed;
${BAKE_CUBE}
${NOISE}
void main() {
  vec3 q = cubeDir() * vec3(1.6, 4.0, 1.6) + uSeed * 4.1;
  gl_FragColor = vec4(fbm(q, 3) * 0.5 + 0.5, fbm(q + 5.2, 3) * 0.5 + 0.5, fbm(q + 9.4, 3) * 0.5 + 0.5, 1.0);
}
`;

const PAINTED_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

// A point on the ball back to its place on the plane (the inverse of globeBend), as the War Map's clouds do.
const UNBEND = /* glsl */ `
uniform float uGlobeRadius;
uniform vec2 uGlobeScroll, uGlobePeriod;
vec2 unbendRel(vec3 n) {
  float th = acos(clamp(n.z, -1.0, 1.0));
  float s = sin(th);
  return (s > 1e-4 ? vec2(n.x, -n.y) / s : vec2(0.0)) * th * uGlobeRadius;
}
// The painting on the plane: BANDS rows per period, each a strip round the main screen's planet near its equator
// (so never stretched), each from a different longitude, the neighbours blended across their shared edge. Pinned
// to the plane (the hexes and cities) and repeating with it.
const float BANDS = 6.0;
vec3 bandDir(float lon, float lat, float k) {
  float o = k * 2.39996; // a different longitude for each band
  return vec3(cos(lat) * sin(lon + o), -sin(lat), cos(lat) * cos(lon + o));
}
vec4 paint(samplerCube m, vec2 plane) {
  float lon = plane.x / uGlobePeriod.x * 6.28318530718;
  float yb = plane.y / uGlobePeriod.y * BANDS;
  float k = floor(yb);
  float f = yb - k;
  float span = 6.28318530718 / BANDS; // one band, in radians of the sphere
  // Mip level from the plane's own (smooth) change across the pixel, not the band jump at the edges.
  vec3 gx = vec3(dFdx(plane), 0.0) * (6.28318530718 / uGlobePeriod.x);
  vec3 gy = vec3(dFdy(plane), 0.0) * (6.28318530718 / uGlobePeriod.x);
  vec4 c = textureGrad(m, bandDir(lon, (f - 0.5) * span, mod(k, BANDS)), gx, gy);
  float up = 0.5 * smoothstep(0.65, 1.0, f);
  float down = 0.5 * smoothstep(0.35, 0.0, f);
  if (up > 0.0) c = mix(c, textureGrad(m, bandDir(lon, (f - 1.5) * span, mod(k + 1.0, BANDS)), gx, gy), up);
  if (down > 0.0) c = mix(c, textureGrad(m, bandDir(lon, (f + 0.5) * span, mod(k - 1.0, BANDS)), gx, gy), down);
  return c;
}
vec3 bendRel(vec2 rel) {
  float d = length(rel);
  float th = d / uGlobeRadius;
  vec2 dir = d > 1e-5 ? rel / d : vec2(0.0);
  float s = sin(th);
  return vec3(dir.x * s, -dir.y * s, cos(th)) * uGlobeRadius;
}
`;

const PAINTED_SURFACE = /* glsl */ `
${UNBEND}
uniform samplerCube uMap;
uniform vec3 uSun, uLine;
uniform float uGrid;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vWorld);
  vec2 rel = unbendRel(n);
  vec2 plane = uGlobeScroll + rel;
  vec4 tex = paint(uMap, plane);
  vec3 col = pow(tex.rgb, vec3(2.2));

  // Hex grid lines: the nearest cell centre (rows alternate between two lattices), then the distance to its edge.
  const vec2 S = vec2(1.7320508, 3.0);
  vec2 q = plane + 0.5 * uGlobePeriod;
  vec2 a = mod(q, S) - 0.5 * S;
  vec2 b = mod(q - 0.5 * S, S) - 0.5 * S;
  vec2 g = abs(dot(a, a) < dot(b, b) ? a : b);
  float edge = 0.8660254 - max(g.x, g.x * 0.5 + g.y * 0.8660254);
  float aa = fwidth(edge);
  float w = max(uGrid * 0.43, aa * 0.25);
  col = mix(col, uLine, (1.0 - smoothstep(w, w + aa, edge)) * 0.6);

  // Bump as on the main screen: the relief's slope along the plane's two directions.
  float e = 0.004 * uGlobeRadius;
  float dx = (paint(uMap, plane + vec2(e, 0.0)).a - paint(uMap, plane - vec2(e, 0.0)).a) * 2.0;
  float dy = (paint(uMap, plane + vec2(0.0, e)).a - paint(uMap, plane - vec2(0.0, e)).a) * 2.0;
  vec3 p0 = bendRel(rel);
  vec3 tu = normalize(bendRel(rel + vec2(0.05, 0.0)) - p0);
  vec3 tv = normalize(bendRel(rel + vec2(0.0, 0.05)) - p0);
  vec3 bn = normalize(n - (dx * tu + dy * tv) * 0.55);

  vec3 view = normalize(cameraPosition - vWorld);
  float light = smoothstep(-0.12, 0.75, dot(bn, uSun));
  vec3 lit = col * (0.008 + 1.05 * light);
  float rim = pow(1.0 - max(dot(n, view), 0.0), 2.4);
  lit = mix(lit, vec3(0.95, 0.72, 0.48) * (0.03 + 0.9 * light), rim * 0.6);
  gl_FragColor = vec4(lit, 1.0);
  #include <colorspace_fragment>
}
`;

const PAINTED_CLOUDS = (maxCities) => /* glsl */ `
${UNBEND}
uniform samplerCube uClouds;
uniform float uDrift; // the clouds' own drift along the plane's x
uniform vec3 uSun;
uniform float uOpacity, uClear;
uniform vec2 uCities[${maxCities}];
uniform int uCityCount;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vWorld);
  vec3 view = normalize(cameraPosition - vWorld);
  float facing = dot(n, view);
  if (facing <= 0.0) discard;
  vec2 plane = uGlobeScroll + unbendRel(n);
  float a = paint(uClouds, plane + vec2(uDrift, 0.0)).r;
  // Parted round the cities, so their towers stay in view.
  if (uClear > 0.0) {
    float m = 1e3;
    for (int i = 0; i < ${maxCities}; i++) {
      if (i >= uCityCount) break;
      vec2 d = plane - uCities[i];
      d -= uGlobePeriod * floor(d / uGlobePeriod + 0.5);
      m = min(m, length(d));
    }
    a *= smoothstep(uClear * 0.6, uClear * 1.3, m);
  }
  float light = smoothstep(-0.12, 0.75, dot(n, uSun));
  a *= smoothstep(0.0, 0.35, facing) * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vec3(1.0, 0.93, 0.84) * (0.02 + 1.05 * light), a * (0.35 + 0.65 * light));
  #include <colorspace_fragment>
}
`;

const PAINTED_ATMO = /* glsl */ `
uniform vec3 uSun;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vWorld);
  float f = pow(1.0 - abs(dot(n, normalize(cameraPosition - vWorld))), 3.0);
  float light = smoothstep(-0.35, 0.6, dot(n, uSun));
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.45) * f * (0.2 + light) * 1.1, 1.0);
}
`;

/** Renders a bake shader once into a mipmapped cube map, face by face in strips so no single draw runs long. */
export function bakeCube(renderer, fragmentShader, uniforms, size) {
  const rt = new THREE.WebGLCubeRenderTarget(size, {
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  });
  const face = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uFace: face, uSize: { value: size } },
    vertexShader: BAKE_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  mat.userData.flat = true; // a screen quad: never the board's map-shape bend
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.Camera();
  const prev = renderer.getRenderTarget();
  const strips = 8;
  rt.scissorTest = true;
  for (let f = 0; f < 6; f++) {
    face.value = f;
    for (let i = 0; i < strips; i++) {
      const y0 = Math.floor((i * size) / strips);
      rt.scissor.set(0, y0, size, Math.floor(((i + 1) * size) / strips) - y0);
      renderer.setRenderTarget(rt, f);
      renderer.render(scene, camera);
    }
  }
  rt.scissorTest = false;
  renderer.setRenderTarget(prev);
  mat.dispose();
  quad.geometry.dispose();
  return rt.texture;
}

/**
 * The War Map planet painted exactly like the main screen's (globeView.js, `painted`): `bend` is the globe's bend
 * uniforms (radius, scroll, period), `cities` holds uCities / uCityCount (the cloud clearing round the cities).
 */
export function createPaintedGlobe({ renderer, radius, bend, cities, maxCities, seed = 3.7, sun = new THREE.Vector3(0.62, 0.42, 0.66), sea = new THREE.Vector3(-0.9, -0.2, 0.35) }) {
  const map = bakeCube(renderer, BAKE_SURFACE, { uSeed: { value: seed }, uSeaDir: { value: sea.clone().normalize() } }, 1024);
  const cloudMap = bakeCube(renderer, BAKE_CLOUDS, { uSeed: { value: seed } }, 512);
  const uSun = { value: sun.clone().normalize() };
  const uDrift = { value: 0 };
  const flat = (m) => ((m.userData.flat = true), m);

  const surfaceMat = flat(
    new THREE.ShaderMaterial({
      uniforms: { ...bend, uMap: { value: map }, uSun, uLine: { value: new THREE.Color(0x2b241b).convertSRGBToLinear() }, uGrid: { value: 0.005 } },
      vertexShader: PAINTED_VERT,
      fragmentShader: PAINTED_SURFACE,
    }),
  );
  const cloudMat = flat(
    new THREE.ShaderMaterial({
      uniforms: { ...bend, uClouds: { value: cloudMap }, uDrift, uSun, uOpacity: { value: 1 }, uClear: { value: 0 }, uCities: cities.uCities, uCityCount: cities.uCityCount },
      vertexShader: PAINTED_VERT,
      fragmentShader: PAINTED_CLOUDS(maxCities),
      transparent: true,
      depthWrite: false,
    }),
  );
  const atmoMat = flat(
    new THREE.ShaderMaterial({
      uniforms: { uSun },
      vertexShader: PAINTED_VERT,
      fragmentShader: PAINTED_ATMO,
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const surface = new THREE.Mesh(new THREE.SphereGeometry(radius, 128, 96), surfaceMat);
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.012, 96, 72), cloudMat);
  clouds.renderOrder = 3;
  const atmo = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.045, 64, 48), atmoMat);
  const group = new THREE.Group();
  group.name = 'painted planet';
  group.add(surface, clouds, atmo);

  return {
    group,
    /** Every frame: drift the clouds, live settings. */
    update(dt, { gridLine, cloudsOn, cloudOpacity, cloudClear, cloudSpeed = 1 }) {
      // The clouds drift over the ground (plane units per second), wrapping with the plane.
      uDrift.value = (uDrift.value + dt * 0.013 * radius * cloudSpeed) % bend.uGlobePeriod.value.x;
      surfaceMat.uniforms.uGrid.value = gridLine;
      clouds.visible = cloudsOn;
      cloudMat.uniforms.uOpacity.value = cloudOpacity;
      cloudMat.uniforms.uClear.value = cloudClear;
    },
  };
}
