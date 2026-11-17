# Presentación · Verum — Evaluador semántico

Presentación web del proyecto de MM3032 Lógica Matemática (UVG): evaluador semántico de lógica de
primer orden.

**Integrantes:** Samuel Robledo · Miguel Rosas · Miguel Carranza

## Cómo presentarla

| Acción                      | Tecla / gesto                         |
| --------------------------- | ------------------------------------- |
| Siguiente / anterior        | → ↓ Espacio Av Pág / ← ↑ Re Pág, rueda o swipe |
| Primera / última            | Inicio / Fin                          |
| Pantalla completa           | F                                     |
| Cambiar el símbolo de portada | clic sobre las partículas           |

## Desarrollo

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # genera dist/
npm run preview   # sirve el build
```

## Publicar en GitHub Pages

El workflow `.github/workflows/deploy.yml` construye y publica la página en cada push a `main`.
Solo hay que activarlo una vez: en el repositorio, **Settings → Pages → Source: GitHub Actions**.

La página queda en `https://<usuario>.github.io/Presentacion-3-Logica/`.

## Contenido

`src/core/` es una copia del núcleo del proyecto (lexer, parser, validación, evaluación, explicación y
juego). Algunas diapositivas usan ese núcleo para generar su contenido: el árbol sintáctico, los
cuatro casos de resultado, los mensajes de error reales y la partida del juego de Hintikka.
