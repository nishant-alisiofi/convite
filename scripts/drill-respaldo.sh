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

# pg_restore reports benign noise for extensions it cannot recreate as a non-superuser;
# --exit-on-error would fail the drill for something that does not affect our data.
docker exec -i "$CONTENEDOR" pg_restore -U "$USUARIO" -d "$SCRATCH" --no-owner --no-privileges \
  < "$ARCHIVO" 2> >(grep -v 'must be owner of extension' >&2 || true)

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
  echo "Drill OK: el respaldo se restaura y los datos cuadran."
else
  echo
  echo "Drill FALLIDO: el respaldo no reproduce la base." >&2
fi
exit "$RESULTADO"
