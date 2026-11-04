#pragma once

// Texte de mesure pour le GRP_TXT, et reconnaissance de mto_now.
// Pas de printf flottant : le nRF en newlib-nano n'a pas %f.

#include "DerivedIndices.h"
#include "StationConfig.h"

#include <stdio.h>
#include <string.h>

inline bool isCmdChar(char c) {
  return (c >= '0' && c <= '9') || (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_';
}

inline bool containsCommand(const char* text, const char* cmd) {
  if (text == nullptr || cmd == nullptr || cmd[0] == 0) {
    return false;
  }
  size_t n = strlen(cmd);
  for (const char* p = text; *p != 0; ++p) {
    if (strncmp(p, cmd, n) != 0) {
      continue;
    }
    bool left = p == text || !isCmdChar(p[-1]);
    bool right = !isCmdChar(p[n]);
    if (left && right) {
      return true;
    }
  }
  return false;
}

inline int appendSep(char* dest, int cap, int used) {
  if (used < 0 || used >= cap - 1) {
    return -1;
  }
  if (used > 0) {
    dest[used++] = ' ';
    dest[used] = 0;
  }
  return used;
}

inline int appendTenths(char* dest, int cap, int used, const char* label, float value) {
  used = appendSep(dest, cap, used);
  if (used < 0) {
    return -1;
  }
  int scaled = static_cast<int>(lroundf(value * 10.0f));
  int neg = scaled < 0;
  if (neg) {
    scaled = -scaled;
  }
  int whole = scaled / 10;
  int frac = scaled % 10;
  int n = snprintf(dest + used, static_cast<size_t>(cap - used), "%s%s%d.%d", label, neg ? "-" : "", whole, frac);
  if (n < 0 || used + n >= cap) {
    return -1;
  }
  return used + n;
}

inline int appendInt(char* dest, int cap, int used, const char* label, int value) {
  used = appendSep(dest, cap, used);
  if (used < 0) {
    return -1;
  }
  int n = snprintf(dest + used, static_cast<size_t>(cap - used), "%s%d", label, value);
  if (n < 0 || used + n >= cap) {
    return -1;
  }
  return used + n;
}

// Ligne courte : grandeurs présentes, dont rosée, ressenti et indices.
inline int formatMeteoLine(const WeatherSample& sample, char* dest, int cap) {
  if (dest == nullptr || cap < 8) {
    return -1;
  }
  dest[0] = 0;
  int used = 0;
  if (sample.temp_c.present) {
    used = appendTenths(dest, cap, used, "T ", sample.temp_c.value);
  }
  if (sample.rh.present) {
    used = appendTenths(dest, cap, used, "HR ", sample.rh.value);
  }
  if (sample.pressure_hpa.present) {
    used = appendTenths(dest, cap, used, "P ", sample.pressure_hpa.value);
  }
  if (sample.dew_c.present) {
    used = appendTenths(dest, cap, used, "rosée ", sample.dew_c.value);
  }
  if (sample.feels_c.present) {
    used = appendTenths(dest, cap, used, "ressenti ", sample.feels_c.value);
  }
  if (sample.frost.present) {
    used = appendInt(dest, cap, used, "gel ", static_cast<int>(lroundf(sample.frost.value)));
  }
  if (sample.fire.present) {
    used = appendInt(dest, cap, used, "feu ", static_cast<int>(lroundf(sample.fire.value)));
  }
  if (sample.smoke.present) {
    used = appendInt(dest, cap, used, "fumée ", static_cast<int>(lroundf(sample.smoke.value)));
  }
  if (used <= 0) {
    return -1;
  }
  return used;
}
