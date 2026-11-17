const historial = document.querySelector("#historial")
const formulario = document.querySelector("#formulario")
const mensaje = document.querySelector("#mensaje")
const aviso = document.querySelector("#aviso")
const estado = document.querySelector("#estado-modelo")
const botonEnviar = formulario.querySelector("button")
const CLAVE = "registro-contratos-sesion"
const PROMPT =
  "Procesa el buzón de contratos con fecha de hoy 2026-09-03. Registra lo que esté limpio, muéstrame lo que requiere revisión campo por campo y termina con el reporte de alertas. No registres nada dudoso sin preguntarme."
const CONFIRMACION = "Confirmo el valor 0 y la fecha fin 2027-08-31."

let sessionId = sessionStorage.getItem(CLAVE) || ""
let ocupado = false

formulario.addEventListener("submit", (evento) => {
  evento.preventDefault()
  enviar(mensaje.value)
})

mensaje.addEventListener("keydown", (evento) => {
  if (evento.key === "Enter" && !evento.shiftKey) {
    evento.preventDefault()
    formulario.requestSubmit()
  }
})

document.querySelector("#nueva").addEventListener("click", () => {
  sessionId = ""
  sessionStorage.removeItem(CLAVE)
  historial.replaceChildren()
  aviso.hidden = true
  mensaje.focus()
})

document.querySelector("#procesar").addEventListener("click", () => enviar(PROMPT))
document.querySelector("#confirmar").addEventListener("click", () => enviar(CONFIRMACION))

iniciar()

async function iniciar() {
  try {
    const salud = await fetch("/api/health")
    const datos = await salud.json()
    estado.textContent =
      datos.provider === "local"
        ? "Modelo: planificador local. Las cifras salen de las herramientas, no de un proveedor externo."
        : `Modelo: ${datos.model} (${datos.provider}).`
  } catch {
    estado.textContent = "No pude consultar el estado del servidor."
  }
  if (!sessionId) return
  const respuesta = await fetch(`/api/sessions/${sessionId}`)
  if (!respuesta.ok) {
    sessionId = ""
    sessionStorage.removeItem(CLAVE)
    return
  }
  const sesion = await respuesta.json()
  for (const turno of sesion.turns ?? []) pintarTurno(turno)
  aviso.hidden = !ultimoPideConfirmacion()
}

async function enviar(texto) {
  const limpio = texto.trim()
  if (!limpio || ocupado) return
  ocupado = true
  botonEnviar.disabled = true
  mensaje.value = ""
  pintarTurno({ role: "user", content: limpio })
  const pensando = document.createElement("div")
  pensando.className = "pensando"
  pensando.textContent = "Pensando…"
  historial.append(pensando)
  historial.scrollTop = historial.scrollHeight
  try {
    const respuesta = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: limpio, sessionId: sessionId || undefined }),
    })
    const datos = await respuesta.json()
    pensando.remove()
    if (!respuesta.ok) {
      pintarError(datos.error || "No pude completar la consulta.")
      return
    }
    sessionId = datos.sessionId
    sessionStorage.setItem(CLAVE, sessionId)
    pintarTurno({
      role: "assistant",
      content: datos.reply,
      toolCalls: datos.toolCalls,
      needsConfirmation: datos.needsConfirmation,
    })
    aviso.hidden = !datos.needsConfirmation
  } catch {
    pensando.remove()
    pintarError("No hay conexión con el servidor. La sesión sigue abierta si recargas.")
  } finally {
    ocupado = false
    botonEnviar.disabled = false
    mensaje.focus()
  }
}

function pintarTurno(turno) {
  if (turno.role === "assistant" && Array.isArray(turno.toolCalls)) {
    for (const llamada of turno.toolCalls) historial.append(pintarTraza(llamada))
  }
  const burbuja = document.createElement("article")
  burbuja.className = turno.role === "user" ? "user" : "assistant"
  if (turno.needsConfirmation) burbuja.classList.add("pide")
  burbuja.textContent = turno.content
  historial.append(burbuja)
  historial.scrollTop = historial.scrollHeight
}

function pintarTraza(llamada) {
  const caja = document.createElement("div")
  caja.className = llamada.ok ? "traza" : "traza fallo"
  const titulo = document.createElement("strong")
  titulo.textContent = llamada.name
  const detalle = document.createElement("div")
  const args = JSON.stringify(llamada.arguments ?? {})
  const corto = args.length > 280 ? `${args.slice(0, 280)}…` : args
  detalle.textContent = `${corto}\n${llamada.resumen || ""}`
  caja.append(titulo, detalle)
  return caja
}

function pintarError(texto) {
  const caja = document.createElement("div")
  caja.className = "error"
  caja.textContent = texto
  historial.append(caja)
}

function ultimoPideConfirmacion() {
  const burbujas = historial.querySelectorAll("article.assistant")
  return burbujas.length > 0 && burbujas[burbujas.length - 1].classList.contains("pide")
}
