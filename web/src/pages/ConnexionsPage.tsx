import { useStation } from '../state/context'

export function ConnexionsPage() {
  const { status, busy, error, log, settings, snapshot, updateSettings, connectDemo, connectHttp, connectUsb, connectBle, disconnect } = useStation()
  const serialOk = typeof navigator !== 'undefined' && navigator.serial != null
  const bleOk = typeof navigator !== 'undefined' && navigator.bluetooth != null
  return (
    <section className="stack">
      <header className="page-head">
        <h2>Connexions</h2>
        <p>Le client parle au nœud comme un client MeshCore. Sur un compagnon USB, il écoute le flood #germacrisepublic, pas la température du dongle.</p>
      </header>
      {error ? <p className="banner alert">{error}</p> : null}
      <div className="cards">
        <article className="card">
          <h3>USB</h3>
          <p>
            Trames <code>0x3C</code> / <code>0x3E</code>, 115200 bauds. Chrome propose Espressif <code>303A:1001</code> (compagnon USB JTAG), Seeed <code>2886</code> et les autres ponts MeshCore. Le port est relâché si la carte disparaît.
          </p>
          <button type="button" data-testid="connect-usb" disabled={busy || !serialOk} onClick={connectUsb}>
            Choisir le port
          </button>
          {serialOk ? null : <p className="note">Web Serial demande Chrome ou Edge.</p>}
        </article>
        <article className="card">
          <h3>Bluetooth</h3>
          <p>Service Nordic UART. Une écriture GATT = une trame, sans enrobage <code>0x3C</code>.</p>
          <div className="row">
            <button type="button" data-testid="connect-ble" disabled={busy || !bleOk} onClick={() => connectBle(false)}>
              Chercher MeshCore
            </button>
            <button type="button" className="ghost" disabled={busy || !bleOk} onClick={() => connectBle(true)}>
              Liste complète
            </button>
          </div>
          {bleOk ? null : <p className="note">Web Bluetooth demande Chrome.</p>}
        </article>
        <article className="card">
          <h3>HTTP</h3>
          <p>
            <code>POST /api/v1/frame</code> avec la charge utile compagnon en base64. Ce n’est pas le TCP brut du port 5000.
          </p>
          <label>
            Adresse
            <input
              value={settings.httpUrl}
              spellCheck={false}
              onChange={(event) => updateSettings({ httpUrl: event.target.value })}
            />
          </label>
          <button type="button" data-testid="connect-http" disabled={busy} onClick={connectHttp}>
            Connecter
          </button>
        </article>
      </div>
      <article className="card demo">
        <h3>Sans radio</h3>
        <p>La démonstration répond au même dialogue que le firmware attendu, avec des mesures qui bougent.</p>
        <div className="row">
          <button type="button" className="primary" data-testid="connect-demo" disabled={busy} onClick={connectDemo}>
            Démonstration
          </button>
          <button type="button" className="ghost" data-testid="disconnect" disabled={status === 'disconnected'} onClick={() => void disconnect()}>
            Déconnecter
          </button>
        </div>
      </article>
      {snapshot?.self ? (
        <dl className="facts">
          <div>
            <dt>Nœud</dt>
            <dd>{snapshot.self.name || 'sans nom'}</dd>
          </div>
          <div>
            <dt>Radio</dt>
            <dd>
              {snapshot.self.freqMhz.toLocaleString('fr-FR')} MHz · BW {snapshot.self.bwKhz.toLocaleString('fr-FR')} kHz · SF {snapshot.self.sf} · CR {snapshot.self.cr}
            </dd>
          </div>
          <div>
            <dt>Modèle</dt>
            <dd>{snapshot.device?.model || '—'}</dd>
          </div>
        </dl>
      ) : null}
      <section>
        <h3>Journal</h3>
        <ol className="log" data-testid="journal">
          {log.length ? log.map((line, index) => <li key={`${index}-${line}`}>{line}</li>) : <li>Rien pour l’instant.</li>}
        </ol>
      </section>
    </section>
  )
}
