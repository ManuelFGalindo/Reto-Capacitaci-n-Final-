import { contratoSchema, type Contrato } from "../domain/contrato.ts"
import { esRegistro } from "../domain/texto.ts"
import type { MensajeAgente } from "../types.ts"

export interface Sobre {
  ok: boolean
  error?: string
  data?: Record<string, unknown>
}

export interface Hecho {
  nombre: string
  args: Record<string, unknown>
  ok: boolean
  error?: string
  data?: Record<string, unknown>
}

export interface Pendiente {
  mensajeId: string
  contrato: Contrato
  campos: string[]
}

export function mensajesDelTurno(mensajes: MensajeAgente[]): MensajeAgente[] {
  let inicio = 0
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    if (mensajes[i]?.role === "user") {
      inicio = i
      break
    }
  }
  return mensajes.slice(inicio)
}

export function hechosDe(mensajes: MensajeAgente[]): Hecho[] {
  const salida: Hecho[] = []
  for (let i = 0; i < mensajes.length; i += 1) {
    const mensaje = mensajes[i]
    if (!mensaje || mensaje.role !== "assistant" || !mensaje.toolCalls) continue
    for (const llamada of mensaje.toolCalls) {
      const respuesta = mensajes.slice(i + 1).find((item) => item.role === "tool" && item.toolCallId === llamada.id)
      const sobre = respuesta && respuesta.role === "tool" ? parsearSobre(respuesta.content) : null
      salida.push({
        nombre: llamada.name,
        args: llamada.arguments,
        ok: sobre?.ok === true,
        error: sobre?.error,
        data: sobre?.data,
      })
    }
  }
  return salida
}

export function pendientesDe(mensajes: MensajeAgente[]): Pendiente[] {
  const registrados = new Set(
    hechosDe(mensajes)
      .filter((hecho) => hecho.nombre === "contratos_registrar" && hecho.ok)
      .map((hecho) => String(hecho.args.mensaje_id ?? hecho.data?.mensaje_id ?? "")),
  )
  const lista: Pendiente[] = []
  for (const hecho of hechosDe(mensajes)) {
    if (hecho.nombre !== "contratos_validar" || !hecho.ok || !hecho.data) continue
    const mensajeId = typeof hecho.data.mensaje_id === "string" ? hecho.data.mensaje_id : ""
    const clasificacion = hecho.data.clasificacion
    const campos = Array.isArray(hecho.data.requiere_revision) ? hecho.data.requiere_revision.map(String) : []
    const parsed = contratoSchema.safeParse(hecho.data.contrato)
    if (!mensajeId || registrados.has(mensajeId) || !parsed.success) continue
    if ((clasificacion === "nuevo" || clasificacion === "actualizacion") && campos.length > 0) {
      lista.push({ mensajeId, contrato: parsed.data, campos })
    }
  }
  return lista
}

export function parsearSobre(content: string): Sobre | null {
  try {
    const valor = JSON.parse(content) as unknown
    if (!esRegistro(valor) || typeof valor.ok !== "boolean") return null
    return {
      ok: valor.ok,
      error: typeof valor.error === "string" ? valor.error : undefined,
      data: esRegistro(valor.data) ? valor.data : undefined,
    }
  } catch {
    return null
  }
}
