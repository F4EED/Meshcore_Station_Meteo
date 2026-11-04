#pragma once

// Constantes de la station. Le firmware MeshCore (pin documenté dans le README)
// reste la pile radio ; ce fichier ne dépend pas d'Arduino.

#include <stdint.h>

// MeshCore 1.18.0, examples/simple_sensor. TELEM_CHANNEL_SELF vaut 1.
// Le BME688 est le premier capteur d'environnement : canal suivant.
static constexpr uint8_t kLppChNode = 1;
static constexpr uint8_t kLppChBme = 2;
static constexpr uint8_t kLppChIaq = 3;
static constexpr uint8_t kLppChFrost = 4;
static constexpr uint8_t kLppChFire = 5;
static constexpr uint8_t kLppChSmoke = 6;
static constexpr uint8_t kLppChDew = 7;
static constexpr uint8_t kLppChFeels = 8;

// Cayenne LPP 1.6.1 (mêmes numéros que la bibliothèque liée par MeshCore).
static constexpr uint8_t kLppTemperature = 103;
static constexpr uint8_t kLppHumidity = 104;
static constexpr uint8_t kLppPressure = 115;
static constexpr uint8_t kLppVoltage = 116;
static constexpr uint8_t kLppGeneric = 100;
static constexpr uint8_t kLppConcentration = 125;
static constexpr uint8_t kLppPercentage = 120;
static constexpr uint8_t kLppAltitude = 121;
static constexpr uint8_t kLppGps = 136;

// Groupe binaire, plage de développement MeshCore (FF00–FFFF).
// Charge utile = LPP Cayenne. mto_now ajoute aussi un GRP_TXT de mesure.
static constexpr uint16_t kStmetDataType = 0xFF42;

// Nom exact, figé. Minuscules, sans underscore, sans autre casse.
// Canal public : secret MeshCore de 16 octets à zéro. Le nom n'entre pas
// dans le hash : SHA-256 de ces 16 zéros commence par 0x37, comme tout
// canal sans clé. MeshCore n'émet que ce premier octet.
static constexpr char kChannelName[] = "#germacrisepublic";
static constexpr uint8_t kPublicChannelHash = 0x37;

// Région du nœud et portée du flood météo / mto_now. Plus fr-ara pour ce flux.
static constexpr char kRegionNode[] = "fr-42";
static constexpr char kRegionFlood[] = "fr-42";
static constexpr char kRegionParent[] = "fr";
static constexpr char kMtoNow[] = "mto_now";

// Nom du projet. L'image s'annonce ainsi à la commande ver.
// Le nœud sur l'air reste kNodeName.
static constexpr char kProjectName[] = "Meshcore_Station_Meteo";
static constexpr char kFirmwareVersion[] = "Meshcore_Station_Meteo-0.0.1";

static constexpr char kNodeName[] = "F4EED-Meteo";

// 1er janvier 2024 UTC. En dessous, l'horloge n'est pas utilisable pour les créneaux.
static constexpr uint32_t kMinValidUnix = 1704067200u;

static constexpr uint32_t kSlotFloorS = 60;
static constexpr uint32_t kShockIntervalS = 300;
static constexpr uint32_t kOutOfRangeIntervalS = 3600;
static constexpr uint32_t kNoClockIntervalS = 21600;
static constexpr int kSlotHours[3] = {6, 12, 18};

static constexpr float kShockTempC = 3.f;
static constexpr float kShockRh = 15.f;
static constexpr float kShockPressureHpa = 5.f;
static constexpr float kShockGasRel = 0.30f;
static constexpr float kShockIaq = 50.f;
static constexpr float kShockEco2Ppm = 200.f;
static constexpr float kShockIndex = 25.f;

static constexpr uint32_t kGpsChaseMs = 8u * 60u * 1000u;
static constexpr uint32_t kSamplePeriodS = 60;
