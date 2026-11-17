import type { Formula, Span, Term } from './ast';
import { atPosition, ParseError } from './errors';
import { tokenize, type Token, type TokenKind } from './lexer';
import type { Signature } from './signature';

export { ParseError } from './errors';

export function parse(input: string, signature: Signature): Formula {
  return new Parser(input, signature).parseComplete();
}

class Parser {
  private readonly tokens: Token[];
  private readonly signature: Signature;
  private readonly endOfInput: Token;
  private index = 0;

  constructor(input: string, signature: Signature) {
    this.tokens = tokenize(input);
    this.signature = signature;
    this.endOfInput = { kind: 'end', text: '', start: input.length, end: input.length };
  }

  parseComplete(): Formula {
    if (this.peek().kind === 'end') {
      throw new ParseError('La fórmula está vacía', 0);
    }
    const formula = this.parseFormula();
    const next = this.peek();
    if (next.kind !== 'end') {
      throw new ParseError(
        `Se esperaba el fin de la fórmula ${atPosition(next.start)}, pero se encontró '${next.text}'`,
        next.start,
      );
    }
    return formula;
  }

  private parseFormula(): Formula {
    return this.parseIff();
  }

  // → y ↔ asocian a la derecha: el operando derecho se parsea llamando otra vez al mismo nivel.
  private parseIff(): Formula {
    const left = this.parseImplies();
    if (!this.match('iff')) {
      return left;
    }
    const right = this.parseIff();
    return { kind: 'Iff', left, right, span: cover(left.span, right.span) };
  }

  private parseImplies(): Formula {
    const left = this.parseOr();
    if (!this.match('implies')) {
      return left;
    }
    const right = this.parseImplies();
    return { kind: 'Implies', left, right, span: cover(left.span, right.span) };
  }

  // ∧ y ∨ asocian a la izquierda: el bucle va acumulando el resultado como operando izquierdo.
  private parseOr(): Formula {
    let left = this.parseAnd();
    while (this.match('or')) {
      const right = this.parseAnd();
      left = { kind: 'Or', left, right, span: cover(left.span, right.span) };
    }
    return left;
  }

  private parseAnd(): Formula {
    let left = this.parseUnary();
    while (this.match('and')) {
      const right = this.parseUnary();
      left = { kind: 'And', left, right, span: cover(left.span, right.span) };
    }
    return left;
  }

  // El operando de ¬, ∀ y ∃ es otra fórmula unaria, por eso ∀x P(x) ∧ Q(x) es (∀x P(x)) ∧ Q(x).
  private parseUnary(): Formula {
    const token = this.peek();
    if (token.kind === 'not') {
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'Not', operand, span: { start: token.start, end: operand.span.end } };
    }
    if (token.kind === 'forall' || token.kind === 'exists') {
      return this.parseQuantifier();
    }
    return this.parseAtom();
  }

  private parseQuantifier(): Formula {
    const quantifier = this.advance();
    const isForAll = quantifier.kind === 'forall';
    const variable = this.expectVariable(isForAll ? '∀' : '∃');
    const body = this.parseUnary();
    const span = { start: quantifier.start, end: body.span.end };
    return isForAll
      ? { kind: 'ForAll', variable, body, span }
      : { kind: 'Exists', variable, body, span };
  }

  private expectVariable(quantifierSymbol: string): string {
    const token = this.peek();
    if (token.kind !== 'identifier') {
      throw new ParseError(
        `Se esperaba una variable después de ${quantifierSymbol} ${atPosition(token.start)}`,
        token.start,
      );
    }
    if (this.isDeclared(token.text)) {
      throw new ParseError(
        `'${token.text}' es un símbolo declarado; se esperaba una variable después de ${quantifierSymbol}`,
        token.start,
      );
    }
    this.advance();
    return token.text;
  }

  private parseAtom(): Formula {
    const token = this.peek();
    switch (token.kind) {
      case 'top':
        this.advance();
        return { kind: 'Top', span: spanOf(token) };
      case 'bottom':
        this.advance();
        return { kind: 'Bottom', span: spanOf(token) };
      case 'lparen':
        return this.parseParenthesized();
      case 'identifier':
        return this.signature.predicates.has(token.text)
          ? this.parsePredicate()
          : this.parseEquality();
      default:
        throw this.unexpected('una fórmula');
    }
  }

  // El span incluye los paréntesis para que al resaltar la subfórmula se vean completos.
  private parseParenthesized(): Formula {
    const open = this.advance();
    const inner = this.parseFormula();
    const close = this.expect('rparen', "')'");
    return { ...inner, span: { start: open.start, end: close.end } };
  }

  private parsePredicate(): Formula {
    const name = this.advance();
    const { args, end } = this.parseArguments(name.end);
    return { kind: 'Pred', name: name.text, args, span: { start: name.start, end } };
  }

  // Si el identificador no es predicado, la única fórmula que puede empezar con él es t1 = t2.
  private parseEquality(): Formula {
    const left = this.parseTerm();
    if (!this.match('equals')) {
      throw termUsedAsFormula(left);
    }
    const right = this.parseTerm();
    return { kind: 'Equals', left, right, span: cover(left.span, right.span) };
  }

  private parseTerm(): Term {
    const token = this.peek();
    if (token.kind !== 'identifier') {
      throw this.unexpected('un término');
    }
    const name = token.text;
    if (this.signature.predicates.has(name)) {
      throw new ParseError(`'${name}' es un predicado; no puede usarse como término`, token.start);
    }
    this.advance();
    if (this.signature.functions.has(name)) {
      const { args, end } = this.parseArguments(token.end);
      return { kind: 'App', name, args, span: { start: token.start, end } };
    }
    if (this.peek().kind === 'lparen') {
      throw new ParseError(
        `'${name}' no está declarado como símbolo funcional ni como predicado`,
        token.start,
      );
    }
    return { kind: 'Var', name, span: spanOf(token) };
  }

  private parseArguments(endWithoutArguments: number): { args: Term[]; end: number } {
    if (!this.match('lparen')) {
      return { args: [], end: endWithoutArguments };
    }
    const args = [this.parseTerm()];
    while (this.match('comma')) {
      args.push(this.parseTerm());
    }
    const close = this.expect('rparen', "')'");
    return { args, end: close.end };
  }

  private isDeclared(name: string): boolean {
    return this.signature.functions.has(name) || this.signature.predicates.has(name);
  }

  private peek(): Token {
    return this.tokens[this.index] ?? this.endOfInput;
  }

  private advance(): Token {
    const token = this.peek();
    this.index++;
    return token;
  }

  private match(kind: TokenKind): boolean {
    if (this.peek().kind !== kind) {
      return false;
    }
    this.advance();
    return true;
  }

  private expect(kind: TokenKind, description: string): Token {
    const token = this.peek();
    if (token.kind !== kind) {
      throw this.unexpected(description);
    }
    return this.advance();
  }

  private unexpected(description: string): ParseError {
    const token = this.peek();
    if (token.kind === 'end') {
      return new ParseError(
        `Fin inesperado de la fórmula; se esperaba ${description}`,
        token.start,
      );
    }
    return new ParseError(
      `Se esperaba ${description} ${atPosition(token.start)}, pero se encontró '${token.text}'`,
      token.start,
    );
  }
}

// Un identificador no declarado en posición de fórmula suele ser un predicado que falta declarar,
// así que el mensaje lo dice en vez de llamarlo "variable".
function termUsedAsFormula(term: Term): ParseError {
  const message =
    term.kind === 'Var'
      ? `'${term.name}' no está declarado como predicado; se esperaba una fórmula`
      : `'${term.name}' es un símbolo funcional; se esperaba una fórmula`;
  return new ParseError(message, term.span.start);
}

function spanOf(token: Token): Span {
  return { start: token.start, end: token.end };
}

function cover(first: Span, last: Span): Span {
  return { start: first.start, end: last.end };
}
