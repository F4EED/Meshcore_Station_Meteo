# Meshcore_Station_Meteo — client web

Version **0.0.1**.

Ce dossier est le client. Le README à la racine du dépôt reste celui de tout le projet ; il ne faut pas le remplacer par ce fichier.

## Pages

- **Météo** — relevé de la **station**, pas la sonde du dongle USB. Pastilles vert / orange / rouge, point de rosée, ressenti, indices gel/verglas et incendie, fumée. Ces grandeurs viennent du `GRP_DATA` `0xFF42` ou du texte `mto_now` quand le compagnon les a reçus ; sinon le client les calcule avec les mêmes formules.
- **Connexions** — USB (Web Serial), Bluetooth (Nordic UART), HTTP (`POST /api/v1/frame`), démonstration locale. Le sélecteur USB liste Espressif `0x303A` (PID `0x1001`, compagnon USB JTAG), Seeed `0x2886`, et les autres ponts MeshCore (`0x10C4`, `0x1A86`, `0x0403`, `0x239A`, `0x2E8A`, `0x1915`). Il ne se limite pas à Seeed. Branché à un compagnon, le client **n’envoie pas** la télémétrie locale `0x27` : elle lirait le micro du dongle (souvent ~39 °C, batterie 0).
- **Réglages**
  - **Canal** — nom et emplacement. Usine : `#germacrisepublic`, public, sans clé à saisir, emplacement 1. Le champ clé reste vide : le client envoie seize octets à zéro. Le nom est figé. La connexion ne réécrit pas les emplacements déjà présents.
  - **Région** — région par défaut. Usine : `fr-42`. La clé de transport du flood est optionnelle et n’est pas inventée.
  - **Configuration** — min/max et autres seuils STMET (température, humidité, pression, gaz, IAQ, eCO2) plus les indices gel et incendie.

Les indices ne sont pas une prévision, ni un IFM. Quand le LPP les porte (gel canal 4, feu canal 5, rosée canal 7, ressenti canal 8, tous des types déjà définis), l’écran montre ces valeurs. L’encodeur LPP du client écrit les mêmes canaux.

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
