#pragma once

#include "CivilTime.h"
#include "DerivedIndices.h"
#include "StationBands.h"
#include "StationConfig.h"

#include <math.h>

// Priorité choc > hors plage > créneau. L'intervalle « normal » est le délai
// depuis le dernier envoi jusqu'au prochain créneau (plancher 60 s), pas un
// délai recalculé qui avancerait l'émission.

enum class TxMode : uint8_t { Normal = 0, OutOfRange = 1, Shock = 2 };

struct Cadence {
  TxMode mode;
  uint32_t interval_s;
};

inline bool deltaAtLeast(const Reading& prev, const Reading& now, float min_delta) {
  if (!prev.present || !now.present) {
    return false;
  }
  float d = now.value - prev.value;
  if (d < 0.0f) {
    d = -d;
  }
  return d >= min_delta;
}

inline bool gasShock(const Reading& prev, const Reading& now) {
  if (!prev.present || !now.present || !(prev.value > 0.0f)) {
    return false;
  }
  float d = now.value - prev.value;
  if (d < 0.0f) {
    d = -d;
  }
  return d / prev.value >= kShockGasRel;
}

inline bool sampleShock(const WeatherSample& prev, const WeatherSample& now) {
  return deltaAtLeast(prev.temp_c, now.temp_c, kShockTempC) || deltaAtLeast(prev.rh, now.rh, kShockRh) ||
         deltaAtLeast(prev.pressure_hpa, now.pressure_hpa, kShockPressureHpa) || gasShock(prev.gas_ohm, now.gas_ohm) ||
         deltaAtLeast(prev.iaq, now.iaq, kShockIaq) || deltaAtLeast(prev.eco2_ppm, now.eco2_ppm, kShockEco2Ppm) ||
         deltaAtLeast(prev.frost, now.frost, kShockIndex) || deltaAtLeast(prev.fire, now.fire, kShockIndex) ||
         deltaAtLeast(prev.smoke, now.smoke, kShockIndex);
}

inline bool readingOutside(const Reading& r, const Band& band) {
  return r.present && outsideBand(band, r.value);
}

inline bool sampleOutside(const WeatherSample& now, const StationBands& bands) {
  return readingOutside(now.temp_c, bandOf(bands, BandId::Temp)) ||
         readingOutside(now.rh, bandOf(bands, BandId::Humidity)) ||
         readingOutside(now.pressure_hpa, bandOf(bands, BandId::Pressure)) ||
         readingOutside(now.gas_ohm, bandOf(bands, BandId::Gas)) ||
         readingOutside(now.iaq, bandOf(bands, BandId::Iaq)) ||
         readingOutside(now.eco2_ppm, bandOf(bands, BandId::Co2)) ||
         readingOutside(now.frost, bandOf(bands, BandId::Frost)) ||
         readingOutside(now.fire, bandOf(bands, BandId::Fire)) ||
         readingOutside(now.smoke, bandOf(bands, BandId::Smoke));
}

inline uint32_t normalIntervalFrom(uint32_t last_tx_unix) {
  CivilClock civil = franceCivil(last_tx_unix);
  if (!civil.valid) {
    return kNoClockIntervalS;
  }
  uint32_t gap = secondsUntilNextSlot(civil.hour, civil.minute, civil.second);
  if (gap < kSlotFloorS) {
    gap = kSlotFloorS;
  }
  return gap;
}

inline Cadence evaluateCadence(const WeatherSample& now, bool have_prev, const WeatherSample& prev,
                               const StationBands& bands, uint32_t last_tx_unix) {
  Cadence c;
  c.mode = TxMode::Normal;
  c.interval_s = normalIntervalFrom(last_tx_unix);
  if (have_prev && sampleShock(prev, now)) {
    c.mode = TxMode::Shock;
    c.interval_s = kShockIntervalS;
    return c;
  }
  if (sampleOutside(now, bands)) {
    c.mode = TxMode::OutOfRange;
    c.interval_s = kOutOfRangeIntervalS;
  }
  return c;
}

inline bool txDue(bool ever_sent, uint32_t now_unix, uint32_t last_tx_unix, uint32_t interval_s) {
  if (!ever_sent) {
    return true;
  }
  return now_unix >= last_tx_unix + interval_s;
}
