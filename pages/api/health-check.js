// Health probe.
//
// This used to check that the Pipedrive sync had run in the last 25 hours and email an
// alert if not. Pipedrive is gone: the CRM is edited live and there is no sync to be
// late. Left as a simple liveness endpoint rather than deleted, in case anything external
// is pinging it - and, importantly, no longer able to fire a false alert every time it is
// called, which is what it would have done with the sync timestamp removed.
export default async function handler(req, res) {
  return res.status(200).json({
    healthy: true,
    source: 'crm',
    checkedAt: new Date().toISOString(),
  })
}
