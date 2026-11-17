import gsap from 'gsap';
import { formulaToString, termToString, type Formula } from './core/ast';
import { evaluate } from './core/evaluate';
import { explain } from './core/explain';
import { freeVariables } from './core/freeVars';
import { applyMove, bestMove, isOver, startGame, whoMoves, winner, type Move } from './core/game';
import { parse } from './core/parser';
import { buildSignature, type ValidationErrorCode } from './core/validate';
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

/* ───────────── 04 · R1: clasificación de identificadores ───────────── */
export function playClassify(): void {
  gsap.fromTo(
    '#decl-grid .decl',
    { y: 40, opacity: 0, rotateX: -60 },
    { y: 0, opacity: 1, rotateX: 0, stagger: 0.1, duration: 0.9, ease: 'expo.out' },
  );
  gsap.fromTo(
    '#classify .t',
    { y: -60, opacity: 0, filter: 'blur(8px)' },
    { y: 0, opacity: 1, filter: 'blur(0px)', stagger: 0.07, duration: 0.8, ease: 'back.out(2)', delay: 0.4 },
  );
}

/* ───────────── 05 · R2: matriz de Ama^I ───────────── */
export function buildMatrix(): void {
  const m = $('#matrix');
  const d = LOVERS.interpretation.domain;
  const rel = new Set(LOVERS.interpretation.predicates.Ama.map((t) => t.join('|')));
  m.innerHTML = '<span></span>' + d.map((e) => `<span class="h">${e}</span>`).join('');
  for (const a of d) {
    m.insertAdjacentHTML('beforeend', `<span class="h">${a}</span>`);
    for (const b of d) {
      m.insertAdjacentHTML(
        'beforeend',
        `<span class="c" data-on="${rel.has(`${a}|${b}`)}" title="(${a}, ${b})"></span>`,
      );
    }
  }
}
export function playMatrix(): void {
  const cells = [...document.querySelectorAll<HTMLElement>('#matrix .c')];
  cells.forEach((c) => {
    c.classList.remove('on');
    c.textContent = '';
  });
  gsap.fromTo('#domain > *', { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, stagger: 0.08, duration: 0.7, ease: 'back.out(2.5)' });
  gsap.fromTo('#matrix .c', { scale: 0.3, opacity: 0 }, { scale: 1, opacity: 1, stagger: 0.04, duration: 0.5, ease: 'expo.out', delay: 0.3 });
  cells.forEach((c, i) => {
    if (c.dataset.on === 'true') {
      gsap.delayedCall(0.9 + i * 0.09, () => {
        c.classList.add('on');
        c.textContent = '✓';
      });
    }
  });
  gsap.fromTo('#ftable tr', { x: 40, opacity: 0 }, { x: 0, opacity: 1, stagger: 0.12, duration: 0.7, ease: 'expo.out', delay: 0.6 });
}

/* ───────────── 06 · R3: árbol sintáctico real ───────────── */
const AST_FORMULA = '∀x (Primo(x) → ¬Par(x) ∨ x = y)';

interface TreeNode {
  label: string;
  op: boolean;
  children: TreeNode[];
  x: number;
  y: number;
}

function toTree(f: Formula): TreeNode {
  const node = (label: string, op: boolean, children: Formula[]): TreeNode => ({
    label,
    op,
    children: children.map(toTree),
    x: 0,
    y: 0,
  });
  switch (f.kind) {
    case 'ForAll':
      return node(`∀${f.variable}`, true, [f.body]);
    case 'Exists':
      return node(`∃${f.variable}`, true, [f.body]);
    case 'Not':
      return node('¬', true, [f.operand]);
    case 'And':
      return node('∧', true, [f.left, f.right]);
    case 'Or':
      return node('∨', true, [f.left, f.right]);
    case 'Implies':
      return node('→', true, [f.left, f.right]);
    case 'Iff':
      return node('↔', true, [f.left, f.right]);
    case 'Equals':
      return node(`${termToString(f.left)} = ${termToString(f.right)}`, false, []);
    default:
      return node(formulaToString(f), false, []);
  }
}

function fullyParenthesized(f: Formula): string {
  const sym: Record<string, string> = { And: '∧', Or: '∨', Implies: '→', Iff: '↔' };
  switch (f.kind) {
    case 'And':
    case 'Or':
    case 'Implies':
    case 'Iff':
      return `(${fullyParenthesized(f.left)} ${sym[f.kind]} ${fullyParenthesized(f.right)})`;
    case 'Not':
      return `¬${fullyParenthesized(f.operand)}`;
    case 'ForAll':
      return `∀${f.variable} ${fullyParenthesized(f.body)}`;
    case 'Exists':
      return `∃${f.variable} ${fullyParenthesized(f.body)}`;
    default:
      return formulaToString(f);
  }
}

export function buildAst(): void {
  const sig = buildSignature(NUMBERS.language);
  const formula = parse(AST_FORMULA, sig);
  $('#ast-formula').textContent = AST_FORMULA;

  // Precedencia: la misma cadena sin paréntesis, como la agrupa el parser.
  const precText = 'Par(x) ∨ Primo(x) ∧ Impar(x) → Par(y)';
  $('#paren-in').textContent = precText;
  $('#paren-out').textContent = fullyParenthesized(parse(precText, sig));

  const root = toTree(formula);
  let leaf = 0;
  const NODE_W = 120;
  const LEVEL_H = 86;
  let maxDepth = 0;
  const layout = (n: TreeNode, depth: number) => {
    maxDepth = Math.max(maxDepth, depth);
    n.y = depth * LEVEL_H + 30;
    if (n.children.length === 0) {
      n.x = leaf++ * NODE_W + NODE_W / 2;
    } else {
      n.children.forEach((c) => layout(c, depth + 1));
      n.x = n.children.reduce((s, c) => s + c.x, 0) / n.children.length;
    }
  };
  layout(root, 0);
  const width = leaf * NODE_W;
  const height = maxDepth * LEVEL_H + 60;
  const svg = $('#ast') as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  let lines = '';
  let nodes = '';
  const walk = (n: TreeNode, depth: number) => {
    for (const c of n.children) {
      lines += `<line x1="${n.x}" y1="${n.y}" x2="${c.x}" y2="${c.y}" data-d="${depth}"/>`;
      walk(c, depth + 1);
    }
    const w = Math.max(44, n.label.length * 10 + 22);
    nodes += `<g class="node${n.op ? ' op' : ''}" data-d="${depth}" transform="translate(${n.x},${n.y})"><rect x="${-w / 2}" y="-17" width="${w}" height="34" rx="17"/><text>${n.label}</text></g>`;
  };
  walk(root, 0);
  svg.innerHTML = lines + nodes;
}

export function playAst(): void {
  const svg = $('#ast');
  const lines = svg.querySelectorAll<SVGLineElement>('line');
  lines.forEach((l) => {
    const len = Math.hypot(+l.getAttribute('x2')! - +l.getAttribute('x1')!, +l.getAttribute('y2')! - +l.getAttribute('y1')!);
    l.style.strokeDasharray = `${len}`;
    gsap.fromTo(l, { strokeDashoffset: len }, { strokeDashoffset: 0, duration: 0.5, ease: 'power2.out', delay: 0.25 + +l.dataset.d! * 0.28 });
  });
  svg.querySelectorAll<SVGGElement>('.node').forEach((g) => {
    const d = +g.dataset.d!;
    gsap.fromTo(
      g.children,
      { scale: 0, transformOrigin: '50% 50%' },
      { scale: 1, duration: 0.6, ease: 'back.out(2.4)', delay: d * 0.28 },
    );
  });
}

/* ───────────── 07 · R4: alcance y variable libre ───────────── */
export function playScope(): void {
  const formula = parse('∀x P(x) ∧ Q(x)', {
    functions: new Map(),
    predicates: new Map([
      ['P', 1],
      ['Q', 1],
    ]),
  });
  $('#fv-out').textContent = `{ ${freeVariables(formula).join(', ')} }`;

  const scope = $('#scope');
  const q = scope.querySelector<HTMLElement>('.q')!;
  const firstB = scope.querySelectorAll<HTMLElement>('.b')[0];
  const free = scope.querySelector<HTMLElement>('.free')!;
  const base = scope.getBoundingClientRect();
  const qr = q.getBoundingClientRect();
  const br = firstB.getBoundingClientRect();
  const fr = free.getBoundingClientRect();
  const bar = scope.querySelector<HTMLElement>('.scope-bar')!;
  bar.style.left = `${qr.left - base.left}px`;
  bar.style.width = `${br.right - qr.left}px`;
  const freeLbl = scope.querySelector<HTMLElement>('.scope-free')!;
  freeLbl.style.left = `${fr.left - base.left - 20}px`;

  const tl = gsap.timeline();
  tl.fromTo('#scope .scope-formula > *', { y: 60, opacity: 0 }, { y: 0, opacity: 1, stagger: 0.1, duration: 0.8, ease: 'expo.out' })
    .fromTo('#scope .bar', { scaleX: 0 }, { scaleX: 1, duration: 0.9, ease: 'expo.inOut' }, '+=0.1')
    .fromTo('#scope .scope-bar .lbl', { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: 0.4 })
    .fromTo(free, { scale: 1 }, { scale: 1.5, duration: 0.25, yoyo: true, repeat: 3, ease: 'power2.inOut' })
    .fromTo(freeLbl, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.5, ease: 'back.out(2)' }, '<');
}

/* ───────────── 08 · R5: botonera que escribe sola ───────────── */
const TYPE_SCRIPT = ['∀', 'x', ' ', '(', 'Primo(x)', ' ', '→', ' ', '¬', 'Par(x)', ' ', '∨', ' ', '∃', 'y', ' ', 'y', ' ', '=', ' ', 'x', ')'];
let typeTl: gsap.core.Timeline | null = null;
export function playTyping(): void {
  const out = $('#type-out');
  const keys = new Map(
    [...document.querySelectorAll<HTMLButtonElement>('#keys button')].map((b) => [b.dataset.k!, b]),
  );
  typeTl?.kill();
  out.textContent = '';
  typeTl = gsap.timeline({ repeat: -1, repeatDelay: 1.6, onRepeat: () => (out.textContent = '') });
  for (const tok of TYPE_SCRIPT) {
    const btn = keys.get(tok);
    typeTl.call(
      () => {
        out.textContent += tok;
        if (btn) {
          btn.classList.add('hit');
          window.setTimeout(() => btn.classList.remove('hit'), 220);
        }
      },
      [],
      `+=${btn ? 0.32 : 0.16}`,
    );
  }
  typeTl.to({}, { duration: 0.1 });

  // También se puede jugar con los botones.
  keys.forEach((btn, k) => {
    btn.onclick = () => {
      typeTl?.pause();
      out.textContent += k;
      btn.classList.add('hit');
      window.setTimeout(() => btn.classList.remove('hit'), 200);
    };
  });
}

/* ───────────── 09 · R6: los cuatro casos, calculados en vivo ───────────── */
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
