-- Inbound webhooks route to an organisation by the `phone_number_id` Meta puts in the
-- payload, so that value has to be unique. It also has to stay nullable: we do not yet know
-- whose WABA we will operate under, and the whole system is built to run without one. The
-- partial index gives us both — any number of organisations may sit at null at once, and
-- the moment a real number id is filled in it is unambiguous.

create unique index organizaciones_waba_phone_number_id_key
  on organizaciones (waba_phone_number_id)
  where waba_phone_number_id is not null;
