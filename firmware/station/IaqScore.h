#pragma once

#include <math.h>
#include <stdint.h>

// Score IAQ 0–500 à partir de la résistance gaz du BME688 et de l'humidité.
// Pas BSEC. eCO2 estimé = 400 + IAQ × 4, calculé par l'appelant.
// Les trois premiers échantillons valides sont écartés (chauffe).

class GasIaqScore {
 public:
  static constexpr float kKh = 0.035f;
  static constexpr float kAlphaUp = 0.25f;
  static constexpr float kAlphaDown = 1.0f / 720.0f;
  static constexpr float kLnFloor = 8.517193f;
  static constexpr float kLnCeilMax = 18.4f;
  static constexpr float kLnRange = 2.7080502f;
  static constexpr float kHumWeight = 0.15f;
  static constexpr float kRhRef = 40.0f;
  static constexpr float kRhComfortMin = 30.0f;
  static constexpr float kRhComfortMax = 60.0f;
  static constexpr float kRhDevNorm = 40.0f;
  static constexpr uint32_t kWarmupDiscard = 3;

  // Écrit *iaq_out (0–500) et renvoie true une fois la chauffe passée.
  bool update(float gas_ohms, float relative_humidity, uint16_t* iaq_out) {
    if (!(isfinite(gas_ohms) && gas_ohms > 0.0f)) {
      return false;
    }
    float rh = isfinite(relative_humidity) ? clamp(relative_humidity, 0.0f, 100.0f) : kRhRef;
    if (warmup_left_ > 0) {
      --warmup_left_;
      return false;
    }

    float x = logf(gas_ohms) + kKh * (rh - kRhRef);
    x = clamp(x, kLnFloor - kLnRange, kLnCeilMax);
    if (!seeded_) {
      ceiling_ = clamp(x, kLnFloor, kLnCeilMax);
      seeded_ = true;
    } else {
      float alpha = (x > ceiling_) ? kAlphaUp : kAlphaDown;
      ceiling_ = clamp(ceiling_ + alpha * (x - ceiling_), kLnFloor, kLnCeilMax);
    }

    float below = ceiling_ - x;
    if (below < 0.0f) {
      below = 0.0f;
    }
    float gas_score = clamp(below / kLnRange, 0.0f, 1.0f) * 500.0f;
    float hum_dev = 0.0f;
    if (rh < kRhComfortMin) {
      hum_dev = kRhComfortMin - rh;
    } else if (rh > kRhComfortMax) {
      hum_dev = rh - kRhComfortMax;
    }
    float hum_score = clamp(hum_dev / kRhDevNorm, 0.0f, 1.0f) * 500.0f;
    float mixed = clamp(gas_score + kHumWeight * hum_score, 0.0f, 500.0f);
    *iaq_out = static_cast<uint16_t>(lroundf(mixed));
    return true;
  }

  uint32_t warmupLeft() const { return warmup_left_; }

 private:
  static float clamp(float v, float lo, float hi) {
    if (v < lo) {
      return lo;
    }
    if (v > hi) {
      return hi;
    }
    return v;
  }

  float ceiling_ = 0.0f;
  uint32_t warmup_left_ = kWarmupDiscard;
  bool seeded_ = false;
};

inline float estimatedEco2Ppm(uint16_t iaq) {
  return 400.0f + static_cast<float>(iaq) * 4.0f;
}
