# Respaldo y restauración

> **Estado (2026-08-14):** el drill local está **probado y pasa**. La restauración del
> proyecto alojado en Supabase **sigue sin probarse** — es la brecha que el PRD §6 señala:
> «Supabase takes backups; nobody has tried restoring one.»

Un respaldo que nadie ha restaurado es una creencia, no un respaldo. Y el momento en que uno
se entera es exactamente el momento en que no se lo puede permitir.

---

## El drill local

```bash
pnpm db:up                      # si la base no está arriba
bash scripts/drill-respaldo.sh  # ~5 segundos
```

Qué hace, en orden:

1. `pg_dump -Fc` de la base local a `$DATA_DIR/respaldos/` (fuera del repo).
2. Crea una base de trabajo `convite_drill` y restaura el volcado ahí.
3. **Compara el conteo de filas de cada tabla** entre el original y la copia.
4. **Corre `esquema.db.test.ts` y `rls.db.test.ts` contra la copia.**
5. Borra la base de trabajo y, salvo `--conservar`, el archivo.

**Última corrida:** 2026-08-14 — 32 tablas, 8 681 filas idénticas, esquema y RLS verdes.

### Qué quiere decir «restauración verificada»

Las dos cosas, no una:

- **Los datos están**: el conteo por tabla cuadra. Un `pg_restore` que "terminó bien" habiendo
  perdido una tabla sale con código 0 y se ve igual que uno correcto.
- **Las reglas se hacen cumplir**: las constraints, las políticas RLS, los `grants` y las
  funciones `security definer` volvieron. Esto es lo que un conteo no puede ver, y es lo que
  hace cumplir las no-negociables — una base con todas las filas y sin RLS no es una copia de
  este sistema, es una filtración con los mismos datos.

### El error que este drill ya atrapó

La primera versión restauraba con `--no-privileges`. Todas las filas volvieron, el conteo
cuadró, y **trece aserciones fallaron**: `anon` quedó sin ningún permiso, ni siquiera el
`SELECT` sobre `mapa_publico`. Una restauración así se ve impecable en un conteo y deja el
borde público sin configurar — o la página pública muerta, o peor, alguien "arreglándola" con
un grant mucho más ancho de lo que 2.4 permite.

Se restaura con `--no-owner` (uno restaura como otro usuario, que es lo que pasa de verdad en
una recuperación) pero **nunca** con `--no-privileges`. Vale para el proyecto alojado igual
que para el local.

El script se niega a correr si `DATABASE_URL` no apunta a `localhost` o `127.0.0.1`. El drill
crea y borra bases de datos: eso es inofensivo contra docker y catastrófico en cualquier otro
lado, así que la verificación no se puede saltar con una bandera.

---

## Lo que falta: el proyecto alojado

Supabase toma respaldos automáticos del proyecto `convite` (`kjwkvulmsjffzhuchwpy`). Nadie ha
restaurado uno nunca. Hasta que alguien lo haga, no sabemos:

- si el respaldo incluye PostGIS y las geometrías salen intactas;
- si las políticas RLS, las funciones `security definer` y los `grants` sobreviven;
- cuánto tarda una restauración completa — el número que decide si una caída se mide en
  minutos o en un día de trabajo perdido;
- quién tiene permiso para dispararla a las tres de la mañana.

### Cómo probarlo, cuando haya con qué

No se restaura sobre producción. Se restaura **a un proyecto nuevo** y se compara:

1. Descargar un respaldo desde el panel de Supabase (Database → Backups).
2. Crear un proyecto Supabase vacío, o levantar una base local con PostGIS.
3. Restaurar ahí el volcado.
4. Correr la misma comparación de conteos que hace el drill.
5. **Correr la suite contra la copia**: `DATABASE_URL=<copia> pnpm test`. Es la verificación
   real — prueba las constraints, las políticas RLS y las funciones, no solo que las filas
   estén. Los tests con `.db.` son exactamente esa comprobación, y es el mismo paso 4 que el
   drill local ya automatiza.
6. Anotar aquí la fecha, el tamaño y cuánto tardó.

Mientras eso no se haya hecho, el plan de recuperación de este sistema es una suposición.

---

## Qué se pierde y qué no

Cuánto se puede perder depende del intervalo de respaldo del plan de Supabase, que hoy nadie
ha confirmado por escrito. Vale la pena mirarlo antes del piloto, porque las tablas que más
duelen son las que no se pueden reconstruir preguntando otra vez:

- `reportes`, `mensajes`, `llamadas`, `adjuntos` — lo que la gente nos dijo. Irrecuperable.
  Nadie va a volver a contar que se le inundó la casa porque nosotros perdimos la fila.
- `decisiones_asignacion` — quién decidió que alguien esperara (2.9). Irrecuperable, y es
  precisamente el registro que existe para poder responder por esa decisión.
- `auditoria` — quién cambió qué. Irrecuperable por diseño: no tiene UPDATE ni DELETE.
- `catalogo_items`, `comunidades`, `rutas` — reconstruibles desde `db/seed/`, pero perdiendo
  todo lo que un coordinador haya editado desde entonces.

Los archivos de media **no están en la base**. Viven bajo `DATA_DIR` en local y tendrán que
vivir en almacenamiento de objetos en producción (D5); ese respaldo es aparte y todavía no
existe. Una base restaurada sin ellos deja `adjuntos` apuntando a claves que no resuelven —
las notas de voz de la bandeja se quedan mudas.

---

## Retención (D9, sin resolver)

Nada expira hoy. Para datos de hogares en zona de conflicto, **borrar es una medida de
protección**, no una tarea de mantenimiento: una base que guarda para siempre el teléfono y la
ubicación aproximada de quien pidió ayuda es un riesgo que crece solo. La política la decide
el equipo con un abogado (Ley 1581 de 2012), no un ingeniero, y hasta que exista, cada
respaldo que se guarda extiende el problema en el tiempo.
