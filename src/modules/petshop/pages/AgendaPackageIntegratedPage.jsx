import AgendaIntegratedPage from './AgendaIntegratedPage'
import AgendaDailyModeBridge from './AgendaDailyModeBridge'

export default function AgendaPackageIntegratedPage({ setPage }) {
  return (
    <>
      <AgendaIntegratedPage setPage={setPage} />
      <AgendaDailyModeBridge />
    </>
  )
}
