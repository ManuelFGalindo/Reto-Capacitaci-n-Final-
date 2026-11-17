# Solución — registro de contratos vigentes

## 1. Problema

El maestro de contratos quedó congelado el 30 de mayo de 2026 y solo entran los que piden póliza, porque cada comercial los manda a una persona distinta. Le duele a la analista administrativa, que no puede decir qué está vigente, y a la gerencia, que no ve vencimientos ni pólizas por constituir.

## 2. Arquitectura

El chat (`web/`) habla con `POST /api/chat`. El servidor corre el ciclo del agente: arma el prompt, pide una respuesta al adaptador y ejecuta herramientas hasta que el adaptador contesta en texto o se llega al tope. Las herramientas leen `fixtures/reto-02/` y escriben solo en `out/`.

```
web/  →  src/server.ts  →  src/agent/loop.ts  →  adaptador LLM
                                    │
                                    └─ src/tools/contratos.ts
                                          ├─ fixtures/   (solo lectura)
                                          └─ out/        (maestro, archivo, historial, alertas, log)
```

| Capa | Dónde vive | Qué se cambia ahí |
|---|---|---|
| Comportamiento | `agent/prompt.md` | Cómo habla y cuándo pide confirmación |
| Conocimiento | `src/knowledge/registro-contratos.md` | Reglas del proceso y del maestro |
| Ejecución | `src/tools/contratos.ts` y `src/domain/` | Extracción, clasificación y escritura |

El ciclo concatena el prompt y el conocimiento al armar el mensaje de sistema. Un cambio de regla no toca el servidor. `modulo/` reexporta las mismas herramientas y, con `npm run modulo`, copia el mismo prompt y el mismo conocimiento.

## 3. Ciclo del agente

Cada turno guarda la sesión en memoria y en `out/sessions/`. El bucle pide al adaptador el siguiente paso. Si devuelve herramientas, el servidor las valida con zod, las ejecuta y mete el JSON en el historial. Si devuelve texto, el turno termina.

El tope es `MAX_TOOL_ITERATIONS` (25). Si se alcanza, el agente dice qué falta y la sesión sigue viva. El tope de tokens de sesión y el de salida cortan un uso sin límite de la clave. Un error del proveedor se muestra en el chat y no borra la sesión.

La confirmación es un turno distinto. Si hay campos bajo 0.8, el agente no llama a `contratos_registrar` y cierra con una pregunta. El front marca ese estado. Solo el mensaje siguiente, si confirma, llama a `contratos_registrar` con `confirmado: true`. Un «no» deja el maestro quieto.

Toda llamada queda en el historial visible y en `out/log.jsonl` con hora, herramienta, mensaje, éxito y un resumen corto.

## 4. Modelo

Por defecto el adaptador es local: un planificador que recorre el buzón en el orden del PRD y llama las mismas herramientas. Sirve para la demo y para probar sin clave. El costo por caso es cero.

Si `LLM_PROVIDER=openai` y existe `OPENAI_API_KEY`, el mismo ciclo usa `gpt-4o-mini` (temperatura 0). Lo elegí porque respeta tool calls y el lote cabe en pocas decenas de miles de tokens. Un caso de seis mensajes, con ida y vuelta de herramientas, queda del orden de 1 a 2 centavos de dólar. Cambiar de proveedor no toca el bucle: solo el adaptador implementa `enviar(mensajes, herramientas)`.

La clave no se imprime. `/api/health` devuelve el nombre del proveedor y del modelo, nunca el secreto.

## 5. Extracción

`contratos_extraer` no le pide cifras al modelo. Lee el texto del adjunto y aplica reglas fijas:

- La contraparte es la primera parte (`EL CONTRATANTE`), nunca Periferia. El NIT o RUC se guarda sin puntos ni dígito de verificación. El país sale del tipo y de la longitud del identificador.
- El objeto, el valor y el plazo se toman de la cláusula con ese título. El valor `COP $265.000.000` y el valor `USD 120,000.00` se normalizan a número.
- «No tiene un valor determinado» propone `0` con confianza 0.55. No se registra solo.
- Un rango «desde … hasta …» da fechas con confianza alta. Un plazo en meses con el día de firma solo dicho como «mes de agosto», corroborado por la fecha del correo, deja la fecha fin en 0.58 para que la analista la confirme. En el fixture eso propone `2027-08-31`.
- La póliza se detecta por «póliza» o «garantía» más el tipo (cumplimiento, responsabilidad civil, calidad, salarios y prestaciones). Si no aparece, `requiere_poliza` es falso y el estado nuevo es `no_aplica`. Si aparece, el alta queda en `pendiente`.
- Un campo que no está en el texto va en `null` con confianza 0. No se inventa.
- Texto vacío, fecha imposible (31 de febrero) o moneda fuera de `COP|USD|PEN|PAB|HNL` (EUR, GBP, MXN, BRL, CLP, ARS) devuelven `{ ok: false, error }` y el lote sigue.

`contratos_validar` y `contratos_registrar` vuelven a leer el archivo. En un alta o una actualización, un campo con confianza menor a 0.8 entra a `requiere_revision`. En un otrosí, lo que el documento no trae se hereda del maestro y no pide revisión. Al confirmar, el registro acepta el valor que mandó la analista solo en esos campos dudosos. Un campo que el texto trae con confianza alta no se deja pisar por el modelo.

## 6. Regla de gobierno

**Canal único.** Todo contrato, otrosí y acta de terminación se envía a `contratos@periferia-ficticia.com`. La dueña del buzón y del maestro es la analista administrativa. No hay área legal: ella no interpreta cláusulas, solo registra y escala lo que no puede leer.

**Obligación del comercial.** Dentro de los dos días hábiles siguientes a la firma envía el PDF firmado, o el texto íntegro si el PDF no se puede leer. También envía otrosíes y actas de terminación, haya o no póliza. El asunto lleva `Contrato`, `Otrosí` o `Terminación`, el número y el cliente. Ejemplo: `Contrato firmado - CT-2026-015 - Industrias Delta`.

**Acuse.** El agente responde al comercial el mismo día hábil: recibido, número con el que quedó, o el motivo del rechazo (no es un contrato, está duplicado, faltan valor o fechas). El acuse no promete revisión jurídica.

**Excepciones.** Sin firma, sin partes o sin objeto no entra al maestro: se rechaza y se le pide el documento al comercial. Sin valor, o con plazo en meses sin día de firma, queda en revisión de la analista. Si ella no puede resolverlo en dos días hábiles, lo escala a la gerencia de la región del comercial. Un remitente que no está en el directorio se registra con el nombre del correo y se avisa para darlo de alta; no bloquea el contrato.

**Cierre del gap.** En una campaña de diez días hábiles, cada comercial reenvía al buzón único todo lo firmado entre el 1 de junio y el 31 de agosto de 2026, con el mismo formato de asunto. El agente lo clasifica contra el maestro congelado: lo nuevo se inserta, el otrosí actualiza, el reenvío se marca duplicado. La gerencia cierra la campaña cuando el indicador del mes llega a la meta.

**Indicador.** Cada mes: contratos facturados en el periodo que existen en el maestro, dividido por los contratos facturados. La meta de salida es 95 %. Si baja, la analista cruza la facturación contra el buzón y cobra los faltantes a cada comercial.

## 7. Decisiones

1. **Extracción por reglas, no por el modelo.** La alternativa era pedirle al modelo cliente, valor y fechas. La descarté porque el maestro se corrompe si el modelo redondea, y `demo.ts` tiene que correr sin clave. El modelo, cuando se usa, solo decide el orden de las herramientas y redacta con los JSON que ellas devuelven.
2. **Validar y registrar releen el archivo.** La alternativa era fiarse del JSON que reenvía el modelo. La descarté porque un campo de confianza alta no debe poder cambiarse en el camino. La confirmación humana solo pisa los campos que estaban en revisión.
3. **Planificador local además de OpenAI.** La alternativa era exigir una clave para poder probar el chat. La descarté porque el reto debe verse en una máquina limpia. Los dos adaptadores cumplen la misma interfaz y el bucle no los distingue.
4. **La fecha de registro es la fecha del correo.** La alternativa era usar el reloj del servidor. La descarté para que dos ejecuciones de la demo dejen el mismo maestro. Los timestamps del log y del historial sí cambian, como permite el PRD.
5. **El otrosí hereda lo que no repite.** La alternativa era tratar cada campo ausente como confianza 0 y frenar el registro. La descarté porque el otrosí del fixture solo cambia plazo y valor, y el PRD espera que esa fila se actualice sin preguntar.

## 8. Supuestos

- El texto de `contrato.txt` y `otrosi.txt` es el contrato; no hay PDF escaneado en los fixtures. `contratos_leer_pdf` lee texto y rechaza un PDF binario.
- «Firmado en el mes de agosto de 2026», si el correo es del 31 de agosto, propone inicio `2026-08-31` y fin a doce meses, `2027-08-31`, ambos por confirmar en la parte que no está escrita día a día. La fecha fin queda bajo 0.8; la de inicio queda en 0.84 porque el día del correo cae dentro del mes que el contrato sí nombra.
- La póliza condicionada a cada orden de servicio del contrato marco cuenta como exigida. El alta queda `pendiente`, no `no_aplica`.
- Un duplicado o un rechazo no toca el maestro ni el archivo, pero sí `procesados.json`, para que el buzón no los vuelva a ofrecer.
- La dueña del maestro, mientras no haya área legal, es la analista administrativa.
- La ventana «vence en 60 días» es desde `hoy` inclusive hasta `hoy` más 60 días. Lo ya vencido no entra en esa lista.

## 9. Cobertura

| Historia | Estado | Qué falta para producción |
|---|---|---|
| HU-1 Leer el buzón | Hecho | Conectar el buzón real en lugar de la carpeta. |
| HU-2 Extraer | Hecho para estos textos | OCR y más plantillas de contrato. |
| HU-3 Validar | Hecho | Revisión de homónimos de NIT entre países. |
| HU-4 Registrar y archivar | Hecho | SharePoint y PDF original, no el `.txt` del fixture. |
| HU-5 Alertas | Hecho | Envío programado a gerencia, no solo el markdown. |
| HU-6 Errores | Hecho | Cola y reintentos si el disco o el buzón fallan. |
| Regla de gobierno | Hecho en este documento | Adoptarla con los comerciales; la campaña de junio a agosto no se ejecuta aquí. |
| Chat, ciclo, confirmación, demo | Hecho | Enlace público. Hoy se prueba en local. |

## 10. Uso de IA

Construí la solución en Cursor con Grok, a partir del PRD y de los seis mensajes del buzón. Le pedí la estructura del agente, la extracción determinista y el chat. Descarté dos propuestas: que el modelo leyera el contrato y devolviera el valor, y que un campo ausente del otrosí bloqueara el registro. La primera contradice la regla de no afirmar cifras que no salgan de una herramienta. La segunda deja sin actualizar el contrato de Minera Los Andes, que el PRD marca como actualización directa.

## 11. Riesgos en producción

- Un contrato con otra redacción (valor en letras sin la cifra, o un NIT escrito en un anexo) se va a revisión o se rechaza. Mitigación: ampliar las reglas con los rechazos reales y mantener el umbral de 0.8.
- Dos clientes con el mismo NIT mal digitado se duplican. Mitigación: el dedupe ya prefiere el número de contrato y, si no hay número, el NIT más la similitud del objeto. En producción conviene una lista de NIT canónicos.
- El planificador local no entiende pedidos fuera del flujo del buzón. Con OpenAI el prompt lo limita, pero un modelo puede intentar registrar de más. Mitigación: registrar vuelve a leer el archivo y no acepta un campo de alta confianza distinto al texto.
- Sin la regla de gobierno, el agente solo ve lo que llega, igual que hoy. Mitigación: el indicador mensual contra facturación.
- Un PDF escaneado no se lee. Mitigación: OCR delante de `contratos_extraer`, sin cambiar el ciclo.
