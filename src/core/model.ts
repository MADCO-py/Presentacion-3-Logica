export interface SymbolDeclaration {
  name: string;
  arity: number;
}

export interface Language {
  functions: SymbolDeclaration[];
  predicates: SymbolDeclaration[];
}

export interface FunctionEntry {
  args: string[];
  value: string;
}

// Se usan objetos planos (y no Map) para poder serializar el estado a JSON y a la URL.
export interface Interpretation {
  domain: string[];
  functions: Record<string, FunctionEntry[]>;
  predicates: Record<string, string[][]>;
}

export type Environment = Record<string, string>;

// Un acceso directo como environment['constructor'] devolvería una propiedad heredada del
// prototipo de Object; con hasOwn solo se leen las claves que el usuario realmente definió.
export function lookup<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
