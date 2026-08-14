/**
 * Catalogue seed (Section 5.1).
 *
 * This is a *starting* catalogue, not a fixed one. It lives in `catalogo_items` precisely
 * so a coordinator can add "gasolina para planta eléctrica" from the Catálogo screen when a
 * new territory needs it (non-negotiable 2.8). Nothing in the codebase may branch on these
 * codes.
 *
 * `ayuda_texto` is what a reporter reads under the row in a WhatsApp list. Section 15:
 * warm, plain, usted, short.
 */

export type ItemSemilla = {
  codigo: string
  familiaLabel: string
  itemLabel: string
  tipo: 'necesidad' | 'dano'
  ayudaTexto: string
  pideDetalle?: boolean
  urgenciaMin?: number
  entregable?: boolean
}

/**
 * How a person counts each item out loud, `[singular, plural]`.
 *
 * Seed values for `catalogo_items.unidad_singular` / `unidad_plural`. They exist because
 * `pedidos.motivo` is read by a human: «Hay 18 mercados en Bodega Central Quibdó, pero
 * nadie va para Bellavista». Kept beside the catalogue rather than inside them only so the
 * list above stays scannable — both end up in the same table, editable from the Catálogo
 * screen without a deploy (2.8).
 *
 * Damage codes have none: nothing is ever counted out and loaded onto a boat.
 */
export const UNIDADES_SEMILLA: Record<string, [string, string]> = {
  '11': ['mercado', 'mercados'],
  '12': ['bidón de agua', 'bidones de agua'],
  '13': ['ración infantil', 'raciones infantiles'],
  '21': ['botiquín', 'botiquines'],
  '22': ['tratamiento', 'tratamientos'],
  '23': ['traslado', 'traslados'],
  '24': ['kit de curación', 'kits de curación'],
  '31': ['kit de dormida', 'kits de dormida'],
  '32': ['colchoneta', 'colchonetas'],
  '33': ['kit de techo', 'kits de techo'],
  '34': ['kit de cocina', 'kits de cocina'],
  '41': ['kit de aseo', 'kits de aseo'],
  '42': ['paca de pañales', 'pacas de pañales'],
  '43': ['kit menstrual', 'kits menstruales'],
  '44': ['frasco de pastillas', 'frascos de pastillas'],
  '51': ['muda de ropa', 'mudas de ropa'],
  '52': ['kit escolar', 'kits escolares'],
  '53': ['acompañamiento', 'acompañamientos'],
  '61': ['juego de herramientas', 'juegos de herramientas'],
  '62': ['paquete de semillas', 'paquetes de semillas'],
}

export const CATALOGO_SEMILLA: ItemSemilla[] = [
  // 1 — Alimentación y agua
  {
    codigo: '11',
    familiaLabel: 'Alimentación y agua',
    itemLabel: 'Mercado y alimentos',
    tipo: 'necesidad',
    ayudaTexto: 'Arroz, panela, aceite, granos y lo básico de la casa.',
  },
  {
    codigo: '12',
    familiaLabel: 'Alimentación y agua',
    itemLabel: 'Agua potable',
    tipo: 'necesidad',
    ayudaTexto: 'Agua en bidones o bolsas para tomar.',
  },
  {
    codigo: '13',
    familiaLabel: 'Alimentación y agua',
    itemLabel: 'Alimentación infantil',
    tipo: 'necesidad',
    ayudaTexto: 'Leche, bienestarina y comida para los más pequeños.',
  },

  // 2 — Salud
  {
    codigo: '21',
    familiaLabel: 'Salud',
    itemLabel: 'Medicamento general',
    tipo: 'necesidad',
    ayudaTexto: 'Para fiebre, dolor, diarrea o gripa.',
  },
  {
    codigo: '22',
    familiaLabel: 'Salud',
    itemLabel: 'Medicamento crónico',
    tipo: 'necesidad',
    ayudaTexto: 'Para tensión, azúcar, epilepsia u otro tratamiento fijo. Díganos cuál.',
    pideDetalle: true,
  },
  {
    codigo: '23',
    familiaLabel: 'Salud',
    itemLabel: 'Atención médica o traslado',
    tipo: 'necesidad',
    ayudaTexto: 'Alguien está grave y necesita que lo vean o lo saquen.',
    urgenciaMin: 3,
  },
  {
    codigo: '24',
    familiaLabel: 'Salud',
    itemLabel: 'Insumos de curación',
    tipo: 'necesidad',
    ayudaTexto: 'Gasas, alcohol, vendas, guantes.',
  },

  // 3 — Albergue y abrigo
  {
    codigo: '31',
    familiaLabel: 'Albergue y abrigo',
    itemLabel: 'Cobijas, hamacas, toldillos',
    tipo: 'necesidad',
    ayudaTexto: 'Para dormir y protegerse del zancudo.',
  },
  {
    codigo: '32',
    familiaLabel: 'Albergue y abrigo',
    itemLabel: 'Colchonetas',
    tipo: 'necesidad',
    ayudaTexto: 'Para dormir en el albergue o en la casa.',
  },
  {
    codigo: '33',
    familiaLabel: 'Albergue y abrigo',
    itemLabel: 'Plásticos y tejas',
    tipo: 'necesidad',
    ayudaTexto: 'Para tapar el techo o levantar un cambuche.',
  },
  {
    codigo: '34',
    familiaLabel: 'Albergue y abrigo',
    itemLabel: 'Kit de cocina',
    tipo: 'necesidad',
    ayudaTexto: 'Ollas, platos, cucharas y vasos.',
  },

  // 4 — Agua, saneamiento e higiene
  {
    codigo: '41',
    familiaLabel: 'Agua, saneamiento e higiene',
    itemLabel: 'Kit de aseo',
    tipo: 'necesidad',
    ayudaTexto: 'Jabón, cepillo, crema dental, toallas.',
  },
  {
    codigo: '42',
    familiaLabel: 'Agua, saneamiento e higiene',
    itemLabel: 'Pañales',
    tipo: 'necesidad',
    ayudaTexto: 'Díganos la talla y para cuántos niños o adultos.',
    pideDetalle: true,
  },
  {
    codigo: '43',
    familiaLabel: 'Agua, saneamiento e higiene',
    itemLabel: 'Salud menstrual',
    tipo: 'necesidad',
    ayudaTexto: 'Toallas higiénicas y lo necesario para el periodo.',
  },
  {
    codigo: '44',
    familiaLabel: 'Agua, saneamiento e higiene',
    itemLabel: 'Tratamiento de agua',
    tipo: 'necesidad',
    ayudaTexto: 'Pastillas o cloro para poder tomar el agua del río.',
  },

  // 5 — Niñez y bienestar
  {
    codigo: '51',
    familiaLabel: 'Niñez y bienestar',
    itemLabel: 'Ropa infantil',
    tipo: 'necesidad',
    ayudaTexto: 'Ropa y zapatos para niñas y niños.',
  },
  {
    codigo: '52',
    familiaLabel: 'Niñez y bienestar',
    itemLabel: 'Kit escolar',
    tipo: 'necesidad',
    ayudaTexto: 'Cuadernos, lápices y morral.',
  },
  {
    codigo: '53',
    familiaLabel: 'Niñez y bienestar',
    itemLabel: 'Apoyo psicosocial',
    tipo: 'necesidad',
    // Not cargo: this need is met by a person travelling, not by a box on a boat.
    ayudaTexto: 'Acompañamiento para la familia o la comunidad.',
    entregable: false,
  },

  // 6 — Medios de vida
  {
    codigo: '61',
    familiaLabel: 'Medios de vida',
    itemLabel: 'Herramientas',
    tipo: 'necesidad',
    ayudaTexto: 'Machete, pala, clavos, martillo.',
  },
  {
    codigo: '62',
    familiaLabel: 'Medios de vida',
    itemLabel: 'Semillas',
    tipo: 'necesidad',
    ayudaTexto: 'Para volver a sembrar el pancoger.',
  },

  // 9 — Daños. Reported, verified, and acted on by a coordinator; never loaded on a boat,
  // so `entregable` is false and no `pedido` is ever created from one.
  {
    codigo: '91',
    familiaLabel: 'Daños',
    itemLabel: 'Vía o camino bloqueado',
    tipo: 'dano',
    ayudaTexto: 'Derrumbe, palo caído o barrizal que no deja pasar.',
    entregable: false,
  },
  {
    codigo: '92',
    familiaLabel: 'Daños',
    itemLabel: 'Puente o paso fluvial',
    tipo: 'dano',
    ayudaTexto: 'Puente caído, palizada o paso que quedó peligroso.',
    entregable: false,
  },
  {
    codigo: '93',
    familiaLabel: 'Daños',
    itemLabel: 'Vivienda afectada',
    tipo: 'dano',
    ayudaTexto: 'Casas inundadas, sin techo o en riesgo.',
    entregable: false,
  },
  {
    codigo: '94',
    familiaLabel: 'Daños',
    itemLabel: 'Acueducto o pozo',
    tipo: 'dano',
    ayudaTexto: 'Se dañó de dónde sacan el agua.',
    entregable: false,
  },
  {
    codigo: '95',
    familiaLabel: 'Daños',
    itemLabel: 'Escuela o puesto de salud',
    tipo: 'dano',
    ayudaTexto: 'La escuela o el puesto de salud quedó afectado.',
    entregable: false,
  },
  {
    codigo: '96',
    familiaLabel: 'Daños',
    itemLabel: 'Cultivo o medio de vida',
    tipo: 'dano',
    ayudaTexto: 'Se perdió el cultivo, la canoa o las herramientas de trabajo.',
    entregable: false,
  },
]
