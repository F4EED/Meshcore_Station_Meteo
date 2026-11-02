#pragma once

#include <math.h>

// Grandeurs calculées sur la mesure, pas une prévision.
// Rosée : Magnus–Tetens, coefficients Sonntag (a=17,62 b=243,12).
// Gel/verglas : un indice 0–100. Ce n'est pas un risque routier officiel.
// Feu : Angström inversé (T haute + HR basse) sur 0–100. Ce n'est pas un IFM.
// Fumée : IAQ déjà élevé. Ce n'est pas le risque qu'un feu parte.

struct Reading {
  bool present;
  float value;
};

inline Reading presentReading(float value) {
  Reading r;
  r.present = true;
  r.value = value;
  return r;
}

inline Reading absentReading() {
  Reading r;
  r.present = false;
  r.value = 0.0f;
  return r;
}

struct WeatherSample {
  Reading temp_c;
  Reading rh;
  Reading pressure_hpa;
  Reading gas_ohm;
  Reading iaq;
  Reading eco2_ppm;
  Reading dew_c;
  Reading frost;
  Reading fire;
  Reading smoke;
  Reading battery_v;
  bool has_position;
  float lat;
  float lon;
  float alt_m;
};

inline WeatherSample emptySample() {
  WeatherSample s;
  s.temp_c = absentReading();
  s.rh = absentReading();
  s.pressure_hpa = absentReading();
  s.gas_ohm = absentReading();
  s.iaq = absentReading();
  s.eco2_ppm = absentReading();
  s.dew_c = absentReading();
  s.frost = absentReading();
  s.fire = absentReading();
  s.smoke = absentReading();
  s.battery_v = absentReading();
  s.has_position = false;
  s.lat = 0.0f;
  s.lon = 0.0f;
  s.alt_m = 0.0f;
  return s;
}

inline int clampPercent(float value) {
  if (value < 0.0f) {
    return 0;
  }
  if (value > 100.0f) {
    return 100;
  }
  return static_cast<int>(lroundf(value));
}

inline bool dewPointC(float temp_c, float rh, float* dew_c) {
  if (!(isfinite(temp_c) && isfinite(rh)) || rh <= 0.0f || rh > 100.0f) {
    return false;
  }
  const float a = 17.62f;
  const float b = 243.12f;
  float gamma = logf(rh / 100.0f) + (a * temp_c) / (b + temp_c);
  float denom = a - gamma;
  if (denom == 0.0f) {
    return false;
  }
  *dew_c = (b * gamma) / denom;
  return isfinite(*dew_c);
}

// 100 quand l'air est à 0 °C ou en dessous et saturé, ou très humide autour de 0 °C.
inline int frostIndex(float temp_c, float rh) {
  float dew = 0.0f;
  if (!dewPointC(temp_c, rh, &dew)) {
    return 0;
  }
  float spread = temp_c - dew;
  if (spread < 0.0f) {
    spread = 0.0f;
  }
  float sat = (3.0f - spread) / 3.0f;
  if (sat < 0.0f) {
    sat = 0.0f;
  }
  if (sat > 1.0f) {
    sat = 1.0f;
  }
  float cold = (3.0f - temp_c) / 3.0f;
  if (cold < 0.0f) {
    cold = 0.0f;
  }
  if (cold > 1.0f) {
    cold = 1.0f;
  }
  float gel = cold * sat;

  float abs_t = temp_c < 0.0f ? -temp_c : temp_c;
  float near0 = (2.0f - abs_t) / 2.0f;
  if (near0 < 0.0f) {
    near0 = 0.0f;
  }
  if (near0 > 1.0f) {
    near0 = 1.0f;
  }
  float humid = (rh - 90.0f) / 10.0f;
  if (humid < 0.0f) {
    humid = 0.0f;
  }
  if (humid > 1.0f) {
    humid = 1.0f;
  }
  float ice = near0 * humid;
  float score = gel > ice ? gel : ice;
  return clampPercent(score * 100.0f);
}

// Angström A = HR/20 + (27−T)/10. A ≥ 4 → 0, A ≤ 2 → 100.
inline int fireWeatherIndex(float temp_c, float rh) {
  float a = rh / 20.0f + (27.0f - temp_c) / 10.0f;
  float score = (4.0f - a) / 2.0f * 100.0f;
  return clampPercent(score);
}

// 0 à IAQ 100, 100 à IAQ 300.
inline int smokeIndex(float iaq) {
  float score = (iaq - 100.0f) / 200.0f * 100.0f;
  return clampPercent(score);
}

inline void fillDerived(WeatherSample* s) {
  s->dew_c = absentReading();
  s->frost = absentReading();
  s->fire = absentReading();
  s->smoke = absentReading();
  s->eco2_ppm = absentReading();
  if (s->iaq.present) {
    uint16_t iaq = static_cast<uint16_t>(lroundf(s->iaq.value));
    s->eco2_ppm = presentReading(400.0f + static_cast<float>(iaq) * 4.0f);
    s->smoke = presentReading(static_cast<float>(smokeIndex(s->iaq.value)));
  }
  if (s->temp_c.present && s->rh.present) {
    float dew = 0.0f;
    if (dewPointC(s->temp_c.value, s->rh.value, &dew)) {
      s->dew_c = presentReading(dew);
    }
    s->frost = presentReading(static_cast<float>(frostIndex(s->temp_c.value, s->rh.value)));
    s->fire = presentReading(static_cast<float>(fireWeatherIndex(s->temp_c.value, s->rh.value)));
  }
}
