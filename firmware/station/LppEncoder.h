#pragma once

#include "StationConfig.h"

#include <stddef.h>
#include <stdint.h>

// Encodeur Cayenne LPP 1.6.1 (octets de donnée, pas l'en-tête MeshCore).
// L'humidité tient sur 1 octet (×2). Le helper MeshCore LPPData annonce 2 octets :
// les trames émises ici suivent la bibliothèque, pas ce helper.

inline int lppDataSize(uint8_t type) {
  switch (type) {
    case 0:
    case 1:
    case 102:
    case kLppHumidity:
    case kLppPercentage:
    case 142:
      return 1;
    case 2:
    case 3:
    case 101:
    case kLppTemperature:
    case kLppPressure:
    case kLppVoltage:
    case 117:
    case kLppAltitude:
    case 128:
    case 132:
    case kLppConcentration:
      return 2;
    case kLppGeneric:
    case 118:
    case 133:
      return 4;
    case kLppGps:
      return 9;
    case 113:
    case 134:
      return 6;
    case 135:
      return 3;
    default:
      return -1;
  }
}

inline uint32_t lppMultiplier(uint8_t type) {
  switch (type) {
    case kLppTemperature:
    case kLppPressure:
      return 10;
    case kLppHumidity:
      return 2;
    case kLppVoltage:
    case 2:
    case 3:
      return 100;
    case 117:
      return 1000;
    default:
      return 1;
  }
}

inline bool lppIsSigned(uint8_t type) {
  switch (type) {
    case 2:
    case 3:
    case kLppTemperature:
    case kLppAltitude:
      return true;
    default:
      return false;
  }
}

inline float lppDecode(const uint8_t* raw, int size, uint32_t mult, bool is_signed) {
  uint32_t v = 0;
  for (int i = 0; i < size; ++i) {
    v = (v << 8) | raw[i];
  }
  if (mult == 0) {
    return 0.0f;
  }
  if (is_signed && size < 4) {
    uint32_t sign = 1u << (size * 8 - 1);
    if (v & sign) {
      uint32_t mask = (1u << (size * 8)) - 1u;
      int32_t sv = static_cast<int32_t>(v | ~mask);
      return static_cast<float>(sv) / static_cast<float>(mult);
    }
  }
  if (is_signed && size == 4) {
    return static_cast<float>(static_cast<int32_t>(v)) / static_cast<float>(mult);
  }
  return static_cast<float>(v) / static_cast<float>(mult);
}

inline bool lppFind(const uint8_t* buf, int len, uint8_t channel, uint8_t type, float* out) {
  int i = 0;
  while (i + 2 <= len) {
    uint8_t ch = buf[i];
    uint8_t t = buf[i + 1];
    int sz = lppDataSize(t);
    if (sz < 0 || i + 2 + sz > len) {
      return false;
    }
    if (ch == channel && t == type) {
      *out = lppDecode(buf + i + 2, sz, lppMultiplier(t), lppIsSigned(t));
      return true;
    }
    i += 2 + sz;
  }
  return false;
}

class LppWriter {
 public:
  LppWriter(uint8_t* buf, int cap) : buf_(buf), cap_(cap), len_(0) {}

  int size() const { return len_; }
  const uint8_t* data() const { return buf_; }

  bool add(uint8_t channel, uint8_t type, float value) {
    int size = lppDataSize(type);
    if (size <= 0 || size > 4 || len_ + 2 + size > cap_) {
      return false;
    }
    bool neg = value < 0.0f;
    double mag = neg ? static_cast<double>(-value) : static_cast<double>(value);
    uint32_t mult = lppMultiplier(type);
    uint32_t v = static_cast<uint32_t>(mag * static_cast<double>(mult));
    if (lppIsSigned(type) && neg) {
      uint32_t mask = (size == 4) ? 0xffffffffu : ((1u << (size * 8)) - 1u);
      v = (mask - (v & mask) + 1u) & mask;
    }
    buf_[len_] = channel;
    buf_[len_ + 1] = type;
    for (int i = size - 1; i >= 0; --i) {
      buf_[len_ + 2 + i] = static_cast<uint8_t>(v & 0xff);
      v >>= 8;
    }
    len_ += 2 + size;
    return true;
  }

  bool addGps(uint8_t channel, float lat, float lon, float alt) {
    if (len_ + 2 + 9 > cap_) {
      return false;
    }
    int32_t ilat = static_cast<int32_t>(lat * 10000.0f);
    int32_t ilon = static_cast<int32_t>(lon * 10000.0f);
    int32_t ialt = static_cast<int32_t>(alt * 100.0f);
    buf_[len_++] = channel;
    buf_[len_++] = kLppGps;
    put3(ilat);
    put3(ilon);
    put3(ialt);
    return true;
  }

 private:
  void put3(int32_t v) {
    buf_[len_++] = static_cast<uint8_t>((v >> 16) & 0xff);
    buf_[len_++] = static_cast<uint8_t>((v >> 8) & 0xff);
    buf_[len_++] = static_cast<uint8_t>(v & 0xff);
  }

  uint8_t* buf_;
  int cap_;
  int len_;
};
