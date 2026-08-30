# Omnia

Omnia es un asistente personal privado y extensible para Windows. El proyecto comienza como un monolito modular: el harness conserva la autoridad, la memoria, la ejecución y la verificación, mientras los modelos y entornos se conectan mediante adaptadores.

## Requisitos

- Node.js 24 o posterior.
- npm 11 o posterior.

## Comandos

- `npm install`: instala las dependencias bloqueadas por `package-lock.json`.
- `npm run typecheck`: comprueba los tipos sin generar archivos.
- `npm run lint`: ejecuta las reglas estáticas.
- `npm test`: ejecuta las pruebas sin red ni interfaz visual.
- `npm run build`: compila el núcleo a `dist/`.
- `npm run check`: ejecuta todas las verificaciones anteriores.

## Documentación

- [`CONTEXT.md`](./CONTEXT.md): lenguaje del dominio.
- [`docs/adr/`](./docs/adr/): decisiones arquitectónicas aceptadas.
- [GitHub Issues](https://github.com/fafafa22po-blip/omnia/issues): especificaciones y tareas.

## Datos locales

Los datos personales, bases SQLite, registros, archivos temporales, credenciales y variables de entorno quedan fuera de Git. Las integraciones deben obtener secretos mediante un almacén seguro del sistema y nunca incluirlos en mensajes del modelo ni en registros.
