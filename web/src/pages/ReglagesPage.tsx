import { useEffect, useState } from 'react'
import { isZero, parseHex, utf8Size } from '../protocol/bytes'
import { FACTORY_CHANNEL_KEY_HEX, FACTORY_CHANNEL_NAME, FACTORY_CHANNEL_SLOT, FACTORY_REGION } from '../protocol/codes'
import { useStation } from '../state/context'
import { BAND_FIELDS, BAND_FIELD_LABELS, BAND_META, BAND_ORDER, type BandField, type BandId } from '../model'
import { FACTORY_BANDS, cloneBandSet, formatBandField, parseBandDraft } from '../weather/factory'
import type { Settings } from '../state/storage'

type Tab = 'canal' | 'region' | 'config'

type Draft = {
  channelName: string
  channelKeyHex: string
  channelSlot: string
  region: string
  floodKeyHex: string
  bands: Record<BandId, Record<BandField, string>>
}

function toDraft(settings: Settings): Draft {
  const bands = {} as Draft['bands']
  for (const id of BAND_ORDER) {
    bands[id] = {
      mean: formatBandField(settings.bands[id].mean),
      low: formatBandField(settings.bands[id].low),
      high: formatBandField(settings.bands[id].high),
      veryLow: formatBandField(settings.bands[id].veryLow),
      warnLow: formatBandField(settings.bands[id].warnLow),
      warnHigh: formatBandField(settings.bands[id].warnHigh),
      veryHigh: formatBandField(settings.bands[id].veryHigh),
    }
  }
  return {
    channelName: settings.channelName,
    channelKeyHex: settings.channelKeyHex,
    channelSlot: String(settings.channelSlot),
    region: settings.region,
    floodKeyHex: settings.floodKeyHex,
    bands,
  }
}

export function ReglagesPage() {
  const station = useStation()
  const [tab, setTab] = useState<Tab>('canal')
  const [draft, setDraft] = useState<Draft>(() => toDraft(station.settings))
  const [showKey, setShowKey] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(toDraft(station.settings))
  }, [station.epoch])

  const connected = station.status === 'connected'
  const channels = station.snapshot?.channels ?? []

  async function sendChannel() {
    setFormError(null)
    const slot = Number(draft.channelSlot)
    if (!Number.isInteger(slot) || slot < 0 || slot > 39) {
      setFormError('Emplacement de canal invalide')
      return
    }
    if (utf8Size(draft.channelName) < 1 || utf8Size(draft.channelName) > 32) {
      setFormError('Nom de canal : 1 à 32 octets')
      return
    }
    const secret = parseHex(draft.channelKeyHex)
    if (!secret || secret.length !== 16) {
      setFormError('La clé fait 32 caractères hexadécimaux')
      return
    }
    if (isZero(secret)) {
      setFormError('Une clé toute nulle est refusée')
      return
    }
    station.updateSettings({ channelName: draft.channelName, channelKeyHex: draft.channelKeyHex.trim().toLowerCase(), channelSlot: slot })
    try {
      await station.createChannel(slot, draft.channelName.trim(), secret)
    } catch {
      /* le message est dans le bandeau */
    }
  }

  async function sendRegion() {
    setFormError(null)
    const region = draft.region.trim()
    if (utf8Size(region) < 1 || utf8Size(region) > 30 || region.includes(':')) {
      setFormError('Région : 1 à 30 octets, sans deux-points')
      return
    }
    let key: Uint8Array | null = null
    if (draft.floodKeyHex.trim()) {
      const parsed = parseHex(draft.floodKeyHex)
      if (!parsed || parsed.length !== 16) {
        setFormError('Clé de transport : 32 hex, ou laisser vide')
        return
      }
      key = parsed
    }
    station.updateSettings({ region, floodKeyHex: draft.floodKeyHex.trim().toLowerCase() })
    try {
      await station.saveRegion(region, key)
    } catch {
      /* bandeau */
    }
  }

  async function sendBands() {
    setFormError(null)
    try {
      const bands = BAND_ORDER.map((id) => parseBandDraft(draft.bands[id]))
      await station.saveBands(bands)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Bandes invalides')
    }
  }

  return (
    <section className="stack">
      <header className="page-head">
        <h2>Réglages</h2>
        <p>Créer le canal, la clé et la région, puis ajuster les bandes. Rien n’est émis tant que la station n’est pas connectée.</p>
      </header>
      {station.error ? <p className="banner alert">{station.error}</p> : null}
      {formError ? <p className="banner alert">{formError}</p> : null}
      <div className="tabs" role="tablist">
        {(
          [
            ['canal', 'Canal'],
            ['region', 'Région'],
            ['config', 'Configuration'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} data-testid={`tab-${id}`} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'canal' ? (
        <form
          className="card form"
          onSubmit={(event) => {
            event.preventDefault()
            void sendChannel()
          }}
        >
          <h3>Canal privé</h3>
          <p className="note">Usine : Germacrise sur l’emplacement 1. L’emplacement 0 est souvent le canal Public.</p>
          <label>
            Emplacement
            <input data-testid="channel-slot" inputMode="numeric" value={draft.channelSlot} onChange={(event) => setDraft({ ...draft, channelSlot: event.target.value })} />
          </label>
          <label>
            Nom
            <input data-testid="channel-name" value={draft.channelName} onChange={(event) => setDraft({ ...draft, channelName: event.target.value })} />
          </label>
          <label>
            Clé (32 hex)
            <input data-testid="channel-key" className="mono" spellCheck={false} autoComplete="off" type={showKey ? 'text' : 'password'} value={draft.channelKeyHex} onChange={(event) => setDraft({ ...draft, channelKeyHex: event.target.value })} />
          </label>
          <div className="row">
            <button type="button" className="ghost" onClick={() => setShowKey((value) => !value)}>
              {showKey ? 'Masquer la clé' : 'Afficher la clé'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() =>
                setDraft({
                  ...draft,
                  channelName: FACTORY_CHANNEL_NAME,
                  channelKeyHex: FACTORY_CHANNEL_KEY_HEX,
                  channelSlot: String(FACTORY_CHANNEL_SLOT),
                })
              }
            >
              Rétablir Germacrise
            </button>
            <button type="submit" className="primary" data-testid="send-channel" disabled={!connected || station.busy}>
              Créer le canal
            </button>
          </div>
          {draft.channelSlot === '0' ? <p className="note">L’emplacement 0 remplace souvent le canal Public.</p> : null}
          <h3>Sur la station</h3>
          {channels.length ? (
            <ul className="channels">
              {channels.map((channel) => (
                <li key={channel.index}>
                  <strong>{channel.index}</strong> {channel.name || 'vide'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="note">Aucun canal lu.</p>
          )}
        </form>
      ) : null}

      {tab === 'region' ? (
        <form
          className="card form"
          onSubmit={(event) => {
            event.preventDefault()
            void sendRegion()
          }}
        >
          <h3>Région par défaut</h3>
          <p className="note">
            Usine du canal Germacrise : fr-ara. Le nom part dans la variable <code>region</code>. Sans clé de transport, aucune clé de flood n’est inventée. Le nœud peut démarrer en fr-42.
          </p>
          <label>
            Région
            <input data-testid="region-name" value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} />
          </label>
          <label>
            Clé de transport (optionnelle, 32 hex)
            <input className="mono" spellCheck={false} autoComplete="off" value={draft.floodKeyHex} onChange={(event) => setDraft({ ...draft, floodKeyHex: event.target.value })} />
          </label>
          <p className="note">
            Lue sur la station : {station.snapshot?.region || '—'}
            {station.snapshot?.floodName ? ` · flood ${station.snapshot.floodName}` : ''}
          </p>
          <div className="row">
            <button type="button" className="ghost" onClick={() => setDraft({ ...draft, region: FACTORY_REGION, floodKeyHex: '' })}>
              Rétablir fr-ara
            </button>
            <button type="submit" className="primary" data-testid="send-region" disabled={!connected || station.busy}>
              Enregistrer la région
            </button>
          </div>
          <h3>Profil radio meshcore.fr</h3>
          <dl className="facts tight">
            <div>
              <dt>Fréquence</dt>
              <dd>869,618 MHz</dd>
            </div>
            <div>
              <dt>Bande</dt>
              <dd>62,5 kHz · SF 8 · CR 8</dd>
            </div>
            <div>
              <dt>Rôle</dt>
              <dd>sensor, pas répéteur · PIRE &lt; 27 dBm</dd>
            </div>
          </dl>
          <button type="button" data-testid="send-radio" disabled={!connected || station.busy} onClick={() => void station.applyRadio()}>
            Appliquer le profil
          </button>
        </form>
      ) : null}

      {tab === 'config' ? (
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            void sendBands()
          }}
        >
          <p className="note">
            {station.snapshot?.stationBands
              ? 'Les dernières bandes lues viennent de la station.'
              : 'Bandes locales : la station n’a pas encore répondu.'}{' '}
            Une case vide retire le seuil. Mini / maxi bornent la bande. Très haut et très bas passent au rouge, les alertes à l’orange.
          </p>
          {BAND_ORDER.map((id) => (
            <fieldset key={id} className="card band">
              <legend>
                {BAND_META[id].label} <span>{BAND_META[id].unit}</span>
              </legend>
              <p className="note">{BAND_META[id].hint}</p>
              <div className="band-grid">
                {BAND_FIELDS.map((field) => (
                  <label key={field}>
                    {BAND_FIELD_LABELS[field]}
                    <input
                      inputMode="decimal"
                      value={draft.bands[id][field]}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          bands: { ...draft.bands, [id]: { ...draft.bands[id], [field]: event.target.value } },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div className="row">
            <button
              type="button"
              className="ghost"
              onClick={() => {
                const fresh = cloneBandSet(FACTORY_BANDS)
                station.updateSettings({ bands: fresh })
                setDraft({ ...draft, bands: toDraft({ ...station.settings, bands: fresh }).bands })
              }}
            >
              Rétablir les bandes usine
            </button>
            <button type="button" disabled={!connected || station.busy} onClick={() => void station.reloadBands()}>
              Lire la station
            </button>
            <button type="submit" className="primary" data-testid="send-bands" disabled={!connected || station.busy}>
              Envoyer les bandes
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
