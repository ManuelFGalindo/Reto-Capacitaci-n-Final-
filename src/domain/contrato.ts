import { z } from "zod"

export const UMBRAL = 0.85
export const CORTE_MAESTRO = "2026-05-30"
export const MONEDAS = ["COP", "USD", "PEN", "PAB", "HNL"] as const
export const PAISES = ["CO", "EC", "PE", "PA", "HN"] as const

export const campoTexto = z.object({
  valor: z.string().nullable(),
  confianza: z.number().min(0).max(1),
})

export const campoNumero = z.object({
  valor: z.number().nullable(),
  confianza: z.number().min(0).max(1),
})

export const campoBool = z.object({
  valor: z.boolean().nullable(),
  confianza: z.number().min(0).max(1),
})

export const contratoSchema = z.object({
  id_contrato: campoTexto.describe("Número tal como aparece en el documento."),
  cliente: campoTexto.describe("Razón social de la contraparte."),
  nit_cliente: campoTexto.describe("Identificador tributario sin puntos ni dígito de verificación."),
  pais: campoTexto.describe("CO, EC, PE, PA o HN."),
  objeto: campoTexto.describe("Objeto en máximo 200 caracteres."),
  valor: campoNumero.describe("Valor sin separadores. 0 si el contrato es por demanda."),
  moneda: campoTexto.describe("COP, USD, PEN, PAB o HNL."),
  fecha_inicio: campoTexto.describe("Inicio en formato YYYY-MM-DD."),
  fecha_fin: campoTexto.describe("Fin en formato YYYY-MM-DD."),
  requiere_poliza: campoBool.describe("True si el contrato exige constituir póliza."),
  tipo_poliza: campoTexto.describe("Tipos separados por punto y coma. Vacío si no exige póliza."),
  valor_indeterminado: campoBool.describe("True si el valor depende de órdenes de servicio."),
  es_otrosi: z.boolean().describe("True si el documento es un otrosí."),
  comercial: campoTexto.describe("Nombre resuelto del comercial remitente."),
})

export type CampoTexto = z.infer<typeof campoTexto>
export type CampoNumero = z.infer<typeof campoNumero>
export type CampoBool = z.infer<typeof campoBool>
export type Contrato = z.infer<typeof contratoSchema>

export type Clasificacion = "nuevo" | "actualizacion" | "duplicado" | "rechazado"

export function campo<T>(valor: T | null, confianza: number): { valor: T | null; confianza: number } {
  if (valor === null) return { valor: null, confianza: 0 }
  const acotada = Math.max(0, Math.min(1, confianza))
  return { valor, confianza: Number(acotada.toFixed(2)) }
}

export function contratoVacio(): Contrato {
  return {
    id_contrato: campo(null, 0),
    cliente: campo(null, 0),
    nit_cliente: campo(null, 0),
    pais: campo(null, 0),
    objeto: campo(null, 0),
    valor: campo(null, 0),
    moneda: campo(null, 0),
    fecha_inicio: campo(null, 0),
    fecha_fin: campo(null, 0),
    requiere_poliza: campo(null, 0),
    tipo_poliza: campo(null, 0),
    valor_indeterminado: campo(null, 0),
    es_otrosi: false,
    comercial: campo(null, 0),
  }
}
