#!/usr/bin/env bash
#
# Backup and restore drill.
#
# PRD §6: «Supabase takes backups; nobody has tried restoring one.» An untested backup is a
# belief, not a backup — and the moment you find out is the moment you cannot afford to.
#
# This proves the round trip against the local database: dump it, restore it into a scratch
# database, compare the row counts of every table, then throw the scratch away. It does NOT
# touch the hosted project, and it refuses to run against anything that is not obviously
# local, the same way scripts/reset.ts does.
#
# Usage:  bash scripts/drill-respaldo.sh
#         bash scripts/drill-respaldo.sh --conservar   # keep the dump file afterwards
#
set -euo pipefail

CONTENEDOR="${CONVITE_DB_CONTENEDOR:-convite-db}"
BASE="${CONVITE_DB:-convite}"
USUARIO="${CONVITE_DB_USUARIO:-convite}"
SCRATCH="${BASE}_drill"
CONSERVAR="${1:-}"

DESTINO="${DATA_DIR:-$PWD/.data}/respaldos"
SELLO="$(date +%Y%m%d-%H%M%S)"
ARCHIVO="$DESTINO/${BASE}-${SELLO}.dump"

# ── Refuse to run anywhere real ─────────────────────────────────────────────────────────
# The drill drops and recreates a database. That is safe against docker on localhost and
# catastrophic anywhere else, so the check is on by default and cannot be skipped by a flag.
if [ -n "${DATABASE_URL:-}" ]; then
  case "$DATABASE_URL" in
    *localhost*|*127.0.0.1*) ;;
    *)
      echo "Este drill solo corre contra la base local. DATABASE_URL apunta a otra parte." >&2
      exit 1
      ;;
  esac
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
  echo "No encuentro el contenedor '$CONTENEDOR'. ¿Corrió 'pnpm db:up'?" >&2
  exit 1
fi

mkdir -p "$DESTINO"

echo "── Respaldo ──────────────────────────────────────────────"
docker exec "$CONTENEDOR" pg_dump -U "$USUARIO" -d "$BASE" -Fc > "$ARCHIVO"
echo "  $(du -h "$ARCHIVO" | cut -f1)  $ARCHIVO"

echo "── Restauración a una base de trabajo ────────────────────"
docker exec "$CONTENEDOR" psql -U "$USUARIO" -d postgres -q \
  -c "drop database if exists ${SCRATCH} with (force)" \
  -c "create database ${SCRATCH}"

# --no-owner because we restore as `convite` rather than the original owner, which is what a
# real recovery into a fresh project looks like.
#
# NOT --no-privileges, and that flag's absence is load-bearing. It was there first, and the
# drill caught what it did: every row came back and every GRANT did not, so `anon` ended up
# with no access to `mapa_publico` at all. A restore like that looks perfect from a row count
# and leaves the public boundary unconfigured — which is either a dead public page or, worse,
# somebody "fixing" it with a grant far broader than 2.4 allows.
#
# pg_restore reports benign noise for extensions it cannot recreate as a non-superuser;
# --exit-on-error would fail the drill for something that does not affect our data.
docker exec -i "$CONTENEDOR" pg_restore -U "$USUARIO" -d "$SCRATCH" --no-owner \
  < "$ARCHIVO" 2> >(grep -vE 'must be owner of extension|must be owner of schema' >&2 || true)

echo "── Comparación fila por fila ─────────────────────────────"
# The check that matters: every table has the same number of rows on both sides. A restore
# that "succeeded" while silently dropping a table is the failure this drill exists to catch.
CONSULTA="
select string_agg(format('%s=%s', tablename, (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename),
                      false, true, '')))[1]::text), E'\n' order by tablename)
  from pg_tables where schemaname = 'public';
"

ORIGEN_CONTEO="$(docker exec "$CONTENEDOR" psql -U "$USUARIO" -d "$BASE" -At -c "$CONSULTA")"
COPIA_CONTEO="$(docker exec "$CONTENEDOR" psql -U "$USUARIO" -d "$SCRATCH" -At -c "$CONSULTA")"

if [ "$ORIGEN_CONTEO" = "$COPIA_CONTEO" ]; then
  TABLAS="$(printf '%s\n' "$ORIGEN_CONTEO" | grep -c '=' || true)"
  FILAS="$(printf '%s\n' "$ORIGEN_CONTEO" | awk -F= '{s+=$2} END {print s+0}')"
  echo "  ✓ $TABLAS tablas, $FILAS filas, idénticas en el original y en la copia"
  RESULTADO=0
else
  echo "  ✗ Los conteos NO coinciden:" >&2
  diff <(printf '%s\n' "$ORIGEN_CONTEO") <(printf '%s\n' "$COPIA_CONTEO") >&2 || true
  RESULTADO=1
fi

# ── La prueba que un conteo no da ───────────────────────────────────────────────────────
# Las filas pueden estar todas y la base seguir inservible: lo que hace cumplir las
# no-negociables son las constraints, las políticas RLS y las funciones `security definer`,
# y un `pg_restore` puede traerse los datos sin traerse eso. Correr las pruebas de base
# contra la copia es lo único que lo demuestra — son exactamente las mismas aserciones que
# protegen la base real.
if [ "$RESULTADO" -eq 0 ]; then
  echo "── Aserciones de la suite contra la copia ────────────────"
  URL_COPIA="postgresql://${USUARIO}:${USUARIO}@localhost:5433/${SCRATCH}"
  if DATABASE_URL="$URL_COPIA" pnpm vitest run tests/esquema.db.test.ts tests/rls.db.test.ts \
       --reporter=dot > /tmp/drill-suite.log 2>&1; then
    echo "  ✓ esquema y RLS pasan contra la restauración"
  else
    echo "  ✗ la copia tiene los datos pero NO hace cumplir las reglas:" >&2
    tail -25 /tmp/drill-suite.log >&2
    RESULTADO=1
  fi
fi

echo "── Limpieza ──────────────────────────────────────────────"
docker exec "$CONTENEDOR" psql -U "$USUARIO" -d postgres -q \
  -c "drop database if exists ${SCRATCH} with (force)"

if [ "$CONSERVAR" != "--conservar" ]; then
  rm -f "$ARCHIVO"
  echo "  respaldo borrado (use --conservar para quedarse con él)"
else
  echo "  respaldo conservado en $ARCHIVO"
fi

if [ "$RESULTADO" -eq 0 ]; then
  echo
  echo "Drill OK: el respaldo se restaura, los datos cuadran y las reglas se hacen cumplir."
else
  echo
  echo "Drill FALLIDO: el respaldo no reproduce la base." >&2
fi
exit "$RESULTADO"
