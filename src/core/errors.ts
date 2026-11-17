export class ParseError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'ParseError';
    this.position = position;
  }
}

// Internamente las posiciones son índices desde 0; al usuario se le muestran desde 1.
export function atPosition(index: number): string {
  return `en la posición ${index + 1}`;
}
