# Meshcore_Station_Meteo

projet de station météo pour meshcore

Station autonome : mesures BME688 sur Seeed Wio Tracker L1 Pro (sans écran), émission MeshCore en mode sensor. Pas de prévision.

Le firmware de la carte et le client web partagent ce dépôt. Le dialogue local entre les deux est dans [docs/lien-local.md](docs/lien-local.md).

## Client web

Interface en français. Le détail des scripts est dans [web/README.md](web/README.md).

| Page | Rôle |
| --- | --- |
| Météo | Température, humidité, pression, gaz, IAQ, eCO2, batterie, point de rosée, ressenti, indices gel/verglas et incendie |
| Connexions | USB, Bluetooth, HTTP, ou démonstration sans radio |
| Réglages | Canal (nom et clé), région par défaut, onglet Configuration (bandes STMET et indices) |

Usine du canal : **Germacrise**, clé `dce843f4d5c2ed416b4ce17db83df618`, région **fr-ara**.

```bash
cd web
npm install
npm test
npm run dev
```

Ouvrir http://127.0.0.1:5173 dans Chrome (USB et Bluetooth exigent un contexte sécurisé). Sans matériel : page Connexions, bouton « Démonstration ». Pour le lien HTTP : `npm run mock` dans un second terminal, puis l’adresse `http://127.0.0.1:5174`.

## Firmware

Le firmware de la carte n’est pas décrit dans cette section. Il doit répondre au lien local : trames compagnon MeshCore, plus les commandes station `0x70` à `0x72`.
