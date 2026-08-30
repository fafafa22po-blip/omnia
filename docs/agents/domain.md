# Domain Docs

Reglas para consumir la documentación de dominio al explorar este repositorio.

## Antes de explorar

Leer cuando existan:

- `CONTEXT.md` en la raíz.
- Los ADR relevantes dentro de `docs/adr/`.

Si no existen, continuar silenciosamente. No crearlos anticipadamente. Las skills de modelado de dominio los crearán cuando se resuelvan conceptos o decisiones reales.

## Estructura

Este proyecto utiliza un contexto único:

```text
/
|-- CONTEXT.md
|-- docs/
|   |-- adr/
|   `-- agents/
`-- src/
```

## Vocabulario

Los issues, especificaciones, pruebas y propuestas arquitectónicas deben utilizar los términos definidos en `CONTEXT.md`.

Si un concepto no está definido, comprobar si se está introduciendo lenguaje innecesario o si existe una carencia real que deba resolverse mediante modelado de dominio.

## Conflictos con decisiones

Si una propuesta contradice un ADR existente, debe indicarlo explícitamente en lugar de reemplazar silenciosamente la decisión.
