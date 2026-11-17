import type { Formula } from './ast';
import { evaluate } from './evaluate';
import type { Environment } from './model';
import type { ValidInput } from './validate';

// Los jugadores se llaman por el rol con el que empiezan; la ¬ intercambia los roles, no los nombres.
export type Player = 'verificador' | 'falsificador';

export interface Roles {
  verifier: Player;
  falsifier: Player;
}

export interface GameState {
  formula: Formula;
  env: Environment;
  roles: Roles;
}

export type Move =
  | { kind: 'element'; element: string }
  | { kind: 'side'; side: 'left' | 'right' }
  | { kind: 'negation' };

export const INITIAL_ROLES: Roles = { verifier: 'verificador', falsifier: 'falsificador' };

export function startGame(input: ValidInput): GameState {
  return { formula: input.formula, env: input.environment, roles: INITIAL_ROLES };
}

export function isOver(state: GameState): boolean {
  return isAtomic(state.formula);
}

// null significa que nadie elige: en un átomo el juego terminó y en ¬ solo se intercambian roles.
export function whoMoves(state: GameState): Player | null {
  switch (state.formula.kind) {
    case 'Exists':
    case 'Or':
    case 'Implies':
      return state.roles.verifier;
    case 'ForAll':
    case 'And':
    case 'Iff':
      return state.roles.falsifier;
    case 'Not':
    case 'Top':
    case 'Bottom':
    case 'Pred':
    case 'Equals':
      return null;
  }
}

export function moves(state: GameState, input: ValidInput): Move[] {
  switch (state.formula.kind) {
    case 'ForAll':
    case 'Exists':
      return input.interpretation.domain.map((element) => ({ kind: 'element', element }));
    case 'And':
    case 'Or':
    case 'Implies':
    case 'Iff':
      return [
        { kind: 'side', side: 'left' },
        { kind: 'side', side: 'right' },
      ];
    case 'Not':
      return [{ kind: 'negation' }];
    case 'Top':
    case 'Bottom':
    case 'Pred':
    case 'Equals':
      return [];
  }
}

export function applyMove(state: GameState, move: Move): GameState {
  const { formula, env, roles } = state;
  if (formula.kind === 'Not' && move.kind === 'negation') {
    return { formula: formula.operand, env, roles: swap(roles) };
  }
  if ((formula.kind === 'ForAll' || formula.kind === 'Exists') && move.kind === 'element') {
    return { formula: formula.body, env: { ...env, [formula.variable]: move.element }, roles };
  }
  if (move.kind !== 'side') {
    throw new Error(`Jugada inválida para ${formula.kind}`);
  }
  const left = move.side === 'left';
  switch (formula.kind) {
    case 'And':
    case 'Or':
      return { formula: left ? formula.left : formula.right, env, roles };
    // φ → ψ se juega como ¬φ ∨ ψ: elegir el antecedente es jugar ¬φ, o sea φ con roles intercambiados.
    case 'Implies':
      return left
        ? { formula: formula.left, env, roles: swap(roles) }
        : { formula: formula.right, env, roles };
    // φ ↔ ψ se juega como (φ → ψ) ∧ (ψ → φ): el falsificador elige cuál implicación atacar.
    case 'Iff': {
      const [antecedent, consequent] = left
        ? [formula.left, formula.right]
        : [formula.right, formula.left];
      return {
        formula: { kind: 'Implies', left: antecedent, right: consequent, span: formula.span },
        env,
        roles,
      };
    }
    default:
      throw new Error(`Jugada inválida para ${formula.kind}`);
  }
}

// En un átomo gana quien tiene el rol de verificador si el átomo es verdadero.
export function winner(state: GameState, input: ValidInput): Player | null {
  if (!isOver(state)) {
    return null;
  }
  return holds(state, input) ? state.roles.verifier : state.roles.falsifier;
}

// Estrategia ganadora: por el teorema, quien tiene el rol de verificador en un estado gana con
// buen juego sii la fórmula de ese estado es verdadera. Basta elegir una jugada que lleve a un
// estado así para quien mueve; si no existe, cualquier jugada pierde igual.
export function bestMove(state: GameState, input: ValidInput): Move | undefined {
  const options = moves(state, input);
  const mover = whoMoves(state);
  if (mover === null) {
    return options[0];
  }
  return options.find((move) => canWin(applyMove(state, move), mover, input)) ?? options[0];
}

function canWin(state: GameState, player: Player, input: ValidInput): boolean {
  return (state.roles.verifier === player) === holds(state, input);
}

function holds(state: GameState, input: ValidInput): boolean {
  const result = evaluate(input, state.formula, state.env);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.root.value;
}

function swap(roles: Roles): Roles {
  return { verifier: roles.falsifier, falsifier: roles.verifier };
}

function isAtomic(formula: Formula): boolean {
  return (
    formula.kind === 'Top' ||
    formula.kind === 'Bottom' ||
    formula.kind === 'Pred' ||
    formula.kind === 'Equals'
  );
}
