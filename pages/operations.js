// The Operations section is now split into separate routed pages under
// /operations/*. This entry point redirects to the first section.
export default function OperationsIndex() {
  return null
}

export async function getServerSideProps() {
  return { redirect: { destination: '/operations/submissions', permanent: false } }
}
