import gsap from 'gsap';
import { formulaToString } from './core/ast';
import { evaluate } from './core/evaluate';
import { explain } from './core/explain';
import { applyMove, bestMove, isOver, startGame, whoMoves, winner, type Move } from './core/game';
import type { ValidationErrorCode } from './core/validate';
import { check, LOVERS, NUMBERS, type World } from './worlds';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T;

/* ───────────── Texto que se "descifra" con símbolos lógicos ───────────── */
const NOISE = '∀∃¬∧∨→↔⊤⊥⊨=()xyzPQR';
export function scramble(el: HTMLElement, text: string, duration = 0.9): gsap.core.Tween {
  const state = { p: 0 };
  return gsap.to(state, {
    p: 1,
    duration,
    ease: 'power2.out',
    onUpdate() {
      const done = Math.floor(state.p * text.length);
      let out = text.slice(0, done);
      for (let i = done; i < text.length; i++) out += NOISE[Math.floor(Math.random() * NOISE.length)];
      el.textContent = out;
    },
    onComplete() {
      el.textContent = text;
    },
  });
}

/* ───────────── 02 · Objetivo: VERDADERA / FALSA ───────────── */
export function initObjective(): () => void {
  const el = $('#verdict-flip');
  let truth = true;
  let timer = 0;
  const flip = () => {
    truth = !truth;
    el.classList.toggle('f', !truth);
    scramble(el, truth ? 'VERDADERA' : 'FALSA', 0.8);
  };
  return () => {
    window.clearInterval(timer);
    scramble(el, 'VERDADERA', 1.2);
    truth = true;
    el.classList.remove('f');
    timer = window.setInterval(flip, 2600);
  };
}

/* ───────────── 03 · Siete requisitos ───────────── */
export function playRequirements(): void {
  const rows = [...document.querySelectorAll<HTMLElement>('#reqs li')];
  gsap.fromTo(rows, { y: 24, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.09, duration: 0.8, ease: 'expo.out', delay: 0.2 });
  // Una línea fina se dibuja bajo cada fila, como la ficha técnica de un auto.
  gsap.fromTo(rows, { '--p': 0 }, { '--p': 1, stagger: 0.09, duration: 1.1, ease: 'expo.inOut', delay: 0.35 });
  rows.forEach((r, i) => {
    const code = r.querySelector('code')!;
    const text = code.dataset.text ?? code.textContent!;
    code.dataset.text = text;
    gsap.delayedCall(0.4 + i * 0.09, () => scramble(code, text, 0.7));
  });
}

/* ───────────── 04 · R6: los cuatro casos, calculados en vivo ───────────── */
const CASES: { k: string; world: World; formula: string; accent: string }[] = [
  { k: 'Testigo', world: NUMBERS, formula: '∃x Par(x)', accent: 'var(--blue-hi)' },
  { k: 'Contraejemplo', world: NUMBERS, formula: '∀x (Primo(x) → Impar(x))', accent: '#ff4a50' },
  { k: 'Comprobación completa · ∀', world: LOVERS, formula: '∀x ∃y Ama(x, y)', accent: 'var(--blue-hi)' },
  { k: 'Comprobación completa · ∃', world: LOVERS, formula: '∃x Ama(x, x)', accent: '#ff4a50' },
];
export function buildCases(): void {
  $('#cases').innerHTML = CASES.map(({ k, world, formula, accent }) => {
    const c = check(world, formula);
    if (!c.ok) return '';
    const r = evaluate(c.value);
    if (!r.ok) return '';
    const ex = explain(r);
    const why = ex.summary.replace(/^.*?: /, '');
    return `<article class="case" style="--accent:${accent}">
      <span class="k">${k}</span>
      <span class="f">${formula}</span>
      <span class="v">${r.root.value ? 'Verdadero' : 'Falso'}</span>
      <p>${cap(why)}</p>
    </article>`;
  }).join('');
}
export function playCases(): void {
  gsap.fromTo(
    '#cases .case',
    { y: 80, opacity: 0, rotateY: -25 },
    { y: 0, opacity: 1, rotateY: 0, stagger: 0.12, duration: 1, ease: 'expo.out' },
  );
  document.querySelectorAll<HTMLElement>('#cases .v').forEach((v, i) => {
    const text = v.textContent!;
    gsap.delayedCall(0.4 + i * 0.12, () => scramble(v, text, 0.7));
  });
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* ───────────── 10 · R7: los 21 códigos y errores reales ───────────── */
const CODES: ValidationErrorCode[] = [
  'empty-name', 'invalid-name', 'reserved-name', 'invalid-arity', 'nullary-predicate', 'duplicate-name',
  'empty-domain', 'empty-element', 'duplicate-element', 'empty-function', 'missing-value', 'value-outside-domain',
  'duplicate-entry', 'empty-relation', 'tuple-length', 'tuple-outside-domain', 'syntax', 'undeclared-symbol',
  'arity-mismatch', 'unassigned-variable', 'assignment-outside-domain',
];
export function buildErrors(): void {
  $('#codes').innerHTML = CODES.map((c) => `<span data-code="${c}">${c}</span>`).join('');
  const samples: { world: World; formula: string; env?: Record<string, string>; patch?: (w: World) => World }[] = [
    { world: NUMBERS, formula: '∃x (Par(x) ∧ Primo(x)' },
    { world: LOVERS, formula: '∀x Ama(x)' },
    { world: LOVERS, formula: 'Ama(x, y)', env: { x: 'ana' } },
    {
      world: LOVERS,
      formula: '∃x Ama(x, x)',
      patch: (w) => ({ ...w, interpretation: { ...w.interpretation, predicates: { Ama: [] } } }),
    },
  ];
  const html: string[] = [];
  for (const s of samples) {
    const w = s.patch ? s.patch(s.world) : s.world;
    const c = check(w, s.formula, s.env ?? {});
    if (c.ok) continue;
    const e = c.errors[0];
    html.push(`<div class="err" data-code="${e.code}"><code>${e.code}</code>${escapeHtml(e.message)}</div>`);
  }
  $('#errs').innerHTML = html.join('');
}
export function playErrors(): void {
  const spans = [...document.querySelectorAll<HTMLElement>('#codes span')];
  spans.forEach((s) => s.classList.remove('lit', 'lit-red'));
  gsap.fromTo(spans, { opacity: 0, y: 20 }, { opacity: 1, y: 0, stagger: { each: 0.03, from: 'random' }, duration: 0.5, ease: 'power3.out' });
  const real = new Set([...document.querySelectorAll<HTMLElement>('#errs .err')].map((e) => e.dataset.code));
  spans.forEach((s, i) => {
    gsap.delayedCall(0.6 + i * 0.05, () => s.classList.add('lit'));
    gsap.delayedCall(0.6 + i * 0.05 + 0.35, () => {
      s.classList.remove('lit');
      if (real.has(s.dataset.code)) s.classList.add('lit-red');
    });
  });
  gsap.fromTo('#errs .err', { x: -40, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.15, duration: 0.7, ease: 'expo.out', delay: 1.4 });
}

/* ───────────── 12 · Juego de Hintikka con bestMove ───────────── */
const GAMES = [
  { world: LOVERS, formula: '∀x ∃y Ama(x, y)' },
  { world: LOVERS, formula: '∃x Ama(x, x)' },
  { world: NUMBERS, formula: '∀x (Primo(x) → Impar(x))' },
  { world: NUMBERS, formula: '¬∀x Par(x)' },
];
let gameIndex = 0;
let gameTl: gsap.core.Timeline | null = null;

function describe(move: Move, state: ReturnType<typeof startGame>): string {
  const f = state.formula;
  if (move.kind === 'element' && (f.kind === 'ForAll' || f.kind === 'Exists')) return `elige ${f.variable} = ${move.element}`;
  if (move.kind === 'negation') return 'nadie elige: se intercambian los roles';
  if (move.kind === 'side') {
    if (f.kind === 'Implies') return move.side === 'left' ? 'juega ¬ del antecedente (roles cambian)' : 'elige el consecuente';
    if (f.kind === 'Iff') return `elige la implicación ${move.side === 'left' ? '→' : '←'}`;
    return `elige el lado ${move.side === 'left' ? 'izquierdo' : 'derecho'}`;
  }
  return '';
}

export function buildGamePicker(): void {
  const pick = $('#game-pick');
  pick.innerHTML = GAMES.map((g, i) => `<button type="button" class="mono${i === 0 ? ' on' : ''}" data-i="${i}">${g.formula}</button>`).join('');
  pick.querySelectorAll<HTMLButtonElement>('button').forEach((b) =>
    b.addEventListener('click', () => {
      gameIndex = +b.dataset.i!;
      pick.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      playGame();
    }),
  );
}

export function playGame(): void {
  const { world, formula } = GAMES[gameIndex];
  const c = check(world, formula);
  const box = $('#game');
  if (!c.ok) return;
  const input = c.value;
  let state = startGame(input);
  const rows: string[] = [];
  const color = (p: string | null) => (p === 'verificador' ? 'var(--blue)' : p === 'falsificador' ? 'var(--red)' : '#555');
  let guard = 0;
  while (!isOver(state) && guard++ < 40) {
    const mover = whoMoves(state);
    const move = bestMove(state, input)!;
    const who = mover ? cap(mover) : 'Negación';
    rows.push(
      `<div class="gstep" style="--c:${color(mover)}"><span class="gf">${formulaToString(state.formula)}</span><span class="gm"><b>${who}</b> ${describe(move, state)}</span></div>`,
    );
    state = applyMove(state, move);
  }
  const win = winner(state, input);
  const env = Object.entries(state.env).map(([k, v]) => `${k} ↦ ${v}`).join(', ');
  rows.push(
    `<div class="gstep" style="--c:#888"><span class="gf">${formulaToString(state.formula)}${env ? `  con ${env}` : ''}</span><span class="gm">Átomo: termina la partida</span></div>`,
  );
  rows.push(`<div class="gwin" style="--c:${color(win)}">Gana el ${win} — con estrategia ganadora</div>`);
  box.innerHTML = `<div class="players"><span class="v">● Verificador</span><span class="f">Falsificador ●</span></div>${rows.join('')}`;
  gameTl?.kill();
  gameTl = gsap.timeline();
  gameTl.fromTo(box.querySelectorAll('.gstep, .gwin'), { x: 60, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.45, duration: 0.6, ease: 'expo.out' });
}

/* ───────────── Contadores ───────────── */
export function countUp(root: Element): void {
  root.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const target = +el.dataset.count!;
    const o = { v: 0 };
    gsap.to(o, {
      v: target,
      duration: 1.8,
      ease: 'expo.out',
      onUpdate: () => (el.textContent = Math.round(o.v).toLocaleString('es')),
    });
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}
