import { formulaToString, termToString, type Formula, type Term } from './ast';
import type { EvalNode, EvalReason, EvalSuccess, TermValue } from './evaluate';
import { freeVariables } from './freeVars';
import { lookup, type Environment } from './model';
import { formatTuple } from './tuples';

export interface ExplanationLine {
  id: string;
  depth: number;
  decisive: boolean;
  text: string;
}

export interface CheckRow {
  nodeId: string;
  element: string;
  termValues: string[];
  value: boolean;
}

export interface CheckTable {
  variable: string;
  termColumns: string[];
  rows: CheckRow[];
}

export interface Explanation {
  summary: string;
  details: ExplanationLine[];
  table?: CheckTable;
}

export function explain(result: EvalSuccess): Explanation {
  const { root } = result;
  const explanation = { summary: summarize(root), details: detailLines(root, 0) };
  return root.reason.kind === 'exhaustive'
    ? { ...explanation, table: buildCheckTable(root) }
    : explanation;
}

export function formatEnvironment(env: Environment): string {
  const pairs = Object.entries(env).map(([variable, element]) => `${variable} ↦ ${element}`);
  return `{${pairs.join(', ')}}`;
}

// La raíz se muestra tal como la escribió el usuario; si es abierta, se agrega su entorno.
function summarize(root: EvalNode): string {
  const formula = formulaToString(root.formula);
  return `${formula} es ${truthWord(root.value)}${environmentSuffix(root)}: ${because(root)}.`;
}

function environmentSuffix(node: EvalNode): string {
  const free = freeVariables(node.formula);
  if (free.length === 0) {
    return '';
  }
  const relevant = Object.fromEntries(
    Object.entries(node.env).filter(([variable]) => free.includes(variable)),
  );
  return ` con ${formatEnvironment(relevant)}`;
}

function detailLines(node: EvalNode, depth: number): ExplanationLine[] {
  const line = {
    id: node.id,
    depth,
    decisive: node.decisive,
    text: `${show(node)} es ${truthWord(node.value)}: ${because(node)}`,
  };
  return [line, ...node.children.flatMap((child) => detailLines(child, depth + 1))];
}

function because(node: EvalNode): string {
  const reason = node.reason;
  switch (reason.kind) {
    case 'truth-constant':
      return node.value ? '⊤ es verdadera por definición' : '⊥ es falsa por definición';
    case 'atom':
      return atomReason(node, reason);
    case 'equality':
      return equalityReason(node, reason);
    case 'connective':
      return connectiveReason(node);
    case 'witness':
      return `testigo ${reason.variable} = ${reason.element}, porque ${childReason(decisiveChild(node))}`;
    case 'counterexample':
      return `contraejemplo ${reason.variable} = ${reason.element}, porque ${childReason(decisiveChild(node))}`;
    case 'exhaustive':
      return exhaustiveReason(node.value, reason.elements.length);
  }
}

// Los átomos y conectivos ya nombran sus subfórmulas al explicarse; un cuantificador no, así que se
// antepone cuál es y cuánto vale para no perder el sujeto: "∃y R(b, f(y)) es falsa, ya que …".
function childReason(child: EvalNode): string {
  const reason = child.reason;
  if (reason.kind === 'exhaustive') {
    return `${show(child)} es ${truthWord(child.value)}, ya que ${because(child)}`;
  }
  if (reason.kind === 'witness' || reason.kind === 'counterexample') {
    return `${show(child)} es ${truthWord(child.value)}, con ${because(child)}`;
  }
  return because(child);
}

function atomReason(node: EvalNode, reason: Extract<EvalReason, { kind: 'atom' }>): string {
  const symbol = reason.inRelation ? '∈' : '∉';
  const membership = `${formatTuple(reason.tuple)} ${symbol} ${reason.predicate}^I`;
  const termFacts = reason.terms
    .filter((term) => term.term.kind === 'App')
    .map((term) => termFact(term, node.env));
  const justification =
    termFacts.length > 0 ? `${termFacts.join(', ')} y ${membership}` : membership;
  return `${show(node)} ${reason.inRelation ? 'se cumple' : 'no se cumple'}, ya que ${justification}`;
}

// Como la derivación de evaluate, pero con las variables reemplazadas: f(a) = f^I(a) = b.
function termFact(termValue: TermValue, env: Environment): string {
  return `${showTerm(termValue.term, env)} = ${termValue.application} = ${termValue.value}`;
}

function equalityReason(node: EvalNode, reason: Extract<EvalReason, { kind: 'equality' }>): string {
  if (node.value) {
    return `${show(node)} se cumple, ya que ambos lados valen ${reason.left.value}`;
  }
  const left = showTerm(reason.left.term, node.env);
  const right = showTerm(reason.right.term, node.env);
  return `${show(node)} no se cumple, ya que ${left} vale ${reason.left.value} y ${right} vale ${reason.right.value}`;
}

function connectiveReason(node: EvalNode): string {
  const kind = node.formula.kind;
  if (kind === 'Not') {
    const operand = childAt(node, 0);
    return `${show(operand)} es ${truthWord(operand.value)}`;
  }
  const left = childAt(node, 0);
  const right = childAt(node, 1);
  switch (kind) {
    case 'And':
      return node.value
        ? `${show(left)} y ${show(right)} son verdaderas`
        : `${show(decisiveChild(node))} es falsa`;
    case 'Or':
      return node.value
        ? `${show(decisiveChild(node))} es verdadera`
        : `${show(left)} y ${show(right)} son falsas`;
    case 'Implies':
      if (!node.value) {
        return `${show(left)} es verdadera y ${show(right)} es falsa, así que la implicación falla`;
      }
      return left.value
        ? `el consecuente ${show(right)} es verdadero`
        : `el antecedente ${show(left)} es falso`;
    case 'Iff':
      return left.value === right.value
        ? `${show(left)} y ${show(right)} son ambas ${left.value ? 'verdaderas' : 'falsas'}`
        : `${show(left)} es ${truthWord(left.value)} y ${show(right)} es ${truthWord(right.value)}`;
    default:
      throw new Error(`'${kind}' no es un conectivo`);
  }
}

function exhaustiveReason(value: boolean, count: number): string {
  if (value) {
    return count === 1
      ? 'se comprobó para el único elemento de D'
      : `se comprobó para los ${count} elementos de D`;
  }
  return count === 1
    ? 'el único elemento de D no sirve como testigo'
    : `ningún elemento de D sirve como testigo (se comprobaron los ${count})`;
}

// Tabla de la comprobación completa: una fila por elemento de D con los términos que se evaluaron
// en esa fila. No se entra a cuantificadores internos, porque ahí los valores cambian por fila.
export function buildCheckTable(node: EvalNode): CheckTable {
  if (node.formula.kind !== 'ForAll' && node.formula.kind !== 'Exists') {
    throw new Error('La tabla de comprobación solo existe para cuantificadores');
  }
  const variable = node.formula.variable;
  const termsByRow = node.children.map((child) => collectTermValues(child, new Map()));
  const termColumns = [...new Set(termsByRow.flatMap((terms) => [...terms.keys()]))];
  const rows = node.children.map((child, index) => ({
    nodeId: child.id,
    element: lookup(child.env, variable) ?? '',
    termValues: termColumns.map((column) => termsByRow[index]?.get(column) ?? ''),
    value: child.value,
  }));
  return { variable, termColumns, rows };
}

function collectTermValues(node: EvalNode, found: Map<string, string>): Map<string, string> {
  const reason = node.reason;
  if (reason.kind === 'atom') {
    reason.terms.forEach((term) => addApplications(term, found));
  } else if (reason.kind === 'equality') {
    addApplications(reason.left, found);
    addApplications(reason.right, found);
  }
  if (node.formula.kind !== 'ForAll' && node.formula.kind !== 'Exists') {
    node.children.forEach((child) => collectTermValues(child, found));
  }
  return found;
}

// Las variables ya aparecen en la columna del elemento; solo interesan las aplicaciones.
function addApplications(termValue: TermValue, found: Map<string, string>): void {
  if (termValue.term.kind === 'Var') {
    return;
  }
  termValue.args.forEach((arg) => addApplications(arg, found));
  found.set(termToString(termValue.term), termValue.value);
}

function decisiveChild(node: EvalNode): EvalNode {
  const child = node.children.find((candidate) => candidate.decisive);
  if (!child) {
    throw new Error(`El nodo ${node.id} no tiene un hijo decisivo`);
  }
  return child;
}

function childAt(node: EvalNode, index: number): EvalNode {
  const child = node.children[index];
  if (!child) {
    throw new Error(`El nodo ${node.id} no tiene hijo en la posición ${index}`);
  }
  return child;
}

function truthWord(value: boolean): string {
  return value ? 'verdadera' : 'falsa';
}

// Las subfórmulas se muestran con sus variables libres reemplazadas por su valor: P(b) en vez de
// P(x) con x ↦ b, que es como se lee en clase.
function show(node: EvalNode): string {
  return formulaToString(instantiate(node.formula, node.env));
}

function showTerm(term: Term, env: Environment): string {
  return termToString(instantiateTerm(term, env));
}

function instantiate(formula: Formula, env: Environment): Formula {
  switch (formula.kind) {
    case 'Top':
    case 'Bottom':
      return formula;
    case 'Pred':
      return { ...formula, args: formula.args.map((arg) => instantiateTerm(arg, env)) };
    case 'Equals':
      return {
        ...formula,
        left: instantiateTerm(formula.left, env),
        right: instantiateTerm(formula.right, env),
      };
    case 'Not':
      return { ...formula, operand: instantiate(formula.operand, env) };
    case 'And':
    case 'Or':
    case 'Implies':
    case 'Iff':
      return {
        ...formula,
        left: instantiate(formula.left, env),
        right: instantiate(formula.right, env),
      };
    case 'ForAll':
    case 'Exists':
      // Dentro del cuantificador la variable vuelve a estar ligada y no se reemplaza.
      return { ...formula, body: instantiate(formula.body, without(env, formula.variable)) };
  }
}

function instantiateTerm(term: Term, env: Environment): Term {
  if (term.kind === 'Var') {
    const value = lookup(env, term.name);
    return value === undefined ? term : { ...term, name: value };
  }
  return { ...term, args: term.args.map((arg) => instantiateTerm(arg, env)) };
}

function without(env: Environment, variable: string): Environment {
  return Object.fromEntries(Object.entries(env).filter(([name]) => name !== variable));
}
