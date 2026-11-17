import { UMBRAL, type Clasificacion, type Contrato } from "./contrato.ts"
import type { Fila } from "./maestro.ts"
import { similitud } from "./texto.ts"

export interface Diferencia {
  campo: string
  antes: string
  despues: string
}

const COLUMNAS = [
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
  "comercial",
] as const

export function buscarExistente(filas: Fila[], contrato: Contrato): Fila | null {
  const id = contrato.id_contrato.valor?.toLowerCase()
  if (id) return filas.find((fila) => fila.id_contrato.toLowerCase() === id) ?? null
  if (!contrato.nit_cliente.valor || !contrato.objeto.valor) return null
  let mejor: { fila: Fila; puntaje: number } | null = null
  for (const fila of filas) {
    if (fila.nit_cliente !== contrato.nit_cliente.valor) continue
    const puntaje = similitud(fila.objeto, contrato.objeto.valor)
    if (!mejor || puntaje > mejor.puntaje) mejor = { fila, puntaje }
  }
  if (mejor && mejor.puntaje >= 0.9) return mejor.fila
  return null
}

export function clasificar(contrato: Contrato, existente: Fila | null): { clasificacion: Clasificacion; motivo: string } {
  const identificable = Boolean(contrato.id_contrato.valor || contrato.cliente.valor || contrato.objeto.valor)
  if (!identificable) {
    return { clasificacion: "rechazado", motivo: "El texto no contiene partes ni objeto identificables." }
  }
  if (!existente) return { clasificacion: "nuevo", motivo: "No hay un contrato igual en el maestro." }
  if (mismosDatosClave(contrato, existente)) {
    return {
      clasificacion: "duplicado",
      motivo: `Mismos id, valor y fechas que ${existente.id_contrato}. No se escribe.`,
    }
  }
  const porOtrosi = contrato.es_otrosi ? " Es un otrosí." : ""
  return {
    clasificacion: "actualizacion",
    motivo: `Actualiza ${existente.id_contrato}.${porOtrosi}`,
  }
}

export function camposEnRevision(contrato: Contrato, clasificacion: Clasificacion): string[] {
  if (clasificacion === "rechazado" || clasificacion === "duplicado") return []
  const hereda = clasificacion === "actualizacion"
  const pendientes: string[] = []
  for (const nombre of COLUMNAS) {
    if (nombre === "tipo_poliza") {
      if (contrato.requiere_poliza.valor !== true) continue
      if (!contrato.tipo_poliza.valor || contrato.tipo_poliza.confianza < UMBRAL) pendientes.push(nombre)
      continue
    }
    const actual = contrato[nombre]
    if (hereda && (actual.valor === null || actual.valor === "")) continue
    if (actual.valor === null || actual.valor === "" || actual.confianza < UMBRAL) pendientes.push(nombre)
  }
  return pendientes
}

export function diferenciasDe(fila: Fila, contrato: Contrato): Diferencia[] {
  const pares: { campo: string; antes: string; despues: string | null }[] = [
    { campo: "cliente", antes: fila.cliente, despues: contrato.cliente.valor },
    { campo: "nit_cliente", antes: fila.nit_cliente, despues: contrato.nit_cliente.valor },
    { campo: "pais", antes: fila.pais, despues: contrato.pais.valor },
    { campo: "objeto", antes: fila.objeto, despues: contrato.objeto.valor },
    { campo: "valor", antes: String(fila.valor), despues: contrato.valor.valor === null ? null : String(contrato.valor.valor) },
    { campo: "moneda", antes: fila.moneda, despues: contrato.moneda.valor },
    { campo: "fecha_inicio", antes: fila.fecha_inicio, despues: contrato.fecha_inicio.valor },
    { campo: "fecha_fin", antes: fila.fecha_fin, despues: contrato.fecha_fin.valor },
    {
      campo: "requiere_poliza",
      antes: String(fila.requiere_poliza),
      despues: contrato.requiere_poliza.valor === null ? null : String(contrato.requiere_poliza.valor),
    },
    { campo: "tipo_poliza", antes: fila.tipo_poliza, despues: contrato.tipo_poliza.valor },
    { campo: "comercial", antes: fila.comercial, despues: contrato.comercial.valor },
  ]
  return pares
    .filter((par): par is { campo: string; antes: string; despues: string } => par.despues !== null && par.despues !== par.antes)
    .map((par) => ({ campo: par.campo, antes: par.antes, despues: par.despues }))
}

export function conflictoNit(fila: Fila | null, contrato: Contrato): boolean {
  if (!fila || !contrato.nit_cliente.valor) return false
  return fila.nit_cliente !== contrato.nit_cliente.valor && contrato.nit_cliente.confianza >= UMBRAL
}

function mismosDatosClave(contrato: Contrato, fila: Fila): boolean {
  if (contrato.valor.valor === null || !contrato.fecha_inicio.valor || !contrato.fecha_fin.valor) return false
  return (
    contrato.valor.valor === fila.valor &&
    contrato.fecha_inicio.valor === fila.fecha_inicio &&
    contrato.fecha_fin.valor === fila.fecha_fin
  )
}
