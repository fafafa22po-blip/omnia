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

## Modelos de IA

El seam `ModelGateway` pertenece a Omnia. El adapter inicial usa la Responses API de OpenAI, pero sus tipos no cruzan al harness y puede añadirse otro proveedor mediante un adapter nuevo.

La selección provisional para el MVP es:

- Habitual: `gpt-5.6-terra`.
- Escalamiento explícito: `gpt-5.6-sol`.

El catálogo registra texto, visión, streaming, llamadas de herramientas y precios por tokens. Los límites predeterminados son US$0.25 por Tarea y US$10 al mes; pueden ajustarse con `OMNIA_MAX_COST_USD` y `OMNIA_MAX_MONTHLY_COST_USD`.

La clave de OpenAI se lee de `omnia/openai-api-key` mediante `SystemSecretStore`, respaldado por el almacén nativo del sistema (Credential Manager en Windows). No se admite `OPENAI_API_KEY` en la configuración de Omnia ni se conserva la clave en SQLite. El mismo almacén permite aprovisionarla desde una futura interfaz:

```typescript
await new SystemSecretStore().set("omnia/openai-api-key", apiKey);
```

Las pruebas contractuales utilizan transporte y adapters falsos; no requieren una clave ni consumen saldo.
