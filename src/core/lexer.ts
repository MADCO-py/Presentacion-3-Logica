import { atPosition, ParseError } from './errors';

export type TokenKind =
  | 'not'
  | 'and'
  | 'or'
  | 'implies'
  | 'iff'
  | 'forall'
  | 'exists'
  | 'top'
  | 'bottom'
  | 'equals'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'identifier'
  | 'end';

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
}

const SYMBOLS: ReadonlyArray<[string, TokenKind]> = [
  ['<->', 'iff'],
  ['->', 'implies'],
  ['↔', 'iff'],
  ['→', 'implies'],
  ['¬', 'not'],
  ['~', 'not'],
  ['!', 'not'],
  ['∧', 'and'],
  ['&', 'and'],
  ['∨', 'or'],
  ['|', 'or'],
  ['∀', 'forall'],
  ['∃', 'exists'],
  ['⊤', 'top'],
  ['⊥', 'bottom'],
  ['=', 'equals'],
  ['(', 'lparen'],
  [')', 'rparen'],
  [',', 'comma'],
];

// Solo cuentan como palabra clave si son el identificador completo: "Ab" o "Tx" son identificadores.
const KEYWORDS: ReadonlyMap<string, TokenKind> = new Map([
  ['forall', 'forall'],
  ['A', 'forall'],
  ['exists', 'exists'],
  ['E', 'exists'],
  ['T', 'top'],
  ['F', 'bottom'],
]);

const IDENTIFIER = /[A-Za-z][A-Za-z0-9_]*/y;
const WHOLE_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
const WHITESPACE = /\s/;

export function isIdentifier(text: string): boolean {
  return WHOLE_IDENTIFIER.test(text);
}

export function isReservedWord(text: string): boolean {
  return KEYWORDS.has(text);
}

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < input.length) {
    if (WHITESPACE.test(input.charAt(position))) {
      position++;
      continue;
    }
    const token = readSymbol(input, position) ?? readWord(input, position);
    if (!token) {
      throw unknownSymbol(input, position);
    }
    tokens.push(token);
    position = token.end;
  }
  return tokens;
}

function readSymbol(input: string, start: number): Token | undefined {
  for (const [text, kind] of SYMBOLS) {
    if (input.startsWith(text, start)) {
      return { kind, text, start, end: start + text.length };
    }
  }
  return undefined;
}

function readWord(input: string, start: number): Token | undefined {
  IDENTIFIER.lastIndex = start;
  const match = IDENTIFIER.exec(input);
  if (!match) {
    return undefined;
  }
  const text = match[0];
  const kind = KEYWORDS.get(text) ?? 'identifier';
  return { kind, text, start, end: start + text.length };
}

function unknownSymbol(input: string, position: number): ParseError {
  const codePoint = input.codePointAt(position) ?? 0;
  const symbol = String.fromCodePoint(codePoint);
  return new ParseError(`Símbolo desconocido '${symbol}' ${atPosition(position)}`, position);
}
