#pragma once

#include "StationConfig.h"

#include <stdint.h>
#include <time.h>

struct CivilClock {
  int hour;
  int minute;
  int second;
  bool valid;
};

// Heure civile Europe/Paris (CET/CEST). À appeler après setenv("TZ", ...) / tzset().
inline CivilClock franceCivil(uint32_t unix_utc) {
  CivilClock c;
  c.hour = 0;
  c.minute = 0;
  c.second = 0;
  c.valid = false;
  if (unix_utc < kMinValidUnix) {
    return c;
  }
  time_t t = static_cast<time_t>(unix_utc);
  struct tm tm_local;
  if (localtime_r(&t, &tm_local) == 0) {
    return c;
  }
  c.hour = tm_local.tm_hour;
  c.minute = tm_local.tm_min;
  c.second = tm_local.tm_sec;
  c.valid = true;
  return c;
}

// Secondes jusqu'au prochain 06:00, 12:00 ou 18:00. À l'heure pile, le créneau suivant.
inline uint32_t secondsUntilNextSlot(int hour, int minute, int second) {
  const int now = hour * 3600 + minute * 60 + second;
  for (int i = 0; i < 3; ++i) {
    const int slot = kSlotHours[i] * 3600;
    if (slot > now) {
      return static_cast<uint32_t>(slot - now);
    }
  }
  return static_cast<uint32_t>((24 * 3600 - now) + kSlotHours[0] * 3600);
}
