/**
 * Recorded WhatsApp Cloud API webhooks.
 *
 * PRD §4 M5: «Built and tested against recorded Meta payloads with locally computed
 * signatures — no account needed.» These are the real envelope shape Meta posts, trimmed of
 * the fields we never read, with the message content rewritten to the basin.
 *
 * The `wamid` values are structurally real (base64-ish, opaque) because they are the
 * idempotency key and a test that used `id: '1'` would not catch a driver that truncates or
 * lower-cases them.
 *
 * Phone numbers are the seed's synthetic contacts, in Meta's format — no leading `+`, which
 * is exactly the conversion the driver has to get right.
 */

export const PHONE_NUMBER_ID = '109371665014416'

/** A second partner's WABA number, for the day there is more than one (0008). */
export const OTRO_PHONE_NUMBER_ID = '117482553901772'

/** The number of the partner WABA these webhooks were addressed to. */
const METADATA = {
  display_phone_number: '573001112233',
  phone_number_id: PHONE_NUMBER_ID,
}

function entrada(phoneNumberId: string, valor: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '102290129340398',
    changes: [
      {
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { ...METADATA, phone_number_id: phoneNumberId },
          ...valor,
        },
      },
    ],
  }
}

function webhook(valor: Record<string, unknown>): Record<string, unknown> {
  return {
    object: 'whatsapp_business_account',
    entry: [entrada(PHONE_NUMBER_ID, valor)],
  }
}

/** Rosa in Tagachí, after the river came up. 2026-08-13T19:02:11Z. */
export const WEBHOOK_TEXTO = webhook({
  contacts: [{ profile: { name: 'Rosa Palacios' }, wa_id: '573000000001' }],
  messages: [
    {
      from: '573000000001',
      id: 'wamid.HBgMNTczMDAwMDAwMDAxFQIAEhggM0E0N0YwQjJDMUQ4RTkwQTAx',
      timestamp: '1786647731',
      type: 'text',
      text: {
        body:
          'Buenas tardes, aquí en Tagachí la creciente nos entró a las casas anoche. ' +
          'Quedamos como 12 familias sin nada que cocinar. Manden mercados por favor.',
      },
    },
  ],
})

/** Marta in Bellavista, who sent a voice note and nothing else. 2026-08-13T20:40:03Z. */
export const WEBHOOK_NOTA_DE_VOZ = webhook({
  contacts: [{ profile: { name: 'Marta Perea' }, wa_id: '573000000003' }],
  messages: [
    {
      from: '573000000003',
      id: 'wamid.HBgMNTczMDAwMDAwMDAzFQIAEhggQjc3RTVBMUQ0RjAyQzMxMDIz',
      timestamp: '1786653603',
      type: 'audio',
      audio: {
        id: '1129384756201928',
        // Meta really does send the codec parameter; the driver drops it.
        mime_type: 'audio/ogg; codecs=opus',
        sha256: 'f1c2d3e4a5b60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
        voice: true,
      },
    },
  ],
})

/** Carmen in Pacurita, photographing the acopio, with a caption. 2026-08-13T21:12:47Z. */
export const WEBHOOK_FOTO = webhook({
  contacts: [{ profile: { name: 'Carmen Rentería' }, wa_id: '573000000008' }],
  messages: [
    {
      from: '573000000008',
      id: 'wamid.HBgMNTczMDAwMDAwMDA4FQIAEhggQzA5MUE3RDIzRTQ1Njc4OTBB',
      timestamp: '1786655567',
      type: 'image',
      image: {
        id: '9982736451029384',
        mime_type: 'image/jpeg',
        sha256: '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',
        caption: 'Esto es lo que ha llegado hasta ahora.',
      },
    },
  ],
})

/** A dropped pin. 2026-08-13T21:30:00Z. */
export const WEBHOOK_UBICACION = webhook({
  contacts: [{ profile: { name: 'Carmen Rentería' }, wa_id: '573000000008' }],
  messages: [
    {
      from: '573000000008',
      id: 'wamid.HBgMNTczMDAwMDAwMDA4FQIAEhggRDFBMkIzQzRENUU2Rjc4OTAx',
      timestamp: '1786656600',
      type: 'location',
      location: { latitude: 5.6444, longitude: -76.6089, name: 'Acopio Pacurita' },
    },
  ],
})

/**
 * A delivery callback for something we sent. Carries no `messages` key at all — a driver
 * that assumes one is there crashes on every status Meta sends, which is most of the traffic.
 */
export const WEBHOOK_ESTADO = webhook({
  statuses: [
    {
      id: 'wamid.HBgMNTczMDAwMDAwMDAxFQIAERgSRkZGRkZGRkZGRkZGRkZGRkYA',
      status: 'delivered',
      timestamp: '1786658700',
      recipient_id: '573000000001',
      conversation: { id: 'e5c7a0f1', origin: { type: 'service' } },
      pricing: { billable: true, pricing_model: 'CBP', category: 'service' },
    },
  ],
})

/**
 * A type we do not handle. Kept as a fixture because the requirement is that it is *logged*,
 * never dropped: the ref survives in `payloadCrudo` and a human can still see that something
 * arrived (2.12, and PRD §4 M4's «never drops»).
 */
export const WEBHOOK_TIPO_DESCONOCIDO = webhook({
  contacts: [{ profile: { name: 'Aníbal Córdoba' }, wa_id: '573000000004' }],
  messages: [
    {
      from: '573000000004',
      id: 'wamid.HBgMNTczMDAwMDAwMDA0FQIAEhggRTJCM0M0RDVFNkY3ODkwMTI',
      timestamp: '1786658700',
      type: 'document',
      document: { id: '5566778899', mime_type: 'application/pdf', filename: 'censo.pdf' },
    },
  ],
})

/**
 * A message nobody can act on. PRD §4 M4 names it: «Muchas cosas!! De todo!!!» must yield no
 * category. It is here so the clarification path is exercised end to end against the real
 * normalizer rather than against a stub.
 */
export const WEBHOOK_VAGO = webhook({
  contacts: [{ profile: { name: 'Rosa Palacios' }, wa_id: '573000000001' }],
  messages: [
    {
      from: '573000000001',
      id: 'wamid.HBgMNTczMDAwMDAwMDAxFQIAEhggVkFHTzAwMDAwMDAwMDAwMDAx',
      timestamp: '1786647731',
      type: 'text',
      text: { body: 'Muchas cosas!! De todo!!! estamos mal por acá' },
    },
  ],
})

/** The reply to the clarification question, arriving later as its own webhook. */
export const WEBHOOK_RESPUESTA = webhook({
  contacts: [{ profile: { name: 'Rosa Palacios' }, wa_id: '573000000001' }],
  messages: [
    {
      from: '573000000001',
      id: 'wamid.HBgMNTczMDAwMDAwMDAxFQIAEhggUkVTUFVFU1RBMDAwMDAwMDAx',
      timestamp: '1786653603',
      type: 'text',
      text: { body: 'perdón, es que necesitamos mercados, somos 12 familias' },
    },
  ],
})

/** The two messages of the two-WABA batch, one per partner. */
export const WAMID_WABA_UNO = 'wamid.HBgMNTczMDAwMDAwMDAxFQIAEhggV0FCQVVOTzAwMDAwMDAwMDAx'
export const WAMID_WABA_DOS = 'wamid.HBgMNTczMDAwMDAwMDA0FQIAEhggV0FCQURPUzAwMDAwMDAwMDAx'

/**
 * One POST, two partners.
 *
 * Meta batches across `entry[]` and each entry brings its own `metadata.phone_number_id`, so
 * this is the shape the endpoint sees the day a second WABA is enabled — and the shape that
 * used to file the second household's report under the first partner's organisation, because
 * the parser kept only the first number it saw.
 */
export const WEBHOOK_DOS_WABAS = {
  object: 'whatsapp_business_account',
  entry: [
    entrada(PHONE_NUMBER_ID, {
      contacts: [{ profile: { name: 'Rosa Palacios' }, wa_id: '573000000001' }],
      messages: [
        {
          from: '573000000001',
          id: WAMID_WABA_UNO,
          timestamp: '1786647731',
          type: 'text',
          text: { body: 'Necesitamos mercados en Tagachí, somos 12 familias.' },
        },
      ],
    }),
    entrada(OTRO_PHONE_NUMBER_ID, {
      contacts: [{ profile: { name: 'Aníbal Córdoba' }, wa_id: '573000000004' }],
      messages: [
        {
          from: '573000000004',
          id: WAMID_WABA_DOS,
          timestamp: '1786647999',
          type: 'text',
          text: { body: 'Necesitamos mercados en Bellavista, somos 8 familias.' },
        },
      ],
    }),
  ],
}

export const WAMID_VAGO = 'wamid.HBgMNTczMDAwMDAwMDAxFQIAEhggVkFHTzAwMDAwMDAwMDAwMDAx'
export const WAMID_RESPUESTA = 'wamid.HBgMNTczMDAwMDAwMDAxFQIAEhggUkVTUFVFU1RBMDAwMDAwMDAx'

/** The `wamid` of the message inside WEBHOOK_TEXTO, for idempotency assertions. */
export const WAMID_TEXTO = 'wamid.HBgMNTczMDAwMDAwMDAxFQIAEhggM0E0N0YwQjJDMUQ4RTkwQTAx'

/** The `wamid` the delivery callback refers to. */
export const WAMID_SALIENTE = 'wamid.HBgMNTczMDAwMDAwMDAxFQIAERgSRkZGRkZGRkZGRkZGRkZGRkYA'
