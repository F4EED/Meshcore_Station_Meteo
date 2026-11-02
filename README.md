# Meshcore_Station_Meteo

Station météo de F4EED pour le réseau **MeshCore** en France. Une carte mesure l’air là où elle est installée, puis envoie ces mesures sur le maillage. Le dépôt est [F4EED/Meshcore_Station_Meteo](https://github.com/F4EED/Meshcore_Station_Meteo), licence MIT.

Elle publie des mesures. Les pages qui suivent disent le matériel, le réglage radio, le rythme d’envoi, les indices calculés sur place, et la façon de compiler puis de flasher.

## But

Le nœud reste dehors, sans écran et sans lien vers un service météo en ligne. Il lit le BME688, il garde la radio en écoute, et il parle quand la mesure le justifie :

- aux heures calmes, trois fois dans la journée ;
- plus souvent si une valeur sort des seuils ;
- encore plus souvent si la météo change d’un coup.

Les autres postes MeshCore qui ont le canal **#germacrise_publique** peuvent lire ces trames. Le rôle de la carte est un **capteur** (type de contact MeshCore `sensor`, valeur 4). Elle répond aux demandes de télémétrie. Elle ne relaie pas le trafic des voisins : ce travail reste aux répéteurs.

## Matériel

| Pièce | Rôle |
| --- | --- |
| Seeed Wio Tracker **L1 Pro** | nRF52840, radio SX1262, GPS L76K. Firmware **sans écran** |
| **BME688** | Température, humidité, pression, gaz. Branché en I2C sur le connecteur Grove |
| Antenne 868 MHz | À visser avant toute émission |
| Alimentation | Li-ion du L1 Pro, avec le solaire du boîtier si la station est autonome |

Le BME688 est lu par la bibliothèque Adafruit BME680 (le BME688 s’en sert). Le logiciel Bosch BSEC n’est pas utilisé. L’adresse I2C est `0x76` ou `0x77`. Le bus est **Wire1** du Grove : **SDA = D18**, **SCL = D17**.

Le GPS ne tourne qu’une fois, huit minutes, au premier démarrage. S’il obtient un fix, la position est enregistrée et le GPS s’éteint. Sans fix, la station n’annonce pas de coordonnées, pour ne pas publier un point 0,0.

La puissance d’émission de la puce est **22 dBm**, sous le plafond de **27 dBm** PIRE du plan français. Le L1 Pro n’a pas d’amplificateur externe.

Nom annoncé sur le réseau : `F4EED-Meteo`. Le mot de passe d’administration compilé dans l’image est `meteo`. À changer dès la première console, avec la commande `password` suivie du nouveau mot de passe.

## Radio MeshCore

Les réglages sont ceux du profil France publié sur [meshcore.fr](https://www.meshcore.fr/) (EU/UK Narrow) :

| Réglage | Valeur | À quoi ça sert |
| --- | --- | --- |
| Fréquence | 869,618 MHz | Canal MeshCore France |
| Bande passante | 62,5 kHz | Largeur du signal, mode Narrow |
| Spreading factor | SF 8 | Compromis portée / durée d’émission |
| Coding rate | 8 | Chez RadioLib, ce chiffre est le taux 4/8 |
| Duty cycle | 10 % | Part du temps où la carte a le droit d’émettre |
| Sync word | `0x12` | Mot de synchro privé de MeshCore. Le site meshcore.fr ne le publie pas ; c’est celui du firmware |
| Chemin | `path.hash.mode 1` | Adresses de chemin sur 2 octets, comme les répéteurs du réseau |
| Annonce locale | toutes les 4 h | Présence zero-hop, `advert.interval 240` |
| Annonce flood | toutes les 12 h | Découverte plus loin |
| CAD | activé | La carte écoute le canal avant d’émettre |

Le facteur d’airtime correspondant au duty cycle de 10 % est 9 (`set dutycycle 10`). Si le budget d’émission restant est trop juste pour la trame, l’envoi attend.

## Canal #germacrise_publique et régions

Deux choses différentes circulent sur la même radio.

**Le canal** dit qui affiche la mesure. Il s’appelle **#germacrise_publique**, tout en minuscules. Il est public : il n’a pas de clé. Le secret MeshCore de la trame est vide, seize octets à zéro. Un client qui ajoute ce canal sans clé lit la mesure. Sur l’air, le hash de canal est `0x37` (premier octet du SHA-256 de ce secret vide).

**La région** dit jusqu’où le réseau accepte de relayer. La station a deux noms :

| Nom | Usage |
| --- | --- |
| `fr-42` | Région du nœud (Loire). Annonces, région par défaut et région « home » |
| `fr-ara` | Portée de transport des mesures météo, pour l’instant |

Les deux sont des enfants de la région `fr`, elle-même sous `europe` et `eu`. Un répéteur qui ne connaît que `fr` ne relaie ni `fr-42` ni `fr-ara`. Il faut lui charger ces deux noms, sinon les trames s’arrêtent au premier saut.

La clé de transport d’une région se calcule : début du SHA-256 de `#` collé au nom (`#fr-42`, `#fr-ara`). Le canal #germacrise_publique n’a pas de clé et n’entre pas dans ce calcul.

Au premier démarrage, la carte enregistre ce profil (régions, duty cycle, cadence d’annonces, répétition coupée). Les changements faits ensuite au clavier restent en mémoire.

## Ce qui est envoyé

La station parle en **CayenneLPP**, le format de télémétrie MeshCore. Deux chemins portent les mêmes grandeurs :

1. la télémétrie du capteur, lue sur demande ou poussée vers un abonné ;
2. une trame de groupe `GRP_DATA` (`0x06`), type de donnée `0xFF42` (plage de développement MeshCore), secret de canal vide, envoyée en flood sur `fr-ara`.

`0xFF42` se lit ainsi : un entier 16 bits petit-boutiste, un octet de longueur, puis les octets LPP.

| Canal LPP | Contenu |
| --- | --- |
| 1 | Tension de la batterie. Position GPS seulement après un fix. La température de ce canal est celle du micro, pas l’air |
| 2 | Air en °C, humidité, pression en hPa, résistance du gaz en ohms, eCO2 estimé en ppm |
| 3 | Score IAQ de 0 à 500 |
| 4 | Indice gel / verglas, 0 à 100 |
| 5 | Indice feu météo, 0 à 100 |
| 6 | Indice fumée, 0 à 100 |
| 7 | Point de rosée en °C |

L’humidité tient sur un octet (valeur × 2), comme la bibliothèque CayenneLPP. Le gaz et l’IAQ sont des entiers bruts (type 100, échelle × 1) : des ohms, ou un score, pas une valeur divisée par 100.

L’eCO2 n’est pas un capteur de CO2. C’est une estimation : `400 + IAQ × 4`, après trois lectures de chauffe écartées. L’IAQ vient de la résistance du gaz et de l’humidité, sans BSEC.

## Cadence

La carte se relit toutes les minutes. Elle n’émet pas à chaque lecture. Elle compare la mesure au **dernier envoi**, puis choisit un délai. L’ordre est fixe : un choc passe devant une valeur hors seuils, qui passe devant le rythme calme.

| Situation | Délai avant le prochain envoi |
| --- | --- |
| Choc : la température bouge d’au moins 3 °C, l’humidité de 15 points, la pression de 5 hPa, le gaz de 30 % par rapport à lui-même, l’IAQ de 50, l’eCO2 de 200 ppm, ou un indice de 25 points | 5 minutes |
| Hors plage : une grandeur présente est en dehors de son intervalle `[low, high]` | 1 heure |
| Calme, horloge valable | Prochain créneau **06:00**, **12:00** ou **18:00**, heure de Paris. Au moins 60 secondes |
| Horloge pas encore fiable (avant 2024) | 6 heures |

Le premier échantillon utilisable part tout de suite. Les seuils d’usine reprennent les bandes de la station Gaulix pour la température, l’humidité, la pression, le gaz, l’IAQ et l’eCO2. Les indices gel, feu et fumée passent en « hors plage » au-dessus de 40. On les modifie à la console avec `bands`, et ils sont gardés dans le fichier `/stmet.bands`.

La carte ne dort pas entre deux envois. Le capteur MeshCore doit pouvoir répondre. La cadence ne limite que la radio.

## Indices

Ces chiffres sont calculés à partir de la mesure du moment. Ce sont des aides à la lecture, pas une prévision, pas un indice forêt météo officiel, pas un avis de verglas sur la route.

**Point de rosée.** Formule de Magnus–Tetens (`a = 17,62`, `b = 243,12`) à partir de la température et de l’humidité. Par exemple, 15 °C et 55 % d’humidité donnent une rosée d’environ 6 °C.

**Gel / verglas.** Un score de 0 à 100. Il monte quand l’air est froid et proche de la saturation (gel), ou très humide tout près de 0 °C (verglas). Repères : −1 °C et 95 % → environ 77 ; 0 °C et 100 % → 100 ; 15 °C et 55 % → 0.

**Feu météo.** Indice d’Ångström allégé : `humidité / 20 + (27 − température) / 10`. On le ramène entre 0 et 100. Il monte quand l’air est chaud et sec. À 15 °C et 55 %, il vaut 2. Il ne remplace pas l’IFM de Météo-France : il n’y a ni vent, ni pluie des jours précédents.

**Fumée.** Elle suit l’IAQ déjà élevé (0 à IAQ 100, 100 à IAQ 300). Elle dit qu’il y a déjà des composés dans l’air. Elle ne dit pas qu’un feu va partir.

## Compiler

Il faut Git et [PlatformIO](https://platformio.org/) (`pio` dans le terminal). Depuis la racine du dépôt :

```bash
./scripts/test.sh
./scripts/build.sh
```

`test.sh` vérifie sur le PC la cadence, l’IAQ, les indices et l’encodage LPP. Rien n’est flashé.

`build.sh` récupère MeshCore au commit `81dbae592ffad40b4212bc0b37e82b38da08f4bc` (v1.18.0, exemple `simple_sensor`), prépare la variante `WioTrackerL1_meteo` et lance :

```bash
pio run -e WioTrackerL1_meteo
```

L’image à copier sur la carte est :

`build/MeshCore/.pio/build/WioTrackerL1_meteo/firmware.uf2`

Les dossiers `firmware/` et `scripts/` arrivent avec le firmware. Tant qu’ils ne sont pas sur `main`, ils sont dans la [pull request firmware](https://github.com/F4EED/Meshcore_Station_Meteo/pull/1), branche `cursor/station-meteo-firmware-c913`.

## Flasher

1. Produire le fichier `firmware.uf2` avec `./scripts/build.sh`.
2. Brancher le L1 Pro en USB.
3. **Deux appuis rapides** sur le bouton reset. Un volume UF2 apparaît (le chargeur de boot de la carte).
4. Copier `firmware.uf2` sur ce volume. La carte redémarre toute seule à la fin de la copie.
5. Ouvrir la console série à **115200** bauds.

Commandes utiles, en plus du CLI MeshCore habituel :

| Commande | Effet |
| --- | --- |
| `meteo` | Affiche la dernière mesure |
| `bands` | Affiche les seuils |
| `bands temp 15 -10 40 -20 0 35 45` | Remplace une bande (sept nombres : moyenne, low, high, veryLow, warnLow, warnHigh, veryHigh) |
| `tx` | Force un envoi, sous réserve du duty cycle |
| `password` suivi du nouveau mot | Remplace `meteo` |

Noms de bandes : `temp`, `humidity`, `pressure`, `gas`, `iaq`, `co2`, `frost`, `fire`, `smoke`.

Avant de conclure que la station est en service : antenne en place, BME688 vu sur le Grove, première ligne `meteo` cohérente, mot de passe changé, et au moins un répéteur ou un compagnon qui a le canal **#germacrise_publique** sans clé, ainsi que les régions `fr-42` et `fr-ara`. Le décodage de la trame `0xFF42` se vérifie sur ce poste.

<!-- appli-web -->

## Appli web

Le client web de la station est le dossier `web/` de ce dépôt, dès que sa branche est réunie à `main`. Les scripts sont détaillés dans [web/README.md](web/README.md). Le dialogue entre le navigateur et la carte est décrit dans [docs/lien-local.md](docs/lien-local.md). Ce bloc est celui que le travail sur l’appli met à jour.

L’interface est en français.

| Page | Rôle |
| --- | --- |
| Météo | Température, humidité, pression, gaz, IAQ, eCO2, batterie, point de rosée, ressenti, indices gel/verglas et incendie |
| Connexions | USB, Bluetooth, HTTP, ou une démonstration sans radio |
| Réglages | Nom du canal, sans clé, région par défaut, onglet Configuration pour les bandes et les indices |

Réglage d’usine du canal dans l’appli : **#germacrise_publique**, sans clé, région **fr-ara**.

```bash
cd web
npm install
npm test
npm run dev
```

Ouvrir http://127.0.0.1:5173 dans Chrome. L’USB et le Bluetooth demandent une page en contexte sécurisé. Sans carte : page Connexions, bouton « Démonstration ». Pour l’essai HTTP, lancer `npm run mock` dans un second terminal, puis ouvrir `http://127.0.0.1:5174`.

<!-- /appli-web -->
