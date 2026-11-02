import { useEffect, useState } from 'react'
import { useStation } from '../state/context'
import { formatAge, presentWeather } from '../weather/present'

export function MeteoPage() {
  const { snapshot, settings, linkKind, status, poll } = useStation()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(clock)
  }, [])

  useEffect(() => {
    if (status !== 'connected') return
    const timer = window.setInterval(() => {
      void poll()
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [poll, status])

  const reading = snapshot?.reading
  if (!reading || snapshot.readingSource === 'none') {
    return (
      <section className="panel empty">
        <h2>Pas encore de mesure</h2>
        <p>Ouvrez Connexions et reliez la station, ou lancez la démonstration sans radio.</p>
      </section>
    )
  }

  const view = presentWeather(reading, settings.bands)
  const age = snapshot.readingAt ? formatAge(now - snapshot.readingAt) : ''
  const source = snapshot.readingSource === 'station' ? 'trame station' : 'télémétrie LPP'

  return (
    <section aria-live="polite">
      {linkKind === 'demo' ? <p className="banner">Données simulées, aucune radio.</p> : null}
      {view.smoke ? <p className="banner alert">Fumée éventuelle : IAQ ou gaz hors seuil. Ce n’est pas un départ de feu.</p> : null}
      <article className={`hero level-${view.hero.level}`} data-testid="metric-temp">
        <p className="eyebrow">Température</p>
        <p className="hero-value">
          {view.hero.value}
          <span>°C</span>
        </p>
        <p className={`pill pill-${view.hero.level}`}>{view.hero.levelLabel}</p>
      </article>
      <div className="metrics">
        {view.cards.map((item) => (
          <article key={item.id} className="metric" data-testid={`metric-${item.id}`}>
            <header>
              <h2>{item.label}</h2>
              <span className={`pill pill-${item.level}`}>{item.levelLabel}</span>
            </header>
            <p className="metric-value">
              {item.value} <span>{item.unit}</span>
            </p>
            {item.note ? <p className="note">{item.note}</p> : null}
          </article>
        ))}
      </div>
      <div className="metrics indices">
        {[view.frost, view.fire].map((item) => (
          <article key={item.id} className="metric feature" data-testid={`metric-${item.id}`}>
            <header>
              <h2>{item.label}</h2>
              <span className={`pill pill-${item.level}`}>{item.levelLabel}</span>
            </header>
            <p className="metric-value">
              {item.value} <span>{item.unit}</span>
            </p>
            <p className="note">{item.note}</p>
          </article>
        ))}
      </div>
      <p className="meta">
        {view.cadenceLabel ? <span>{view.cadenceLabel}</span> : null}
        {view.intervalLabel ? <span>Intervalle d’envoi {view.intervalLabel}</span> : null}
        <span>
          {source} · {age}
        </span>
        {view.smoke ? null : <span>Pas de signal fumée</span>}
      </p>
    </section>
  )
}
