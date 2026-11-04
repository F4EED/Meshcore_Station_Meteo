#pragma once

#include "StationConfig.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Bandes STMET Gaulix (mean / low / high / veryLow / warnLow / warnHigh / veryHigh).
// Hors plage = en dehors de [low, high]. Les autres bornes servent aux pastilles client.

struct Band {
  float mean;
  float low;
  float high;
  float very_low;
  float warn_low;
  float warn_high;
  float very_high;
};

enum class BandId : uint8_t {
  Temp = 0,
  Humidity,
  Pressure,
  Gas,
  Iaq,
  Co2,
  Frost,
  Fire,
  Smoke,
  Count
};

struct StationBands {
  Band band[static_cast<int>(BandId::Count)];
};

inline Band makeBand(float mean, float low, float high, float very_low, float warn_low, float warn_high,
                     float very_high) {
  Band b;
  b.mean = mean;
  b.low = low;
  b.high = high;
  b.very_low = very_low;
  b.warn_low = warn_low;
  b.warn_high = warn_high;
  b.very_high = very_high;
  return b;
}

inline const char* bandName(BandId id) {
  switch (id) {
    case BandId::Temp:
      return "temp";
    case BandId::Humidity:
      return "humidity";
    case BandId::Pressure:
      return "pressure";
    case BandId::Gas:
      return "gas";
    case BandId::Iaq:
      return "iaq";
    case BandId::Co2:
      return "co2";
    case BandId::Frost:
      return "frost";
    case BandId::Fire:
      return "fire";
    case BandId::Smoke:
      return "smoke";
    default:
      return "";
  }
}

inline bool bandFromName(const char* name, BandId* id) {
  for (int i = 0; i < static_cast<int>(BandId::Count); ++i) {
    BandId candidate = static_cast<BandId>(i);
    if (strcmp(name, bandName(candidate)) == 0) {
      *id = candidate;
      return true;
    }
  }
  return false;
}

inline StationBands defaultBands() {
  StationBands s;
  // Chiffres du firmware Gaulix 0.1.2 (y compris les bornes d'affichage).
  s.band[static_cast<int>(BandId::Temp)] = makeBand(15.f, -10.f, 40.f, -20.f, 0.f, 35.f, 45.f);
  s.band[static_cast<int>(BandId::Humidity)] = makeBand(55.f, 20.f, 90.f, 10.f, 30.f, 80.f, 95.f);
  s.band[static_cast<int>(BandId::Pressure)] = makeBand(1013.f, 980.f, 1040.f, 960.f, 990.f, 1030.f, 1050.f);
  s.band[static_cast<int>(BandId::Gas)] = makeBand(50000.f, 5000.f, 1.0e7f, 1000.f, 10000.f, 5.0e6f, 2.0e7f);
  s.band[static_cast<int>(BandId::Iaq)] = makeBand(50.f, 0.f, 150.f, 0.f, 25.f, 100.f, 200.f);
  s.band[static_cast<int>(BandId::Co2)] = makeBand(600.f, 400.f, 1500.f, 350.f, 500.f, 1000.f, 2000.f);
  // Indices 0–100 : au-dessus de high, la cadence passe en hors plage.
  s.band[static_cast<int>(BandId::Frost)] = makeBand(0.f, 0.f, 40.f, 0.f, 0.f, 25.f, 70.f);
  s.band[static_cast<int>(BandId::Fire)] = makeBand(0.f, 0.f, 40.f, 0.f, 0.f, 25.f, 70.f);
  s.band[static_cast<int>(BandId::Smoke)] = makeBand(0.f, 0.f, 40.f, 0.f, 0.f, 25.f, 70.f);
  return s;
}

inline const Band& bandOf(const StationBands& s, BandId id) {
  return s.band[static_cast<int>(id)];
}

inline bool outsideBand(const Band& b, float value) {
  return value < b.low || value > b.high;
}

// Une ligne « nom mean low high veryLow warnLow warnHigh veryHigh ».
// Renvoie false si la ligne n'est pas une bande (commentaire, vide, ou invalide).
inline bool parseBandLine(const char* line, StationBands* bands) {
  while (*line == ' ' || *line == '\t') {
    ++line;
  }
  if (*line == '\0' || *line == '#' || *line == '\n' || *line == '\r') {
    return true;
  }
  char name[16];
  float v[7];
  int n = sscanf(line, "%15s %f %f %f %f %f %f %f", name, &v[0], &v[1], &v[2], &v[3], &v[4], &v[5], &v[6]);
  if (n == 0) {
    return true;
  }
  if (n != 8) {
    return false;
  }
  BandId id;
  if (!bandFromName(name, &id)) {
    return false;
  }
  bands->band[static_cast<int>(id)] = makeBand(v[0], v[1], v[2], v[3], v[4], v[5], v[6]);
  return true;
}

inline int formatBands(const StationBands& bands, char* dest, int dest_len) {
  int used = 0;
  for (int i = 0; i < static_cast<int>(BandId::Count); ++i) {
    const Band& b = bands.band[i];
    int n = snprintf(dest + used, dest_len > used ? static_cast<size_t>(dest_len - used) : 0,
                     "%s %.9g %.9g %.9g %.9g %.9g %.9g %.9g\n", bandName(static_cast<BandId>(i)), b.mean, b.low,
                     b.high, b.very_low, b.warn_low, b.warn_high, b.very_high);
    if (n < 0) {
      return -1;
    }
    used += n;
  }
  return used;
}
