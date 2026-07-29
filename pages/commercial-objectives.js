export default function CommercialObjectivesRedirect() { return null }
export async function getServerSideProps() {
  return { redirect: { destination: '/weekly-tasks', permanent: false } }
}
