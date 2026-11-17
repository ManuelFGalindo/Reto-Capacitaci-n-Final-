import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const prompt = fs.readFileSync(path.join(raiz, "agent", "prompt.md"), "utf8").trim()
const conocimiento = fs.readFileSync(path.join(raiz, "src", "knowledge", "registro-contratos.md"), "utf8").trim()

const agent = `---
description: Registra contratos vigentes desde el buzón único, sin duplicar el maestro y pidiendo confirmación cuando la confianza es baja.
mode: primary
permission:
  edit: deny
  bash: deny
---

${prompt}
`

const skill = `---
name: registro-contratos
description: Conocimiento del proceso de registro de contratos vigentes, el maestro y las reglas de duplicado, actualización y revisión.
---

${conocimiento}
`

fs.mkdirSync(path.join(raiz, "modulo", "skill", "registro-contratos"), { recursive: true })
fs.writeFileSync(path.join(raiz, "modulo", "agent.md"), agent, "utf8")
fs.writeFileSync(path.join(raiz, "modulo", "skill", "registro-contratos", "SKILL.md"), skill, "utf8")
console.log("Módulo sincronizado con el prompt y el conocimiento de la aplicación.")
