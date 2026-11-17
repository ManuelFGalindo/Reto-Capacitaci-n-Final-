import { campo, MONEDAS, type Contrato } from "./contrato.ts"
import { fechaIso, listarFechas, mesNombrado, mesesDePlazo, sumarMeses } from "./fechas.ts"
import { limpiarNit, limpiarTexto, recortar, titular, unaLinea } from "./texto.ts"

export interface Comercial {
  email: string
  nombre: string
  region?: string
}

export interface MetaCorreo {
  de: string
  fecha: string
  cuerpo: string
  nombreArchivo: string
  comerciales: Comercial[]
}

export type ResultadoExtraccion =
  | { ok: true; contrato: Contrato; advertencias: string[] }
  | { ok: false; error: string }

const MONEDA_PAIS: Record<string, string> = {
  CO: "COP",
  EC: "USD",
  PE: "PEN",
  PA: "PAB",
  HN: "HNL",
}

export function extraerDesdeTexto(textoCrudo: string, meta: MetaCorreo): ResultadoExtraccion {
  const texto = limpiarTexto(textoCrudo)
  if (!texto) return { ok: false, error: "El texto del contrato está vacío." }
  const ajena = /\b(EUR|GBP|MXN|BRL|CLP|ARS)\b/.exec(texto)
  if (ajena?.[1]) return { ok: false, error: `Moneda desconocida: ${ajena[1]}.` }

  const parte = extraerParte(texto)
  const objeto = extraerObjeto(texto)
  const valor = extraerValor(texto, parte.pais)
  const fechas = extraerFechas(texto, meta.fecha)
  if ("error" in fechas) return { ok: false, error: fechas.error }
  const poliza = extraerPoliza(texto)
  const comercial = resolverComercial(meta)
  const esOtrosi = /otros[ií]/i.test(texto) || /otrosi/i.test(meta.nombreArchivo)

  const contrato: Contrato = {
    id_contrato: extraerId(texto),
    cliente: parte.cliente,
    nit_cliente: parte.nit,
    pais: parte.paisCampo,
    objeto: objeto,
    valor: campo(valor.valor, valor.confianzaValor),
    moneda: campo(valor.moneda, valor.confianzaMoneda),
    fecha_inicio: fechas.inicio,
    fecha_fin: fechas.fin,
    requiere_poliza: campo(poliza.requiere, poliza.confianza),
    tipo_poliza: campo(poliza.tipo, poliza.confianza),
    valor_indeterminado: campo(valor.indeterminado, valor.indeterminado ? 0.7 : 0.95),
    es_otrosi: esOtrosi,
    comercial: campo(comercial.nombre, comercial.confianza),
  }

  return { ok: true, contrato, advertencias: comercial.advertencias }
}

function extraerId(texto: string): Contrato["id_contrato"] {
  const match = /\b((?:CT|CM|C)-\d{4}-\d+)\b/i.exec(texto)
  if (!match?.[1]) return campo(null, 0)
  return campo(match[1].toUpperCase(), 0.98)
}

function extraerParte(texto: string): {
  cliente: Contrato["cliente"]
  nit: Contrato["nit_cliente"]
  pais: string | null
  paisCampo: Contrato["pais"]
} {
  const match =
    /(?:Entre los suscritos,|Entre)\s+(.+?),\s+(?:identificada con\s+)?(NIT|RUC|RTN)\s+([\d.\-]+)/i.exec(texto)
  if (!match?.[1] || !match[2] || !match[3]) {
    return { cliente: campo(null, 0), nit: campo(null, 0), pais: null, paisCampo: campo(null, 0) }
  }
  const nit = limpiarNit(match[3])
  const pais = paisDe(match[2], nit)
  return {
    cliente: campo(titular(match[1]), 0.95),
    nit: campo(nit || null, nit ? 0.97 : 0),
    pais,
    paisCampo: campo(pais, pais ? 0.93 : 0),
  }
}

function paisDe(tipo: string, nit: string): string | null {
  const etiqueta = tipo.toUpperCase()
  if (etiqueta === "NIT") return "CO"
  if (etiqueta === "RTN" || nit.length === 14) return "HN"
  if (etiqueta === "RUC" && nit.length === 13) return "EC"
  if (etiqueta === "RUC" && nit.length === 11) return "PE"
  if (nit.length === 9) return "PA"
  return null
}

function extraerObjeto(texto: string): Contrato["objeto"] {
  const clausula = textoClausula(texto, "OBJETO")
  if (!clausula) return campo(null, 0)
  const { texto: corto, recortado } = recortar(clausula, 200)
  return campo(corto || null, corto ? (recortado ? 0.9 : 0.94) : 0)
}

function extraerValor(
  texto: string,
  pais: string | null,
): {
  valor: number | null
  moneda: string | null
  confianzaValor: number
  confianzaMoneda: number
  indeterminado: boolean
} {
  const clausula = textoClausula(texto, "VALOR")
  const zona = clausula || texto
  if (/no tiene un valor determinado|valor indeterminado|por demanda/i.test(zona)) {
    const moneda = monedaEn(texto) ?? (pais ? MONEDA_PAIS[pais] ?? null : null)
    return {
      valor: 0,
      moneda,
      confianzaValor: 0.55,
      confianzaMoneda: monedaEn(texto) ? 0.86 : 0.84,
      indeterminado: true,
    }
  }
  const hallado = montoEn(clausula) ?? montoEn(texto)
  if (!hallado) {
    const moneda = pais ? MONEDA_PAIS[pais] ?? null : null
    return { valor: null, moneda, confianzaValor: 0, confianzaMoneda: moneda ? 0.84 : 0, indeterminado: false }
  }
  return {
    valor: hallado.valor,
    moneda: hallado.moneda,
    confianzaValor: 0.97,
    confianzaMoneda: 0.96,
    indeterminado: false,
  }
}

function montoEn(fragmento: string): { valor: number; moneda: string } | null {
  if (!fragmento) return null
  const match = /(COP|USD|PEN|PAB|HNL)\s*\$?\s*(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)/i.exec(fragmento)
  if (!match?.[1] || !match[2]) return null
  const moneda = match[1].toUpperCase()
  if (!MONEDAS.includes(moneda as (typeof MONEDAS)[number])) return null
  const valor = parseMonto(match[2])
  if (valor === null) return null
  return { valor, moneda }
}

function monedaEn(fragmento: string): string | null {
  const match = /\b(COP|USD|PEN|PAB|HNL)\b/i.exec(fragmento)
  return match?.[1]?.toUpperCase() ?? null
}

function parseMonto(token: string): number | null {
  if (/^\d{1,3}(\.\d{3})+$/.test(token)) return Number(token.replaceAll(".", ""))
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(token)) return Number(token.replaceAll(",", ""))
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(token)) {
    const [entero, decimal] = token.split(",")
    return Number(`${(entero ?? "").replaceAll(".", "")}.${decimal ?? "0"}`)
  }
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token)
  return null
}

function extraerFechas(
  texto: string,
  fechaCorreo: string,
): { inicio: Contrato["fecha_inicio"]; fin: Contrato["fecha_fin"] } | { error: string } {
  const plazo = textoClausula(texto, "PLAZO")
  const zona = plazo || texto
  const explicitas = listarFechas(zona)
  if ("error" in explicitas) return explicitas
  const tieneRango = /desde[\s\S]{0,120}hasta/i.test(zona)
  if (tieneRango && explicitas.length >= 2) {
    return { inicio: campo(explicitas[0]?.iso ?? null, 0.96), fin: campo(explicitas[1]?.iso ?? null, 0.96) }
  }
  const hasta = /hasta el\s+(.{0,80}?\d{4})/i.exec(texto)
  if (hasta?.[1]) {
    const fines = listarFechas(hasta[1])
    if ("error" in fines) return fines
    const suscrito = /suscrito el\s+(.{0,80}?\d{4})/i.exec(texto)
    let inicio: string | null = null
    if (suscrito?.[1]) {
      const inicios = listarFechas(suscrito[1])
      if ("error" in inicios) return inicios
      inicio = inicios[0]?.iso ?? null
    }
    if (fines[0]?.iso) {
      return { inicio: campo(inicio, inicio ? 0.9 : 0), fin: campo(fines[0].iso, 0.96) }
    }
  }
  const meses = mesesDePlazo(zona)
  const firma = mesNombrado(texto)
  const diaCorreo = fechaIso(fechaCorreo)
  if (meses && firma && diaCorreo) {
    const [anio, mes] = diaCorreo.split("-").map(Number)
    if (anio === firma.anio && mes === firma.mes) {
      return {
        inicio: campo(diaCorreo, 0.84),
        fin: campo(sumarMeses(diaCorreo, meses), 0.58),
      }
    }
  }
  if (explicitas.length >= 2) {
    return { inicio: campo(explicitas[0]?.iso ?? null, 0.9), fin: campo(explicitas[1]?.iso ?? null, 0.9) }
  }
  return { inicio: campo(null, 0), fin: campo(null, 0) }
}

function extraerPoliza(texto: string): { requiere: boolean; tipo: string; confianza: number } {
  const tipos: string[] = []
  const plano = texto.toLowerCase()
  const mencionaGarantia = /p[oó]liza|garant[ií]a/.test(plano)
  if (mencionaGarantia && /cumplimiento/.test(plano)) tipos.push("cumplimiento")
  if (/responsabilidad\s+civil/.test(plano)) tipos.push("responsabilidad_civil")
  if (/salarios/.test(plano) && /prestaciones/.test(plano)) tipos.push("salarios_prestaciones")
  if (/p[oó]liza de calidad|garant[ií]a de calidad/.test(plano)) tipos.push("calidad")
  if (tipos.length === 0) return { requiere: false, tipo: "", confianza: 0.92 }
  return { requiere: true, tipo: tipos.join(";"), confianza: 0.94 }
}

function resolverComercial(meta: MetaCorreo): { nombre: string; confianza: number; advertencias: string[] } {
  const email = meta.de.trim().toLowerCase()
  const conocido = meta.comerciales.find((item) => item.email.toLowerCase() === email)
  if (conocido) return { nombre: conocido.nombre, confianza: 0.98, advertencias: [] }
  const firma = /([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){1,2})\s*,\s*practicante/i.exec(meta.cuerpo)
  const nombre = firma?.[1] ?? email
  return {
    nombre,
    confianza: firma ? 0.9 : 0.84,
    advertencias: [`Remitente no registrado en comerciales.json: ${email}.`],
  }
}

function textoClausula(texto: string, titulo: string): string {
  const regex = new RegExp(
    `(?:^|\\n)\\s*(?:[A-ZÁÉÍÓÚÑ]+\\.\\s*)?${titulo}\\b\\.?\\s*([\\s\\S]*?)(?=\\n\\s*[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ .]{2,}\\.|$)`,
    "i",
  )
  return unaLinea(regex.exec(texto)?.[1] ?? "")
}
