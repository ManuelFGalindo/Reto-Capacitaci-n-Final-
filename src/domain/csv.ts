export function parsearCsv(texto: string): { encabezados: string[]; filas: string[][] } {
  const filas: string[][] = []
  let actual: string[] = []
  let campo = ""
  let entreComillas = false
  const fuente = texto.replace(/^\uFEFF/, "")
  for (let i = 0; i < fuente.length; i += 1) {
    const letra = fuente[i] ?? ""
    if (entreComillas) {
      if (letra === '"') {
        if (fuente[i + 1] === '"') {
          campo += '"'
          i += 1
        } else {
          entreComillas = false
        }
      } else {
        campo += letra
      }
      continue
    }
    if (letra === '"') {
      entreComillas = true
      continue
    }
    if (letra === ",") {
      actual.push(campo)
      campo = ""
      continue
    }
    if (letra === "\n" || letra === "\r") {
      if (letra === "\r" && fuente[i + 1] === "\n") i += 1
      actual.push(campo)
      campo = ""
      if (actual.some((valor) => valor.trim() !== "")) filas.push(actual)
      actual = []
      continue
    }
    campo += letra
  }
  if (campo.length > 0 || actual.length > 0) {
    actual.push(campo)
    if (actual.some((valor) => valor.trim() !== "")) filas.push(actual)
  }
  const encabezados = filas.shift() ?? []
  return { encabezados, filas }
}

export function escribirCsv(encabezados: string[], filas: string[][]): string {
  const lineas = [encabezados, ...filas].map((fila) => fila.map(escapar).join(","))
  return `${lineas.join("\n")}\n`
}

function escapar(valor: string): string {
  if (/[",\n\r]/.test(valor)) return `"${valor.replaceAll('"', '""')}"`
  return valor
}
