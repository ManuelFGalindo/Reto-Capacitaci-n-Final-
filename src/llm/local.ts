import { aplicarConfirmacion, esConfirmacionExplicita } from "../domain/confirmacion.ts"
import { contratoSchema, type Contrato } from "../domain/contrato.ts"
import { normalizar } from "../domain/texto.ts"
import { hechosDe, mensajesDelTurno, pendientesDe, type Hecho } from "../agent/historial.ts"
import type { ResultadoModelo } from "./adapter.ts"
import type { MensajeAgente } from "../types.ts"

const PROMPT =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme."

export function planificar(mensajes: MensajeAgente[]): ResultadoModelo {
  const turno = mensajesDelTurno(mensajes)
  const usuario = [...turno].reverse().find((mensaje) => mensaje.role === "user")
  const texto = usuario && usuario.role === "user" ? usuario.content : ""
  const plano = normalizar(texto)
  const hechos = hechosDe(turno)
  const hoy = fechaDeTrabajo(mensajes)

  if (/^no\b/.test(plano)) {
    return textoModelo("Dejo sin registrar los campos en revisión. El maestro no cambia.", false)
  }

  if (esConfirmacionExplicita(texto)) {
    const registradoAhora = [...hechos].reverse().find((hecho) => hecho.nombre === "contratos_registrar" && hecho.ok)
    if (registradoAhora) {
      const alertado = hechos.some((hecho) => hecho.nombre === "contratos_alertas")
      if (!alertado) return herramienta("contratos_alertas", { hoy })
      return textoModelo(resumenConfirmacion(hechos, String(registradoAhora.args.mensaje_id ?? "")), false)
    }
    const pendiente = pendientesDe(mensajes)[0]
    if (!pendiente) return textoModelo("No hay un contrato esperando confirmación. Puedes pedirme que procese el buzón.", false)
    return herramienta("contratos_registrar", {
      mensaje_id: pendiente.mensajeId,
      contrato: aplicarConfirmacion(pendiente.contrato, texto),
      confirmado: true,
    })
  }

  const procesar = /\b(proces|buzon|bandeja|registr)/.test(plano)
  const soloAlertas = /\b(alerta|venc|poliza|reporte)\b/.test(plano) && !procesar
  const soloBuzon = /\b(que hay|pendient|lista el buzon|muestra el buzon)\b/.test(plano) && !procesar

  if (!procesar && !soloAlertas && !soloBuzon) {
    return textoModelo(
      `Puedo procesar el buzón de contratos, registrar lo que esté limpio y dejarte el reporte de alertas.\n\nPrueba con:\n${PROMPT}`,
      false,
    )
  }

  if (soloBuzon) {
    const buzon = ultimo(hechos, "contratos_leer_buzon")
    if (!buzon) return herramienta("contratos_leer_buzon", {})
    if (!buzon.ok) return textoModelo(buzon.error ?? "No pude leer el buzón.", false)
    return textoModelo(listarMensajes(buzon), false)
  }

  if (soloAlertas) {
    const reporte = ultimo(hechos, "contratos_alertas")
    if (!reporte) return herramienta("contratos_alertas", { hoy })
    if (!reporte.ok) return textoModelo(reporte.error ?? "No pude armar las alertas.", false)
    return textoModelo(resumenAlertas(reporte), false)
  }

  const buzon = ultimo(hechos, "contratos_leer_buzon")
  if (!buzon) return herramienta("contratos_leer_buzon", {})
  if (!buzon.ok) return textoModelo(buzon.error ?? "No pude leer el buzón.", false)

  for (const mensaje of mensajesDe(buzon)) {
    const id = mensaje.id
    const extraido = hechoMensaje(hechos, "contratos_extraer", id)
    if (!extraido) return herramienta("contratos_extraer", { mensaje_id: id })
    const validado = hechoMensaje(hechos, "contratos_validar", id)
    if (!validado) {
      const contrato = extraido.ok ? extraido.data?.contrato : undefined
      return herramienta("contratos_validar", contrato ? { mensaje_id: id, contrato } : { mensaje_id: id })
    }
    if (!validado.ok || !validado.data) continue
    const clasificacion = String(validado.data.clasificacion ?? "")
    const revision = Array.isArray(validado.data.requiere_revision) ? validado.data.requiere_revision : []
    if ((clasificacion === "nuevo" || clasificacion === "actualizacion") && revision.length === 0) {
      const registrado = hechoMensaje(hechos, "contratos_registrar", id)
      if (!registrado && validado.data.contrato) {
        return herramienta("contratos_registrar", { mensaje_id: id, contrato: validado.data.contrato, confirmado: false })
      }
    }
  }

  const reporte = ultimo(hechos, "contratos_alertas")
  if (!reporte) return herramienta("contratos_alertas", { hoy })
  if (!reporte.ok) return textoModelo(reporte.error ?? "No pude armar las alertas.", false)
  const cierre = resumenLote(hechos, reporte)
  return textoModelo(cierre, cierre.includes("¿Confirmas"))
}

function resumenLote(hechos: Hecho[], reporte: Hecho): string {
  const lineas = ["Procesé el buzón con las herramientas. Esto es lo que salió de ellas:", ""]
  const ids = idsVistos(hechos)
  for (const id of ids) {
    const validado = hechoMensaje(hechos, "contratos_validar", id)
    const registrado = hechoMensaje(hechos, "contratos_registrar", id)
    const clasificacion = String(validado?.data?.clasificacion ?? "sin clasificar")
    const revision = Array.isArray(validado?.data?.requiere_revision) ? validado.data.requiere_revision.map(String) : []
    const accion = accionDe(clasificacion, revision, registrado)
    lineas.push(`- ${id}: ${clasificacion}. ${accion}`)
    const advertencias = Array.isArray(validado?.data?.advertencias) ? validado.data.advertencias.map(String) : []
    for (const nota of advertencias) lineas.push(`  ${nota}`)
  }
  const pendientes = hechos
    .filter((hecho) => hecho.nombre === "contratos_validar" && hecho.ok)
    .filter((hecho) => Array.isArray(hecho.data?.requiere_revision) && hecho.data.requiere_revision.length > 0)
  lineas.push("", resumenAlertas(reporte))
  if (pendientes.length === 0) return lineas.join("\n")
  lineas.push("", "Hay campos por debajo de 0.8 de confianza. No los registré.")
  for (const pendiente of pendientes) {
    const parsed = contratoSchema.safeParse(pendiente.data?.contrato)
    const campos = Array.isArray(pendiente.data?.requiere_revision) ? pendiente.data.requiere_revision.map(String) : []
    const id = String(pendiente.data?.mensaje_id ?? "")
    lineas.push("", `${id}, campo por campo:`)
    if (parsed.success) {
      for (const nombre of campos) lineas.push(`- ${nombre}: ${mostrarCampo(parsed.data, nombre)}`)
    }
  }
  lineas.push("", "¿Confirmas estos valores? Si sí, respóndeme por ejemplo: confirmo el valor 0 y la fecha fin 2027-08-31.")
  return lineas.join("\n")
}

function resumenConfirmacion(hechos: Hecho[], mensajeId: string): string {
  const registro = hechos.find((hecho) => hecho.nombre === "contratos_registrar" && hecho.args.mensaje_id === mensajeId)
  const id = String(registro?.data?.id_contrato ?? mensajeId)
  const accion = String(registro?.data?.accion ?? "registrar")
  const ruta = String(registro?.data?.ruta_archivo ?? "")
  const lineas = [`Confirmado. ${accion} ${id}.`, ruta ? `Archivo: ${ruta}.` : ""]
  const reporte = ultimo(hechos, "contratos_alertas")
  if (reporte?.ok) lineas.push("", resumenAlertas(reporte))
  return lineas.filter(Boolean).join("\n")
}

function resumenAlertas(reporte: Hecho): string {
  const vencen = filas(reporte.data?.vencen)
  const polizas = filas(reporte.data?.polizas_pendientes)
  const registrados = filas(reporte.data?.registrados_desde_corte)
  const lineas = ["Alertas:"]
  lineas.push(vencen.length ? `Vencen en 60 días: ${vencen.map(etiqueta).join("; ")}.` : "Vencen en 60 días: ninguno.")
  lineas.push(polizas.length ? `Pólizas pendientes: ${polizas.map(etiqueta).join("; ")}.` : "Pólizas pendientes: ninguna.")
  lineas.push(
    registrados.length
      ? `Registrados desde el 2026-05-30: ${registrados.map(etiqueta).join("; ")}.`
      : "Registrados desde el 2026-05-30: ninguno.",
  )
  if (typeof reporte.data?.ruta === "string") lineas.push(`Reporte: ${reporte.data.ruta}.`)
  return lineas.join("\n")
}

function listarMensajes(buzon: Hecho): string {
  const mensajes = mensajesDe(buzon)
  if (mensajes.length === 0) return "El buzón no tiene mensajes pendientes."
  const lineas = ["Mensajes pendientes:"]
  for (const mensaje of mensajes) {
    const marca = mensaje.tiene_contrato ? "con contrato" : "sin contrato"
    lineas.push(`- ${mensaje.id} · ${mensaje.de} · ${mensaje.asunto} (${marca})`)
  }
  return lineas.join("\n")
}

function accionDe(clasificacion: string, revision: string[], registrado: Hecho | undefined): string {
  if (revision.length > 0) return `Sin registrar. Revisión: ${revision.join(", ")}.`
  if (registrado?.ok) return `${String(registrado.data?.accion ?? "registrado")} ${String(registrado.data?.id_contrato ?? "")}.`.trim()
  if (registrado && !registrado.ok) return registrado.error ?? "No se registró."
  if (clasificacion === "duplicado") return "Sin escritura."
  if (clasificacion === "rechazado") return "Rechazado."
  return "Sin registrar."
}

function mostrarCampo(contrato: Contrato, nombre: string): string {
  const mapa: Record<string, { valor: unknown; confianza: number }> = {
    cliente: contrato.cliente,
    nit_cliente: contrato.nit_cliente,
    pais: contrato.pais,
    objeto: contrato.objeto,
    valor: contrato.valor,
    moneda: contrato.moneda,
    fecha_inicio: contrato.fecha_inicio,
    fecha_fin: contrato.fecha_fin,
    requiere_poliza: contrato.requiere_poliza,
    tipo_poliza: contrato.tipo_poliza,
    comercial: contrato.comercial,
    id_contrato: contrato.id_contrato,
  }
  const campo = mapa[nombre]
  if (!campo) return "sin dato"
  const valor = campo.valor === null || campo.valor === "" ? "vacío" : String(campo.valor)
  return `${valor} (confianza ${campo.confianza})`
}

function fechaDeTrabajo(mensajes: MensajeAgente[]): string {
  for (let i = mensajes.length - 1; i >= 0; i -= 1) {
    const mensaje = mensajes[i]
    if (!mensaje || mensaje.role !== "user" || esConfirmacionExplicita(mensaje.content)) continue
    const fecha = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(mensaje.content)
    if (fecha?.[1]) return fecha[1]
  }
  return "2026-09-03"
}

function idsVistos(hechos: Hecho[]): string[] {
  const ids: string[] = []
  for (const hecho of hechos) {
    const id = typeof hecho.args.mensaje_id === "string" ? hecho.args.mensaje_id : ""
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

function ultimo(hechos: Hecho[], nombre: string): Hecho | undefined {
  return [...hechos].reverse().find((hecho) => hecho.nombre === nombre)
}

function hechoMensaje(hechos: Hecho[], nombre: string, mensajeId: string): Hecho | undefined {
  return hechos.find((hecho) => hecho.nombre === nombre && hecho.args.mensaje_id === mensajeId)
}

function mensajesDe(hecho: Hecho): { id: string; de: string; asunto: string; tiene_contrato: boolean }[] {
  if (!Array.isArray(hecho.data?.mensajes)) return []
  return hecho.data.mensajes.filter(esMensaje)
}

function esMensaje(valor: unknown): valor is { id: string; de: string; asunto: string; tiene_contrato: boolean } {
  if (!valor || typeof valor !== "object") return false
  const mensaje = valor as Record<string, unknown>
  return typeof mensaje.id === "string" && typeof mensaje.de === "string" && typeof mensaje.asunto === "string"
}

function filas(valor: unknown): Record<string, unknown>[] {
  if (!Array.isArray(valor)) return []
  return valor.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
}

function etiqueta(fila: Record<string, unknown>): string {
  const id = String(fila.id_contrato ?? "")
  const extra = fila.fecha_fin ?? fila.estado_poliza ?? fila.fecha_registro ?? ""
  return extra ? `${id} (${String(extra)})` : id
}

function textoModelo(content: string, needsConfirmation: boolean): ResultadoModelo {
  return { content, toolCalls: [], needsConfirmation }
}

function herramienta(name: string, args: Record<string, unknown>): ResultadoModelo {
  return {
    content: null,
    toolCalls: [{ id: `call_${name}_${String(args.mensaje_id ?? "lote")}`, name, arguments: args }],
    needsConfirmation: false,
  }
}
