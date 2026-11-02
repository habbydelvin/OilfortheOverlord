/**
 * The CRT as a real post-process (Game Debug → Graphics → CRT screen: Shader). The scene is drawn into an off-screen
 * image, then one full-screen pass draws it the way a picture tube would, after the libretro CRT shaders (crt-geom,
 * Guest Advanced): a gentle barrel bend of the picture, colour fringes growing toward the edges, a glow around bright
 * parts (blurred at quarter size), scanlines whose beam gets thicker where it's bright, a slot mask, then tone mapping,
 * contrast, darker edges, grain, a faint rolling band and flicker. The dirt, glare and bezel stay as cheap HTML
 * layers over it (crt.js); the in-world HTML (map icons, payout numbers) is placed through the same bend.
 *
 * The scene goes into its image exactly as it would onto the screen (tone mapped, in display colours: the target is
 * flagged like a VR one, which three.js treats as the final output), so every effect keeps its look, the fog overlay
 * included. The pass works in linear light for the beam, mask and glow, and writes display colours straight out.
 *
 * Cost: the scene pass into a multisampled 8-bit image (it was multisampled on screen before), three small passes at
 * a quarter of the size for the glow, and one full-screen pass of five texture reads.
 */
import * as THREE from 'three';

export const CRT_DEFAULTS = {
  bloom: 0.3, // glow around bright parts (0: off, skips its passes)
  curve: 0.05, // barrel bend of the picture
  mask: 0.35, // slot mask strength
  maskSize: 3, // mask triad width, CSS px
  lineSize: 3, // scanline pitch, CSS px
  contrast: 1.6,
  fringe: 1, // colour fringe at the edges, px
};

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

// Downsample (4 taps) and keep only what's bright.
const BRIGHT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, -1.0)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tSrc, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  c *= 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * smoothstep(0.72, 0.97, l), 1.0); // only real highlights (lit windows, glows, blasts)
}`;

// 9-tap Gaussian in 5 bilinear reads, along uDir.
const BLUR_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const CRT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform sampler2D tBloom;
uniform vec4 uRect;     // the glass, in screen uv: x0, y0, x1, y1
uniform vec2 uRes;      // drawing buffer, px
uniform float uLines;   // scanlines over the glass's height
uniform float uMaskPx;  // mask triad width, px
uniform float uMask;
uniform float uCurve;
uniform float uBloom;
uniform float uContrast;
uniform float uFringe;  // px at the edges
uniform float uTime;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 centre = (uRect.xy + uRect.zw) * 0.5;
  vec2 hs = (uRect.zw - uRect.xy) * 0.5;
  vec2 p = (vUv - centre) / hs; // -1..1 across the glass
  if (abs(p.x) > 1.0 || abs(p.y) > 1.0) {
    gl_FragColor = texture2D(tSrc, vUv); // outside the glass (under the side panel): as is
    return;
  }
  // Barrel bend: the tube's picture bows out; past its edge the corners are black.
  float r2 = dot(p, p);
  vec2 q = p * (1.0 + uCurve * r2);
  if (abs(q.x) > 1.0 || abs(q.y) > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 uv = centre + q * hs;

  // Convergence: red and blue drift apart toward the edges.
  float off = uFringe * (0.35 + r2) / uRes.x;
  vec3 col = vec3(texture2D(tSrc, uv + vec2(off, 0.0)).r, texture2D(tSrc, uv).g, texture2D(tSrc, uv - vec2(off, 0.0)).b);
  col = pow(col + texture2D(tBloom, uv).rgb * uBloom, vec3(2.2)); // to linear light for the beam and the mask

  // The beam: a Gaussian across each scanline, wider where the picture is bright (bright lines merge, dark ones part).
  float line = (uv.y - uRect.y) / (uRect.w - uRect.y) * uLines;
  float f = fract(line) - 0.5;
  float l = clamp(dot(col, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  float sigma = mix(0.2, 0.5, sqrt(l));
  // Divided by the beam's average across a line, so the picture keeps its brightness (only its texture changes).
  float mean = sigma * 2.5066 * tanh(1.202 * 0.5 / (sigma * 1.4142));
  col *= exp(-0.5 * f * f / (sigma * sigma)) / mean;

  // Slot mask: red / green / blue columns, every other column shifted half a slot, with dark gaps between slots.
  float cell = floor(gl_FragCoord.x / uMaskPx);
  float sub = floor(fract(gl_FragCoord.x / uMaskPx) * 3.0);
  vec3 tri = vec3(float(sub == 0.0), float(sub == 1.0), float(sub == 2.0));
  float slotY = fract((gl_FragCoord.y + mod(cell, 2.0) * uMaskPx * 1.5) / (uMaskPx * 3.0));
  float gap = smoothstep(0.0, 0.12, slotY) * smoothstep(1.0, 0.88, slotY);
  vec3 mask = mix(vec3(1.0), (0.35 + 0.65 * tri) * mix(0.55, 1.0, gap), uMask);
  col *= mask / (1.0 - uMask * 0.473); // the mask's average light loss, given back exactly

  // Back to display colours: contrast, darker edges, grain, a faint rolling band and the odd flicker.
  vec3 c = (pow(col, vec3(1.0 / 2.2)) - 0.5) * uContrast + 0.5;
  c *= mix(0.42, 1.0, smoothstep(1.35, 0.5, length(q * vec2(1.0, 1.08))));
  c += (hash(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * 0.045;
  float band = fract(0.5 - (uv.y - uRect.y) / (uRect.w - uRect.y) - uTime * 0.085);
  c *= 1.0 + 0.035 * exp(-pow((band - 0.5) * 9.0, 2.0));
  c *= 1.0 - 0.02 * step(0.965, hash(vec2(floor(uTime * 24.0), 3.7)));
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

const flatMaterial = (fragmentShader, uniforms) => {
  const m = new THREE.ShaderMaterial({ vertexShader: QUAD_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
  m.userData.flat = true; // a screen-space pass: not bent by the small-planet look (curvature.js)
  return m;
};

export class CrtPass {
  enabled = false;
  cfg = { ...CRT_DEFAULTS };
  #size = new THREE.Vector2();
  #rect = new THREE.Vector4(0, 0, 1, 1);

  /** `glass`: the element marking the screen's area (#crt). */
  constructor(renderer, glass) {
    this.renderer = renderer;
    this.glass = glass;
    // The scene as it would look on screen: three.js tone maps and encodes to sRGB for "VR" targets (isXRRenderTarget),
    // and the plain RGBA8 storage keeps the GPU from encoding it a second time.
    this.target = new THREE.WebGLRenderTarget(1, 1, { samples: 4 });
    this.target.isXRRenderTarget = true;
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.target.texture.internalFormat = 'RGBA8';
    this.bloomA = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.bloomB = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.bright = flatMaterial(BRIGHT_FRAG, { tSrc: { value: this.target.texture }, uTexel: { value: new THREE.Vector2() } });
    this.blur = flatMaterial(BLUR_FRAG, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.crt = flatMaterial(CRT_FRAG, {
      tSrc: { value: this.target.texture },
      tBloom: { value: this.bloomA.texture },
      uRect: { value: this.#rect },
      uRes: { value: new THREE.Vector2() },
      uLines: { value: 200 },
      uMaskPx: { value: 3 },
      uMask: { value: 0 },
      uCurve: { value: 0 },
      uBloom: { value: 0 },
      uContrast: { value: 1 },
      uFringe: { value: 0 },
      uTime: { value: 0 },
    });
  }

  /** Before the scene is drawn: draw it into the off-screen image (nothing to do when off). */
  begin() {
    if (!this.enabled) return;
    const size = this.renderer.getDrawingBufferSize(this.#size);
    if (this.target.width !== size.x || this.target.height !== size.y) {
      this.target.setSize(size.x, size.y);
      const bw = Math.max(1, Math.round(size.x / 4));
      const bh = Math.max(1, Math.round(size.y / 4));
      this.bloomA.setSize(bw, bh);
      this.bloomB.setSize(bw, bh);
    }
    this.#measure();
    this.renderer.setRenderTarget(this.target);
  }

  /** After the scene: the glow passes, then the picture onto the screen. */
  end(time) {
    if (!this.enabled) return;
    const r = this.renderer;
    const c = this.cfg;
    const u = this.crt.uniforms;
    if (c.bloom > 0) {
      this.bright.uniforms.uTexel.value.set(1 / this.target.width, 1 / this.target.height);
      this.#pass(this.bright, this.bloomA);
      // Wider sideways than up and down, like a beam's glow.
      this.blur.uniforms.tSrc.value = this.bloomA.texture;
      this.blur.uniforms.uDir.value.set(2 / this.bloomA.width, 0);
      this.#pass(this.blur, this.bloomB);
      this.blur.uniforms.tSrc.value = this.bloomB.texture;
      this.blur.uniforms.uDir.value.set(0, 1 / this.bloomA.height);
      this.#pass(this.blur, this.bloomA);
    }
    const dpr = r.getPixelRatio();
    const glassH = (this.#rect.w - this.#rect.y) * this.target.height / dpr; // CSS px
    u.uRes.value.set(this.target.width, this.target.height);
    u.uLines.value = Math.max(60, glassH / c.lineSize);
    u.uMaskPx.value = Math.max(1, c.maskSize * dpr);
    u.uMask.value = c.mask;
    u.uCurve.value = c.curve;
    u.uBloom.value = c.bloom;
    u.uContrast.value = c.contrast;
    u.uFringe.value = c.fringe * dpr;
    u.uTime.value = time;
    this.#pass(this.crt, null);
  }

  #pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
  }

  /** The glass's area on the canvas (it widens while the side panel is away). */
  #measure() {
    const g = this.glass.getBoundingClientRect();
    const w = window.innerWidth;
    const h = window.innerHeight;
    // uv: x left to right, y bottom to top.
    this.#rect.set(g.left / w, 1 - g.bottom / h, g.right / w, 1 - g.top / h);
  }

  /** Screen point (NDC) -> where the picture there comes from (NDC): for picking under the bend. */
  warp(ndc) {
    if (!this.enabled || !this.cfg.curve) return ndc;
    const [cx, cy, hx, hy] = this.#frame();
    const px = ((ndc.x * 0.5 + 0.5) - cx) / hx;
    const py = ((ndc.y * 0.5 + 0.5) - cy) / hy;
    if (Math.abs(px) > 1 || Math.abs(py) > 1) return ndc;
    const k = 1 + this.cfg.curve * (px * px + py * py);
    ndc.x = (cx + px * k * hx) * 2 - 1;
    ndc.y = (cy + py * k * hy) * 2 - 1;
    return ndc;
  }

  /** Picture point (NDC) -> where it shows on screen (NDC): for HTML placed over the 3D view. */
  unwarp(ndc) {
    if (!this.enabled || !this.cfg.curve) return ndc;
    const [cx, cy, hx, hy] = this.#frame();
    const sx = ((ndc.x * 0.5 + 0.5) - cx) / hx;
    const sy = ((ndc.y * 0.5 + 0.5) - cy) / hy;
    if (Math.abs(sx) > 1.5 || Math.abs(sy) > 1.5) return ndc;
    let px = sx;
    let py = sy;
    for (let i = 0; i < 4; i++) {
      const k = 1 + this.cfg.curve * (px * px + py * py);
      px = sx / k;
      py = sy / k;
    }
    ndc.x = (cx + px * hx) * 2 - 1;
    ndc.y = (cy + py * hy) * 2 - 1;
    return ndc;
  }

  /** HTML over the 3D view projects world points through `camera`: put them where the bent picture shows them. */
  hookProjection(camera) {
    const project = THREE.Vector3.prototype.project; // (already bent for the small planet, curvature.js)
    const pass = this;
    THREE.Vector3.prototype.project = function (cam) {
      project.call(this, cam);
      if (cam === camera) pass.unwarp(this);
      return this;
    };
  }

  #frame() {
    const r = this.#rect;
    return [(r.x + r.z) / 2, (r.y + r.w) / 2, (r.z - r.x) / 2, (r.w - r.y) / 2];
  }
}
