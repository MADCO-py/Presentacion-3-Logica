import '@fontsource-variable/inter';
import './style.css';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { createParticles } from './particles';
import {
  buildCases,
  buildErrors,
  buildGamePicker,
  countUp,
  initObjective,
  playCases,
  playErrors,
  playGame,
  playRequirements,
} from './slides';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

// La presentación siempre arranca en la portada (o en el #ancla pedida), no donde quedó el scroll.
history.scrollRestoration = 'manual';
if (!location.hash) window.scrollTo(0, 0);

const slides = [...document.querySelectorAll<HTMLElement>('.slide')];
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────────── Texto partido en palabras ───────────── */
document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => {
  const words = el.textContent!.trim().split(/\s+/);
  el.innerHTML = words.map((w) => `<span class="w"><span class="wi">${w}</span></span>`).join(' ');
});

/* ───────────── Contenido generado con el núcleo real ───────────── */
buildCases();
buildErrors();
buildGamePicker();
const startObjective = initObjective();

/* ───────────── Animación de entrada por diapositiva ───────────── */
const onEnter: Record<string, () => void> = {
  objetivo: startObjective,
  requisitos: playRequirements,
  r6: playCases,
  r7: () => {
    playErrors();
    countUp(document.querySelector('#r7')!);
  },
  hintikka: playGame,
};

function reveal(slide: HTMLElement) {
  const words = slide.querySelectorAll('.wi');
  const items = slide.querySelectorAll('[data-reveal]');
  const tl = gsap.timeline();
  tl.fromTo(words, { yPercent: 115, rotate: 4 }, { yPercent: 0, rotate: 0, duration: 1.1, stagger: 0.06, ease: 'expo.out' });
  tl.fromTo(items, { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.9, stagger: 0.08, ease: 'expo.out' }, 0.15);
  if (slide.id === 'ia') {
    tl.fromTo('.rules article', { y: 50, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.12, duration: 0.9, ease: 'expo.out' }, 0.3);
  }
  onEnter[slide.id]?.();
}

slides.forEach((slide) => {
  if (reduced) {
    onEnter[slide.id]?.();
    return;
  }
  ScrollTrigger.create({
    trigger: slide,
    start: 'top 65%',
    end: 'bottom 35%',
    onEnter: () => reveal(slide),
    onEnterBack: () => reveal(slide),
  });
});

// La portada entra sola al cargar.
window.addEventListener('load', () => ScrollTrigger.refresh());

/* ───────────── Partículas ───────────── */
const HERO_STEPS = [
  { glyph: '∀', name: 'Para todo' },
  { glyph: '∃', name: 'Existe' },
  { glyph: '¬', name: 'Negación' },
  { glyph: '∧', name: 'Conjunción' },
  { glyph: '∨', name: 'Disyunción' },
  { glyph: '→', name: 'Implicación' },
  { glyph: '↔', name: 'Bicondicional' },
  { glyph: '⊨', name: 'Satisface' },
];
document.fonts.ready.then(() => {
  const nameEl = document.querySelector<HTMLElement>('#glyph-name')!;
  createParticles(document.querySelector('#hero-gl')!, HERO_STEPS, (s) => {
    gsap.to(nameEl, {
      opacity: 0,
      duration: 0.25,
      onComplete: () => {
        nameEl.textContent = s.name;
        gsap.to(nameEl, { opacity: 1, duration: 0.5 });
      },
    });
  });
  createParticles(document.querySelector('#end-gl')!, [
    { glyph: '⊨', name: '' },
    { glyph: '∎', name: '' },
    { glyph: '∀', name: '' },
    { glyph: '∃', name: '' },
  ], undefined, 0.36);
});

/* ───────────── Navegación: puntos, contador, progreso, tema ───────────── */
const dots = document.querySelector<HTMLElement>('#dots')!;
dots.innerHTML = slides
  .map((s, i) => `<button type="button" aria-label="${s.dataset.title}" data-label="${s.dataset.title}" data-i="${i}"></button>`)
  .join('');
dots.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.addEventListener('click', () => go(+b.dataset.i!)));

let current = 0;
const counter = document.querySelector<HTMLElement>('#counter')!;
const bar = document.querySelector<HTMLElement>('#progress-bar')!;
const pad = (n: number) => String(n).padStart(2, '0');

function setCurrent(i: number) {
  current = i;
  counter.textContent = `${pad(i + 1)} / ${pad(slides.length)}`;
  bar.style.width = `${((i + 1) / slides.length) * 100}%`;
  dots.querySelectorAll('button').forEach((b, j) => b.classList.toggle('on', j === i));
  document.body.dataset.theme = slides[i].dataset.theme ?? 'dark';
  if (i > 0) document.querySelector('#hint')!.classList.add('gone');
}

const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !animating) setCurrent(slides.indexOf(e.target as HTMLElement));
    }
  },
  { rootMargin: '-50% 0px -50% 0px' },
);
slides.forEach((s) => io.observe(s));
setCurrent(0);

// Modo diapositiva (pantallas grandes): cada gesto de rueda, swipe o tecla avanza exactamente una
// diapositiva con una transición propia. En pantallas chicas el scroll es libre y normal.
const deckQuery = window.matchMedia('(min-width: 900px) and (min-height: 600px)');
let animating = false;
// La inercia del trackpad sigue mandando eventos de rueda después de la transición; mientras
// sigan llegando seguidos, se ignoran para que un solo gesto no salte varias diapositivas.
let wheelLockedUntil = 0;

function go(i: number) {
  const target = Math.max(0, Math.min(slides.length - 1, i));
  if (!deckQuery.matches) {
    slides[target].scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
    return;
  }
  if (animating && target === current) return;
  animating = true;
  // La diapositiva que se va se hunde y se desvanece durante la transición; al terminar se limpia,
  // así ninguna queda a medio desvanecer (p. ej. al entrar o salir de pantalla completa).
  const leaving = slides[current].querySelector<HTMLElement>('.slide-inner');
  if (leaving && target !== current && !reduced) {
    gsap.fromTo(
      leaving,
      { scale: 1, opacity: 1, y: 0 },
      { scale: 0.92, opacity: 0.1, y: (target > current ? -1 : 1) * 80, duration: 0.7, ease: 'power2.in', overwrite: true },
    );
    gsap.delayedCall(1.2, () => gsap.set(leaving, { clearProps: 'transform,opacity' }));
  }
  setCurrent(target);
  gsap.to(window, {
    scrollTo: { y: slides[target].offsetTop, autoKill: false },
    duration: reduced ? 0 : 1.15,
    ease: 'expo.inOut',
    overwrite: true,
    onComplete: () => {
      animating = false;
      wheelLockedUntil = performance.now() + 220;
    },
  });
}

let wheelAcc = 0;
let wheelTimer = 0;
window.addEventListener(
  'wheel',
  (e) => {
    if (!deckQuery.matches || e.ctrlKey) return;
    e.preventDefault();
    const now = performance.now();
    if (animating || now < wheelLockedUntil) {
      if (!animating) wheelLockedUntil = now + 220;
      wheelAcc = 0;
      return;
    }
    wheelAcc += e.deltaY;
    window.clearTimeout(wheelTimer);
    wheelTimer = window.setTimeout(() => (wheelAcc = 0), 180);
    if (Math.abs(wheelAcc) > 40) {
      const dir = Math.sign(wheelAcc);
      wheelAcc = 0;
      go(current + dir);
    }
  },
  { passive: false },
);

let touchY = 0;
window.addEventListener('touchstart', (e) => (touchY = e.touches[0].clientY), { passive: true });
window.addEventListener(
  'touchmove',
  (e) => {
    if (deckQuery.matches) e.preventDefault();
  },
  { passive: false },
);
window.addEventListener('touchend', (e) => {
  if (!deckQuery.matches) return;
  const dy = touchY - e.changedTouches[0].clientY;
  if (Math.abs(dy) > 50) go(current + Math.sign(dy));
});

// Al cambiar el tamaño de la ventana (o entrar/salir de pantalla completa) se vuelve a alinear la
// diapositiva actual y se recalculan los disparadores de animación.
let pinnedIndex = 0;
function realign() {
  if (!deckQuery.matches || animating) return;
  window.scrollTo(0, slides[current].offsetTop);
  ScrollTrigger.refresh();
}
window.addEventListener('resize', realign);
document.addEventListener('fullscreenchange', () => requestAnimationFrame(() => requestAnimationFrame(realign)));
ScrollTrigger.addEventListener('refreshInit', () => {
  // Durante el refresh se fija el índice actual para no perder la diapositiva si cambia la altura.
  pinnedIndex = current;
});
ScrollTrigger.addEventListener('refresh', () => {
  if (deckQuery.matches && !animating) window.scrollTo(0, slides[pinnedIndex].offsetTop);
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select')) return;
  if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) {
    e.preventDefault();
    go(current + 1);
  } else if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) {
    e.preventDefault();
    go(current - 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    go(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    go(slides.length - 1);
  } else if (e.key === 'f' || e.key === 'F') {
    toggleFullscreen();
  }
});

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen?.();
}
document.querySelector('#fs-btn')!.addEventListener('click', toggleFullscreen);

// Los enlaces internos usan el mismo desplazamiento suave.
document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) =>
  a.addEventListener('click', (e) => {
    const target = document.querySelector<HTMLElement>(a.getAttribute('href')!);
    if (!target) return;
    e.preventDefault();
    go(slides.indexOf(target));
  }),
);
