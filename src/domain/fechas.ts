const MESES: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
}

const DIAS: Record<string, number> = {
  primero: 1,
  primer: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiuno: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
  treinta: 30,
}

const RE_FECHA =
  /(?:el\s+)?([A-Za-zÁÉÍÓÚáéíóúñÑ]+(?:\s+y\s+[A-Za-zÁÉÍÓÚáéíóúñÑ]+)?)(?:\s*\((\d{1,2})\))?\s+de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+de\s+(\d{4})/gi

export function fechaIso(valor: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim())
  if (!match) return null
  return isoDe(Number(match[3]), Number(match[2]), Number(match[1]))
}

export function sumarDias(iso: string, dias: number): string {
  const partes = iso.split("-").map(Number)
  const fecha = new Date(Date.UTC(partes[0] ?? 1970, (partes[1] ?? 1) - 1, partes[2] ?? 1))
  fecha.setUTCDate(fecha.getUTCDate() + dias)
  return fecha.toISOString().slice(0, 10)
}

export function sumarMeses(iso: string, meses: number): string {
  const partes = iso.split("-").map(Number)
  const anio = partes[0] ?? 1970
  const mes = partes[1] ?? 1
  const dia = partes[2] ?? 1
  const fecha = new Date(Date.UTC(anio, mes - 1 + meses, dia))
  return fecha.toISOString().slice(0, 10)
}

export function diasEntre(desde: string, hasta: string): number {
  const a = Date.parse(`${desde}T00:00:00Z`)
  const b = Date.parse(`${hasta}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

export function listarFechas(fragmento: string): { iso: string }[] | { error: string } {
  const encontradas: { iso: string }[] = []
  for (const match of fragmento.matchAll(RE_FECHA)) {
    const palabra = quitarTilde((match[1] ?? "").toLowerCase())
    const parentesis = match[2] ? Number(match[2]) : null
    const mes = MESES[quitarTilde((match[3] ?? "").toLowerCase())]
    const anio = Number(match[4])
    if (!mes) continue
    const porPalabra = diaPorPalabra(palabra)
    const dia = parentesis ?? porPalabra
    if (!dia) continue
    const iso = isoDe(dia, mes, anio)
    if (!iso) {
      return { error: `Fecha inválida: ${dia} de ${match[3]} de ${anio}.` }
    }
    encontradas.push({ iso })
  }
  return encontradas
}

export function mesNombrado(fragmento: string): { mes: number; anio: number } | null {
  const match = /mes de\s+([A-Za-zÁÉÍÓÚáéíóúñÑ]+)\s+de\s+(\d{4})/i.exec(fragmento)
  if (!match) return null
  const mes = MESES[quitarTilde(match[1]?.toLowerCase() ?? "")]
  if (!mes) return null
  return { mes, anio: Number(match[2]) }
}

export function mesesDePlazo(fragmento: string): number | null {
  const match = /\((\d{1,2})\)\s*meses/i.exec(fragmento) ?? /\b(\d{1,2})\s+meses\b/i.exec(fragmento)
  if (!match) return null
  const meses = Number(match[1])
  if (meses < 1 || meses > 120) return null
  return meses
}

function isoDe(dia: number, mes: number, anio: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || anio < 1990 || anio > 2100) return null
  const fecha = new Date(Date.UTC(anio, mes - 1, dia))
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null
  const mesTexto = String(mes).padStart(2, "0")
  const diaTexto = String(dia).padStart(2, "0")
  return `${anio}-${mesTexto}-${diaTexto}`
}

function diaPorPalabra(palabra: string): number | null {
  if (DIAS[palabra]) return DIAS[palabra]
  const treinta = /^treinta y ([a-z]+)$/.exec(palabra)
  if (!treinta) return null
  const unidad = DIAS[treinta[1] ?? ""]
  if (!unidad || unidad > 9) return null
  return 30 + unidad
}

function quitarTilde(texto: string): string {
  return texto.normalize("NFD").replace(/\p{M}/gu, "")
}
