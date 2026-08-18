-- FR-48 — Servicios de ingeniería y evaluación técnica.
--
-- Some needs are not goods, they are assessments: is this bridge safe, does this water system
-- work, is this building habitable. This extends PRD-29's `evaluaciones` (0044) rather than
-- standing up a parallel system: the same row now also models a technical/engineering evaluation
-- *ticket* — a request for a técnico to assess one piece of infrastructure, assigned to a
-- technical contact, tracked solicitada → en curso → completada, closed with a finding.
--
-- What changes on `evaluaciones`:
--   * `fecha_visita`, `evaluador_nombre`, `total_estimado` become nullable. A census sweep (0044)
--     still fills all three; a FR-48 ticket fills none of them until (if ever) it is visited.
--   * `total_estimado is null` is the discriminator between a sweep row and a ticket row — the
--     application queries (lib/evaluaciones.ts) use it to keep Level 4 coverage a claim about
--     surveyed items, never about open engineering requests.
--   * New columns: `estado` (the ticket lifecycle, defaulting `solicitada` on every row —
--     existing sweeps get the default too, but the panel never reads or advances it for them),
--     `asignado_a` (the técnico, light identity by name — the same posture as `evaluador_nombre`),
--     `detalle` (the finding/detail note, recorded as a ticket reaches `completada`).
--   * The domain vocabulary gains `puente` and `electrico` — infrastructure types FR-48 names
--     that the original census domains did not (§21's schema comment: "a new domain is a one-line
--     ALTER", which this is).
--
-- No RLS change: the existing policies on `evaluaciones` (0044) already scope every read/write to
-- the caller's organisation and role for the whole row, new columns included — ADD COLUMN does not
-- touch policy definitions, and no new table is created here.
--
-- Depends on: db/migrations/0044_evaluaciones_y_recuperacion.sql.

-- ── evaluaciones — nullable sweep-only columns + the FR-48 ticket columns ───────────────────────

alter table evaluaciones
  alter column evaluador_nombre drop not null,
  alter column fecha_visita drop not null,
  alter column total_estimado drop not null;

alter table evaluaciones
  add column estado     text not null default 'solicitada',
  add column asignado_a text,
  add column detalle    text;

alter table evaluaciones
  drop constraint evaluaciones_total_check,
  add constraint evaluaciones_total_check check (total_estimado is null or total_estimado > 0);

alter table evaluaciones
  add constraint evaluaciones_estado_check
    check (estado in ('solicitada', 'en_curso', 'completada'));

create index evaluaciones_estado_idx on evaluaciones (estado);

comment on column evaluaciones.total_estimado is
  'In-scope items the surveyor estimates at this place, for a census sweep. NULL marks a FR-48 technical-evaluation ticket instead — the discriminator lib/evaluaciones.ts queries on to keep Level 4 coverage a claim about surveyed items only. Coverage = assessed (findings against this sweep) / total_estimado, dated by fecha_visita.';
comment on column evaluaciones.estado is
  'FR-48: the technical-evaluation ticket lifecycle — solicitada -> en_curso -> completada, forward-only. Every row defaults to solicitada, including census sweeps; the panel reads/advances it only for tickets (total_estimado is null).';
comment on column evaluaciones.asignado_a is
  'FR-48: the técnico/technical contact a ticket is assigned to, by name — light identity, the same posture as evaluador_nombre.';
comment on column evaluaciones.detalle is
  'FR-48: the finding/detail note for a technical-evaluation ticket, recorded as it reaches estado = completada.';

-- ── Domain vocabulary — add puente, electrico (§21's "a new domain is a one-line ALTER") ────────

alter table plantillas_evaluacion
  drop constraint plantillas_evaluacion_dominio_check,
  add constraint plantillas_evaluacion_dominio_check
    check (dominio in
      ('vivienda', 'educacion', 'salud', 'agua', 'ambiente', 'organizacional', 'puente', 'electrico'));

alter table evaluaciones
  drop constraint evaluaciones_dominio_check,
  add constraint evaluaciones_dominio_check
    check (dominio in
      ('vivienda', 'educacion', 'salud', 'agua', 'ambiente', 'organizacional', 'puente', 'electrico'));

alter table evaluacion_hallazgos
  drop constraint evaluacion_hallazgos_dominio_check,
  add constraint evaluacion_hallazgos_dominio_check
    check (dominio in
      ('vivienda', 'educacion', 'salud', 'agua', 'ambiente', 'organizacional', 'puente', 'electrico'));
