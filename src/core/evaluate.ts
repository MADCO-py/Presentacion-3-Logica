import type { BinaryFormula, Equals, Exists, ForAll, Formula, Not, Pred, Term } from './ast';
import { termToString } from './ast';
import { lookup, type Environment, type Interpretation } from './model';
import { formatApplication, tupleKey, type Tuple } from './tuples';
import type { ValidInput } from './validate';

// Cada cuantificador multiplica el árbol por |D|, así que crece como |D|^k con k cuantificadores
// anidados. Con |D| = 10 y k = 4 hay 1 + 10 + 10² + 10³ + 10⁴ ≈ 11 000 nodos; 20 000 cubre ese caso
// con margen y sigue siendo manejable para dibujar el árbol en la UI.
export const MAX_EVAL_NODES = 20_000;

export const ROOT_ID = 'r';

export interface TermValue {
  term: Term;
  value: string;
  // El paso intermedio de la regla: "e(x)" para una variable, "f^I(a)" para una aplicación.
  application: string;
  // La cadena completa, p. ej. "f(c) = f^I(a) = b".
  derivation: string;
  args: TermValue[];
}

export type EvalReason =
  | { kind: 'truth-constant' }
  | { kind: 'atom'; predicate: string; terms: TermValue[]; tuple: Tuple; inRelation: boolean }
  | { kind: 'equality'; left: TermValue; right: TermValue }
  | { kind: 'connective' }
  | { kind: 'witness'; variable: string; element: string }
  | { kind: 'counterexample'; variable: string; element: string }
  | { kind: 'exhaustive'; variable: string; elements: string[] };

export interface EvalNode {
  id: string;
  formula: Formula;
  env: Environment;
  value: boolean;
  children: EvalNode[];
  // Si este nodo determina el valor de su padre. La raíz siempre es decisiva.
  decisive: boolean;
  reason: EvalReason;
}

export interface EvalSuccess {
  ok: true;
  root: EvalNode;
  steps: EvalNode[];
  decisivePath: string[];
}

export type EvalResult = EvalSuccess | { ok: false; message: string };

// La interpretación con búsquedas rápidas: f^I como tabla tupla → valor y P^I como conjunto.
export interface Structure {
  domain: string[];
  functions: Map<string, Map<string, string>>;
  predicates: Map<string, Set<string>>;
}

export function buildStructure(interpretation: Interpretation): Structure {
  const functions = new Map(
    Object.entries(interpretation.functions).map(([name, entries]) => [
      name,
      new Map(entries.map(({ args, value }) => [tupleKey(args), value])),
    ]),
  );
  const predicates = new Map(
    Object.entries(interpretation.predicates).map(([name, tuples]) => [
      name,
      new Set(tuples.map(tupleKey)),
    ]),
  );
  return { domain: interpretation.domain, functions, predicates };
}

// ⟦x⟧ = e(x) y ⟦f(t₁,…,tₙ)⟧ = f^I(⟦t₁⟧,…,⟦tₙ⟧).
export function evalTerm(term: Term, structure: Structure, env: Environment): TermValue {
  if (term.kind === 'Var') {
    const value = lookup(env, term.name);
    if (value === undefined) {
      throw new Error(`La variable '${term.name}' no tiene valor en el entorno`);
    }
    const application = `e(${term.name})`;
    return {
      term,
      value,
      application,
      derivation: `${term.name} = ${application} = ${value}`,
      args: [],
    };
  }
  const args = term.args.map((arg) => evalTerm(arg, structure, env));
  const argValues = args.map((arg) => arg.value);
  const value = structure.functions.get(term.name)?.get(tupleKey(argValues));
  if (value === undefined) {
    throw new Error(
      `${formatApplication(term.name, argValues)} no está definida en la interpretación`,
    );
  }
  const application = formatApplication(`${term.name}^I`, argValues);
  const derivation = `${termToString(term)} = ${application} = ${value}`;
  return { term, value, application, derivation, args };
}

export function evaluate(
  input: ValidInput,
  formula: Formula = input.formula,
  env: Environment = input.environment,
): EvalResult {
  const evaluator = new Evaluator(buildStructure(input.interpretation));
  try {
    const root = { ...evaluator.evalFormula(formula, env, ROOT_ID), decisive: true };
    return { ok: true, root, steps: postorder(root), decisivePath: decisiveIds(root) };
  } catch (error) {
    if (error instanceof NodeLimitExceeded) {
      return {
        ok: false,
        message: `La evaluación necesita más de ${MAX_EVAL_NODES} pasos. Reduce el dominio o la cantidad de cuantificadores anidados.`,
      };
    }
    throw error;
  }
}

class NodeLimitExceeded extends Error {}

class Evaluator {
  private readonly structure: Structure;
  private nodeCount = 0;

  constructor(structure: Structure) {
    this.structure = structure;
  }

  evalFormula(formula: Formula, env: Environment, id: string): EvalNode {
    this.nodeCount++;
    if (this.nodeCount > MAX_EVAL_NODES) {
      throw new NodeLimitExceeded();
    }
    switch (formula.kind) {
      case 'Top':
        return leaf(id, formula, env, true, { kind: 'truth-constant' });
      case 'Bottom':
        return leaf(id, formula, env, false, { kind: 'truth-constant' });
      case 'Pred':
        return this.evalPredicate(formula, env, id);
      case 'Equals':
        return this.evalEquality(formula, env, id);
      case 'Not':
        return this.evalNot(formula, env, id);
      case 'And':
      case 'Or':
      case 'Implies':
      case 'Iff':
        return this.evalBinary(formula, env, id);
      case 'ForAll':
        return this.evalForAll(formula, env, id);
      case 'Exists':
        return this.evalExists(formula, env, id);
    }
  }

  // I, e ⊨ P(t₁,…,tₙ) sii (⟦t₁⟧,…,⟦tₙ⟧) ∈ P^I
  private evalPredicate(formula: Pred, env: Environment, id: string): EvalNode {
    const terms = formula.args.map((arg) => evalTerm(arg, this.structure, env));
    const tuple = terms.map((term) => term.value);
    const inRelation = this.structure.predicates.get(formula.name)?.has(tupleKey(tuple)) ?? false;
    const reason: EvalReason = {
      kind: 'atom',
      predicate: formula.name,
      terms,
      tuple,
      inRelation,
    };
    return leaf(id, formula, env, inRelation, reason);
  }

  // I, e ⊨ t₁ = t₂ sii ⟦t₁⟧ = ⟦t₂⟧
  private evalEquality(formula: Equals, env: Environment, id: string): EvalNode {
    const left = evalTerm(formula.left, this.structure, env);
    const right = evalTerm(formula.right, this.structure, env);
    return leaf(id, formula, env, left.value === right.value, { kind: 'equality', left, right });
  }

  // I, e ⊨ ¬φ sii I, e ⊭ φ
  private evalNot(formula: Not, env: Environment, id: string): EvalNode {
    const operand = this.evalFormula(formula.operand, env, `${id}/0`);
    return {
      id,
      formula,
      env,
      value: !operand.value,
      children: [{ ...operand, decisive: true }],
      decisive: false,
      reason: { kind: 'connective' },
    };
  }

  // Se evalúan siempre los dos lados para que el árbol quede completo; los decisivos indican cuáles
  // bastan para justificar el resultado.
  private evalBinary(formula: BinaryFormula, env: Environment, id: string): EvalNode {
    const left = this.evalFormula(formula.left, env, `${id}/0`);
    const right = this.evalFormula(formula.right, env, `${id}/1`);
    const { value, decisive } = BINARY_RULES[formula.kind](left.value, right.value);
    return {
      id,
      formula,
      env,
      value,
      children: [
        { ...left, decisive: decisive[0] },
        { ...right, decisive: decisive[1] },
      ],
      decisive: false,
      reason: { kind: 'connective' },
    };
  }

  // I, e ⊨ ∀x φ sii para todo d ∈ D, I, e[x ↦ d] ⊨ φ
  private evalForAll(formula: ForAll, env: Environment, id: string): EvalNode {
    const children = this.evalForEachElement(formula, env, id);
    const counterexample = children.findIndex((child) => !child.value);
    if (counterexample === -1) {
      return quantifierNode(id, formula, env, true, children, exhaustive(formula, this.structure));
    }
    const reason: EvalReason = {
      kind: 'counterexample',
      variable: formula.variable,
      element: this.elementAt(counterexample),
    };
    return quantifierNode(id, formula, env, false, children, reason, counterexample);
  }

  // I, e ⊨ ∃x φ sii existe d ∈ D tal que I, e[x ↦ d] ⊨ φ
  private evalExists(formula: Exists, env: Environment, id: string): EvalNode {
    const children = this.evalForEachElement(formula, env, id);
    const witness = children.findIndex((child) => child.value);
    if (witness === -1) {
      return quantifierNode(id, formula, env, false, children, exhaustive(formula, this.structure));
    }
    const reason: EvalReason = {
      kind: 'witness',
      variable: formula.variable,
      element: this.elementAt(witness),
    };
    return quantifierNode(id, formula, env, true, children, reason, witness);
  }

  // Se recorre todo D aunque el resultado ya se conozca, para que la UI muestre la tabla completa.
  private evalForEachElement(formula: ForAll | Exists, env: Environment, id: string): EvalNode[] {
    return this.structure.domain.map((element) =>
      this.evalFormula(
        formula.body,
        { ...env, [formula.variable]: element },
        `${id}/${formula.variable}=${encodeURIComponent(element)}`,
      ),
    );
  }

  private elementAt(index: number): string {
    const element = this.structure.domain[index];
    if (element === undefined) {
      throw new Error(`No hay elemento en la posición ${index} del dominio`);
    }
    return element;
  }
}

type BinaryRule = (
  left: boolean,
  right: boolean,
) => { value: boolean; decisive: [boolean, boolean] };

const BINARY_RULES: Record<BinaryFormula['kind'], BinaryRule> = {
  // V: hacen falta los dos. F: basta el primer conjunto falso.
  And: (left, right) => ({
    value: left && right,
    decisive: left && right ? [true, true] : left ? [false, true] : [true, false],
  }),
  // V: basta el primer disyunto verdadero. F: hacen falta los dos.
  Or: (left, right) => ({
    value: left || right,
    decisive: left || right ? (left ? [true, false] : [false, true]) : [true, true],
  }),
  // F: antecedente V y consecuente F. V: basta un antecedente F o, si no, el consecuente V.
  Implies: (left, right) => ({
    value: !left || right,
    decisive: left && !right ? [true, true] : !left ? [true, false] : [false, true],
  }),
  // El valor de ↔ siempre depende de comparar los dos lados.
  Iff: (left, right) => ({ value: left === right, decisive: [true, true] }),
};

function leaf(
  id: string,
  formula: Formula,
  env: Environment,
  value: boolean,
  reason: EvalReason,
): EvalNode {
  return { id, formula, env, value, children: [], decisive: false, reason };
}

// Con testigo o contraejemplo, solo ese hijo es decisivo; sin él (comprobación completa) lo son todos.
function quantifierNode(
  id: string,
  formula: ForAll | Exists,
  env: Environment,
  value: boolean,
  children: EvalNode[],
  reason: EvalReason,
  decisiveIndex?: number,
): EvalNode {
  return {
    id,
    formula,
    env,
    value,
    children: children.map((child, index) => ({
      ...child,
      decisive: decisiveIndex === undefined || index === decisiveIndex,
    })),
    decisive: false,
    reason,
  };
}

function exhaustive(formula: ForAll | Exists, structure: Structure): EvalReason {
  return { kind: 'exhaustive', variable: formula.variable, elements: structure.domain };
}

// Postorden: primero los hijos y luego el padre, que es el orden en que se calculan los valores.
function postorder(node: EvalNode): EvalNode[] {
  return [...node.children.flatMap(postorder), node];
}

function decisiveIds(node: EvalNode): string[] {
  return [
    node.id,
    ...node.children.filter((child) => child.decisive).flatMap((child) => decisiveIds(child)),
  ];
}
