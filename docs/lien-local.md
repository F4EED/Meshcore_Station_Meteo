# Lien local — Meshcore_Station_Meteo

## Topologie (2026-11-04)

Le pager envoie `mto_now` **par radio**. Le poste branché au navigateur est un **compagnon** MeshCore (USB, souvent Espressif `0x303A`). Ce n’est pas la station. La station répond sur **#germacrisepublic**, flood **`fr-42`**, vers tous les compagnons qui ont ce canal : un `GRP_DATA` de type `0xFF42` (LPP) et un texte de mesure (`GRP_TXT`). Le nom du canal est figé : **#germacrisepublic**. Ouvrir la session **ne renomme pas** les emplacements déjà écrits sur le compagnon.

Décidé le **2 novembre 2026**. USB, Bluetooth et HTTP portent **les mêmes charges utiles**. Seul l’emballage change. Le client ne reprend pas le `wantConfigId` 69420 de Meshtastic.

## Transports

| Lien | Emballage | Détail |
| --- | --- | --- |
| USB série | hôte → carte `3C len_lo len_hi payload` ; carte → hôte `3E len_lo len_hi payload` | 115200 bauds. Longueur utile sur 16 bits, petit-boutiste. Charge utile max 512 octets côté client. Si le port disparaît, le client le ferme. Le choix Chrome (`requestPort`) ne filtre pas seulement Seeed `0x2886` : il inclut Espressif `0x303A` (compagnon USB JTAG, PID `0x1001`), Silicon Labs `0x10C4`, WCH `0x1A86`, FTDI `0x0403`, Adafruit `0x239A`, Raspberry Pi `0x2E8A` et Nordic `0x1915`. |
| Bluetooth LE | une écriture ou notification GATT = une charge utile, **sans** `3C`/`3E` | Service Nordic UART `6e400001-b5a3-f393-e0a9-e50e24dcca9e`. RX (hôte → carte) `6e400002-b5a3-f393-e0a9-e50e24dcca9e`. TX `6e400003-b5a3-f393-e0a9-e50e24dcca9e`. Écriture avec réponse, sinon sans réponse. `CMD_SET_CHANNEL` fait 50 octets : le MTU doit suivre. |
| HTTP | `POST {base}/api/v1/frame` | Corps JSON `{ "payload": "<base64 de la charge utile, sans 3C>" }`. Réponse `{ "frames": ["<base64>", ...] }`. Une erreur de protocole reste un HTTP 200 qui contient une trame `0x01`. HTTP 400 si le JSON est illisible. `GET {base}/api/v1/health` répond `{ "ok": true }`. |
| TCP compagnon (port souvent 5000) | même emballage que l’USB | Le navigateur ne peut pas ouvrir ce TCP. Un pont doit exposer le HTTP ci-dessus. |

Une commande à la fois. Délai 5 s. Les poussées `0x80`, `0x82`, `0x83` et `0x88` sont ignorées en attendant la réponse. Entiers multi-octets en petit-boutiste, sauf CayenneLPP (gros-boutiste).

## Ouverture de session

Le client envoie, dans l’ordre :

1. `CMD_APP_START` (`0x01`) — 7 octets réservés à zéro, puis le nom UTF-8 `stmeteo-web`. Réponse `PACKET_SELF_INFO` (`0x05`).
2. `CMD_DEVICE_QUERY` (`0x16`, `0x0B`) — version visée 11. Réponse `PACKET_DEVICE_INFO` (`0x0D`).
3. `CMD_SET_DEVICE_TIME` (`0x06` + uint32 heure Unix). Refus si l’heure est avant 2020-01-01 (`1577836800`).
4. `CMD_GET_CHANNEL` (`0x1F` + index) pour les emplacements `0 .. min(max_channels, 8) - 1`.
5. `CMD_GET_CUSTOM_VARS` (`0x28`) — lit la variable `region`.
6. `CMD_GET_DEFAULT_FLOOD_SCOPE` (`0x40`) — ignoré si le firmware répond une erreur.
7. Mesure, selon le type d’annonce (octet 1 de `PACKET_SELF_INFO`) :
   - **capteur** (type 4, la station elle-même sur ce lien) : `0x70`, sinon repli LPP local (plus bas) ;
   - **compagnon** (tout autre type, le nœud USB du PC) : **pas** de `0x27`. Quatre octets `0x27 00 00 00` sont la télémétrie **du compagnon** (température du micro, souvent autour de 39 °C, reste vide, batterie 0). Ce n’est pas `mto_now`. Le client vide la file avec `CMD_SYNC_NEXT_MESSAGE` (`0x0A`) et n’affiche que le `GRP_DATA` `0xFF42` ou le texte de mesure de la station.
8. Bandes : `0x71` pour les identifiants 0 à 7. Si la première échoue, les seuils restent locaux. Un compagnon qui ne connaît pas `0x71` ne bloque pas l’écoute radio.

Pas de dump de contacts. Les poussées `≥ 0x80` (y compris `0x83`, messages en attente) ne font pas échouer la commande en cours. Après `0x83`, le client rappelle `0x0A` jusqu’à `PACKET_NO_MORE_MSGS` (`0x0A`). Il n’écrit pas un nouveau nom sur un emplacement déjà rempli.

`PACKET_SELF_INFO` : type d’annonce à l’octet 1 (capteur = 4), puissance TX, clé publique 32 octets, latitude/longitude, puis fréquence `MHz × 1000`, bande `kHz × 1000`, SF, CR, nom. Le client affiche fréquence, BW, SF et CR.

`PACKET_DEVICE_INFO` (firmware ≥ 3, trame ≥ 80 octets) : `max_channels` à l’octet 3, build 12 octets dès l’octet 8, modèle 40 octets dès l’octet 20, version 20 octets dès l’octet 60.

`PACKET_CHANNEL_INFO` (`0x12`, 50 octets) : index, nom 32 octets terminé par zéro, secret 16 octets.

`PACKET_CUSTOM_VARS` (`0x15`) : ASCII `nom:valeur` séparé par des virgules. Vide = un seul octet `0x15`.

`PACKET_DEFAULT_FLOOD_SCOPE` (`0x1C`) : 1 octet si aucun scope, sinon nom 31 octets + clé 16.

`PACKET_ERROR` (`0x01`) + code : 1 non géré, 2 introuvable, 3 file pleine, 4 mauvais état, 5 stockage, 6 argument refusé.

## Ce que l’utilisateur envoie

### Canal — `CMD_SET_CHANNEL` (`0x20`, 50 octets)

| Octet | Contenu |
| --- | --- |
| 0 | `0x20` |
| 1 | emplacement (usine **1**, pas 0) |
| 2–33 | nom UTF-8, complété par des zéros. Usine **#germacrisepublic** (figé, ne plus le renommer) |
| 34–49 | secret 16 octets. Usine : champ clé vide, le client envoie **seize octets à zéro** (hash `0x37`) |

Réponse `0x00`, ou `0x01`. Le client relit ensuite l’emplacement.

### Région — variable `region`, pas une clé inventée

`CMD_SET_CUSTOM_VAR` (`0x29`) + ASCII `region:fr-42` (sans zéro final).

Le firmware **doit** retenir ce nom. Flood d’usine **`fr-42`**. Canal **#germacrisepublic** sans clé. Le secret du canal **n’est pas** la clé de transport de la région. Cette commande n’est envoyée que si l’utilisateur enregistre la région : la connexion ne réécrit pas la région déjà en mémoire.

Clé de transport seulement si l’opérateur en colle une (32 hex) :

`CMD_SET_DEFAULT_FLOOD_SCOPE` (`0x3F`) : nom 31 octets terminé par zéro, puis 16 octets de clé. Sans clé, cette commande n’est pas envoyée.

### Profil radio — bouton « Appliquer le profil »

`CMD_SET_RADIO_PARAMS` (`0x0B`, 12 octets) :

| Champ | Valeur |
| --- | --- |
| fréquence uint32 | `869618` (869,618 MHz × 1000) |
| bande uint32 | `62500` (62,5 kHz × 1000) |
| SF | 8 |
| CR | 8 |
| repeat | **0** (la station n’est pas un répéteur) |

PIRE sous 27 dBm : contrainte du firmware, le client n’envoie pas une puissance. Après l’accusé, le client renvoie `CMD_APP_START` pour relire la fréquence.

## Mesures vues par un compagnon

`mto_now` n’est pas une sonde du nœud USB. C’est la réponse radio de la station, flood **`fr-42`**, canal **#germacrisepublic**, lue par chaque compagnon qui a le secret vide.

Le client récupère la file avec `0x0A`. Trois réponses utiles :

| Code | Contenu |
| --- | --- |
| `0x1B` | `PACKET_CHANNEL_DATA_RECV`. Octet 1 SNR×4, 2 octets réservés, index de canal, longueur de chemin, `data_type` uint16 petit-boutiste, longueur, puis charge. On ne garde que `data_type` **`0xFF42`**. La charge est du CayenneLPP **×1** sur le type 100 (pas ÷100). |
| `0x11` / `0x08` | Texte de canal, version 3 ou ancienne. Le corps suit `F4EED-Meteo: …`. On garde cette ligne. Un écho `mto_now` sans mesures est ignoré. |
| `0x0A` | Plus de message. On s’arrête. La dernière mesure affichée reste en place. |

Le `GRP_TXT` (firmware `135d901`) est une ligne courte, dixièmes pour T, HR, P, rosée et ressenti, entiers pour les indices. Le gaz, l’IAQ, l’eCO2 et la batterie ne sont pas dans ce texte : ils sont dans le `0xFF42`.

```text
F4EED-Meteo: T 15.0 HR 55.0 P 1013.2 rosée 6.0 ressenti 14.1 gel 0 feu 2 fumée 0
```

Libellés lus : `T`, `HR`, `P`, `rosée`, `ressenti`, `gel`, `feu`, `fumée`.

Carte LPP `0xFF42` (et télémétrie sensor de la station). Le type 100 est un entier brut. L’humidité tient sur un octet.

| Canal | Type | Grandeur |
| --- | --- | --- |
| 1 | 116, 136 s’il y a un fix | batterie, position. La température de ce canal est celle du micro : elle n’est pas l’air |
| 2 | 103, 104, 115, 100, 125 | air, HR, pression, gaz en ohms, eCO2 ppm |
| 3 | 100 | IAQ 0–500 |
| 4, 5, 6 | 120 | gel, feu, fumée, 0–100 |
| 7 | 103 | point de rosée |
| 8 | 103 | température ressentie |

Le ressenti a un type LPP (103, canal 8) : il est affiché et, quand le client encode un LPP, il est écrit. Le point de rosée (canal 7), le gel (4) et le feu (5) aussi. La fumée part sur le canal 6. À l’écran, la valeur reçue prime sur le calcul local.

### Trame station `0x70` (lien direct capteur)

Requête : un octet `0x70`.

Réponse, 37 octets :

| Offset | Taille | Champ |
| --- | --- | --- |
| 0 | 1 | `0x70` |
| 1 | 1 | version = 1 |
| 2 | 2 | drapeaux uint16 |
| 4 | 4 | température °C, float32 |
| 8 | 4 | humidité % HR, float32 |
| 12 | 4 | pression hPa, float32 |
| 16 | 4 | gaz Ω, float32 |
| 20 | 4 | IAQ, float32 |
| 24 | 4 | eCO2 ppm, float32 |
| 28 | 2 | batterie mV, uint16 |
| 30 | 1 | cadence : 0 créneau, 1 hors plage, 2 choc |
| 31 | 2 | intervalle d’envoi, secondes |
| 33 | 4 | heure Unix |

Drapeaux : bit 0 température, 1 HR, 2 pression, 3 gaz, 4 IAQ, 5 eCO2, 6 batterie, 7 cadence. Un bit à 0 annule le champ, même si les octets ne sont pas nuls. Heure &lt; 2020 ignorée.

Si `0x70` répond `0x01` / code 1, le client continue sans erreur fatale.

### Repli LPP — seulement si le lien est la station

`CMD_SEND_TELEMETRY_REQ` (`0x27 00 00 00`, exactement 4 octets) demande la télémétrie **du nœud branché**. Sur un compagnon, c’est le micro du dongle, pas la station : le client **ne l’envoie pas**. Il ne l’envoie que si l’annonce est de type capteur (4), et seulement après un échec de `0x70`.

Réponse `0x8B`, octet réservé, 6 octets de préfixe de clé, puis CayenneLPP (gros-boutiste). Même carte que le `0xFF42` : type 100 **×1**, rosée canal 7, ressenti canal 8, indices canaux 4 à 6. La température du canal 1, sans humidité sur le canal 2, n’est pas l’air. L’altitude LPP est ignorée.

Sans eCO2 dans la trame mais avec un IAQ, le client affiche `400 + IAQ × 4` et le marque **estimé**.

`CMD_GET_BATT_AND_STORAGE` (`0x14`) complète la batterie si elle manque : `0x0C` + uint16 mV.

## Bandes — `0x71` / `0x72`

Huit bandes, dans cet ordre : température, humidité, pression, gaz, IAQ, eCO2, gel/verglas, incendie.

Chaque bande : `mean`, `low`, `high`, `veryLow`, `warnLow`, `warnHigh`, `veryHigh`, float32. Un seuil absent est le NaN canonique `0x7FC00000` (petit-boutiste).

Usine (vide = seuil absent) :

| Grandeur | mean | low | high | veryLow | warnLow | warnHigh | veryHigh |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Température °C | 15 | −10 | 40 | −20 | 0 | 35 | 45 |
| Humidité % | 55 | 20 | 90 | | 30 | 80 | |
| Pression hPa | 1013 | 980 | 1040 | | | | |
| Gaz Ω | 50000 | 5000 | 10000000 | | | | |
| IAQ | 50 | | 150 | | | | 200 |
| eCO2 ppm | 600 | 400 | 1500 | | | | |
| Gel / verglas | 0 | 0 | 40 | | | 25 | 60 |
| Incendie | 0 | 0 | 50 | | | 35 | 70 |

Lecture : `0x71` + id (0–7). Réponse `0x71` + id + 28 octets. Écriture : `0x72` + id + 28 octets, réponse `0x00`.

Pastilles : rouge sur `veryLow` / `veryHigh`, orange sur `warnLow` / `warnHigh`. Si l’alerte n’est pas définie, mini/maxi servent d’orange. Température, humidité et pression des deux côtés. IAQ, eCO2, gaz, gel et feu : seul le haut est pire (une valeur basse de gaz n’allume pas la pastille).

La cadence radio (choc 300 s, hors `[low, high]` 3600 s, sinon créneau 06:00 / 12:00 / 18:00) reste celle des **six** grandeurs STMET. Gel et feu sont persistés pour l’affichage ; le firmware peut les ignorer pour l’intervalle d’envoi.

## Indices affichés

La page Météo montre le point de rosée, le ressenti, le gel et le feu. Si la trame les porte (LPP ou texte), ce sont **ces** nombres. Sinon le client calcule les mêmes formules que la station.

Point de rosée Magnus–Tetens, `a = 17,62`, `b = 243,12` :

```
γ = ln(HR/100) + a·T / (b+T)
Td = b·γ / (a−γ)
```

Ressenti : si T ≥ 27 °C, indice de chaleur NWS ; sinon Steadman vent nul, `T + 0,33·e − 4`, avec `e = HR/100 · 6,105 · exp(17,27·T / (237,7+T))` en hPa. 15 °C et 55 % donnent environ 14,1 °C. Le LPP le porte (canal 8, type 103) : il est donc aussi encodé quand le client écrit un LPP.

Gel / verglas, 0–100, le plus haut des deux termes, arrondi :

- gel : `spread = max(0, T − Td)`, `sat = borne((3 − spread) / 3)`, `froid = borne((3 − T) / 3)`, produit des deux
- verglas : `borne((2 − |T|) / 2) × borne((HR − 90) / 10)`
- libellé « gel » ou « verglas » seulement si le score ≥ 20, sinon « aucun »
- repères : −1 °C / 95 % → 77 ; 0 °C / 100 % → 100 ; 15 °C / 55 % → 0 ; 1 °C / 98 % → 60

Feu, pas un IFM : Ångström `A = HR/20 + (27 − T)/10`, score `borne((4 − A) / 2 × 100)`. 15 °C / 55 % → 2.

Fumée : `borne((IAQ − 100) / 200 × 100)`, canal LPP 6. Le bandeau « fumée éventuelle » s’allume aussi si l’IAQ atteint `veryHigh` (usine 200) ou si le gaz passe sous `low` ohms (usine 5 000) : un gaz bas veut dire que le capteur MOS voit des volatils. Ce n’est pas le sens de la pastille STMET du gaz.

## Simulateur

`web/` contient le même comportement dans `src/link/firmware-sim.ts`. `npm run mock` l’expose en HTTP sur le port 5174. La démonstration du navigateur l’utilise sans réseau. Ce n’est pas le firmware de la carte : c’est la référence du dialogue.
