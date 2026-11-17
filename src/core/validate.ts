import type { Formula, Span, Term } from './ast';
import { ParseError } from './errors';
import { freeVariables } from './freeVars';
import { isIdentifier, isReservedWord } from './lexer';
import {
  lookup,
  type Environment,
  type FunctionEntry,
  type Interpretation,
  type Language,
  type SymbolDeclaration,
} from './model';
import { parse } from './parser';
import type { Signature } from './signature';
import {
  allTuples,
  formatApplication,
  formatTuple,
  superscript,
  tupleKey,
  type Tuple,
} from './tuples';

// El path indica qué campo de la UI provocó el error, p. ej. ['language', 'functions', 0, 'arity'].
export type ValidationPath = (string | number)[];

export type ValidationErrorCode =
  | 'empty-name'
  | 'invalid-name'
  | 'reserved-name'
  | 'invalid-arity'
  | 'nullary-predicate'
  | 'duplicate-name'
  | 'empty-domain'
  | 'empty-element'
  | 'duplicate-element'
  | 'empty-function'
  | 'missing-value'
  | 'value-outside-domain'
  | 'duplicate-entry'
  | 'empty-relation'
  | 'tuple-length'
  | 'tuple-outside-domain'
  | 'syntax'
  | 'undeclared-symbol'
  | 'arity-mismatch'
  | 'unassigned-variable'
  | 'assignment-outside-domain';

export interface ValidationError {
  code: ValidationErrorCode;
  path: ValidationPath;
  message: string;
  span?: Span;
}

// Un error todavía sin ubicar: quien lo detecta sabe qué pasó, y quien lo llama sabe dónde.
type Problem = Pick<ValidationError, 'code' | 'message'>;

export interface EvaluationInput {
  language: Language;
  interpretation: Interpretation;
  formulaText: string;
  environment: Environment;
}

export interface ValidInput {
  formula: Formula;
  signature: Signature;
  freeVariables: string[];
  interpretation: Interpretation;
  environment: Environment;
}

export type ValidationResult =
  { ok: true; value: ValidInput } | { ok: false; errors: ValidationError[] };

// Única puerta de entrada a la evaluación: si hay cualquier error, no se devuelve una entrada
// válida y por lo tanto no hay forma de obtener un valor de verdad.
export function validateInput(input: EvaluationInput): ValidationResult {
  const languageErrors = validateLanguage(input.language);
  if (languageErrors.length > 0) {
    // Con un lenguaje inválido (p. ej. nombres repetidos) no se sabe qué es cada identificador,
    // así que no tiene sentido revisar la fórmula ni la interpretación todavía.
    return { ok: false, errors: languageErrors };
  }
  const signature = buildSignature(input.language);
  const errors = validateInterpretation(input.language, input.interpretation);
  const formulaCheck = checkFormula(input.formulaText, signature);
  errors.push(...formulaCheck.errors);
  if (!formulaCheck.formula) {
    return { ok: false, errors };
  }
  const variables = freeVariables(formulaCheck.formula);
  errors.push(...validateEnvironment(variables, input.environment, input.interpretation.domain));
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      formula: formulaCheck.formula,
      signature,
      freeVariables: variables,
      interpretation: input.interpretation,
      environment: input.environment,
    },
  };
}

export function buildSignature(language: Language): Signature {
  return {
    functions: new Map(language.functions.map(({ name, arity }) => [name, arity])),
    predicates: new Map(language.predicates.map(({ name, arity }) => [name, arity])),
  };
}

type SymbolGroup = 'functions' | 'predicates';

const GROUP_LABEL: Record<SymbolGroup, string> = {
  functions: 'símbolo funcional',
  predicates: 'predicado',
};

export function validateLanguage(language: Language): ValidationError[] {
  return [
    ...language.functions.flatMap((declaration, index) =>
      validateDeclaration(declaration, 'functions', index),
    ),
    ...language.predicates.flatMap((declaration, index) =>
      validateDeclaration(declaration, 'predicates', index),
    ),
    ...findDuplicateNames(language),
  ];
}

function validateDeclaration(
  declaration: SymbolDeclaration,
  group: SymbolGroup,
  index: number,
): ValidationError[] {
  const path = ['language', group, index];
  const errors: ValidationError[] = [];
  const nameProblem = checkSymbolName(
    declaration.name,
    `El ${GROUP_LABEL[group]} n.º ${index + 1}`,
  );
  if (nameProblem) {
    errors.push({ ...nameProblem, path: [...path, 'name'] });
  }
  const arityProblem = checkArity(declaration, group);
  if (arityProblem) {
    errors.push({ ...arityProblem, path: [...path, 'arity'] });
  }
  return errors;
}

function checkSymbolName(name: string, unnamedSubject: string): Problem | undefined {
  if (name.trim() === '') {
    return { code: 'empty-name', message: `${unnamedSubject} no tiene nombre` };
  }
  if (isReservedWord(name)) {
    return {
      code: 'reserved-name',
      message: `'${name}' es una palabra reservada y no puede usarse como nombre`,
    };
  }
  if (!isIdentifier(name)) {
    return {
      code: 'invalid-name',
      message: `'${name}' no es un nombre válido: debe empezar con una letra y tener solo letras, dígitos o _`,
    };
  }
  return undefined;
}

function checkArity({ name, arity }: SymbolDeclaration, group: SymbolGroup): Problem | undefined {
  if (!Number.isInteger(arity) || arity < 0) {
    const owner = name.trim() === '' ? `del ${GROUP_LABEL[group]}` : `de '${name}'`;
    return {
      code: 'invalid-arity',
      message: `La aridad ${owner} debe ser un entero mayor o igual a 0`,
    };
  }
  // Como no se admiten relaciones vacías, la única relación posible sobre D⁰ = {()} es {()}:
  // un predicado 0-ario sería siempre verdadero. Para valores fijos ya existen ⊤ y ⊥.
  if (group === 'predicates' && arity === 0) {
    return { code: 'nullary-predicate', message: 'Los predicados deben tener aridad ≥ 1' };
  }
  return undefined;
}

// Funciones y predicados comparten el mismo espacio de nombres: si 'P' fuera ambas cosas, el
// parser no podría decidir si P(x) es un término o una fórmula.
function findDuplicateNames(language: Language): ValidationError[] {
  const groups: SymbolGroup[] = ['functions', 'predicates'];
  const declarations = groups.flatMap((group) =>
    language[group].map(({ name }, index) => ({ name, path: ['language', group, index, 'name'] })),
  );
  const seen = new Set<string>();
  const errors: ValidationError[] = [];
  for (const { name, path } of declarations) {
    if (name.trim() !== '' && seen.has(name)) {
      errors.push({ code: 'duplicate-name', path, message: `'${name}' ya está declarado` });
    }
    seen.add(name);
  }
  return errors;
}

export function validateDomain(domain: string[]): ValidationError[] {
  if (domain.length === 0) {
    return [
      {
        code: 'empty-domain',
        path: ['interpretation', 'domain'],
        message: 'El dominio no puede estar vacío',
      },
    ];
  }
  const seen = new Set<string>();
  const errors: ValidationError[] = [];
  domain.forEach((element, index) => {
    const path = ['interpretation', 'domain', index];
    if (element.trim() === '') {
      errors.push({
        code: 'empty-element',
        path,
        message: `El elemento n.º ${index + 1} del dominio no tiene nombre`,
      });
    } else if (seen.has(element)) {
      errors.push({
        code: 'duplicate-element',
        path,
        message: `El elemento '${element}' está repetido en el dominio`,
      });
    }
    seen.add(element);
  });
  return errors;
}

// Supone un lenguaje ya validado: cada símbolo tiene nombre único y aridad correcta.
export function validateInterpretation(
  language: Language,
  interpretation: Interpretation,
): ValidationError[] {
  const domainErrors = validateDomain(interpretation.domain);
  if (domainErrors.length > 0) {
    // Las tablas se revisan contra Dⁿ; con un dominio inválido solo se generarían errores en cascada.
    return domainErrors;
  }
  const domain = interpretation.domain;
  return [
    ...language.functions.flatMap((declaration) =>
      validateFunction(
        declaration,
        lookup(interpretation.functions, declaration.name) ?? [],
        domain,
      ),
    ),
    ...language.predicates.flatMap((declaration) =>
      validateRelation(
        declaration,
        lookup(interpretation.predicates, declaration.name) ?? [],
        domain,
      ),
    ),
  ];
}

function validateFunction(
  { name, arity }: SymbolDeclaration,
  entries: FunctionEntry[],
  domain: string[],
): ValidationError[] {
  const path = ['interpretation', 'functions', name];
  if (entries.length === 0) {
    return [
      {
        code: 'empty-function',
        path,
        message: `La función '${name}' está vacía; debe tener un valor para cada tupla de D${superscript(arity)}`,
      },
    ];
  }
  const domainSet = new Set(domain);
  const defined = new Set<string>();
  const errors: ValidationError[] = [];
  for (const entry of entries) {
    const problem = checkEntry(name, arity, entry, domainSet, defined);
    if (problem) {
      errors.push({ ...problem, path: [...path, tupleKey(entry.args)] });
    }
    defined.add(tupleKey(entry.args));
  }
  return [...errors, ...missingTuples(name, arity, domain, defined)];
}

function checkEntry(
  name: string,
  arity: number,
  { args, value }: FunctionEntry,
  domainSet: ReadonlySet<string>,
  alreadyDefined: ReadonlySet<string>,
): Problem | undefined {
  const label = formatApplication(name, args);
  const tupleProblem = checkTuple(args, arity, domainSet, `La entrada ${label}`, name);
  if (tupleProblem) {
    return tupleProblem;
  }
  if (alreadyDefined.has(tupleKey(args))) {
    return { code: 'duplicate-entry', message: `La entrada ${label} está repetida` };
  }
  if (value === '') {
    return { code: 'missing-value', message: `Falta el valor de ${label}` };
  }
  if (!domainSet.has(value)) {
    return {
      code: 'value-outside-domain',
      message: `El valor de ${label} es '${value}', que no pertenece al dominio`,
    };
  }
  return undefined;
}

function missingTuples(
  name: string,
  arity: number,
  domain: string[],
  defined: ReadonlySet<string>,
): ValidationError[] {
  return allTuples(domain, arity)
    .filter((tuple) => !defined.has(tupleKey(tuple)))
    .map((tuple) => ({
      code: 'missing-value',
      path: ['interpretation', 'functions', name, tupleKey(tuple)],
      message: `Falta el valor de ${formatApplication(name, tuple)}`,
    }));
}

function validateRelation(
  { name, arity }: SymbolDeclaration,
  tuples: Tuple[],
  domain: string[],
): ValidationError[] {
  const path = ['interpretation', 'predicates', name];
  if (tuples.length === 0) {
    return [
      {
        code: 'empty-relation',
        path,
        message: `La relación de '${name}' está vacía; debe contener al menos una tupla`,
      },
    ];
  }
  const domainSet = new Set(domain);
  return tuples.flatMap((tuple): ValidationError[] => {
    const subject = `La tupla ${formatTuple(tuple)} de '${name}'`;
    const problem = checkTuple(tuple, arity, domainSet, subject, name);
    return problem ? [{ ...problem, path: [...path, tupleKey(tuple)] }] : [];
  });
}

// Una tupla pertenece a Dⁿ si tiene exactamente n componentes y todas están en D.
function checkTuple(
  tuple: Tuple,
  arity: number,
  domainSet: ReadonlySet<string>,
  subject: string,
  symbolName: string,
): Problem | undefined {
  if (tuple.length !== arity) {
    return {
      code: 'tuple-length',
      message: `${subject} tiene ${countLabel(tuple.length, 'elemento', 'elementos')}, pero '${symbolName}' tiene aridad ${arity}`,
    };
  }
  const outside = tuple.find((element) => !domainSet.has(element));
  if (outside !== undefined) {
    return {
      code: 'tuple-outside-domain',
      message: `${subject} usa '${outside}', que no pertenece al dominio`,
    };
  }
  return undefined;
}

function checkFormula(
  text: string,
  signature: Signature,
): { formula?: Formula; errors: ValidationError[] } {
  let formula: Formula;
  try {
    formula = parse(text, signature);
  } catch (error) {
    if (error instanceof ParseError) {
      const span = { start: error.position, end: Math.min(error.position + 1, text.length) };
      return { errors: [{ code: 'syntax', path: ['formula'], message: error.message, span }] };
    }
    throw error;
  }
  const errors = validateFormulaSymbols(formula, signature);
  return errors.length > 0 ? { errors } : { formula, errors };
}

// El parser ya separa predicados de funciones; aquí se revisa que cada uso respete la aridad
// declarada. También detecta símbolos no declarados en un AST que no venga del parser.
export function validateFormulaSymbols(formula: Formula, signature: Signature): ValidationError[] {
  switch (formula.kind) {
    case 'Top':
    case 'Bottom':
      return [];
    case 'Pred':
      return [
        ...checkUsage(formula.name, formula.args.length, signature.predicates, formula.span),
        ...formula.args.flatMap((arg) => validateTermSymbols(arg, signature)),
      ];
    case 'Equals':
      return [
        ...validateTermSymbols(formula.left, signature),
        ...validateTermSymbols(formula.right, signature),
      ];
    case 'Not':
      return validateFormulaSymbols(formula.operand, signature);
    case 'And':
    case 'Or':
    case 'Implies':
    case 'Iff':
      return [
        ...validateFormulaSymbols(formula.left, signature),
        ...validateFormulaSymbols(formula.right, signature),
      ];
    case 'ForAll':
    case 'Exists':
      return validateFormulaSymbols(formula.body, signature);
  }
}

function validateTermSymbols(term: Term, signature: Signature): ValidationError[] {
  if (term.kind === 'Var') {
    return [];
  }
  return [
    ...checkUsage(term.name, term.args.length, signature.functions, term.span),
    ...term.args.flatMap((arg) => validateTermSymbols(arg, signature)),
  ];
}

function checkUsage(
  name: string,
  argumentCount: number,
  declared: ReadonlyMap<string, number>,
  span: Span,
): ValidationError[] {
  const arity = declared.get(name);
  if (arity === undefined) {
    return [
      {
        code: 'undeclared-symbol',
        path: ['formula'],
        message: `'${name}' no está declarado`,
        span,
      },
    ];
  }
  if (arity !== argumentCount) {
    return [
      {
        code: 'arity-mismatch',
        path: ['formula'],
        message: `'${name}' tiene aridad ${arity}, pero se usa con ${countLabel(argumentCount, 'argumento', 'argumentos')}`,
        span,
      },
    ];
  }
  return [];
}

export function validateEnvironment(
  variables: string[],
  environment: Environment,
  domain: string[],
): ValidationError[] {
  const domainSet = new Set(domain);
  return variables.flatMap((variable): ValidationError[] => {
    const path = ['environment', variable];
    const value = lookup(environment, variable);
    if (value === undefined || value === '') {
      return [
        {
          code: 'unassigned-variable',
          path,
          message: `Falta asignar un valor a la variable libre '${variable}'`,
        },
      ];
    }
    if (!domainSet.has(value)) {
      return [
        {
          code: 'assignment-outside-domain',
          path,
          message: `El valor asignado a '${variable}' es '${value}', que no pertenece al dominio`,
        },
      ];
    }
    return [];
  });
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
