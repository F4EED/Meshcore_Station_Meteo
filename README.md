# Station météo MeshCore

Station headless pour le **Seeed Wio Tracker L1 Pro** et un **BME688**. Elle mesure sur place et publie sur le réseau MeshCore France. Pas de Meshtastic, pas de prévision, pas d’écran.

Le dépôt est sous licence MIT. La pile radio est [MeshCore](https://github.com/meshcore-dev/MeshCore) `81dbae592ffad40b4212bc0b37e82b38da08f4bc` (v1.18.0, `examples/simple_sensor`), clonée au build dans `build/MeshCore` (ignoré par git).

## But

Le nœud est un contact **sensor** (type 4). Il reste à l’écoute : la cadence limite les émissions, elle ne met pas la carte en sommeil. Les mesures partent de deux façons :

- télémétrie CayenneLPP du mode sensor (réponse à une requête, et push d’abonné) ;
- trame de groupe **GRP_DATA** (`0x06`), `data_type` **`0xFF42`**, chiffrée avec la clé du canal **Germacrise**, en flood de transport sur **`fr-ara`**.

`0xFF42` est dans la plage de développement MeshCore (`FF00`–`FFFF`). Le clair est `uint16` petit-boutiste, un octet de longueur, puis le LPP brut.

## Matériel

| Pièce | Détail |
| --- | --- |
| Carte | Seeed Wio Tracker L1 Pro, nRF52840, SX1262, GNSS L76K, sans écran |
| Capteur | BME688 traité par le driver Adafruit BME680 (pas BSEC), adresses `0x76` ou `0x77` |
| Bus | Grove sur **Wire1**, SDA **D18**, SCL **D17** |
| GPS | Une chasse de 8 minutes au premier boot. Fix obtenu : latitude et longitude figées dans les préférences, GPS coupé. Pas de fix : aucune position annoncée (pas de 0,0) |
| Émission | 22 dBm sur le SX1262, sous la limite de 27 dBm PIRE. Pas de front-end Heltec |

Nom du nœud : `F4EED-Meteo`. Mot de passe admin compilé : `meteo`. Le changer sur la console avec `password` suivi du nouveau mot de passe.

## Radio

Profil France de [meshcore.fr](https://www.meshcore.fr/) : EU/UK Narrow, **869,618 MHz**, BW **62,5 kHz**, **SF 8**, coding rate **8**. Dans RadioLib ce 8 est le taux 4/8. Le sync word privé MeshCore est `0x12` (fait du firmware, pas une valeur publiée sur meshcore.fr).

| Réglage | Valeur |
| --- | --- |
| Région du nœud, annonces | `fr-42` (Loire), sous `fr` |
| Portée de la trame météo | `fr-ara`, sous `fr` |
| Canal | Germacrise, clé `dce843f4d5c2ed416b4ce17db83df618` |
| Duty cycle | 10 % (`set dutycycle 10`, facteur d’airtime 9) |
| Rôle | capteur, `set repeat off` |
| Hachage de chemin | `set path.hash.mode 1` (2 octets, comme les répéteurs meshcore.fr) |
| Annonce zero-hop | 240 minutes |
| Annonce flood | 12 heures |
| CAD | activé |

Au premier boot, ces régions et ces commandes sont enregistrées (`/stmet.seed`). Un répéteur qui ne connaît que `fr` ne relaie ni `fr-42` ni `fr-ara` : il faut y charger les deux noms.

La clé de transport d’une région publique est le début de SHA-256 de `#` suivi du nom. Ce n’est pas la clé du canal.

## Trame LPP

Humidité sur **1 octet** (×2), comme CayenneLPP 1.6.1. Le capteur générique (type 100) est un entier **×1**, pas ×100 : ohms pour le gaz, score 0–500 pour l’IAQ.

Présent dans la télémétrie sensor et dans le GRP_DATA, sauf la température du micro et l’altitude déduite de la pression (télémétrie seule, pas dans le groupe) :

| Canal | Types | Contenu |
| --- | --- | --- |
| 1 | 116, 136 si fix | tension batterie, position |
| 2 | 103, 104, 115, 100, 125 | air °C, HR, pression hPa, gaz Ω, eCO2 ppm |
| 3 | 100 | IAQ 0–500 |
| 4 | 120 | indice gel / verglas 0–100 |
| 5 | 120 | indice feu météo 0–100 |
| 6 | 120 | indice fumée 0–100 |
| 7 | 103 | point de rosée °C |

La température du canal 1 est celle du micro, pas l’air. eCO2 = `400 + IAQ × 4` après trois échantillons de chauffe écartés. Les indices sont calculés sur la mesure, pas une prévision.

Rosée Magnus–Tetens, `a = 17,62`, `b = 243,12`. Gel : saturation dans les 3 °C de rosée et froid sous 3 °C, ou air très humide (au-dessus de 90 %) dans les 2 °C autour de 0. Feu : Ångström `HR/20 + (27−T)/10`, score `(4 − A) / 2` ramené à 0–100. Fumée : IAQ de 100 à 300 ramené à 0–100. Ce n’est ni un IFM ni un risque routier.

## Cadence

Priorité choc, puis hors plage, puis créneau. La comparaison se fait avec le dernier échantillon **envoyé**. Les créneaux sont 06:00, 12:00 et 18:00, heure Europe/Paris. Le délai normal est calculé depuis l’heure civile de cet envoi, avec un plancher de 60 s.

| Mode | Condition | Intervalle |
| --- | --- | --- |
| Choc | ΔT ≥ 3 °C, ΔHR ≥ 15, ΔP ≥ 5 hPa, gaz ≥ 30 % relatif, ΔIAQ ≥ 50, ΔeCO2 ≥ 200, ou Δ d’un indice ≥ 25 | 300 s |
| Hors plage | une grandeur présente en dehors de `[low, high]` | 3600 s |
| Créneau | horloge valide (à partir de 2024-01-01 UTC) | jusqu’au prochain créneau |
| Sans heure | horloge invalide | 21600 s |

Le premier échantillon utilisable part tout de suite. Si le budget d’émission du duty cycle est trop bas, la trame est relâchée et réessayée. Les bandes d’usine reprennent le firmware Gaulix (température, HR, pression, gaz, IAQ, eCO2) plus gel, feu et fumée (hors plage au-dessus de 40). Fichier `/stmet.bands`.

## Compiler

Les tests hôtes ne flashent rien :

```bash
./scripts/test.sh
```

L’image nRF demande PlatformIO (`pio`) et un clone de MeshCore :

```bash
./scripts/build.sh
```

Le script pose le pin, applique `firmware/patches/sensor-telemetry-hook.patch` (crochet `onTelemetryBuilt`), copie la variante `WioTrackerL1_meteo` et lance `pio run -e WioTrackerL1_meteo`. L’UF2 est `build/MeshCore/.pio/build/WioTrackerL1_meteo/firmware.uf2`.

## Flasher

1. Double appui sur reset : le volume UF2 du L1 Pro apparaît.
2. Copier le fichier `firmware.uf2` sur ce volume.
3. Console série 115200 bauds.

Commandes station, en plus du CLI MeshCore : `meteo`, `bands`, `bands <nom> <7 nombres>`, `tx` (forcer un envoi). Les noms de bandes : `temp`, `humidity`, `pressure`, `gas`, `iaq`, `co2`, `frost`, `fire`, `smoke`.

## Reste à vérifier sur le matériel

Cette branche n’a pas été flashée ici. Il reste à poser l’antenne et le BME688 sur le Grove, flasher l’UF2, lire la première mesure au série, changer le mot de passe `meteo`, et disposer d’un compagnon ou d’un répéteur qui a la clé Germacrise **et** les régions `fr-42` et `fr-ara`. Le décodage à l’air de `0xFF42` se confirme avec ce client.

L’image parle le CLI texte du mode sensor. Le dialogue binaire compagnon (trames `0x70` à `0x72`, emballage USB `3C`/`3E`) décrit pour l’appli web reste à brancher sur cette image.

<!-- appli-web -->

## Appli web

Le client web vit dans ce dépôt, dossier `web/`, dès que sa branche est réunie à celle-ci. Le détail des scripts est dans [web/README.md](web/README.md). Le contrat de dialogue local est dans [docs/lien-local.md](docs/lien-local.md). Ce bloc est celui que le travail web met à jour.

Interface en français.

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

<!-- /appli-web -->
