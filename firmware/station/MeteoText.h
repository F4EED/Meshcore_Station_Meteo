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

inline char foldCmd(char c) {
  if (c >= 'A' && c <= 'Z') {
    return static_cast<char>(c - 'A' + 'a');
  }
  return c;
}

inline bool containsCommand(const char* text, const char* cmd) {
  if (text == nullptr || cmd == nullptr || cmd[0] == 0) {
    return false;
  }
  size_t n = strlen(cmd);
  for (const char* p = text; *p != 0; ++p) {
    size_t i = 0;
    for (; i < n; ++i) {
      if (p[i] == 0 || foldCmd(p[i]) != foldCmd(cmd[i])) {
        break;
      }
    }
    if (i != n) {
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

// Copie bornée : le déchiffrement MeshCore padde par des zéros, sans garder
// la longueur utile d'origine.
inline bool bytesContainCommand(const uint8_t* data, size_t len, const char* cmd) {
  if (data == nullptr || len == 0) {
    return false;
  }
  char text[160];
  size_t n = len < sizeof(text) - 1 ? len : sizeof(text) - 1;
  size_t m = 0;
  for (size_t i = 0; i < n; ++i) {
    if (data[i] == 0) {
      break;
    }
    text[m++] = static_cast<char>(data[i]);
  }
  text[m] = 0;
  return containsCommand(text, cmd);
}

// GRP_TXT clair. MeshCore 1.18 : timestamp uint32, octet de type, puis
// « nom: message ». Packet.h décrit aussi timestamp puis le texte, sans
// octet de type. Les deux sont acceptés. Le type (clair, essai, CLI) ne
// fait pas rejeter la commande.
inline bool grpTxtRequestsCommand(const uint8_t* data, size_t len, const char* cmd) {
  if (data == nullptr || len < 5) {
    return false;
  }
  if (len >= 6 && bytesContainCommand(data + 5, len - 5, cmd)) {
    return true;
  }
  return bytesContainCommand(data + 4, len - 4, cmd);
}

// Le texte ne doit pas empêcher le GRP_DATA. S'il ne reste de budget que
// pour une trame, seule la data part.
struct DutyPlan {
  bool send_data;
  bool send_text;
};

inline DutyPlan planDutyTx(uint32_t budget_ms, uint32_t data_ms, uint32_t text_ms, bool want_text) {
  DutyPlan plan;
  plan.send_data = false;
  plan.send_text = false;
  if (budget_ms < data_ms) {
    return plan;
  }
  plan.send_data = true;
  if (want_text && text_ms <= budget_ms - data_ms) {
    plan.send_text = true;
  }
  return plan;
}

// Portée entendue sur un flood. Fr42 = étiquette fr-42. Fr = parent fr.
// Open = pas de code de transport. Other = une autre étiquette (fr-ara, …).
// Un paquet qui n'est pas un flood (direct, CLI) reste Fr42.
enum class HearScope : uint8_t { Fr42 = 0, Fr = 1, Open = 2, Other = 3 };

inline HearScope hearScopeOf(bool is_flood, bool has_transport, uint16_t code, uint16_t code_fr42, uint16_t code_fr) {
  if (!is_flood) {
    return HearScope::Fr42;
  }
  if (!has_transport || code == 0) {
    return HearScope::Open;
  }
  if (code == code_fr42) {
    return HearScope::Fr42;
  }
  if (code == code_fr) {
    return HearScope::Fr;
  }
  return HearScope::Other;
}

// mto_now : le texte part même sans mesure. La data part dès qu'il y a un
// échantillon. Le budget local ne retient pas cette réponse.
inline DutyPlan planReplyTx(bool have_sample) {
  DutyPlan plan;
  plan.send_data = have_sample;
  plan.send_text = true;
  return plan;
}

inline bool replyAlsoOnParent(HearScope scope) {
  return scope == HearScope::Fr || scope == HearScope::Other;
}

inline bool replyAlsoOpen(HearScope scope) { return scope == HearScope::Open; }

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
