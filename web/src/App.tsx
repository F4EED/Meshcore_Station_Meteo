import { useEffect, useState } from 'react'
import { MeteoPage } from './pages/MeteoPage'
import { ConnexionsPage } from './pages/ConnexionsPage'
import { ReglagesPage } from './pages/ReglagesPage'
import { Shell, type PageId } from './ui/Shell'

function pathToPage(path: string): PageId {
  if (path.startsWith('/connexions')) return 'connexions'
  if (path.startsWith('/reglages')) return 'reglages'
  return 'meteo'
}

export function App() {
  const [page, setPage] = useState<PageId>(() => pathToPage(window.location.pathname))

  useEffect(() => {
    if (window.location.pathname === '/') history.replaceState(null, '', '/meteo')
    const onPop = () => setPage(pathToPage(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  function go(next: PageId) {
    const path = `/${next}`
    history.pushState(null, '', path)
    setPage(next)
  }

  return (
    <Shell page={page} onNavigate={go}>
      {page === 'meteo' ? <MeteoPage /> : null}
      {page === 'connexions' ? <ConnexionsPage /> : null}
      {page === 'reglages' ? <ReglagesPage /> : null}
    </Shell>
  )
}
