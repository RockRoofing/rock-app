import OperationsShell, { PageHeading } from '../../components/OperationsShell'
import NegotiatingTable from '../../components/NegotiatingTable'

// Reuses the exact same NegotiatingTable component as the Pre-Contract
// Negotiating page — same Pipedrive data, same columns. Changes to the shared
// component appear in both places.
export default function OperationsNegotiating() {
  return (
    <OperationsShell active="pm:negotiating" section="pm" title="Negotiating" wide>
      <PageHeading title="Projects in Negotiating" sub="Live from Pipedrive — deals currently at the Negotiating stage" />
      <NegotiatingTable accent="#ca8a04" />
    </OperationsShell>
  )
}
