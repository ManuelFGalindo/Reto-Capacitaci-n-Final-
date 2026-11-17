import type { Configuracion } from "../config.ts"
import type { AdaptadorLlm } from "./adapter.ts"
import { planificar } from "./local.ts"
import { crearAdaptadorOpenAI } from "./openai.ts"

export function crearAdaptador(config: Configuracion): AdaptadorLlm {
  if (config.proveedor === "openai") return crearAdaptadorOpenAI(config.modelo)
  return crearAdaptadorLocal()
}

export function crearAdaptadorLocal(): AdaptadorLlm {
  return {
    id: "local",
    model: "planificador-local",
    async enviar(mensajes) {
      return planificar(mensajes)
    },
  }
}
