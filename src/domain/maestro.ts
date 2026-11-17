import fs from "node:fs/promises"
import path from "node:path"
import { parsearCsv, escribirCsv } from "./csv.ts"

export const ENCABEZADOS = [
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

export interface Fila {
  id_contrato: string
  cliente: string
  nit_cliente: string
  pais: string
  objeto: string
  valor: number
  moneda: string
  fecha_inicio: string
  fecha_fin: string
  requiere_poliza: boolean
  tipo_poliza: string
  estado_poliza: string
  comercial: string
  ruta_sharepoint: string
  fecha_registro: string
  fuente: string
}

export function rutaFixture(directorio: string): string {
  return path.join(directorio, "fixtures", "reto-02", "maestro-contratos.csv")
}

export function rutaMaestro(directorio: string): string {
  return path.join(directorio, "out", "sharepoint", "maestro-contratos.csv")
}

export function rutaBuzon(directorio: string): string {
  return path.join(directorio, "fixtures", "reto-02", "buzon")
}

export function rutaComerciales(directorio: string): string {
  return path.join(directorio, "fixtures", "reto-02", "comerciales.json")
}

export function rutaProcesados(directorio: string): string {
  return path.join(directorio, "out", "procesados.json")
}

export function rutaHistorial(directorio: string): string {
  return path.join(directorio, "out", "sharepoint", "historial.jsonl")
}

export async function leerMaestro(directorio: string): Promise<Fila[]> {
  const destino = rutaMaestro(directorio)
  const texto = await fs.readFile(destino, "utf8").catch(() => fs.readFile(rutaFixture(directorio), "utf8"))
  return parsearMaestro(await texto)
}

export async function guardarMaestro(directorio: string, filas: Fila[]): Promise<void> {
  const destino = rutaMaestro(directorio)
  await fs.mkdir(path.dirname(destino), { recursive: true })
  const registros = filas.map(aColumnas)
  await fs.writeFile(destino, escribirCsv([...ENCABEZADOS], registros), "utf8")
}

export function parsearMaestro(texto: string): Fila[] {
  const { filas } = parsearCsv(texto)
  return filas.map((columnas) => ({
    id_contrato: columnas[0] ?? "",
    cliente: columnas[1] ?? "",
    nit_cliente: columnas[2] ?? "",
    pais: columnas[3] ?? "",
    objeto: columnas[4] ?? "",
    valor: Number(columnas[5] ?? "0"),
    moneda: columnas[6] ?? "",
    fecha_inicio: columnas[7] ?? "",
    fecha_fin: columnas[8] ?? "",
    requiere_poliza: (columnas[9] ?? "") === "true",
    tipo_poliza: columnas[10] ?? "",
    estado_poliza: columnas[11] ?? "",
    comercial: columnas[12] ?? "",
    ruta_sharepoint: columnas[13] ?? "",
    fecha_registro: columnas[14] ?? "",
    fuente: columnas[15] ?? "",
  }))
}

export function aColumnas(fila: Fila): string[] {
  return [
    fila.id_contrato,
    fila.cliente,
    fila.nit_cliente,
    fila.pais,
    fila.objeto,
    Number.isInteger(fila.valor) ? String(fila.valor) : String(fila.valor),
    fila.moneda,
    fila.fecha_inicio,
    fila.fecha_fin,
    fila.requiere_poliza ? "true" : "false",
    fila.tipo_poliza,
    fila.estado_poliza,
    fila.comercial,
    fila.ruta_sharepoint,
    fila.fecha_registro,
    fila.fuente,
  ]
}

export async function leerProcesados(directorio: string): Promise<Record<string, { ts: string; clasificacion: string; motivo?: string }>> {
  try {
    const texto = await fs.readFile(rutaProcesados(directorio), "utf8")
    const datos = JSON.parse(texto) as unknown
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) return {}
    return datos as Record<string, { ts: string; clasificacion: string; motivo?: string }>
  } catch {
    return {}
  }
}

export async function marcarProcesado(
  directorio: string,
  mensajeId: string,
  clasificacion: string,
  motivo?: string,
): Promise<void> {
  const actual = await leerProcesados(directorio)
  actual[mensajeId] = { ts: new Date().toISOString(), clasificacion, motivo }
  const destino = rutaProcesados(directorio)
  await fs.mkdir(path.dirname(destino), { recursive: true })
  await fs.writeFile(destino, JSON.stringify(actual, null, 2), "utf8")
}

let cola: Promise<unknown> = Promise.resolve()

export function enCola<T>(tarea: () => Promise<T>): Promise<T> {
  const resultado = cola.then(tarea, tarea)
  cola = resultado.then(
    () => undefined,
    () => undefined,
  )
  return resultado
}
