export function esRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor)
}

export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function limpiarTexto(texto: string): string {
  return texto.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").trim()
}

export function unaLinea(texto: string): string {
  return texto.replace(/\s+/g, " ").trim()
}

const MENORES = new Set(["de", "del", "y", "e"])
const SUFIJOS: Record<string, string> = {
  "s.a.s.": "S.A.S.",
  "s.a.c.": "S.A.C.",
  "s.a.": "S.A.",
  "r.l.": "R.L.",
}

export function titular(nombre: string): string {
  return nombre
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((parte, indice) => {
      const sufijo = SUFIJOS[parte.toLowerCase()]
      if (sufijo) return sufijo
      const base = parte.toLocaleLowerCase("es-CO")
      if (indice > 0 && MENORES.has(normalizar(parte))) return base
      return base.charAt(0).toLocaleUpperCase("es-CO") + base.slice(1)
    })
    .join(" ")
}

export function slugCliente(cliente: string): string {
  return normalizar(cliente)
    .replace(/\bs a s\b/g, " ")
    .replace(/\bs a c\b/g, " ")
    .replace(/\bs a\b/g, " ")
    .replace(/\bs de r l\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
}

export function similitud(a: string, b: string): number {
  const izquierda = tokens(a)
  const derecha = tokens(b)
  if (izquierda.size === 0 || derecha.size === 0) return 0
  let comunes = 0
  for (const token of izquierda) {
    if (derecha.has(token)) comunes += 1
  }
  const union = izquierda.size + derecha.size - comunes
  return union === 0 ? 0 : comunes / union
}

export function limpiarNit(crudo: string): string {
  const [base] = crudo.replaceAll(".", "").trim().split("-")
  return (base ?? "").replace(/\D/g, "")
}

export function recortar(texto: string, maximo: number): { texto: string; recortado: boolean } {
  const limpio = unaLinea(texto)
  if (limpio.length <= maximo) return { texto: limpio, recortado: false }
  const corte = limpio.slice(0, maximo)
  const espacio = corte.lastIndexOf(" ")
  const textoCorte = (espacio > 80 ? corte.slice(0, espacio) : corte).trim()
  return { texto: textoCorte, recortado: true }
}

function tokens(texto: string): Set<string> {
  return new Set(normalizar(texto).split(" ").filter((token) => token.length > 2))
}
