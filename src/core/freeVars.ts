import type { Formula, Term } from './ast';

// Devuelve las variables libres en orden de primera aparición, sin repetir.
export function freeVariables(formula: Formula): string[] {
  const found = new Set<string>();
  collectFromFormula(formula, new Set(), found);
  return [...found];
}

function collectFromFormula(
  formula: Formula,
  bound: ReadonlySet<string>,
  found: Set<string>,
): void {
  switch (formula.kind) {
    case 'Top':
    case 'Bottom':
      return;
    case 'Pred':
      formula.args.forEach((arg) => collectFromTerm(arg, bound, found));
      return;
    case 'Equals':
      collectFromTerm(formula.left, bound, found);
      collectFromTerm(formula.right, bound, found);
      return;
    case 'Not':
      collectFromFormula(formula.operand, bound, found);
      return;
    case 'And':
    case 'Or':
    case 'Implies':
    case 'Iff':
      collectFromFormula(formula.left, bound, found);
      collectFromFormula(formula.right, bound, found);
      return;
    case 'ForAll':
    case 'Exists':
      // Se crea un conjunto nuevo para que la ligadura solo valga dentro del cuerpo:
      // en P(x) ∧ ∀x Q(x), la x de P(x) sigue libre.
      collectFromFormula(formula.body, new Set([...bound, formula.variable]), found);
      return;
  }
}

function collectFromTerm(term: Term, bound: ReadonlySet<string>, found: Set<string>): void {
  if (term.kind === 'Var') {
    if (!bound.has(term.name)) {
      found.add(term.name);
    }
    return;
  }
  term.args.forEach((arg) => collectFromTerm(arg, bound, found));
}
