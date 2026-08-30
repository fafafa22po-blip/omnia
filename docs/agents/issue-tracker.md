# Issue tracker: GitHub

Las tareas y especificaciones de este repositorio viven en GitHub Issues. Utiliza la CLI `gh` para todas las operaciones.

Actualmente el repositorio remoto todavía no está configurado. Antes de crear o consultar issues, verifica que `git remote -v` apunte al repositorio correcto de GitHub.

## Convenciones

- Crear: `gh issue create --title "..." --body "..."`
- Consultar: `gh issue view <number> --comments`
- Listar: `gh issue list --state open`
- Comentar: `gh issue comment <number> --body "..."`
- Añadir una etiqueta: `gh issue edit <number> --add-label "..."`
- Retirar una etiqueta: `gh issue edit <number> --remove-label "..."`
- Cerrar: `gh issue close <number> --comment "..."`

## Pull requests como solicitudes

PRs as a request surface: no.

Los pull requests externos no se tratarán automáticamente como solicitudes o tareas.

## Publicación

Cuando una skill indique "publish to the issue tracker", debe crear un GitHub Issue.

Cuando una skill indique "fetch the relevant ticket", debe ejecutar:

`gh issue view <number> --comments`

## Dependencias

Utiliza dependencias nativas de GitHub Issues cuando estén disponibles. Si no lo están, coloca al principio del issue:

`Blocked by: #<número>`
