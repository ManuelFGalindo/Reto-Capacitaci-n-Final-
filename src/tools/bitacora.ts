import fs from "node:fs/promises"
import path from "node:path"

export async function bitacora(
  directorio: string,
  mensajeId: string | null,
  herramienta: string,
  bien: boolean,
  resumen: string,
): Promise<void> {
  const linea = `${JSON.stringify({
    ts: new Date().toISOString(),
    herramienta,
    mensaje_id: mensajeId,
    ok: bien,
    resumen: resumen.replace(/\s+/g, " ").slice(0, 240),
  })}\n`
  try {
    const salida = path.join(directorio, "out")
    await fs.mkdir(salida, { recursive: true })
    await fs.appendFile(path.join(salida, "log.jsonl"), linea, "utf8")
  } catch {
    // La bitácora no puede tumbar la herramienta.
  }
}
