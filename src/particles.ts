import * as THREE from 'three';
import gsap from 'gsap';

// Partículas que se reorganizan para dibujar símbolos lógicos. Cada símbolo se rasteriza en un
// canvas 2D, se muestrean sus píxeles y las partículas viajan de un conjunto de puntos al siguiente.

const COUNT = 9000;
const WORLD_W = 8;
const WORLD_H = 4;

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uProgress;
  uniform float uSize;
  uniform float uPixelRatio;
  uniform vec2 uMouse;
  attribute vec3 aFrom;
  attribute vec3 aTo;
  attribute float aRand;
  varying float vAlpha;
  varying float vHeat;

  void main() {
    float p = clamp(uProgress * 1.6 - aRand * 0.6, 0.0, 1.0);
    p = p * p * (3.0 - 2.0 * p);
    vec3 pos = mix(aFrom, aTo, p);

    // Explosión a mitad del viaje y respiración constante.
    float burst = sin(p * 3.14159);
    vec3 swirl = vec3(
      sin(uTime * 1.3 + aRand * 40.0),
      cos(uTime * 1.1 + aRand * 30.0),
      sin(uTime * 0.9 + aRand * 20.0)
    );
    pos += swirl * (0.015 + burst * 1.1 * aRand);

    // El cursor aparta las partículas.
    vec2 d = pos.xy - uMouse;
    float dist = length(d);
    float push = smoothstep(1.3, 0.0, dist);
    pos.xy += normalize(d + 0.0001) * push * 0.55;
    pos.z += push * 0.6;

    vec4 mv = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * uPixelRatio * (0.45 + aRand) / -mv.z;
    vAlpha = 0.35 + 0.65 * aRand;
    vHeat = burst + push;
  }
`;

const fragment = /* glsl */ `
  uniform vec3 uColor;
  uniform vec3 uHot;
  varying float vAlpha;
  varying float vHeat;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    vec3 color = mix(uColor, uHot, clamp(vHeat, 0.0, 1.0));
    gl_FragColor = vec4(color, a * vAlpha);
  }
`;

function sampleGlyph(glyph: string): Float32Array {
  const W = 800;
  const H = 400;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = glyph.length > 2 ? 150 : 330;
  ctx.font = `700 ${size}px "Inter Variable", "DejaVu Sans", "Segoe UI Symbol", sans-serif`;
  ctx.fillText(glyph, W / 2, H / 2 + 10);
  const data = ctx.getImageData(0, 0, W, H).data;
  const pts: number[] = [];
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (data[(y * W + x) * 4 + 3] > 128) pts.push(x, y);
    }
  }
  const out = new Float32Array(COUNT * 3);
  const n = pts.length / 2;
  for (let i = 0; i < COUNT; i++) {
    if (n === 0) {
      out.set([0, 0, 0], i * 3);
      continue;
    }
    const k = Math.floor(Math.random() * n) * 2;
    const jitter = () => (Math.random() - 0.5) * 0.02;
    out[i * 3] = (pts[k] / W - 0.5) * WORLD_W + jitter();
    out[i * 3 + 1] = -(pts[k + 1] / H - 0.5) * WORLD_H + jitter();
    out[i * 3 + 2] = (Math.random() - 0.5) * 0.35;
  }
  return out;
}

function sphere(radius: number): Float32Array {
  const out = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const r = radius * Math.cbrt(Math.random());
    const s = Math.sqrt(1 - u * u);
    out[i * 3] = r * s * Math.cos(t);
    out[i * 3 + 1] = r * s * Math.sin(t);
    out[i * 3 + 2] = r * u;
  }
  return out;
}

export interface GlyphStep {
  glyph: string;
  name: string;
}

// centerY: dónde queda el centro del símbolo, como fracción de la altura desde arriba.
export function createParticles(
  canvas: HTMLCanvasElement,
  steps: GlyphStep[],
  onStep?: (step: GlyphStep) => void,
  centerY = 0.56,
): void {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
  } catch {
    // Sin WebGL (equipos sin aceleración, algunos proyectores) se usa la versión en Canvas 2D.
    createParticles2D(canvas, steps, onStep, centerY);
    return;
  }
  const pixelRatio = Math.min(window.devicePixelRatio, 2);
  renderer.setPixelRatio(pixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 6;

  const targets = steps.map((s) => sampleGlyph(s.glyph));
  const geometry = new THREE.BufferGeometry();
  const from = new THREE.BufferAttribute(sphere(9), 3);
  const to = new THREE.BufferAttribute(targets[0].slice(), 3);
  const rand = new Float32Array(COUNT).map(() => Math.random());
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
  geometry.setAttribute('aFrom', from);
  geometry.setAttribute('aTo', to);
  geometry.setAttribute('aRand', new THREE.BufferAttribute(rand, 1));

  const uniforms = {
    uTime: { value: 0 },
    uProgress: { value: 0 },
    uSize: { value: 42 },
    uPixelRatio: { value: pixelRatio },
    uMouse: { value: new THREE.Vector2(99, 99) },
    uColor: { value: new THREE.Color('#e9eefc') },
    uHot: { value: new THREE.Color('#3e6ae1') },
  };
  const material = new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.add(points);
  scene.add(group);

  // Polvo de fondo.
  const starGeo = new THREE.BufferGeometry();
  const stars = new Float32Array(1500 * 3).map((_, i) => (i % 3 === 2 ? -Math.random() * 20 - 2 : (Math.random() - 0.5) * 40));
  starGeo.setAttribute('position', new THREE.BufferAttribute(stars, 3));
  const starField = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ color: 0x8fa6e8, size: 0.04, transparent: true, opacity: 0.6, depthWrite: false }),
  );
  scene.add(starField);

  let halfW = 1;
  let halfH = 1;
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    halfW = halfH * camera.aspect;
    // En pantallas angostas el símbolo se encoge para caber.
    const fit = Math.min((halfW * 2 * 0.9) / WORLD_W, (halfH * 2 * 0.5) / WORLD_H);
    group.scale.setScalar(fit);
    group.position.y = halfH * (1 - 2 * centerY);
  }
  resize();
  new ResizeObserver(resize).observe(canvas);

  const mouseTarget = new THREE.Vector2(99, 99);
  canvas.parentElement!.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    mouseTarget.set((nx * halfW) / group.scale.x, (ny * halfH - group.position.y) / group.scale.y);
  });
  canvas.parentElement!.addEventListener('pointerleave', () => mouseTarget.set(99, 99));

  let index = 0;
  let morphTween: gsap.core.Tween | null = null;
  function morphTo(next: number, duration = 2.2) {
    // El estado actual pasa a ser el origen y el nuevo símbolo el destino.
    from.array.set(to.array as Float32Array);
    from.needsUpdate = true;
    to.array.set(targets[next]);
    to.needsUpdate = true;
    uniforms.uProgress.value = 0;
    index = next;
    onStep?.(steps[next]);
    morphTween?.kill();
    morphTween = gsap.to(uniforms.uProgress, { value: 1, duration, ease: 'power2.inOut' });
  }

  // Entrada: de una nube esférica al primer símbolo.
  onStep?.(steps[0]);
  morphTween = gsap.to(uniforms.uProgress, { value: 1, duration: 3, ease: 'expo.out', delay: 0.2 });

  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { threshold: 0.05 }).observe(canvas);

  let cycle = 0;
  const clock = new THREE.Clock();
  let last = 0;
  renderer.setAnimationLoop(() => {
    if (!visible) return;
    const t = clock.getElapsedTime();
    const dt = t - last;
    last = t;
    uniforms.uTime.value = t;
    uniforms.uMouse.value.lerp(mouseTarget, 0.08);
    group.rotation.y = Math.sin(t * 0.25) * 0.18 + uniforms.uMouse.value.x * 0.02;
    group.rotation.x = Math.cos(t * 0.2) * 0.06;
    starField.rotation.z += dt * 0.01;
    cycle += dt;
    if (cycle > 4.2 && steps.length > 1) {
      cycle = 0;
      morphTo((index + 1) % steps.length);
    }
    renderer.render(scene, camera);
  });

  // Clic: salto inmediato al siguiente símbolo.
  canvas.parentElement!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    cycle = 0;
    morphTo((index + 1) % steps.length, 1.6);
  });
}

/* ───────────── Respaldo en Canvas 2D ───────────── */
function createParticles2D(
  original: HTMLCanvasElement,
  steps: GlyphStep[],
  onStep: ((step: GlyphStep) => void) | undefined,
  centerY: number,
): void {
  // Un canvas que ya intentó WebGL no puede dar un contexto 2D: se reemplaza por uno nuevo.
  const canvas = original.cloneNode() as HTMLCanvasElement;
  original.replaceWith(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const N = 2600;
  const targets = steps.map((s) => sampleGlyph(s.glyph));
  const rand = Float32Array.from({ length: N }, () => Math.random());
  const pos = sphere(9).slice(0, N * 3);
  const from = pos.slice();
  let to = targets[0];
  let progress = 0;
  let index = 0;
  const mouse = { x: 99, y: 99 };
  let scale = 1;
  let w = 0;
  let h = 0;
  const dpr = Math.min(window.devicePixelRatio, 2);

  function resize() {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    scale = Math.min((w * 0.9) / WORLD_W, (h * 0.5) / WORLD_H);
  }
  resize();
  new ResizeObserver(resize).observe(canvas);
  canvas.parentElement!.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - r.left - w / 2) / scale;
    mouse.y = -(e.clientY - r.top - h * centerY) / scale;
  });
  canvas.parentElement!.addEventListener('pointerleave', () => {
    mouse.x = mouse.y = 99;
  });

  function morph(next: number) {
    for (let i = 0; i < N * 3; i++) from[i] = pos[i];
    to = targets[next];
    index = next;
    progress = 0;
    onStep?.(steps[next]);
  }
  onStep?.(steps[0]);
  canvas.parentElement!.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a,button')) return;
    cycle = 0;
    morph((index + 1) % steps.length);
  });

  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting), { threshold: 0.05 }).observe(canvas);
  let cycle = 0;
  let last = performance.now();
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (!visible) {
      last = now;
      return;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now / 1000;
    progress = Math.min(1, progress + dt / 2.2);
    cycle += dt;
    if (cycle > 4.2 && steps.length > 1) {
      cycle = 0;
      morph((index + 1) % steps.length);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < N; i++) {
      const r = rand[i];
      let p = Math.max(0, Math.min(1, progress * 1.6 - r * 0.6));
      p = p * p * (3 - 2 * p);
      const burst = Math.sin(p * Math.PI);
      let x = from[i * 3] + (to[i * 3] - from[i * 3]) * p + Math.sin(t * 1.3 + r * 40) * (0.015 + burst * 1.1 * r);
      let y = from[i * 3 + 1] + (to[i * 3 + 1] - from[i * 3 + 1]) * p + Math.cos(t * 1.1 + r * 30) * (0.015 + burst * 1.1 * r);
      const dx = x - mouse.x;
      const dy = y - mouse.y;
      const d = Math.hypot(dx, dy) + 1e-4;
      const push = Math.max(0, 1 - d / 1.3);
      x += (dx / d) * push * push * 0.55;
      y += (dy / d) * push * push * 0.55;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      const heat = Math.min(1, burst + push);
      const rr = Math.round(233 - heat * 171);
      const gg = Math.round(238 - heat * 132);
      ctx.fillStyle = `rgba(${rr},${gg},${Math.round(252 - heat * 27)},${0.35 + 0.65 * r})`;
      const s = 0.8 + r * 1.6;
      ctx.fillRect(w / 2 + x * scale, h * centerY - y * scale, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
  };
  requestAnimationFrame(frame);
}
