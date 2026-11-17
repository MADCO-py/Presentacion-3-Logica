import type { Environment, Interpretation, Language } from './core/model';
import { validateInput, type ValidInput, type ValidationError } from './core/validate';

// Los mismos mundos de ejemplo que trae la aplicación (src/ui/examples.ts del proyecto).

export interface World {
  id: string;
  name: string;
  language: Language;
  interpretation: Interpretation;
  examples: { formula: string; env?: Environment }[];
}

export const NUMBERS: World = {
  id: 'numeros',
  name: 'Números',
  language: {
    functions: [],
    predicates: [
      { name: 'Par', arity: 1 },
      { name: 'Primo', arity: 1 },
      { name: 'Impar', arity: 1 },
    ],
  },
  interpretation: {
    domain: ['dos', 'tres', 'cuatro'],
    functions: {},
    predicates: {
      Par: [['dos'], ['cuatro']],
      Primo: [['dos'], ['tres']],
      Impar: [['tres']],
    },
  },
  examples: [
    { formula: '∃x Par(x)' },
    { formula: '∀x (Primo(x) → Impar(x))' },
    { formula: '∀x (Par(x) ∨ Impar(x))' },
    { formula: 'Par(x) ∧ Primo(x)' },
    { formula: '∃x (Par(x) ∧ Primo(x)' },
  ],
};

// Un ciclo ana → beto → carla → ana: todos aman a alguien, nadie se ama a sí mismo.
export const LOVERS: World = {
  id: 'amor',
  name: 'Ciclo de amor',
  language: { functions: [], predicates: [{ name: 'Ama', arity: 2 }] },
  interpretation: {
    domain: ['ana', 'beto', 'carla'],
    functions: {},
    predicates: {
      Ama: [
        ['ana', 'beto'],
        ['beto', 'carla'],
        ['carla', 'ana'],
      ],
    },
  },
  examples: [
    { formula: '∀x ∃y Ama(x, y)' },
    { formula: '∃x Ama(x, x)' },
    { formula: '∃y ∀x Ama(x, y)' },
    { formula: 'Ama(x, y) ∨ Ama(y, x)', env: { x: 'ana', y: 'carla' } },
    { formula: '∀x Ama(x)' },
  ],
};

export const FUNCS: World = {
  id: 'funcion',
  name: 'Función f',
  language: { functions: [{ name: 'f', arity: 1 }, { name: 'k', arity: 0 }], predicates: [{ name: 'Fijo', arity: 1 }] },
  interpretation: {
    domain: ['a', 'b', 'c'],
    functions: {
      f: [
        { args: ['a'], value: 'b' },
        { args: ['b'], value: 'a' },
        { args: ['c'], value: 'c' },
      ],
      k: [{ args: [], value: 'c' }],
    },
    predicates: { Fijo: [['c']] },
  },
  examples: [
    { formula: '∀x (f(f(x)) = x)' },
    { formula: '∀x (f(x) = x → Fijo(x))' },
    { formula: 'f(k) = k' },
    { formula: '∃x ¬(f(x) = x)' },
  ],
};

export const WORLDS = [NUMBERS, LOVERS, FUNCS];

export type Checked = { ok: true; value: ValidInput } | { ok: false; errors: ValidationError[] };

export function check(world: World, formulaText: string, environment: Environment = {}): Checked {
  return validateInput({
    language: world.language,
    interpretation: world.interpretation,
    formulaText,
    environment,
  });
}
