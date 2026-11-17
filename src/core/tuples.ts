export type Tuple = string[];

// Dⁿ en orden lexicográfico según el orden del dominio: (a,a), (a,b), (b,a), (b,b).
export function allTuples(domain: string[], arity: number): Tuple[] {
  if (arity === 0) {
    return [[]];
  }
  return allTuples(domain, arity - 1).flatMap((prefix) =>
    domain.map((element) => [...prefix, element]),
  );
}

// JSON evita ambigüedades si un elemento contiene comas: ["a,b"] y ["a","b"] dan claves distintas.
export function tupleKey(tuple: Tuple): string {
  return JSON.stringify(tuple);
}

export function formatTuple(tuple: Tuple): string {
  return `(${tuple.join(', ')})`;
}

const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

// Para escribir Dⁿ en los mensajes: superscript(2) = "²".
export function superscript(value: number): string {
  return [...String(value)].map((digit) => SUPERSCRIPT_DIGITS[Number(digit)] ?? digit).join('');
}

export function formatApplication(name: string, args: Tuple): string {
  return args.length === 0 ? name : `${name}(${args.join(', ')})`;
}
