export interface Span {
  start: number;
  end: number;
}

export interface Var {
  kind: 'Var';
  name: string;
  span: Span;
}

export interface App {
  kind: 'App';
  name: string;
  args: Term[];
  span: Span;
}

export type Term = Var | App;

export interface Top {
  kind: 'Top';
  span: Span;
}

export interface Bottom {
  kind: 'Bottom';
  span: Span;
}

export interface Pred {
  kind: 'Pred';
  name: string;
  args: Term[];
  span: Span;
}

export interface Equals {
  kind: 'Equals';
  left: Term;
  right: Term;
  span: Span;
}

export interface Not {
  kind: 'Not';
  operand: Formula;
  span: Span;
}

interface Binary<K extends string> {
  kind: K;
  left: Formula;
  right: Formula;
  span: Span;
}

export type And = Binary<'And'>;
export type Or = Binary<'Or'>;
export type Implies = Binary<'Implies'>;
export type Iff = Binary<'Iff'>;
export type BinaryFormula = And | Or | Implies | Iff;

interface Quantified<K extends string> {
  kind: K;
  variable: string;
  body: Formula;
  span: Span;
}

export type ForAll = Quantified<'ForAll'>;
export type Exists = Quantified<'Exists'>;

export type Formula = Top | Bottom | Pred | Equals | Not | BinaryFormula | ForAll | Exists;

// Mayor número = liga más fuerte. Debe coincidir con el orden de funciones del parser.
const PRECEDENCE: Record<Formula['kind'], number> = {
  Iff: 1,
  Implies: 2,
  Or: 3,
  And: 4,
  Not: 5,
  ForAll: 5,
  Exists: 5,
  Top: 6,
  Bottom: 6,
  Pred: 6,
  Equals: 6,
};

const BINARY_SYMBOL: Record<BinaryFormula['kind'], string> = {
  And: '∧',
  Or: '∨',
  Implies: '→',
  Iff: '↔',
};

export function termToString(term: Term): string {
  return term.kind === 'Var' ? term.name : applicationToString(term.name, term.args);
}

function applicationToString(name: string, args: Term[]): string {
  return args.length === 0 ? name : `${name}(${args.map(termToString).join(', ')})`;
}

export function formulaToString(formula: Formula): string {
  switch (formula.kind) {
    case 'Top':
      return '⊤';
    case 'Bottom':
      return '⊥';
    case 'Pred':
      return applicationToString(formula.name, formula.args);
    case 'Equals':
      return `${termToString(formula.left)} = ${termToString(formula.right)}`;
    case 'Not':
      return `¬${wrap(formula.operand, PRECEDENCE.Not)}`;
    case 'ForAll':
      return `∀${formula.variable} ${wrap(formula.body, PRECEDENCE.ForAll)}`;
    case 'Exists':
      return `∃${formula.variable} ${wrap(formula.body, PRECEDENCE.Exists)}`;
    case 'And':
    case 'Or':
    case 'Implies':
    case 'Iff':
      return binaryToString(formula);
  }
}

function binaryToString(formula: BinaryFormula): string {
  const precedence = PRECEDENCE[formula.kind];
  const rightAssociative = formula.kind === 'Implies' || formula.kind === 'Iff';
  // El lado hacia el que asocia el operador acepta su mismo nivel sin paréntesis;
  // el otro lado necesita un nivel estrictamente mayor.
  const left = wrap(formula.left, rightAssociative ? precedence + 1 : precedence);
  const right = wrap(formula.right, rightAssociative ? precedence : precedence + 1);
  return `${left} ${BINARY_SYMBOL[formula.kind]} ${right}`;
}

function wrap(formula: Formula, minimumPrecedence: number): string {
  const text = formulaToString(formula);
  return PRECEDENCE[formula.kind] < minimumPrecedence ? `(${text})` : text;
}
