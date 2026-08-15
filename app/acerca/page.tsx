import Acerca from './vista'

/**
 * The front door. What Convite is and why it works the way it does, for the people who arrive
 * before they have a login: partner organisations, the humanitarian cluster, funders, and
 * anyone deciding whether to trust it with a community's data.
 *
 * Static marketing content — no database, no client JavaScript — so it prerenders cleanly and
 * arrives whole on a weak connection, the same bar the rest of the product holds to. The
 * markup lives in `vista.tsx` so it can be rendered and reviewed from a harness without
 * standing up Next; this route file only declares how it is served.
 */
export const dynamic = 'force-static'

export default function AcercaPage() {
  return <Acerca />
}
