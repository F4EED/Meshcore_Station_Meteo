# Meshcore_Station_Meteo — client web

Ce dossier est le client. Le README à la racine du dépôt reste celui de tout le projet ; il ne faut pas le remplacer par ce fichier.

## Pages

- **Météo** — relevé courant, pastilles vert / orange / rouge, point de rosée, ressenti, indices gel/verglas et incendie, signal de fumée éventuelle.
- **Connexions** — USB (Web Serial), Bluetooth (Nordic UART), HTTP (`POST /api/v1/frame`), démonstration locale.
- **Réglages**
  - **Canal** — nom et emplacement. Usine : `#germacrise_publique`, public, sans clé à saisir, emplacement 1. Le champ clé reste vide : le client envoie seize octets à zéro.
  - **Région** — région par défaut. Usine : `fr-ara`. La clé de transport du flood est optionnelle et n’est pas inventée.
  - **Configuration** — min/max et autres seuils STMET (température, humidité, pression, gaz, IAQ, eCO2) plus les indices gel et incendie.

Les indices affichés sont calculés dans le client. Ce n’est pas une prévision, ni un IFM.

## Lancement

Depuis ce dossier :

```bash
npm install
npm test
npm run dev
```

La page est sur http://127.0.0.1:5173. Chrome ou Edge pour le port USB et le Bluetooth. `npm run build` puis `npm run preview` sert le build au même port.

Simulateur HTTP du firmware (autre terminal) :

```bash
npm run mock
```

Puis, dans Connexions, adresse `http://127.0.0.1:5174`.

## Lien avec la carte

USB et Bluetooth parlent le protocole compagnon MeshCore. HTTP transporte les mêmes charges utiles. Le contrat, y compris ce que le firmware doit encore répondre, est dans [docs/lien-local.md](../docs/lien-local.md).
