-- ============================================================================
-- CONVITE — SEED DE TERRITORIO
-- Chocó (ASOREDIPARCHOCÓ) y Pacífico caucano (Fundación Herencia de Timbiquí)
--
-- ⚠️  TODAS LAS COORDENADAS SON APROXIMADAS Y ESTÁN PARA SER CORREGIDAS.
--     Las cabeceras municipales son razonablemente confiables.
--     Los corregimientos y veredas son de memoria y seguramente tienen errores
--     de nombre, de ubicación y de existencia. ESO ES INTENCIONAL: el objetivo
--     es que quien conoce el territorio corrija, no que nosotros acertemos.
--
--     Cada registro sembrado lleva verificado_en = NULL. Nada sembrado cuenta
--     como verificado hasta que alguien del territorio lo confirme.
--
--   DATOS DE REGISTRO, NO DE PRUEBA. Regiones, comunidades, catálogo, nodos,
--   rutas y jornadas históricas son datos de referencia reales del territorio y
--   son apropiados TANTO para staging COMO para producción. NO trae reportes ni
--   pedidos demo: esa actividad fabricada es solo de staging y vive en `db:seed`.
--
--   IDEMPOTENTE / RE-EJECUTABLE. Cada inserción usa UUIDs fijos o `on conflict`
--   sobre su clave natural (regiones.id, organizaciones.id, catalogo_items.codigo,
--   comunidades.codigo, nodos (comunidad_id, nombre), rutas (origen_id, destino_id,
--   modo, temporada), jornadas.codigo, jornada_paradas (jornada_id, orden)), así
--   que volver a correr el seed no duplica el registro. Cárguelo con
--   `pnpm sembrar:territorio` (scripts/sembrar-territorio.ts).
-- ============================================================================

create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- REGIONES
-- ---------------------------------------------------------------------------
insert into regiones (id, nombre, departamento, tipo, activa) values
  ('11111111-0000-0000-0000-000000000001', 'Chocó',             'Chocó', 'mixta', true),
  ('11111111-0000-0000-0000-000000000002', 'Pacífico caucano',  'Cauca', 'rural', true),
  ('11111111-0000-0000-0000-000000000003', 'Valle del Cauca',   'Valle del Cauca', 'mixta', true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- ORGANIZACIONES
-- techo_permisos se define en el acuerdo con cada organización; acá va mínimo.
--
-- estado_aprobacion queda en su default ('pendiente'): una organización del
-- registro no cuenta como aprobada para operar hasta que la plataforma lo diga
-- (§2.4). En producción quien las aprueba es el equipo Alisio desde el panel de
-- plataforma; en staging el `db:seed` demo aprueba a la que opera para poder
-- recorrer el panel. Nada aquí se auto-aprueba.
--
-- Se insertan en dos sentencias con clock_timestamp() a propósito: ASOREDIPARCHOCÓ
-- queda con un creado_en estrictamente anterior al de Herencia, para que el
-- resolvedor «la organización activa más antigua» (scripts/seed.ts,
-- sembrar-staff.ts, sembrar-plataforma.ts) caiga siempre en la red ancla del
-- Chocó y nunca, de forma no determinista, en la fundación. Ambas quedan después
-- de cualquier organización de plataforma que ya exista (en prod «Alisio» se crea
-- antes, en su propio arranque), así que el equipo de plataforma sigue aterrizando
-- en «Alisio». Idempotente por id.
-- ---------------------------------------------------------------------------
insert into organizaciones (id, nombre, tipo, activo, techo_permisos, aval_motivo, creado_en) values
  ('22222222-0000-0000-0000-000000000001',
   'ASOREDIPARCHOCÓ', 'red_comunitaria', true,
   '{"direcciones_hogar": false, "inventario_nodo": true, "despacho": false}',
   'Semilla inicial. Techo pendiente de acuerdo.', clock_timestamp())
on conflict (id) do nothing;

insert into organizaciones (id, nombre, tipo, activo, techo_permisos, aval_motivo, creado_en) values
  ('22222222-0000-0000-0000-000000000002',
   'Fundación Herencia de Timbiquí', 'fundacion', true,
   '{"direcciones_hogar": false, "inventario_nodo": true, "despacho": false}',
   'Semilla inicial. Techo pendiente de acuerdo.', clock_timestamp())
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- CATÁLOGO
-- Necesidades, daños y materiales de recuperación de vivienda.
-- Tomado del plan de respuesta de ASOREDIPARCHOCÓ.
-- ---------------------------------------------------------------------------
-- familia_ayuda (FR-45): the three coarse families Doña Marta asked to track distinctly —
-- alimentos, medicinas, construcción — layered on top of the finer familia above. NULL where
-- an item genuinely is none of the three (higiene, niñez, daños, and the rest of abrigo —
-- cobijas/colchonetas/kit de cocina); see FAMILIAS_AYUDA. Code 33 (plásticos y tejas) is the
-- one abrigo item that is itself a roofing/repair material, the same good as family 7's
-- «láminas de zinc», so it resolves to construcción rather than staying null.
-- perecedero (FR-43): whether counted stock of this item always carries a shelf life.
insert into catalogo_items (codigo, familia, familia_label, item_label, tipo, pide_detalle, urgencia_min, entregable, orden, familia_ayuda, perecedero) values
  ('11','1','Alimentos y agua','Mercado y alimentos secos','necesidad',false,1,true,10,'alimentos',true),
  ('12','1','Alimentos y agua','Agua potable','necesidad',false,1,true,20,'alimentos',false),
  ('13','1','Alimentos y agua','Alimentación infantil','necesidad',false,1,true,30,'alimentos',true),
  ('21','2','Salud','Medicamento general','necesidad',false,1,true,40,'medicinas',true),
  ('22','2','Salud','Medicamento crónico','necesidad',true,1,true,50,'medicinas',true),
  ('23','2','Salud','Atención médica o traslado','necesidad',false,3,true,60,'medicinas',false),
  ('24','2','Salud','Insumos de curación','necesidad',false,1,true,70,'medicinas',true),
  ('25','2','Salud','Insumos de diabetes','necesidad',true,1,true,75,'medicinas',true),
  ('31','3','Abrigo y albergue','Cobijas, hamacas, toldillos','necesidad',false,1,true,80,null,false),
  ('32','3','Abrigo y albergue','Colchonetas','necesidad',false,1,true,90,null,false),
  ('33','3','Abrigo y albergue','Plásticos y tejas','necesidad',false,1,true,100,'construccion',false),
  ('34','3','Abrigo y albergue','Kit de cocina','necesidad',false,1,true,110,null,false),
  ('41','4','Higiene','Kit de aseo personal','necesidad',false,1,true,120,null,false),
  ('42','4','Higiene','Pañales','necesidad',true,1,true,130,null,false),
  ('43','4','Higiene','Salud menstrual','necesidad',false,1,true,140,null,false),
  ('44','4','Higiene','Tratamiento de agua','necesidad',false,1,true,150,null,true),
  ('51','5','Niñez y educación','Ropa infantil','necesidad',false,1,true,160,null,false),
  ('52','5','Niñez y educación','Kit escolar','necesidad',false,1,true,170,null,false),
  ('53','5','Niñez y educación','Apoyo psicosocial','necesidad',false,1,false,180,null,false),
  ('61','6','Partería','Kit de control prenatal','necesidad',false,1,true,190,'medicinas',false),
  ('62','6','Partería','Kit de atención de parto','necesidad',false,1,true,200,'medicinas',false),
  ('71','7','Vivienda','Láminas de zinc','necesidad',false,1,true,210,'construccion',false),
  ('72','7','Vivienda','Madera y tablones','necesidad',false,1,true,220,'construccion',false),
  ('73','7','Vivienda','Cemento, arena y grava','necesidad',false,1,true,230,'construccion',false),
  ('74','7','Vivienda','Clavos, tornillos y alambre','necesidad',false,1,true,240,'construccion',false),
  ('75','7','Vivienda','Herramientas básicas','necesidad',false,1,true,250,'construccion',false),
  ('76','7','Vivienda','Material eléctrico','necesidad',false,1,true,260,'construccion',false),
  ('77','7','Vivienda','Tuberías y accesorios hidráulicos','necesidad',false,1,true,270,'construccion',false),
  ('91','9','Daños','Vía o camino bloqueado','dano',false,1,false,280,null,false),
  ('92','9','Daños','Puente o paso fluvial','dano',false,1,false,290,null,false),
  ('93','9','Daños','Vivienda afectada','dano',false,1,false,300,null,false),
  ('94','9','Daños','Acueducto o pozo','dano',false,1,false,310,null,false),
  ('95','9','Daños','Escuela o puesto de salud','dano',false,1,false,320,null,false),
  ('96','9','Daños','Cultivo o medio de vida','dano',false,1,false,330,null,false)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- CHOCÓ — 31 CABECERAS MUNICIPALES
-- Coordenadas aproximadas. Tier de conectividad = suposición inicial.
-- San José del Palmar fue el epicentro del sismo del 10 de agosto de 2026.
-- ---------------------------------------------------------------------------
insert into comunidades
  (codigo, nombre, tipo, municipio, agrupador, region_id, organizacion_id,
   ubicacion, tier_conectividad, intervalo_chequeo_dias, activa)
values
  ('CH-QUI','Quibdó','cabecera','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.658, 5.694),4326), 1, 7, true),
  ('CH-IST','Istmina','cabecera','Istmina','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.685, 5.160),4326), 1, 7, true),
  ('CH-TAD','Tadó','cabecera','Tadó','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.562, 5.265),4326), 2, 10, true),
  ('CH-CON','Condoto','cabecera','Condoto','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.650, 5.091),4326), 2, 10, true),
  ('CH-NOV','Nóvita','cabecera','Nóvita','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.607, 4.955),4326), 2, 14, true),
  ('CH-SIP','Sipí','cabecera','Sipí','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.644, 4.652),4326), 3, 21, true),
  ('CH-MSJ','Andagoya','cabecera','Medio San Juan','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.681, 5.101),4326), 2, 14, true),
  ('CH-LSJ','Docordó','cabecera','El Litoral del San Juan','Litoral','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.361, 4.271),4326), 3, 21, true),
  ('CH-UPA','Ánimas','cabecera','Unión Panamericana','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.633, 5.282),4326), 2, 10, true),
  ('CH-CER','Cértegui','cabecera','Cértegui','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.605, 5.370),4326), 2, 14, true),
  ('CH-RIR','Santa Rita','cabecera','Río Iró','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.480, 5.180),4326), 3, 21, true),
  ('CH-CSP','Managrú','cabecera','Cantón de San Pablo','San Juan','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.752, 5.351),4326), 3, 21, true),
  ('CH-ATR','Yuto','cabecera','Atrato','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.672, 5.552),4326), 2, 10, true),
  ('CH-LLO','Lloró','cabecera','Lloró','Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.546, 5.496),4326), 2, 14, true),
  ('CH-BAG','Bagadó','cabecera','Bagadó','Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.415, 5.410),4326), 3, 21, true),
  ('CH-RQU','Paimadó','cabecera','Río Quito','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.742, 5.480),4326), 3, 21, true),
  ('CH-MAT','Beté','cabecera','Medio Atrato','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.850, 6.020),4326), 3, 21, true),
  ('CH-BOJ','Bellavista','cabecera','Bojayá','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.879, 6.556),4326), 3, 21, true),
  ('CH-RIO','Riosucio','cabecera','Riosucio','Bajo Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.117, 7.442),4326), 3, 21, true),
  ('CH-CDA','Curbaradó','cabecera','El Carmen del Darién','Bajo Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.900, 7.160),4326), 3, 21, true),
  ('CH-BBJ','Belén de Bajirá','cabecera','Belén de Bajirá','Bajo Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.720, 7.370),4326), 3, 21, true),
  ('CH-UNG','Unguía','cabecera','Unguía','Darién','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.093, 8.043),4326), 3, 21, true),
  ('CH-ACA','Acandí','cabecera','Acandí','Darién','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.277, 8.512),4326), 2, 14, true),
  ('CH-JUR','Juradó','cabecera','Juradó','Costa Pacífica norte','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.761, 7.104),4326), 3, 21, true),
  ('CH-BSO','Bahía Solano','cabecera','Bahía Solano','Costa Pacífica norte','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.397, 6.223),4326), 2, 14, true),
  ('CH-NUQ','Nuquí','cabecera','Nuquí','Costa Pacífica norte','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.271, 5.709),4326), 2, 14, true),
  ('CH-ABA','Pie de Pató','cabecera','Alto Baudó','Baudó','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.973, 5.518),4326), 3, 21, true),
  ('CH-MBA','Boca de Pepé','cabecera','Medio Baudó','Baudó','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.950, 5.200),4326), 3, 21, true),
  ('CH-BBA','Pizarro','cabecera','Bajo Baudó','Baudó','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.366, 4.284),4326), 3, 21, true),
  ('CH-CAT','El Carmen de Atrato','cabecera','El Carmen de Atrato','Alto Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.142, 5.899),4326), 2, 14, true),
  ('CH-SJP','San José del Palmar','cabecera','San José del Palmar','San Juan alto','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.235, 4.895),4326), 3, 14, true)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- CHOCÓ — CORREGIMIENTOS DE QUIBDÓ (para el mapa del piloto)
-- Estos son los más inciertos de todo el archivo. Corregir en campo.
-- ---------------------------------------------------------------------------
insert into comunidades
  (codigo, nombre, tipo, municipio, agrupador, region_id, organizacion_id,
   ubicacion, familias_estimadas, tier_conectividad, intervalo_chequeo_dias, activa)
values
  ('CH-QUI-TUT','Tutunendo','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.545, 5.755),4326), 46, 2, 14, true),
  ('CH-QUI-PAC','Pacurita','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.620, 5.630),4326), 22, 2, 14, true),
  ('CH-QUI-GUA','Guayabal','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.700, 5.790),4326), 31, 3, 21, true),
  ('CH-QUI-MER','Las Mercedes','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.720, 5.860),4326), 19, 3, 21, true),
  ('CH-QUI-TAG','Tagachí','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.760, 5.960),4326), 27, 3, 21, true),
  ('CH-QUI-ICH','San Francisco de Ichó','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.560, 5.600),4326), 24, 3, 21, true),
  ('CH-QUI-CAM','Campobonito','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.500, 5.700),4326), 16, 4, 30, true),
  ('CH-QUI-BAR','Barranco','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.720, 5.560),4326), 29, 3, 21, true),
  ('CH-QUI-WIN','Winandó','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.760, 5.480),4326), 21, 4, 30, true),
  ('CH-QUI-ROS','Villa del Rosario','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.590, 5.540),4326), 18, 3, 21, true),
  ('CH-QUI-TAN','Boca de Tanandó','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.700, 5.450),4326), 25, 4, 30, true),
  ('CH-QUI-MUR','Puerto Murillo','corregimiento','Quibdó','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.800, 5.620),4326), 14, 4, 30, true)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- CHOCÓ — COMUNIDADES DE RÍO Y LITORAL (antes solo demo, PRD-39)
-- Estas cinco eran filas «demo» paralelas en db/seed/comunidades.ts, con códigos
-- cortos (SIV, DOC, BEB, SAM, PCO). Son lugares reales del territorio, así que
-- pasan al registro como cualquier otro corregimiento (verificado_en = NULL) y
-- la actividad demo de staging se apoya sobre ELLAS, sin duplicar el lugar.
-- Coordenadas aproximadas, como el resto del archivo. Se declara la fuente donde
-- no es un centroide: Docampadó y Puerto Conto llegaron por radio (`referida`).
-- ---------------------------------------------------------------------------
insert into comunidades
  (codigo, nombre, tipo, municipio, agrupador, region_id, organizacion_id,
   ubicacion, ubicacion_fuente, ubicacion_precision_m,
   familias_estimadas, tier_conectividad, intervalo_chequeo_dias, activa)
values
  ('CH-BBA-SIV','Sivirú','corregimiento','Bajo Baudó','Baudó','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.3808, 4.8992),4326), 'centroide', 1000, 55, 3, 10, true),
  ('CH-BBA-DOC','Docampadó','corregimiento','Bajo Baudó','Baudó','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-77.3164, 4.7789),4326), 'referida', 2000, 40, 4, 7, true),
  ('CH-RQU-BEB','Bebedó','corregimiento','Río Quito','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.8203, 5.3494),4326), 'centroide', 1000, 90, 4, 7, true),
  ('CH-ATR-SAM','Samurindó','corregimiento','Atrato','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.6822, 5.6231),4326), 'centroide', 1000, 65, 3, 10, true),
  ('CH-BOJ-PCO','Puerto Conto','corregimiento','Bojayá','Medio Atrato','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001', st_setsrid(st_makepoint(-76.9061, 6.5972),4326), 'referida', 2000, 110, 4, 7, true)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- PACÍFICO CAUCANO — CABECERAS
-- Territorio de la Fundación Herencia de Timbiquí.
-- Los tres municipios donde movieron 40+ toneladas durante la pandemia.
-- ---------------------------------------------------------------------------
insert into comunidades
  (codigo, nombre, tipo, municipio, agrupador, region_id, organizacion_id,
   ubicacion, tier_conectividad, intervalo_chequeo_dias, activa)
values
  ('CA-TIM','Santa Bárbara de Timbiquí','cabecera','Timbiquí','Río Timbiquí','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.667, 2.772),4326), 2, 14, true),
  ('CA-GUA','Guapi','cabecera','Guapi','Río Guapi','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.893, 2.570),4326), 2, 14, true),
  ('CA-LOP','López de Micay','cabecera','López de Micay','Río Micay','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.100, 2.850),4326), 3, 21, true)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- PACÍFICO CAUCANO — COMUNIDADES DE RÍO
-- ⚠️ MUY INCIERTO. Nombres y ubicaciones de memoria.
--    Esta es exactamente la lista que queremos que Herencia corrija.
-- ---------------------------------------------------------------------------
insert into comunidades
  (codigo, nombre, tipo, municipio, agrupador, region_id, organizacion_id,
   ubicacion, tier_conectividad, intervalo_chequeo_dias, activa)
values
  ('CA-TIM-COT','Coteje','corregimiento','Timbiquí','Río Timbiquí','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.530, 2.800),4326), 4, 30, true),
  ('CA-TIM-SMA','Santa María','corregimiento','Timbiquí','Río Timbiquí','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.600, 2.790),4326), 4, 30, true),
  ('CA-TIM-SJO','San José','corregimiento','Timbiquí','Río Timbiquí','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.570, 2.820),4326), 4, 30, true),
  ('CA-TIM-SAI','Puerto Saija','corregimiento','Timbiquí','Río Saija','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.500, 2.960),4326), 4, 30, true),
  ('CA-TIM-SBE','San Bernardo','corregimiento','Timbiquí','Río Saija','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.450, 2.990),4326), 4, 30, true),
  ('CA-TIM-COR','Corozal','corregimiento','Timbiquí','Río Timbiquí','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.620, 2.760),4326), 4, 30, true),
  ('CA-TIM-CHE','Cheté','corregimiento','Timbiquí','Río Timbiquí','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.560, 2.850),4326), 4, 30, true),
  ('CA-TIM-BUB','Bubuey','corregimiento','Timbiquí','Río Bubuey','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.640, 2.900),4326), 4, 30, true),
  ('CA-GUA-NAP','Napi','corregimiento','Guapi','Río Napi','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.780, 2.640),4326), 4, 30, true),
  ('CA-GUA-GUJ','San Antonio de Guajuí','corregimiento','Guapi','Río Guajuí','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.820, 2.480),4326), 4, 30, true),
  ('CA-GUA-LIM','Limones','corregimiento','Guapi','Río Guapi','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.850, 2.620),4326), 4, 30, true),
  ('CA-GUA-BAL','Balsitas','corregimiento','Guapi','Río Guapi','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.800, 2.680),4326), 4, 30, true),
  ('CA-GUA-SFR','San Francisco','corregimiento','Guapi','Río San Francisco','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.760, 2.560),4326), 4, 30, true),
  ('CA-LOP-ZAR','Zaragoza','corregimiento','López de Micay','Río Micay','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.190, 2.900),4326), 4, 30, true),
  ('CA-LOP-NOA','Noanamito','corregimiento','López de Micay','Río Micay','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.230, 2.820),4326), 4, 30, true),
  ('CA-LOP-BOC','Boca de Micay','corregimiento','López de Micay','Río Micay','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.290, 2.760),4326), 4, 30, true),
  ('CA-LOP-TAP','Taparal','corregimiento','López de Micay','Río Naya','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000002', st_setsrid(st_makepoint(-77.150, 3.010),4326), 4, 30, true)
on conflict (codigo) do nothing;

-- ---------------------------------------------------------------------------
-- NODOS — bodegas y puntos de acopio
-- ---------------------------------------------------------------------------
insert into nodos (nombre, tipo, comunidad_id, activo)
select 'Bodega Quibdó', 'bodega', id, true from comunidades where codigo = 'CH-QUI'
on conflict (comunidad_id, nombre) do nothing;
insert into nodos (nombre, tipo, comunidad_id, activo)
select 'Acopio Pie de Pató', 'acopio', id, true from comunidades where codigo = 'CH-ABA'
on conflict (comunidad_id, nombre) do nothing;
insert into nodos (nombre, tipo, comunidad_id, activo)
select 'Acopio Istmina', 'acopio', id, true from comunidades where codigo = 'CH-IST'
on conflict (comunidad_id, nombre) do nothing;
insert into nodos (nombre, tipo, comunidad_id, activo)
select 'Acopio Timbiquí', 'acopio', id, true from comunidades where codigo = 'CA-TIM'
on conflict (comunidad_id, nombre) do nothing;
insert into nodos (nombre, tipo, comunidad_id, activo)
select 'Acopio Guapi', 'acopio', id, true from comunidades where codigo = 'CA-GUA'
on conflict (comunidad_id, nombre) do nothing;

-- ---------------------------------------------------------------------------
-- RUTAS
-- ⚠️ TODAS MANUALES Y TODAS SUPOSICIONES.
--    Los tiempos fluviales cambian con el nivel del río. Ninguna fuente
--    satelital ni Google los tiene. Un lanchero los corrige en cinco minutos.
--    Donde hay dos filas para el mismo par, es por temporada.
-- ---------------------------------------------------------------------------
insert into rutas (origen_id, destino_id, modo, minutos, temporada, fuente, activa, notas)
select o.id, d.id, m.modo, m.minutos, m.temporada, 'manual', true, m.notas
from (values
  ('CH-QUI','CH-QUI-TUT','carretera', 45,'todo_el_ano','Vía a El Carmen. Suposición.'),
  ('CH-QUI','CH-QUI-PAC','carretera', 30,'todo_el_ano','Suposición.'),
  ('CH-QUI','CH-QUI-GUA','lancha',    40,'lluvias','Atrato arriba. Suposición.'),
  ('CH-QUI','CH-QUI-GUA','lancha',    65,'seca','Río bajo, más lento. Suposición.'),
  ('CH-QUI-GUA','CH-QUI-MER','lancha',50,'todo_el_ano','Suposición.'),
  ('CH-QUI-MER','CH-QUI-TAG','lancha',45,'todo_el_ano','Suposición.'),
  ('CH-QUI','CH-QUI-BAR','lancha',    55,'todo_el_ano','Suposición.'),
  -- Winandó se entra por el caño desde Las Mercedes y SOLO en lluvias: en seca el caño no
  -- tiene agua y la comunidad queda incomunicada. No hay puerta de todo el año (esa es la
  -- que aislaría el escenario estacional del demo, PRD-39). El db:seed de staging refuerza
  -- este mismo tramo (misma clave origen/destino/modo/temporada), así que no lo duplica.
  ('CH-QUI-MER','CH-QUI-WIN','chalupa',25,'lluvias','Por el caño desde Las Mercedes. En verano no entra chalupa. Suposición.'),
  ('CH-QUI-BAR','CH-QUI-TAN','lancha',40,'todo_el_ano','Suposición.'),
  ('CH-QUI','CH-QUI-MUR','lancha',    70,'todo_el_ano','Suposición.'),
  ('CH-QUI-PAC','CH-QUI-ROS','trocha',80,'todo_el_ano','Suposición.'),
  ('CH-QUI-PAC','CH-QUI-ICH','trocha',70,'todo_el_ano','Suposición.'),
  ('CH-QUI-TUT','CH-QUI-CAM','trocha',120,'todo_el_ano','Suposición.'),
  ('CH-QUI','CH-ATR','carretera',     35,'todo_el_ano','Vía Quibdó–Yuto.'),
  ('CH-ATR','CH-LLO','carretera',     30,'todo_el_ano','Suposición.'),
  ('CH-QUI','CH-IST','carretera',    150,'todo_el_ano','Vía Quibdó–Istmina.'),
  ('CH-IST','CH-CON','carretera',     40,'todo_el_ano','Suposición.'),
  ('CH-IST','CH-MSJ','carretera',     25,'todo_el_ano','Suposición.'),
  ('CH-QUI','CH-MAT','lancha',       180,'todo_el_ano','Atrato abajo hacia Beté.'),
  ('CH-MAT','CH-BOJ','lancha',       150,'todo_el_ano','Atrato abajo hacia Bellavista.'),
  ('CH-QUI','CH-ABA','lancha',       240,'lluvias','Hacia el Baudó. Suposición gruesa.'),
  ('CA-TIM','CA-TIM-COT','lancha',    90,'todo_el_ano','Timbiquí arriba. Suposición.'),
  ('CA-TIM','CA-TIM-SMA','lancha',    60,'todo_el_ano','Suposición.'),
  ('CA-TIM','CA-TIM-COR','lancha',    45,'todo_el_ano','Suposición.'),
  ('CA-TIM','CA-TIM-CHE','lancha',    70,'todo_el_ano','Suposición.'),
  ('CA-TIM','CA-TIM-SAI','lancha',   120,'todo_el_ano','Hacia el Saija. Suposición.'),
  ('CA-TIM-SAI','CA-TIM-SBE','lancha',50,'todo_el_ano','Suposición.'),
  ('CA-TIM','CA-GUA','lancha',       150,'todo_el_ano','Costero. Depende del mar.'),
  ('CA-GUA','CA-GUA-NAP','lancha',    75,'todo_el_ano','Napi arriba. Suposición.'),
  ('CA-GUA','CA-GUA-LIM','lancha',    40,'todo_el_ano','Suposición.'),
  ('CA-GUA','CA-GUA-BAL','lancha',    55,'todo_el_ano','Suposición.'),
  ('CA-GUA','CA-GUA-GUJ','lancha',    95,'todo_el_ano','Guajuí. Suposición.'),
  ('CA-TIM','CA-LOP','lancha',       180,'todo_el_ano','Costero hacia Micay. Suposición.'),
  ('CA-LOP','CA-LOP-ZAR','lancha',    70,'todo_el_ano','Micay arriba. Suposición.'),
  ('CA-LOP','CA-LOP-NOA','lancha',    50,'todo_el_ano','Suposición.'),
  ('CA-LOP','CA-LOP-BOC','lancha',    40,'todo_el_ano','Suposición.')
) as m(origen, destino, modo, minutos, temporada, notas)
join comunidades o on o.codigo = m.origen
join comunidades d on d.codigo = m.destino
on conflict (origen_id, destino_id, modo, temporada) do nothing;

-- ---------------------------------------------------------------------------
-- NADA DE ESTO ESTÁ VERIFICADO.
--
-- Consulta útil para la reunión: qué comunidades quedan sin ruta conocida.
--   select nombre, municipio from comunidades c
--   where not exists (select 1 from rutas r where r.origen_id = c.id or r.destino_id = c.id);
--
-- Y la pregunta que importa: ¿cuáles de estas existen, cuáles faltan,
-- y cuáles están mal ubicadas?
-- ---------------------------------------------------------------------------

-- ============================================================================
-- HISTÓRICO DE LA FUNDACIÓN HERENCIA DE TIMBIQUÍ
--
-- Jornadas que ellos ya hicieron, sembradas como histórico.
-- Propósito: que al abrir el mapa vean su propio trabajo, no una pantalla
-- vacía. Las cifras son las que ellos publican; el detalle de paradas es
-- suposición nuestra y está para que lo corrijan.
--
-- ⚠️ NO sembrar necesidades inventadas en Cauca. Adivinar un tiempo de río es
--    una cosa; inventar que una comunidad no tiene agua es otra, y si lo
--    detectan cuesta la confianza.
-- ============================================================================

insert into jornadas (codigo, tipo, organizacion_id, titulo, region_id,
                      fecha_inicio, fecha_fin, estado, familias_atendidas, notas)
values
  ('J-HDT-COVID', 'distribucion', '22222222-0000-0000-0000-000000000002',
   'Ayuda humanitaria en el marco de la pandemia',
   '11111111-0000-0000-0000-000000000002',
   '2020-05-01', '2020-08-31', 'historico', 2000,
   'Más de 40 toneladas de alimentos en Guapi, Timbiquí y López de Micay. '
   'Cifra publicada por la fundación. Paradas y fechas exactas: por confirmar.'),

  ('J-HDT-BRIGADA', 'brigada', '22222222-0000-0000-0000-000000000002',
   'Brigada de salud integral en Timbiquí',
   '11111111-0000-0000-0000-000000000002',
   null, null, 'historico', 400,
   'Medicina general, ginecología, odontología, optometría, consultorio jurídico '
   'y recreación. Más de 400 familias. Fecha exacta: por confirmar.'),

  ('J-HDT-REGALOS', 'distribucion', '22222222-0000-0000-0000-000000000002',
   'Regalos para sonreír',
   '11111111-0000-0000-0000-000000000002',
   null, null, 'historico', 630,
   'Entrega de regalos a niñas y niños de 0 a 12 años en Guapi y Timbiquí. '
   'Más de 630 niños. Se ha repetido en varias navidades.')
on conflict (codigo) do nothing;

insert into jornada_paradas (jornada_id, comunidad_id, orden, notas)
select j.id, c.id, p.orden, 'Parada supuesta — corregir con la fundación.'
from (values
  ('J-HDT-COVID','CA-GUA',1),
  ('J-HDT-COVID','CA-TIM',2),
  ('J-HDT-COVID','CA-LOP',3),
  ('J-HDT-BRIGADA','CA-TIM',1),
  ('J-HDT-REGALOS','CA-GUA',1),
  ('J-HDT-REGALOS','CA-TIM',2)
) as p(jornada, comunidad, orden)
join jornadas j on j.codigo = p.jornada
join comunidades c on c.codigo = p.comunidad
on conflict (jornada_id, orden) do nothing;

-- Nodos que probablemente usaron como acopio. Suposición.
insert into nodos (nombre, tipo, comunidad_id, activo)
select 'Acopio López de Micay', 'acopio', id, true from comunidades where codigo = 'CA-LOP'
on conflict (comunidad_id, nombre) do nothing;

-- ---------------------------------------------------------------------------
-- Pregunta para la reunión, sobre estas mismas filas:
--   ¿Cuántas comunidades de río alcanzaron en cada jornada, y cuáles?
--   Esa respuesta es la primera evaluación de cobertura que tendría el sistema.
-- ---------------------------------------------------------------------------
