import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { responderTurno } from "./src/agent/loop.ts"
import type { Contrato } from "./src/domain/contrato.ts"
import { extraerDesdeTexto } from "./src/domain/extraccion.ts"
import { parsearMaestro } from "./src/domain/maestro.ts"
import { alertas, extraer, leer_buzon, registrar, validar } from "./src/tools/contratos.ts"
import type { ContextoHerramienta } from "./src/tools/contratos.ts"

const directorio = path.resolve(path.dirname(fileURLToPath(import.meta.url)))
const ctx: ContextoHerramienta = { directory: directorio, sessionId: "demo" }

const ESPERADO: Record<string, { clasificacion: string; revision: string[] }> = {
  "msg-001": { clasificacion: "nuevo", revision: [] },
  "msg-002": { clasificacion: "nuevo", revision: [] },
  "msg-003": { clasificacion: "actualizacion", revision: [] },
  "msg-004": { clasificacion: "duplicado", revision: [] },
  "msg-005": { clasificacion: "rechazado", revision: [] },
  "msg-006": { clasificacion: "nuevo", revision: ["valor", "fecha_inicio", "fecha_fin"] },
}

await fs.rm(path.join(directorio, "out"), { recursive: true, force: true })

const buzon = leer(await leer_buzon.execute({}, ctx))
const mensajes = lista(buzon.mensajes)
if (mensajes.length !== 6) fallar(`El buzón debería traer 6 mensajes y trajo ${mensajes.length}.`)

console.log("Buzón pendiente:")
for (const mensaje of mensajes) {
  console.log(`- ${mensaje.id} | ${mensaje.de} | contrato: ${mensaje.tiene_contrato ? "sí" : "no"}`)
}
console.log("")

for (const mensaje of mensajes) {
  const extraido = leer(await extraer.execute({ mensaje_id: mensaje.id }, ctx))
  const validado = leer(
    await validar.execute(
      extraido.contrato ? { mensaje_id: mensaje.id, contrato: extraido.contrato } : { mensaje_id: mensaje.id },
      ctx,
    ),
  )
  const clasificacion = String(validado.clasificacion)
  const revision = (validado.requiere_revision as string[]) ?? []
  const esperado = ESPERADO[mensaje.id]
  if (!esperado) fallar(`Mensaje inesperado ${mensaje.id}.`)
  if (clasificacion !== esperado.clasificacion || revision.join(",") !== esperado.revision.join(",")) {
    fallar(`${mensaje.id}: esperaba ${esperado.clasificacion} [${esperado.revision.join(", ")}] y obtuve ${clasificacion} [${revision.join(", ")}].`)
  }
  let accion = "sin registrar"
  if ((clasificacion === "nuevo" || clasificacion === "actualizacion") && revision.length === 0) {
    if (!validado.contrato) fallar(`${mensaje.id} no trajo el contrato para registrarlo.`)
    const registro = leer(await registrar.execute({ mensaje_id: mensaje.id, contrato: validado.contrato, confirmado: false }, ctx))
    accion = `${registro.accion} ${registro.id_contrato} → ${registro.ruta_archivo} (${registro.estado_poliza})`
  } else if (revision.length > 0) {
    accion = `en revisión: ${revision.join(", ")}`
  }
  console.log(`${mensaje.id}  ${clasificacion.padEnd(14)} ${accion}`)
  if (typeof validado.motivo === "string") console.log(`         ${validado.motivo}`)
}

const antes = await fs.readFile(path.join(directorio, "out", "sharepoint", "maestro-contratos.csv"), "utf8")
if (antes.includes("CM-2026-03")) fallar("msg-006 quedó registrado antes de la confirmación.")

console.log("\nSegunda pasada: confirmo msg-006 con valor 0 y fecha fin 2027-08-31.")
const pendiente = leer(await extraer.execute({ mensaje_id: "msg-006" }, ctx))
if (!pendiente.contrato) fallar("No pude releer msg-006.")
const confirmado = structuredClone(pendiente.contrato)
confirmado.valor = { valor: 0, confianza: 1 }
confirmado.fecha_fin = { valor: "2027-08-31", confianza: 1 }
const alto = leer(await registrar.execute({ mensaje_id: "msg-006", contrato: confirmado, confirmado: true }, ctx))
console.log(`msg-006  registrado     ${alto.accion} ${alto.id_contrato} → ${alto.ruta_archivo} (${alto.estado_poliza})`)

const filas = parsearMaestro(await fs.readFile(path.join(directorio, "out", "sharepoint", "maestro-contratos.csv"), "utf8"))
exigir(filas.filter((fila) => fila.id_contrato === "CT-2026-012").length === 1, "CT-2026-012 debe seguir siendo una sola fila.")
const nuevo = fila(filas, "CT-2026-015")
exigir(nuevo.estado_poliza === "pendiente" && nuevo.requiere_poliza && nuevo.valor === 265000000, "msg-001 no quedó como contrato nuevo con póliza pendiente.")
const sinPoliza = fila(filas, "CT-2026-016")
exigir(sinPoliza.estado_poliza === "no_aplica" && sinPoliza.requiere_poliza === false, "msg-002 debía registrarse sin póliza.")
const otrosi = fila(filas, "CT-2026-011")
exigir(otrosi.valor === 520000 && otrosi.fecha_fin === "2027-11-01", "El otrosí no actualizó valor y fecha fin.")
const marco = fila(filas, "CM-2026-03")
exigir(marco.valor === 0 && marco.fecha_fin === "2027-08-31" && marco.estado_poliza === "pendiente", "msg-006 no quedó con el valor y la fecha confirmados.")

const historial = await fs.readFile(path.join(directorio, "out", "sharepoint", "historial.jsonl"), "utf8")
exigir(historial.includes('"id_contrato":"CT-2026-011"') && historial.includes('"accion":"actualizar"'), "Falta el historial del otrosí.")

const reporte = leer(await alertas.execute({ hoy: "2026-09-03" }, ctx))
const vencen = ids(reporte.vencen)
const polizas = ids(reporte.polizas_pendientes)
const registrados = ids(reporte.registrados_desde_corte)
exigir(vencen.includes("CT-2026-009") && vencen.includes("CT-2026-004"), "Las alertas no incluyen los contratos que vencen en 60 días.")
exigir(polizas.includes("CT-2026-004") && polizas.includes("CT-2026-015") && polizas.includes("CM-2026-03"), "Faltan pólizas pendientes.")
exigir(registrados.includes("CT-2026-015") && registrados.includes("CT-2026-016") && registrados.includes("CM-2026-03"), "Falta el gap cubierto desde el corte.")
console.log(`\nAlertas ${reporte.ruta}`)
console.log(`  vencen: ${vencen.join(", ")}`)
console.log(`  pólizas pendientes: ${polizas.join(", ")}`)
console.log(`  registrados desde el corte: ${registrados.join(", ")}`)

const ausente = leer(await extraer.execute({ mensaje_id: "msg-999" }, ctx))
exigir(ausente.ok === false, "Un mensaje inexistente debería devolver error.")
const vacio = extraerDesdeTexto("   ", { de: "a@b.co", fecha: "2026-08-01", cuerpo: "", nombreArchivo: "contrato.txt", comerciales: [] })
const moneda = extraerDesdeTexto("VALOR. El valor es EUR 10.", {
  de: "a@b.co",
  fecha: "2026-08-01",
  cuerpo: "",
  nombreArchivo: "contrato.txt",
  comerciales: [],
})
const fechaMala = extraerDesdeTexto("TERCERA. PLAZO. desde el treinta y uno (31) de febrero de 2026 hasta el uno (1) de marzo de 2026.", {
  de: "a@b.co",
  fecha: "2026-08-01",
  cuerpo: "",
  nombreArchivo: "contrato.txt",
  comerciales: [],
})
exigir(!vacio.ok && !moneda.ok && !fechaMala.ok, "Texto vacío, moneda desconocida o fecha inválida deberían fallar sin tumbar el lote.")
console.log("\nErrores controlados:")
console.log(`- ${"error" in ausente ? ausente.error : ""}`)
console.log(`- ${vacio.ok ? "" : vacio.error}`)
console.log(`- ${moneda.ok ? "" : moneda.error}`)
console.log(`- ${fechaMala.ok ? "" : fechaMala.error}`)
console.log("\nConversación:")
await fs.rm(path.join(directorio, "out"), { recursive: true, force: true })
const pedido =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme."
const primera = await responderTurno({ directory: directorio, message: pedido })
if (!primera.needsConfirmation) fallar("La conversación debía pedir confirmación para msg-006.")
if (!primera.toolCalls.some((llamada) => llamada.name === "contratos_alertas" && llamada.ok)) {
  fallar("La conversación no generó alertas.")
}
const maestroPendiente = await fs.readFile(path.join(directorio, "out", "sharepoint", "maestro-contratos.csv"), "utf8")
if (maestroPendiente.includes("CM-2026-03")) fallar("La conversación registró msg-006 antes de confirmar.")
const segunda = await responderTurno({
  directory: directorio,
  sessionId: primera.sessionId,
  message: "Confirmo el valor 0 y la fecha fin 2027-08-31.",
})
if (segunda.needsConfirmation) fallar("Después de confirmar no debía quedar otra pregunta.")
const maestroFinal = await fs.readFile(path.join(directorio, "out", "sharepoint", "maestro-contratos.csv"), "utf8")
if (!maestroFinal.includes("CM-2026-03")) fallar("Tras confirmar, CM-2026-03 no quedó en el maestro.")
if (!segunda.reply.includes("CM-2026-03")) fallar("La respuesta de confirmación no cuenta el registro.")
console.log(primera.reply)
console.log("\n---\n")
console.log(segunda.reply)
console.log("\nDemo correcta.")

interface DatosDemo {
  ok: boolean
  error?: string
  contrato?: Contrato
  clasificacion?: string
  requiere_revision?: string[]
  motivo?: string
  accion?: string
  id_contrato?: string
  ruta_archivo?: string
  estado_poliza?: string
  mensajes?: unknown
  vencen?: unknown
  polizas_pendientes?: unknown
  registrados_desde_corte?: unknown
  ruta?: string
}

function leer(body: string): DatosDemo {
  const parsed = JSON.parse(body) as { ok: boolean; data?: DatosDemo; error?: string }
  if (!parsed.ok) return { ok: false, error: parsed.error ?? "Error." }
  return { ok: true, ...(parsed.data ?? {}) }
}

function lista(valor: unknown): { id: string; de: string; tiene_contrato: boolean }[] {
  if (!Array.isArray(valor)) return []
  return valor.filter((item) => item && typeof item === "object" && typeof item.id === "string")
}

function ids(valor: unknown): string[] {
  if (!Array.isArray(valor)) return []
  return valor.map((item) => (item && typeof item === "object" ? String(item.id_contrato ?? "") : "")).filter(Boolean)
}

function fila(filas: ReturnType<typeof parsearMaestro>, id: string) {
  const encontrada = filas.find((item) => item.id_contrato === id)
  if (!encontrada) fallar(`No está ${id} en el maestro.`)
  return encontrada
}

function exigir(condicion: boolean, mensaje: string): void {
  if (!condicion) fallar(mensaje)
}

function fallar(mensaje: string): never {
  console.error(`\n${mensaje}`)
  process.exit(1)
}
