# Registro de contratos vigentes

Agente conversacional que lee un buzón, extrae los datos del contrato, evita duplicados y actualiza el maestro. Los campos con confianza menor a 0.85 no se escriben hasta que la analista los confirme.

## Arranque

Requiere Node 18 o superior.

```bash
npm install
copy .env.example .env
npm run dev
```

Abre [http://localhost:3010](http://localhost:3010).

Sin `OPENAI_API_KEY`, el servidor usa el planificador local: recorre las mismas herramientas y no llama a un proveedor. Para usar OpenAI, en `.env`:

```
LLM_PROVIDER=openai
OPENAI_API_KEY=tu-clave
OPENAI_MODEL=gpt-4o-mini
```

La clave se lee solo en el backend. No se escribe en el repositorio, el front, los logs ni la respuesta de `/api/health`.

## Demo sin modelo

```bash
npm run demo
```

Limpia `out/`, procesa los seis mensajes, deja sin registrar el que pide revisión, lo registra en una segunda llamada con `confirmado: true` y genera `out/alertas.md`. También recorre el mismo flujo por el chat. No usa clave de ningún proveedor.

## API

| Método | Ruta | Cuerpo / respuesta |
|---|---|---|
| `POST` | `/api/chat` | `{ sessionId?, message }` → `{ sessionId, reply, toolCalls[], needsConfirmation }` |
| `GET` | `/api/sessions/:id` | Historial de la sesión |
| `GET` | `/api/health` | `{ ok, provider, model }` |

## Prompt de prueba

```
Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que
esté limpio, muéstrame lo que requiere revisión campo por campo y termina
con el reporte de alertas. No registres nada dudoso sin preguntarme.
```

Luego: `Confirmo el valor 0 y la fecha fin 2027-08-31.`

## Dónde queda cada cosa

| Pieza | Ruta |
|---|---|
| Comportamiento | `agent/prompt.md` |
| Conocimiento del proceso | `src/knowledge/registro-contratos.md` |
| Herramientas | `src/tools/contratos.ts` |
| Ciclo del agente | `src/agent/loop.ts` |
| Módulo reutilizable | `modulo/` (mismo prompt, mismas herramientas, mismo conocimiento) |

`fixtures/` no se modifica. La copia de trabajo queda en `out/sharepoint/`.

El enlace público no está desplegado: se prueba en local con `npm run dev`.
