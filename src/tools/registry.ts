import { z } from "zod"
import { esRegistro } from "../domain/texto.ts"
import { bitacora } from "./bitacora.ts"
import { alertas, extraer, leer_buzon, leer_pdf, registrar, validar, type ContextoHerramienta } from "./contratos.ts"
import { fail, mensajeZod } from "./errores.ts"

export interface DefinicionHerramienta {
  description: string
  args: z.ZodRawShape
  execute(args: unknown, ctx: ContextoHerramienta): Promise<string>
}

export interface Ejecucion {
  body: string
  ok: boolean
  resumen: string
}

const HERRAMIENTAS: Record<string, DefinicionHerramienta> = {
  contratos_leer_buzon: leer_buzon,
  contratos_extraer: extraer,
  contratos_validar: validar,
  contratos_registrar: registrar,
  contratos_alertas: alertas,
  contratos_leer_pdf: leer_pdf,
}

export function listarHerramientas(): { name: string; def: DefinicionHerramienta }[] {
  return Object.entries(HERRAMIENTAS).map(([name, def]) => ({ name, def }))
}

export async function ejecutarHerramienta(nombre: string, argumentos: unknown, ctx: ContextoHerramienta): Promise<Ejecucion> {
  const def = HERRAMIENTAS[nombre]
  if (!def) {
    const error = `No existe la herramienta ${nombre}.`
    return { body: fail(error), ok: false, resumen: error }
  }
  const entrada = esRegistro(argumentos) ? argumentos : {}
  const parsed = z.object(def.args).safeParse(entrada)
  if (!parsed.success) {
    const error = mensajeZod(parsed.error)
    await bitacora(ctx.directory, mensajeDe(entrada), nombre, false, error)
    return { body: fail(error), ok: false, resumen: error }
  }
  try {
    const body = await def.execute(parsed.data, ctx)
    return interpretar(body)
  } catch {
    const error = "No se pudo completar la herramienta."
    await bitacora(ctx.directory, mensajeDe(entrada), nombre, false, error)
    return { body: fail(error), ok: false, resumen: error }
  }
}

function interpretar(body: string): Ejecucion {
  try {
    const valor = JSON.parse(body) as unknown
    if (!esRegistro(valor) || typeof valor.ok !== "boolean") {
      return { body, ok: false, resumen: "La herramienta devolvió una respuesta ilegible." }
    }
    if (!valor.ok) {
      const error = typeof valor.error === "string" ? valor.error : "La herramienta no pudo completarse."
      return { body, ok: false, resumen: error }
    }
    return { body, ok: true, resumen: resumirData(esRegistro(valor.data) ? valor.data : undefined) }
  } catch {
    return { body, ok: false, resumen: "La herramienta devolvió una respuesta ilegible." }
  }
}

function resumirData(data: Record<string, unknown> | undefined): string {
  if (!data) return "Listo."
  if (Array.isArray(data.mensajes)) return `${data.mensajes.length} mensajes pendientes.`
  if (typeof data.clasificacion === "string") {
    const revision = Array.isArray(data.requiere_revision) ? data.requiere_revision.map(String).join(", ") : ""
    const id = typeof data.mensaje_id === "string" ? data.mensaje_id : "mensaje"
    return revision ? `${id}: ${data.clasificacion}; revisión: ${revision}` : `${id}: ${data.clasificacion}`
  }
  if (typeof data.accion === "string") return `${data.accion} ${String(data.id_contrato ?? "")}`.trim()
  if (Array.isArray(data.vencen) || Array.isArray(data.polizas_pendientes)) {
    const vencen = Array.isArray(data.vencen) ? data.vencen.length : 0
    const polizas = Array.isArray(data.polizas_pendientes) ? data.polizas_pendientes.length : 0
    return `${vencen} por vencer, ${polizas} pólizas pendientes.`
  }
  if (typeof data.texto === "string") return `Texto de ${data.texto.length} caracteres.`
  const id = idDeContrato(data.contrato)
  if (id) return `Contrato ${id}.`
  return "Listo."
}

function idDeContrato(valor: unknown): string | null {
  if (!esRegistro(valor) || !esRegistro(valor.id_contrato)) return null
  return typeof valor.id_contrato.valor === "string" ? valor.id_contrato.valor : null
}

function mensajeDe(entrada: Record<string, unknown>): string | null {
  return typeof entrada.mensaje_id === "string" ? entrada.mensaje_id : null
}
