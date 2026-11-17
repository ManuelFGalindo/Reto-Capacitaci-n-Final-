# Registro de contratos vigentes

El maestro vivía en un Excel de SharePoint y quedó congelado el 2026-05-30. Los comerciales solo reenvían un contrato cuando pide póliza, así que el resto no entra. Este agente es el buzón único: `contratos@periferia-ficticia.com`, administrado por la analista administrativa. Ella es la dueña del maestro mientras no exista área legal.

## Qué hace cada herramienta

- `contratos_leer_buzon` lista lo que aún no está en `out/procesados.json`.
- `contratos_extraer` lee `contrato.txt` u `otrosi.txt` y devuelve cada campo con `confianza` entre 0 y 1. Un campo que no está en el texto va en `null` con confianza 0.
- `contratos_validar` clasifica y dice qué campos hay que confirmar.
- `contratos_registrar` escribe el maestro, copia el archivo y anota `historial.jsonl`. Sin `confirmado: true` rechaza cualquier campo con confianza menor a 0.85.
- `contratos_alertas` escribe `out/alertas.md`. La fecha `hoy` la pone la analista para que el reporte no dependa del reloj.

## Reglas de clasificación

- Duplicado: mismo `id_contrato` y mismos `valor`, `fecha_inicio` y `fecha_fin`. No se escribe nada en el maestro.
- Actualización: mismo `id_contrato`, o mismo NIT y objeto con similitud de al menos 0.9, cuando algún campo cambia. Un otrosí actualiza la fila y el historial guarda el antes y el después. Los campos que el otrosí no trae se heredan del maestro y no piden revisión.
- Nuevo: no hay coincidencia. Se inserta una fila. Si exige póliza, `estado_poliza` queda `pendiente`. Si no exige, queda `no_aplica`.
- Rechazado: no hay adjunto de contrato, o el texto no identifica partes ni objeto.

Un remitente que no está en `comerciales.json` se reporta en `advertencias` y no bloquea el registro.

## Campos que se registran

`id_contrato`, `cliente`, `nit_cliente`, `pais` (`CO`, `EC`, `PE`, `PA`, `HN`), `objeto` (máximo 200 caracteres), `valor`, `moneda` (`COP`, `USD`, `PEN`, `PAB`, `HNL`), `fecha_inicio`, `fecha_fin`, `requiere_poliza`, `tipo_poliza`, `estado_poliza`, `comercial`, `ruta_sharepoint`, `fecha_registro`, `fuente`.

Si el documento no trae número, el registro usa `AUTO-<año>-<secuencia>`. Si el valor es por demanda, se propone `0` con confianza baja y no se escribe hasta que la analista lo confirme. La fecha de fin calculada solo con un plazo en meses, sin día de firma en el texto, también queda en revisión.

El archivo del fixture no se modifica. La copia de trabajo vive en `out/sharepoint/maestro-contratos.csv`. El adjunto se guarda en `out/sharepoint/Contratos/<año>/<cliente>/<id>.<ext>`.
