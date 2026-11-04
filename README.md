# Meshcore_Station_Meteo

**Meshcore_Station_Meteo** est la station météo de F4EED pour le réseau **MeshCore** en France. Une carte mesure l’air là où elle est installée, puis envoie ces mesures sur le maillage. Le dépôt est [F4EED/Meshcore_Station_Meteo](https://github.com/F4EED/Meshcore_Station_Meteo), licence MIT.

Elle publie des mesures. Les pages qui suivent disent le matériel, le réglage radio, le rythme d’envoi, les indices calculés sur place, et la façon de compiler puis de flasher.

## But

Le nœud reste dehors, sans écran et sans lien vers un service météo en ligne. Il lit le BME688, il garde la radio en écoute, et il parle quand la mesure le justifie :

- aux heures calmes, trois fois dans la journée ;
- plus souvent si une valeur sort des seuils ;
- encore plus souvent si la météo change d’un coup.

Les autres postes MeshCore qui ont le canal **#germacrisepublic** peuvent lire ces trames. Le nom est figé : minuscules, sans underscore. Le rôle de la carte est un **capteur** (type de contact MeshCore `sensor`, valeur 4). Un pager qui envoie `mto_now` sur ce canal déclenche un flood vers tous les compagnons qui l’ont. Elle ne relaie pas le trafic des voisins : ce travail reste aux répéteurs.

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

Le projet s’appelle **Meshcore_Station_Meteo**. L’image firmware s’annonce `Meshcore_Station_Meteo-0.0.1` (commande `ver`). Le nom du nœud sur le réseau reste `F4EED-Meteo`. Le mot de passe d’administration compilé dans l’image est `meteo`. À changer dès la première console, avec la commande `password` suivie du nouveau mot de passe.

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
| CAD | coupé | Forcé à chaque démarrage. L’émission n’attend pas un canal libre |

Le facteur d’airtime correspondant au duty cycle de 10 % est 9 (`set dutycycle 10`). Un envoi planifié attend si le budget local est trop court pour le `GRP_DATA`. `mto_now` est mis en file dans tous les cas ; le répartiteur radio applique ensuite le temps d’air réel.

## Canal #germacrisepublic et région fr-42

Deux choses différentes circulent sur la même radio.

**Le canal** dit qui affiche la mesure. Il s’appelle **#germacrisepublic**, tout en minuscules, sans underscore. Ce nom ne change pas. C’est un canal **hashtag** MeshCore : le T-LoRa Pager calcule la clé dès que le nom commence par `#`, et il ne laisse pas la remplacer. La station utilise le même calcul.

Algorithme (protocole compagnon MeshCore, le vecteur `#test` donne `9cd8fcf22a47333b591d96a2b848b73f`) : SHA-256 du nom entier, dièse compris, puis les **16 premiers octets**. Pour `#germacrisepublic` :

- secret : `81f937fdec56c4005a9f78c05f723d05`
- hash d’air : `0x81` (premier octet du SHA-256 de ces 16 octets)

Les 16 octets de queue du tampon secret restent à zéro. Le MAC porte sur les 32 octets, l’AES sur les 16 de tête. Le canal Public d’usine du pager (`8b3387e9c5cdea6ac9e5edbaa115cd72`, hash `0x11`) est un autre salon. Seize octets à zéro donneraient le hash `0x37`, que cette station n’écoute plus.

### Canal sur le T-LoRa Pager

D’après le [guide T-Pager](https://files.liamcottle.net/MeshCore/Documentation/Ripple/T-Pager%20User%20Guide.pdf) (UI v10) :

1. Profil réseau, emplacement **Channel** libre (le Public du premier slot reste à part).
2. Appui long sur **ENTER**, **Enable**.
3. Menu **type #**, puis `germacrisepublic`. Le pager pose la clé hashtag.
4. Laisser cette clé. **ENTER** pour enregistrer.
5. **Regions** → **Add New** → `fr-42` si elle manque. Dans le salon, **Set Scope** → `fr-42`.

Un compagnon USB se règle avec le même nom et le secret hex ci-dessus. Après reflash, COM25 doit montrer `ecoute #germacrisepublic h81 fr-42 …` et, sur `mto_now`, `RX txt h81`.

**La région** dit jusqu’où le réseau accepte de relayer. Les envois planifiés (créneaux 06:00, 12:00, 18:00, choc, hors plage) partent en flood **`fr-42`** (Loire). C’est aussi la région du nœud, la région par défaut et la région « home ».

`fr-42` est un enfant de `fr`, elle-même sous `europe` et `eu`. Un répéteur qui ne connaît que `fr` ne relaie pas un flood étiqueté `fr-42`. Il faut lui charger ce nom, sinon les mesures planifiées s’arrêtent au premier saut.

La clé de transport de `fr-42` est le début du SHA-256 de `#fr-42`. Celle de `fr` est le début du SHA-256 de `#fr`. Le secret hashtag du canal est un autre calcul : il ne sert pas de clé de transport.

La station accepte les floods `fr-42`, `fr` et sans étiquette de transport : elle ne jette pas une demande parce que le code de région diffère. La réponse à `mto_now` part toujours en `fr-42`. Si la demande est arrivée en `fr`, ou sous une autre étiquette, une seconde copie part aussi sur `fr`. Si la demande n’avait pas de code de transport, cette seconde copie part sans étiquette. Une demande déjà en `fr-42`, un message direct ou la commande CLI restent sur `fr-42` seul.

À chaque démarrage, la carte recolle la radio sur EU868 Narrow (869,618 MHz, 62,5 kHz, SF 8, CR 8, 22 dBm), coupe le CAD, coupe le relais, et réautorise le flood sur `fr`, `fr-42` et le joker. Le fichier de réglages survit à la copie UF2 : une image précédente y laisse souvent le coding rate 5, et la station ne démodule plus le pager. Le marqueur `/stmet.seed` ne sert qu’une fois, pour le duty cycle, les annonces et `set repeat off`. Un `set freq` ou un `set cad on` saisi ensuite est recouvert au prochain démarrage.

## Ce qui est envoyé

La station parle en **CayenneLPP**, le format de télémétrie MeshCore. Les chemins portent les mêmes grandeurs, y compris la rosée, le ressenti et les indices :

1. la télémétrie du capteur, lue sur demande ou poussée vers un abonné ;
2. une trame de groupe `GRP_DATA` (`0x06`), type de donnée `0xFF42` (plage de développement MeshCore), secret de canal vide, flood de transport **`fr-42`**.

`0xFF42` se lit ainsi : un entier 16 bits petit-boutiste, un octet de longueur, puis les octets LPP.

Un `mto_now` reçu par radio déclenche ce flood. La station le reconnaît sur **#germacrisepublic** (GRP_TXT 1.18 `NomDuPager: mto_now`, ou texte collé au timestamp), en message direct, et en CLI. La lecture du BME se fait après le retour du callback radio. S’il y a une température ou une pression, le `GRP_DATA` part. Le `GRP_TXT` part dans tous les cas : la ligne de mesure, ou le texte `pas de mesure` tant qu’il n’y a pas d’échantillon. Le budget local ne retient pas cette réponse. Le duty cycle 10 % du répartiteur radio reste appliqué à l’antenne.

- un `GRP_TXT` (`0x05`), auteur `F4EED-Meteo`, avec la ligne de mesure (température, humidité, pression, rosée, ressenti, gel, feu, fumée), ou `pas de mesure` ;
- le `GRP_DATA` `0xFF42` ci-dessus, dès qu’un échantillon T ou P existe.

Le compagnon affiche le texte dans le canal. Le `GRP_DATA` arrive en plus au logiciel branché en USB (`0x1B`, type `0xFF42`, puis le LPP). Ce n’est pas un bulletin de prévision.

| Canal LPP | Contenu |
| --- | --- |
| 1 | Tension de la batterie. Position GPS seulement après un fix. La température de ce canal est celle du micro, pas l’air |
| 2 | Air en °C, humidité, pression en hPa, résistance du gaz en ohms, eCO2 estimé en ppm |
| 3 | Score IAQ de 0 à 500 |
| 4 | Indice gel / verglas, 0 à 100 |
| 5 | Indice feu météo, 0 à 100 |
| 6 | Indice fumée, 0 à 100 |
| 7 | Point de rosée en °C |
| 8 | Température ressentie en °C |

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

**Ressenti.** Sous 27 °C, formule de Steadman sans vent : `T + 0,33·e − 4`, avec `e = HR/100 · 6,105 · exp(17,27·T / (237,7+T))` en hPa. À partir de 27 °C, indice de chaleur NWS (Rothfusz), ramené en °C. À 15 °C et 55 %, il vaut environ 14,1 °C. Ce n’est pas une prévision.

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

L’image à copier sur la carte est dans le dépôt :

`firmware/releases/Meshcore_Station_Meteo-0.0.1.uf2`

SHA-256 : `3625698f6fc7303392c9c9ef04f362e7dfaf8924a3af28f6c7fb41dd1777b56f`

703 488 octets, départ `0x27000`. Flash 351 492 / 811 008 octets (43,3 %), RAM 31 984 / 235 520 (13,6 %). Cette image remplace `0034ba2fc7fcea191f4be5ecdfbb975a102594c0f2b8bb4d365225075310207c` : la carte qui écoute encore le hash `0x37` doit être reflashée. Le battement attendu est `ecoute #germacrisepublic h81`.

`build.sh` compile le `.hex`, le convertit en UF2 (famille nRF52840 `0xADA52840`, comme le `build.sh` de MeshCore) et régénère ce fichier. Avant `pio`, il copie `firmware/variant/fix_wire_timeout.py` : le script borne à 25 ms les attentes du maître I2C nRF52 (TWIM), pour qu’un Grove muet ne bloque plus `setup()`. Le fichier intermédiaire `build/MeshCore/.pio/build/WioTrackerL1_meteo/firmware.uf2` n’est pas versionné. L’image embarque la chaîne `Meshcore_Station_Meteo-0.0.1`.

Les dossiers `firmware/` et `scripts/` arrivent avec le firmware. Tant qu’ils ne sont pas sur `main`, ils sont dans la [pull request firmware](https://github.com/F4EED/Meshcore_Station_Meteo/pull/1), branche `cursor/station-meteo-firmware-c913`.

## Flasher

1. Prendre `firmware/releases/Meshcore_Station_Meteo-0.0.1.uf2`, ou le régénérer avec `./scripts/build.sh`.
2. Brancher le L1 Pro en USB.
3. **Deux appuis rapides** sur le bouton reset. Un volume UF2 apparaît (le chargeur de boot de la carte).
4. Copier `Meshcore_Station_Meteo-0.0.1.uf2` sur ce volume. La carte redémarre toute seule à la fin de la copie.
5. Ouvrir la console USB CDC. Sur le L1 Pro, c’est l’interface `VID_2886` / `PID_1667`, interface `MI_00` (COM25 sur le poste GMC-Poste-maitre). `Serial.begin(115200)` est l’appel du firmware : sur ce CDC, le débit demandé est ignoré, le port répond dès que l’application tourne. Les commandes se terminent par un retour chariot (`\r`). Il n’y a pas d’autre commande de journal.

La boucle écrit toutes les 10 s : `ecoute #germacrisepublic h81 fr-42 rx=… cr=8 cad=off`. Si le port est ouvert pendant le démarrage, on voit aussi `Meshcore_Station_Meteo`, `Meshcore_Station_Meteo-0.0.1`, `radio 869.618 bw 62.5 sf 8 cr 8`, `canal #germacrisepublic h81 cle 81F937FDEC56C4005A9F78C05F723D05`, `RX armee`, puis `capteurs prets`. Un port ouvert après le boot reste vide jusqu’à la ligne `ecoute` suivante.

`RX txt h81` : GRP_TXT du canal hashtag. `RX txt h37` : ancien secret à zéro, que cette image n’ouvre plus. `RX txt h11` : canal Public d’usine du pager. `ouvert` : flood sans code de transport. `mto_now scope N` puis `TX mto_now … o xN` : la réponse est en file. Scope `0` = `fr-42` seul, `1` = aussi `fr`, `2` = aussi sans étiquette, `3` = autre étiquette, copie aussi sur `fr`.

Un seul appui sur reset relance l’application. Deux appuis rapides, ou un contact à 1 200 bauds, ouvrent le chargeur UF2 (volume « TRACKER L1 »). La ligne DTR ne réinitialise pas le nRF52. Zéro octet après un retour chariot, y compris sur `help`, veut dire que `loop()` ne tourne pas.

Commandes utiles, en plus du CLI MeshCore habituel :

| Commande | Effet |
| --- | --- |
| `meteo` | Affiche la dernière mesure |
| `bands` | Affiche les seuils |
| `bands temp 15 -10 40 -20 0 35 45` | Remplace une bande (sept nombres : moyenne, low, high, veryLow, warnLow, warnHigh, veryHigh) |
| `tx` | Force un envoi, sous réserve du duty cycle |
| `password` suivi du nouveau mot | Remplace `meteo` |

Noms de bandes : `temp`, `humidity`, `pressure`, `gas`, `iaq`, `co2`, `frost`, `fire`, `smoke`.

Avant de conclure que la station est en service : antenne en place, BME688 vu sur le Grove, première ligne `meteo` cohérente, mot de passe changé, pager sur **#germacrisepublic** avec la clé hashtag laissée en place et le scope `fr-42`. Envoyer `mto_now` : COM25 doit montrer `RX txt h81`, et un compagnon réglé sur le secret `81f937fdec56c4005a9f78c05f723d05` doit montrer le texte et le LPP `0xFF42`.

<!-- appli-web -->

## Appli web

Le client web de la station est le dossier `web/` de ce dépôt, dès que sa branche est réunie à `main`. Les scripts sont détaillés dans [web/README.md](web/README.md). Le dialogue entre le navigateur et la carte est décrit dans [docs/lien-local.md](docs/lien-local.md). Ce bloc est celui que le travail sur l’appli met à jour.

L’interface est en français.

| Page | Rôle |
| --- | --- |
| Météo | Température, humidité, pression, gaz, IAQ, eCO2, batterie, point de rosée, ressenti, indices gel/verglas et incendie |
| Connexions | USB, Bluetooth, HTTP, ou une démonstration sans radio |
| Réglages | Nom du canal hashtag, secret dérivé du nom, région par défaut, onglet Configuration pour les bandes et les indices |

Réglage d’usine du canal dans l’appli : **#germacrisepublic**, secret hashtag `81f937fdec56c4005a9f78c05f723d05`, hash `0x81`, région **fr-42**. Le nom ne change pas.

```bash
cd web
npm install
npm test
npm run dev
```

Ouvrir http://127.0.0.1:5173 dans Chrome. L’USB et le Bluetooth demandent une page en contexte sécurisé. Sans carte : page Connexions, bouton « Démonstration ». Pour l’essai HTTP, lancer `npm run mock` dans un second terminal, puis ouvrir `http://127.0.0.1:5174`.

<!-- /appli-web -->
