// Visuals: a live halftone backdrop, generated poster art for each
// restaurant, and the pixel chicken. Everything leans on one angle: 23°.

const PALETTE = {
  ink: [0x28, 0x23, 0x23],
  field: [0x59, 0x90, 0x33],
  nope: [0x32, 0x32, 0x82],
  yolk: [0xff, 0xd3, 0x1a],
  paper: [0xf1, 0xec, 0xe1],
};
const vec3 = (rgb) => rgb.map((v) => v / 255);

const NOISE = `
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
  }
  mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
`;

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const BACKDROP_FRAG = `
  precision mediump float;
  uniform vec2 uRes;
  uniform float uTime, uLean, uBurst;
  uniform vec3 cYolk, cInk, cField, cNope;
  ${NOISE}
  void main() {
    float cell = 9.0;
    mat2 R = rot(radians(23.0));
    vec2 g = R * gl_FragCoord.xy / cell;
    vec2 id = floor(g);
    vec2 f = fract(g) - 0.5;
    // Sample noise at the cell centre so each dot is one solid size.
    vec2 centre = rot(radians(-23.0)) * ((id + 0.5) * cell) / uRes;
    float aspect = uRes.x / uRes.y;
    vec2 c = centre * vec2(aspect, 1.0);
    float v = smoothstep(0.4, 0.9, n(c * 3.0 + vec2(uTime * 0.04, -uTime * 0.025)));

    float side = uLean > 0.0 ? centre.x : 1.0 - centre.x;
    float reach = abs(uLean) * 1.15;
    float wipe = smoothstep(1.0 - reach, 1.25 - reach, side) * step(0.001, reach);

    float d = distance(c, vec2(0.5 * aspect, 0.5));
    float ring = uBurst > 0.0 ? exp(-pow((d - uBurst * 1.8) * 5.0, 2.0)) * (1.0 - uBurst * 0.4) : 0.0;

    float r = 0.05 + 0.3 * v + 0.75 * wipe + 0.6 * ring;
    float dotMask = 1.0 - smoothstep(r - 0.08, r, length(f));
    vec3 dotCol = cInk;
    if (wipe > 0.01) dotCol = uLean > 0.0 ? cField : cNope;
    if (ring > 0.05) dotCol = cField;
    gl_FragColor = vec4(mix(cYolk, dotCol, dotMask), 1.0);
  }
`;

const POSTER_FRAG = `
  precision highp float;
  uniform vec2 uRes;
  uniform vec4 uS;
  uniform vec3 cBg, cInk, cAcc, cAlt;
  ${NOISE}
  void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    float dir = uS.x > 0.5 ? 1.0 : -1.0;
    vec3 col = cBg;

    // A striped band cutting across at 23°.
    vec2 q = rot(radians(23.0) * dir) * p;
    float band = step(abs(q.y - (uS.y - 0.5) * 0.55), 0.08 + 0.07 * uS.w);
    col = mix(col, cAlt, band * step(0.5, fract(q.x * 13.0)));

    // A sphere with a hard offset shadow, shaded in halftone.
    vec2 centre = vec2((uS.z - 0.5) * 0.45, (uS.w - 0.5) * 0.22);
    float rad = 0.27 + 0.08 * uS.x;
    col = mix(col, cInk, step(length(p - centre - vec2(0.045 * dir, -0.045)), rad));

    vec2 lp = (p - centre) / rad;
    float l2 = dot(lp, lp);
    if (l2 < 1.0) {
      vec3 nrm = vec3(lp, sqrt(1.0 - l2));
      float a = uS.y * 6.2832;
      vec3 L = normalize(vec3(cos(a), sin(a), 1.1));
      float lam = clamp(dot(nrm, L), 0.0, 1.0);
      vec2 g = rot(radians(23.0)) * gl_FragCoord.xy / 11.0;
      float rr = (1.0 - lam) * 0.64;
      col = mix(cAcc, cInk, 1.0 - smoothstep(rr - 0.1, rr, length(fract(g) - 0.5)));
    }
    float edge = abs(length(p - centre) - rad);
    col = mix(col, cInk, 1.0 - smoothstep(0.004, 0.009, edge));

    col += (h(gl_FragCoord.xy + uS.xy * 97.0) - 0.5) * 0.07;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function program(gl, frag) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = (name) => gl.getUniformLocation(prog, name);
  return { prog, u };
}

export class Backdrop {
  constructor(canvas) {
    this.canvas = canvas;
    this.lean = 0;
    this.shown = 0;
    this.burst = -1;
    this.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      this.gl = canvas.getContext('webgl', { antialias: false });
      if (!this.gl) return;
      this.p = program(this.gl, BACKDROP_FRAG);
      const { u } = this.p;
      this.gl.uniform3fv(u('cYolk'), vec3(PALETTE.yolk));
      this.gl.uniform3fv(u('cInk'), vec3(PALETTE.ink));
      this.gl.uniform3fv(u('cField'), vec3(PALETTE.field));
      this.gl.uniform3fv(u('cNope'), vec3(PALETTE.nope));
    } catch (err) {
      console.warn('Backdrop disabled:', err);
      this.gl = null;
      return;
    }
    document.documentElement.classList.add('has-gl');
    this.resize();
    addEventListener('resize', () => this.resize());
    this.t0 = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  resize() {
    // Half resolution, upscaled with pixelated sampling: crisp, chunky dots.
    this.canvas.width = Math.ceil(innerWidth / 2);
    this.canvas.height = Math.ceil(innerHeight / 2);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.dirty = true;
  }

  celebrate() {
    this.burst = 0;
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    if (document.hidden) return;
    const easing = Math.abs(this.lean - this.shown) > 0.002;
    this.shown += (this.lean - this.shown) * 0.25;
    if (this.burst >= 0) this.burst += 0.012;
    if (this.burst > 1) this.burst = -1;
    if (this.still && !easing && !this.dirty && this.burst < 0) return;
    this.dirty = false;
    const { gl, p } = this;
    gl.uniform2f(p.u('uRes'), this.canvas.width, this.canvas.height);
    gl.uniform1f(p.u('uTime'), this.still ? 0 : (now - this.t0) / 1000);
    gl.uniform1f(p.u('uLean'), this.shown);
    gl.uniform1f(p.u('uBurst'), this.burst);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function seeds(str) {
  let x = hash(str) || 1;
  return Array.from({ length: 4 }, () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 10007) / 10007;
  });
}

// [background, sphere, stripes]
const SCHEMES = [
  ['yolk', 'field', 'paper'],
  ['paper', 'yolk', 'nope'],
  ['nope', 'yolk', 'paper'],
  ['field', 'paper', 'yolk'],
  ['paper', 'nope', 'yolk'],
  ['yolk', 'nope', 'paper'],
];

export function schemeFor(name) {
  return SCHEMES[hash(name.toLowerCase()) % SCHEMES.length];
}

let poster = null;
const posterCache = new Map();

// Returns a data URL of generated art for a restaurant, or null without WebGL.
export function posterFor(name) {
  const key = name.toLowerCase();
  if (posterCache.has(key)) return posterCache.get(key);
  if (poster === null) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 720;
      canvas.height = 540;
      const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
      poster = gl ? { canvas, gl, ...program(gl, POSTER_FRAG) } : false;
    } catch (err) {
      console.warn('Poster art disabled:', err);
      poster = false;
    }
  }
  if (!poster) return null;
  const { gl, u, canvas } = poster;
  const [bg, acc, alt] = schemeFor(name);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(u('uRes'), canvas.width, canvas.height);
  gl.uniform4fv(u('uS'), seeds(key));
  gl.uniform3fv(u('cBg'), vec3(PALETTE[bg]));
  gl.uniform3fv(u('cInk'), vec3(PALETTE.ink));
  gl.uniform3fv(u('cAcc'), vec3(PALETTE[acc]));
  gl.uniform3fv(u('cAlt'), vec3(PALETTE[alt]));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const url = canvas.toDataURL('image/jpeg', 0.88);
  posterCache.set(key, url);
  return url;
}

// 14 x 12 pixel chicken. K body, C comb, B beak, W eye (left open).
const CHICKEN = [
  '..CC..........',
  '.CCCC.........',
  '..KKK.........',
  '.KKWKK........',
  'BKKKKK.......K',
  '.CKKKK......KK',
  '..KKKKKKKKKKKK',
  '..KKKKKKKKKKK.',
  '...KKKKKKKKK..',
  '....KKKKKKK...',
  '.....K...K....',
  '....KK..KK....',
];

export function chickenSVG(className = '') {
  const fills = { K: 'currentColor', C: 'var(--comb, currentColor)', B: 'var(--beak, currentColor)' };
  let rects = '';
  CHICKEN.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (fills[ch]) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fills[ch]}"/>`;
    });
  });
  return `<svg class="${className}" viewBox="0 0 14 12" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
