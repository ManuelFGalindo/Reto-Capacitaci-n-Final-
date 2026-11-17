import { campo, type Contrato } from "./contrato.ts"
import { normalizar } from "./texto.ts"

const FRASES = new Set([
  "si",
  "ok",
  "dale",
  "adelante",
  "confirma",
  "confirmo",
  "confirmar",
  "confirmado",
  "procede",
  "de acuerdo",
  "autorizo",
  "hazlo",
  "registra",
  "registralo",
  "si confirmo",
  "si registra",
])

export function esConfirmacionExplicita(texto: string): boolean {
  const plano = normalizar(texto)
  if (!plano) return false
  if (/\bno\b/.test(plano) || /\b(todavia|aun)\b/.test(plano)) return false
  if (FRASES.has(plano)) return true
  return /^(si|confirmo|confirma|confirmado|autorizo|de acuerdo|adelante|procede|registra|registralo)\b/.test(plano)
}

export function pideConfirmacion(texto: string): boolean {
  return /confirm/i.test(texto) && texto.includes("?")
}

export function aplicarConfirmacion(contrato: Contrato, texto: string): Contrato {
  const copia: Contrato = {
    ...contrato,
    id_contrato: { ...contrato.id_contrato },
    cliente: { ...contrato.cliente },
    nit_cliente: { ...contrato.nit_cliente },
    pais: { ...contrato.pais },
    objeto: { ...contrato.objeto },
    valor: { ...contrato.valor },
    moneda: { ...contrato.moneda },
    fecha_inicio: { ...contrato.fecha_inicio },
    fecha_fin: { ...contrato.fecha_fin },
    requiere_poliza: { ...contrato.requiere_poliza },
    tipo_poliza: { ...contrato.tipo_poliza },
    valor_indeterminado: { ...contrato.valor_indeterminado },
    comercial: { ...contrato.comercial },
  }
  const fecha = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(texto)
  if (fecha?.[1]) copia.fecha_fin = campo(fecha[1], 1)
  const valor = /\bvalor\s+(\d+)\b/i.exec(texto)
  if (valor?.[1]) copia.valor = campo(Number(valor[1]), 1)
  return copia
}
