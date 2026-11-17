import fs from "node:fs/promises"
import path from "node:path"
import { z } from "zod"
import { buscarExistente, camposEnRevision, clasificar, conflictoNit, diferenciasDe } from "../domain/clasificar.ts"
import { contratoSchema, contratoVacio, type CampoBool, type CampoNumero, type CampoTexto, type Contrato } from "../domain/contrato.ts"
import { extraerDesdeTexto, type Comercial } from "../domain/extraccion.ts"
import { diasEntre, fechaIso, sumarDias } from "../domain/fechas.ts"
import {
  aColumnas,
  enCola,
  guardarMaestro,
  leerMaestro,
  leerProcesados,
  marcarProcesado,
  rutaBuzon,
  rutaComerciales,
  rutaHistorial,
  type Fila,
} from "../domain/maestro.ts"
import { CORTE_MAESTRO } from "../domain/contrato.ts"
import { normalizar, slugCliente } from "../domain/texto.ts"
import { esRegistro } from "../domain/texto.ts"
import { bitacora } from "./bitacora.ts"
import { fail, ok } from "./errores.ts"

export interface ContextoHerramienta {
  directory: string
  sessionId: string
}

interface Correo {
  id: string
  de: string
  para: string
  asunto: string
  fecha: string
  cuerpo: string
  adjuntos: string[]
}

export const leer_buzon = {
  description: "Lista los mensajes del buzón que todavía no están en procesados.json.",
  args: {},
  async execute(_args: Record<string, never>, ctx: ContextoHerramienta): Promise<string> {
    return enCola(() => correr("contratos_leer_buzon", null, ctx, () => listarBuzon(ctx.directory)))
  },
}

export const extraer = {
  description: "Extrae los datos del contrato adjunto a un mensaje, con la confianza de cada campo.",
  args: {
    mensaje_id: z.string().min(1).describe("Identificador del mensaje, por ejemplo msg-001."),
  },
  async execute(args: { mensaje_id: string }, ctx: ContextoHerramienta): Promise<string> {
    return enCola(() => correr("contratos_extraer", args.mensaje_id, ctx, () => extraerMensaje(ctx.directory, args.mensaje_id)))
  },
}

export const validar = {
  description: "Clasifica el contrato como nuevo, actualización, duplicado o rechazado y lista los campos en revisión.",
  args: {
    mensaje_id: z.string().min(1).describe("Identificador del mensaje, por ejemplo msg-001."),
    contrato: contratoSchema
      .optional()
      .describe("Contrato devuelto por contratos_extraer. Si falta, se vuelve a leer el adjunto."),
  },
  async execute(args: { mensaje_id: string; contrato?: Contrato }, ctx: ContextoHerramienta): Promise<string> {
    return enCola(() => correr("contratos_validar", args.mensaje_id, ctx, () => validarMensaje(ctx.directory, args.mensaje_id)))
  },
}

export const registrar = {
  description: "Escribe el contrato en el maestro y archiva el adjunto. Rechaza campos dudosos si no van confirmados.",
  args: {
    mensaje_id: z.string().min(1).describe("Identificador del mensaje, por ejemplo msg-001."),
    contrato: contratoSchema.describe("Contrato devuelto por contratos_validar."),
    confirmado: z
      .boolean()
      .optional()
      .describe("True solo cuando la analista ya confirmó los campos en revisión."),
  },
  async execute(
    args: { mensaje_id: string; contrato: Contrato; confirmado?: boolean },
    ctx: ContextoHerramienta,
  ): Promise<string> {
    return enCola(() =>
      correr("contratos_registrar", args.mensaje_id, ctx, () =>
        registrarMensaje(ctx.directory, args.mensaje_id, args.contrato, args.confirmado === true),
      ),
    )
  },
}

export const alertas = {
  description: "Genera el reporte de vencimientos, pólizas pendientes y contratos registrados desde el corte.",
  args: {
    hoy: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato YYYY-MM-DD.")
      .describe("Fecha de referencia en formato YYYY-MM-DD."),
  },
  async execute(args: { hoy: string }, ctx: ContextoHerramienta): Promise<string> {
    return enCola(() => correr("contratos_alertas", null, ctx, () => generarAlertas(ctx.directory, args.hoy)))
  },
}

export const leer_pdf = {
  description: "Lee el texto de un archivo relativo al proyecto, dentro de fixtures o de out.",
  args: {
    ruta: z.string().min(1).describe("Ruta relativa, por ejemplo fixtures/reto-02/buzon/msg-001/contrato.txt."),
  },
  async execute(args: { ruta: string }, ctx: ContextoHerramienta): Promise<string> {
    return correr("contratos_leer_pdf", null, ctx, () => leerTexto(ctx.directory, args.ruta))
  },
}

async function correr(
  herramienta: string,
  mensajeId: string | null,
  ctx: ContextoHerramienta,
  tarea: () => Promise<string>,
): Promise<string> {
  try {
    const body = await tarea()
    await anotar(ctx.directory, herramienta, mensajeId, body)
    return body
  } catch {
    const body = fail("No se pudo completar la herramienta.")
    await anotar(ctx.directory, herramienta, mensajeId, body)
    return body
  }
}

async function anotar(directorio: string, herramienta: string, mensajeId: string | null, body: string): Promise<void> {
  let bien = false
  let resumen = "Respuesta ilegible."
  try {
    const valor = JSON.parse(body) as unknown
    if (esRegistro(valor) && typeof valor.ok === "boolean") {
      bien = valor.ok
      resumen = valor.ok ? resumir(herramienta, esRegistro(valor.data) ? valor.data : undefined) : String(valor.error ?? "Error.")
    }
  } catch {
    resumen = "Respuesta ilegible."
  }
  await bitacora(directorio, mensajeId, herramienta, bien, resumen)
}

async function listarBuzon(directorio: string): Promise<string> {
  const procesados = await leerProcesados(directorio)
  const carpeta = rutaBuzon(directorio)
  let nombres: string[]
  try {
    nombres = (await fs.readdir(carpeta)).filter((nombre) => nombre.startsWith("msg-")).sort()
  } catch {
    return fail("No encuentro el buzón de contratos.")
  }
  const mensajes = []
  for (const id of nombres) {
    if (procesados[id]) continue
    const correo = await leerCorreo(directorio, id)
    if (!correo) continue
    const adjunto = adjuntoDeContrato(correo.adjuntos)
    mensajes.push({
      id: correo.id,
      de: correo.de,
      asunto: correo.asunto,
      fecha: correo.fecha,
      adjuntos: correo.adjuntos,
      tiene_contrato: Boolean(adjunto),
    })
  }
  return ok({ mensajes })
}

async function extraerMensaje(directorio: string, mensajeId: string): Promise<string> {
  const preparado = await prepararLectura(directorio, mensajeId)
  if (!preparado.ok) return fail(preparado.error)
  const resultado = extraerDesdeTexto(preparado.texto, {
    de: preparado.correo.de,
    fecha: preparado.correo.fecha,
    cuerpo: preparado.correo.cuerpo,
    nombreArchivo: preparado.adjunto,
    comerciales: preparado.comerciales,
  })
  if (!resultado.ok) return fail(resultado.error)
  return ok({
    mensaje_id: mensajeId,
    contrato: resultado.contrato,
    advertencias: resultado.advertencias,
    archivo: preparado.adjunto,
  })
}

async function validarMensaje(directorio: string, mensajeId: string): Promise<string> {
  const correo = await leerCorreo(directorio, mensajeId)
  if (!correo) return fail(`No existe el mensaje ${mensajeId}.`)
  const adjunto = adjuntoDeContrato(correo.adjuntos)
  if (!adjunto) {
    const motivo = "El mensaje no trae un adjunto de contrato."
    await marcarProcesado(directorio, mensajeId, "rechazado", motivo)
    return ok({
      mensaje_id: mensajeId,
      clasificacion: "rechazado",
      motivo,
      requiere_revision: [],
      diferencias: [],
      advertencias: [],
      contrato: contratoVacio(),
    })
  }
  const preparado = await prepararLectura(directorio, mensajeId)
  if (!preparado.ok) return fail(preparado.error)
  const resultado = extraerDesdeTexto(preparado.texto, {
    de: preparado.correo.de,
    fecha: preparado.correo.fecha,
    cuerpo: preparado.correo.cuerpo,
    nombreArchivo: preparado.adjunto,
    comerciales: preparado.comerciales,
  })
  if (!resultado.ok) return fail(resultado.error)
  const filas = await leerMaestro(directorio)
  const existente = buscarExistente(filas, resultado.contrato)
  const decision = clasificar(resultado.contrato, existente)
  const requiere = camposEnRevision(resultado.contrato, decision.clasificacion)
  if (conflictoNit(existente, resultado.contrato) && !requiere.includes("nit_cliente")) requiere.push("nit_cliente")
  if (decision.clasificacion === "duplicado" || decision.clasificacion === "rechazado") {
    await marcarProcesado(directorio, mensajeId, decision.clasificacion, decision.motivo)
  }
  return ok({
    mensaje_id: mensajeId,
    clasificacion: decision.clasificacion,
    motivo: decision.motivo,
    id_contrato_existente: existente?.id_contrato,
    requiere_revision: requiere,
    diferencias: existente ? diferenciasDe(existente, resultado.contrato) : [],
    advertencias: resultado.advertencias,
    contrato: resultado.contrato,
  })
}

async function registrarMensaje(
  directorio: string,
  mensajeId: string,
  recibido: Contrato,
  confirmado: boolean,
): Promise<string> {
  const preparado = await prepararLectura(directorio, mensajeId)
  if (!preparado.ok) return fail(preparado.error)
  const resultado = extraerDesdeTexto(preparado.texto, {
    de: preparado.correo.de,
    fecha: preparado.correo.fecha,
    cuerpo: preparado.correo.cuerpo,
    nombreArchivo: preparado.adjunto,
    comerciales: preparado.comerciales,
  })
  if (!resultado.ok) return fail(resultado.error)
  const contrato = fusionar(resultado.contrato, recibido, confirmado)
  const filas = await leerMaestro(directorio)
  const existente = buscarExistente(filas, contrato)
  const decision = clasificar(contrato, existente)
  if (decision.clasificacion === "rechazado") return fail(decision.motivo)
  if (decision.clasificacion === "duplicado") return fail(decision.motivo)
  const requiere = camposEnRevision(contrato, decision.clasificacion)
  if (conflictoNit(existente, contrato) && !requiere.includes("nit_cliente")) requiere.push("nit_cliente")
  if (requiere.length > 0 && !confirmado) {
    return fail(`requiere revisión: ${requiere.join(", ")}`)
  }
  const fechaRegistro = fechaIso(preparado.correo.fecha) ?? new Date().toISOString().slice(0, 10)
  const id = contrato.id_contrato.valor ?? siguienteAuto(filas, fechaRegistro.slice(0, 4))
  const base = existente ?? filaNueva(id, fechaRegistro)
  const ruta = await archivar(directorio, preparado, id, contrato.cliente.valor ?? base.cliente, contrato.fecha_inicio.valor ?? base.fecha_inicio)
  const siguiente = aplicarFila(base, contrato, ruta, fechaRegistro, Boolean(existente))
  const actualizadas = existente
    ? filas.map((fila) => (fila.id_contrato === existente.id_contrato ? siguiente : fila))
    : [...filas, siguiente]
  await guardarMaestro(directorio, actualizadas)
  const cambios = existente ? diffFilas(existente, siguiente) : { alta: id }
  await fs.mkdir(path.dirname(rutaHistorial(directorio)), { recursive: true })
  await fs.appendFile(
    rutaHistorial(directorio),
    `${JSON.stringify({
      ts: new Date().toISOString(),
      id_contrato: siguiente.id_contrato,
      accion: existente ? "actualizar" : "crear",
      cambios,
      mensaje_id: mensajeId,
    })}\n`,
    "utf8",
  )
  await marcarProcesado(directorio, mensajeId, decision.clasificacion)
  return ok({
    mensaje_id: mensajeId,
    id_contrato: siguiente.id_contrato,
    accion: existente ? "actualizar" : "crear",
    ruta_archivo: siguiente.ruta_sharepoint,
    estado_poliza: siguiente.estado_poliza,
  })
}

async function generarAlertas(directorio: string, hoy: string): Promise<string> {
  if (!fechaIso(hoy)) return fail(`Fecha inválida: ${hoy}.`)
  const limite = sumarDias(hoy, 60)
  const filas = await leerMaestro(directorio)
  const vencen = filas
    .filter((fila) => fila.fecha_fin >= hoy && fila.fecha_fin <= limite)
    .map((fila) => ({
      id_contrato: fila.id_contrato,
      cliente: fila.cliente,
      fecha_fin: fila.fecha_fin,
      dias: diasEntre(hoy, fila.fecha_fin),
    }))
  const polizas = filas
    .filter((fila) => fila.requiere_poliza && fila.estado_poliza !== "vigente")
    .map((fila) => ({
      id_contrato: fila.id_contrato,
      cliente: fila.cliente,
      estado_poliza: fila.estado_poliza,
      tipo_poliza: fila.tipo_poliza,
    }))
  const registrados = filas
    .filter((fila) => fila.fecha_registro >= CORTE_MAESTRO)
    .map((fila) => ({
      id_contrato: fila.id_contrato,
      cliente: fila.cliente,
      fecha_registro: fila.fecha_registro,
      fuente: fila.fuente,
    }))
  const markdown = renderAlertas(hoy, vencen, polizas, registrados)
  const destino = path.join(directorio, "out", "alertas.md")
  await fs.mkdir(path.dirname(destino), { recursive: true })
  await fs.writeFile(destino, markdown, "utf8")
  return ok({ ruta: "out/alertas.md", vencen, polizas_pendientes: polizas, registrados_desde_corte: registrados })
}

async function leerTexto(directorio: string, ruta: string): Promise<string> {
  const limpia = ruta.replaceAll("\\", "/").replace(/^\/+/, "")
  if (!limpia || limpia.includes("..")) return fail("No puedo abrir esa ruta.")
  const raiz = path.resolve(directorio)
  const destino = path.resolve(raiz, limpia)
  const relativo = path.relative(raiz, destino)
  if (relativo.startsWith("..") || path.isAbsolute(relativo)) return fail("No puedo abrir esa ruta.")
  const permitida = relativo.startsWith(`fixtures${path.sep}`) || relativo.startsWith(`out${path.sep}`) || relativo === "out"
  if (!permitida) return fail("Solo leo archivos de fixtures o de out.")
  const extension = path.extname(destino).toLowerCase()
  if (extension === ".pdf") return fail("El PDF no trae texto extraíble en este reto. Usa el contrato.txt del mensaje.")
  if (![".txt", ".md", ".json", ".csv", ".jsonl"].includes(extension)) {
    return fail(`No leo archivos ${extension || "sin extensión"}.`)
  }
  try {
    const texto = await fs.readFile(destino, "utf8")
    return ok({ ruta: limpia, texto })
  } catch {
    return fail("No encuentro ese archivo.")
  }
}

async function prepararLectura(directorio: string, mensajeId: string): Promise<
  | { ok: true; correo: Correo; texto: string; adjunto: string; comerciales: Comercial[] }
  | { ok: false; error: string }
> {
  const correo = await leerCorreo(directorio, mensajeId)
  if (!correo) return { ok: false, error: `No existe el mensaje ${mensajeId}.` }
  const adjunto = adjuntoDeContrato(correo.adjuntos)
  if (!adjunto) return { ok: false, error: "El mensaje no tiene adjunto de contrato." }
  try {
    const texto = await fs.readFile(path.join(rutaBuzon(directorio), mensajeId, adjunto), "utf8")
    const comerciales = await leerComerciales(directorio)
    return { ok: true, correo, texto, adjunto, comerciales }
  } catch {
    return { ok: false, error: "No pude leer el adjunto del contrato." }
  }
}

async function leerCorreo(directorio: string, mensajeId: string): Promise<Correo | null> {
  if (!/^msg-\d+$/.test(mensajeId)) return null
  try {
    const texto = await fs.readFile(path.join(rutaBuzon(directorio), mensajeId, "correo.json"), "utf8")
    const datos = JSON.parse(texto) as unknown
    if (!esCorreo(datos)) return null
    return datos
  } catch {
    return null
  }
}

async function leerComerciales(directorio: string): Promise<Comercial[]> {
  try {
    const texto = await fs.readFile(rutaComerciales(directorio), "utf8")
    const datos = JSON.parse(texto) as unknown
    if (!Array.isArray(datos)) return []
    return datos.filter(esComercial)
  } catch {
    return []
  }
}

function adjuntoDeContrato(adjuntos: string[]): string | null {
  return adjuntos.find((nombre) => /contrato|otrosi/i.test(nombre)) ?? null
}

function fusionar(base: Contrato, recibido: Contrato, confirmado: boolean): Contrato {
  if (!confirmado) return base
  return {
    ...base,
    id_contrato: pisarTexto(base.id_contrato, recibido.id_contrato),
    cliente: pisarTexto(base.cliente, recibido.cliente),
    nit_cliente: pisarTexto(base.nit_cliente, recibido.nit_cliente),
    pais: pisarTexto(base.pais, recibido.pais),
    objeto: pisarTexto(base.objeto, recibido.objeto),
    moneda: pisarTexto(base.moneda, recibido.moneda),
    fecha_inicio: pisarTexto(base.fecha_inicio, recibido.fecha_inicio),
    fecha_fin: pisarTexto(base.fecha_fin, recibido.fecha_fin),
    tipo_poliza: pisarTexto(base.tipo_poliza, recibido.tipo_poliza),
    comercial: pisarTexto(base.comercial, recibido.comercial),
    valor: pisarNumero(base.valor, recibido.valor),
    requiere_poliza: pisarBool(base.requiere_poliza, recibido.requiere_poliza),
  }
}

function pisarTexto(base: CampoTexto, recibido: CampoTexto): CampoTexto {
  if (base.confianza >= 0.8 || recibido.valor === null || recibido.valor === "") return base
  return { valor: recibido.valor, confianza: 1 }
}

function pisarNumero(base: CampoNumero, recibido: CampoNumero): CampoNumero {
  if (base.confianza >= 0.8 || recibido.valor === null) return base
  return { valor: recibido.valor, confianza: 1 }
}

function pisarBool(base: CampoBool, recibido: CampoBool): CampoBool {
  if (base.confianza >= 0.8 || recibido.valor === null) return base
  return { valor: recibido.valor, confianza: 1 }
}

function filaNueva(id: string, fechaRegistro: string): Fila {
  return {
    id_contrato: id,
    cliente: "",
    nit_cliente: "",
    pais: "",
    objeto: "",
    valor: 0,
    moneda: "",
    fecha_inicio: "",
    fecha_fin: "",
    requiere_poliza: false,
    tipo_poliza: "",
    estado_poliza: "no_aplica",
    comercial: "",
    ruta_sharepoint: "",
    fecha_registro: fechaRegistro,
    fuente: "buzon",
  }
}

function textoEstable(previo: string, entrante: string | null): string {
  if (!entrante) return previo
  if (previo && normalizar(previo) === normalizar(entrante)) return previo
  return entrante
}

function aplicarFila(base: Fila, contrato: Contrato, ruta: string, fechaRegistro: string, actualizacion: boolean): Fila {
  const requiere = contrato.requiere_poliza.valor ?? base.requiere_poliza
  return {
    id_contrato: contrato.id_contrato.valor ?? base.id_contrato,
    cliente: textoEstable(base.cliente, contrato.cliente.valor),
    nit_cliente: contrato.nit_cliente.valor ?? base.nit_cliente,
    pais: contrato.pais.valor ?? base.pais,
    objeto: textoEstable(base.objeto, contrato.objeto.valor),
    valor: contrato.valor.valor ?? base.valor,
    moneda: contrato.moneda.valor ?? base.moneda,
    fecha_inicio: contrato.fecha_inicio.valor ?? base.fecha_inicio,
    fecha_fin: contrato.fecha_fin.valor ?? base.fecha_fin,
    requiere_poliza: requiere,
    tipo_poliza: requiere ? (contrato.tipo_poliza.valor ?? base.tipo_poliza) : "",
    estado_poliza: actualizacion ? base.estado_poliza : requiere ? "pendiente" : "no_aplica",
    comercial: textoEstable(base.comercial, contrato.comercial.valor),
    ruta_sharepoint: ruta,
    fecha_registro: actualizacion ? base.fecha_registro : fechaRegistro,
    fuente: actualizacion ? base.fuente : "buzon",
  }
}

async function archivar(
  directorio: string,
  preparado: { correo: Correo; adjunto: string },
  id: string,
  cliente: string,
  fechaInicio: string,
): Promise<string> {
  const anio = /^\d{4}/.exec(fechaInicio)?.[0] ?? fechaIso(preparado.correo.fecha)?.slice(0, 4) ?? "sin-fecha"
  const extension = path.extname(preparado.adjunto) || ".txt"
  const relativa = ["Contratos", anio, slugCliente(cliente) || "sin-cliente", `${id}${extension}`].join("/")
  const destino = path.join(directorio, "out", "sharepoint", ...relativa.split("/"))
  await fs.mkdir(path.dirname(destino), { recursive: true })
  await fs.copyFile(path.join(rutaBuzon(directorio), preparado.correo.id, preparado.adjunto), destino)
  return relativa
}

function siguienteAuto(filas: Fila[], anio: string): string {
  let maximo = 0
  const regex = new RegExp(`^AUTO-${anio}-(\\d+)$`)
  for (const fila of filas) {
    const match = regex.exec(fila.id_contrato)
    if (match?.[1]) maximo = Math.max(maximo, Number(match[1]))
  }
  return `AUTO-${anio}-${String(maximo + 1).padStart(3, "0")}`
}

function diffFilas(antes: Fila, despues: Fila): Record<string, { antes: string; despues: string }> {
  const cambios: Record<string, { antes: string; despues: string }> = {}
  const izq = aColumnas(antes)
  const der = aColumnas(despues)
  ENCABEZADOS.forEach((nombre, indice) => {
    if (izq[indice] !== der[indice]) cambios[nombre] = { antes: izq[indice] ?? "", despues: der[indice] ?? "" }
  })
  return cambios
}

const ENCABEZADOS = [
  "id_contrato",
  "cliente",
  "nit_cliente",
  "pais",
  "objeto",
  "valor",
  "moneda",
  "fecha_inicio",
  "fecha_fin",
  "requiere_poliza",
  "tipo_poliza",
  "estado_poliza",
  "comercial",
  "ruta_sharepoint",
  "fecha_registro",
  "fuente",
] as const

function renderAlertas(
  hoy: string,
  vencen: { id_contrato: string; cliente: string; fecha_fin: string; dias: number }[],
  polizas: { id_contrato: string; cliente: string; estado_poliza: string; tipo_poliza: string }[],
  registrados: { id_contrato: string; cliente: string; fecha_registro: string; fuente: string }[],
): string {
  const lineas = [
    "# Alertas de contratos",
    "",
    `Fecha de referencia: ${hoy}`,
    `Corte del maestro: ${CORTE_MAESTRO}`,
    "",
    "## Vencen en 60 días o menos",
    "",
    tabla(
      ["Contrato", "Cliente", "Vence", "Días"],
      vencen.map((fila) => [fila.id_contrato, fila.cliente, fila.fecha_fin, String(fila.dias)]),
    ),
    "",
    "## Pólizas pendientes",
    "",
    tabla(
      ["Contrato", "Cliente", "Estado", "Tipo"],
      polizas.map((fila) => [fila.id_contrato, fila.cliente, fila.estado_poliza, fila.tipo_poliza]),
    ),
    "",
    `## Registrados desde el corte (${CORTE_MAESTRO})`,
    "",
    tabla(
      ["Contrato", "Cliente", "Registro", "Fuente"],
      registrados.map((fila) => [fila.id_contrato, fila.cliente, fila.fecha_registro, fila.fuente]),
    ),
    "",
  ]
  return lineas.join("\n")
}

function tabla(encabezados: string[], filas: string[][]): string {
  if (filas.length === 0) return "Ninguno."
  const cabeza = `| ${encabezados.join(" | ")} |`
  const sep = `| ${encabezados.map(() => "---").join(" | ")} |`
  const cuerpo = filas.map((fila) => `| ${fila.join(" | ")} |`)
  return [cabeza, sep, ...cuerpo].join("\n")
}

function resumir(herramienta: string, data: Record<string, unknown> | undefined): string {
  if (herramienta === "contratos_leer_buzon") {
    const cantidad = Array.isArray(data?.mensajes) ? data.mensajes.length : 0
    return `${cantidad} mensajes pendientes.`
  }
  if (typeof data?.clasificacion === "string") {
    const revision = Array.isArray(data.requiere_revision) ? data.requiere_revision.map(String).join(", ") : ""
    return revision ? `${data.mensaje_id}: ${data.clasificacion}; revisión: ${revision}` : `${data.mensaje_id}: ${data.clasificacion}`
  }
  if (typeof data?.accion === "string") return `${data.accion} ${String(data.id_contrato ?? "")}`.trim()
  if (herramienta === "contratos_alertas") {
    const vencen = Array.isArray(data?.vencen) ? data.vencen.length : 0
    const polizas = Array.isArray(data?.polizas_pendientes) ? data.polizas_pendientes.length : 0
    return `${vencen} por vencer, ${polizas} pólizas pendientes.`
  }
  if (typeof data?.texto === "string") return `Texto de ${data.texto.length} caracteres.`
  const id = idContrato(data?.contrato)
  return id ? `Contrato ${id}.` : "Listo."
}

function idContrato(valor: unknown): string | null {
  if (!esRegistro(valor) || !esRegistro(valor.id_contrato)) return null
  return typeof valor.id_contrato.valor === "string" ? valor.id_contrato.valor : null
}

function esCorreo(valor: unknown): valor is Correo {
  if (!esRegistro(valor)) return false
  return (
    typeof valor.id === "string" &&
    typeof valor.de === "string" &&
    typeof valor.asunto === "string" &&
    typeof valor.fecha === "string" &&
    typeof valor.cuerpo === "string" &&
    Array.isArray(valor.adjuntos)
  )
}

function esComercial(valor: unknown): valor is Comercial {
  return esRegistro(valor) && typeof valor.email === "string" && typeof valor.nombre === "string"
}
