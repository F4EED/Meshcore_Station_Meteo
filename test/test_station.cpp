#include "CivilTime.h"
#include "DerivedIndices.h"
#include "IaqScore.h"
#include "LppEncoder.h"
#include "MeteoText.h"
#include "StationBands.h"
#include "WeatherCadence.h"

#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;

static void expect(bool ok, const char* what) {
  if (!ok) {
    fprintf(stderr, "échec: %s\n", what);
    ++failures;
  }
}

static void expectNear(float got, float want, float tol, const char* what) {
  if (!(fabsf(got - want) <= tol)) {
    fprintf(stderr, "échec: %s (got %.6f want %.6f)\n", what, got, want);
    ++failures;
  }
}

static void expectEq(int got, int want, const char* what) {
  if (got != want) {
    fprintf(stderr, "échec: %s (got %d want %d)\n", what, got, want);
    ++failures;
  }
}

static void testIaq() {
  GasIaqScore score;
  uint16_t iaq = 99;
  expect(!score.update(50000.f, 40.f, &iaq), "chauffe 1");
  expect(!score.update(50000.f, 40.f, &iaq), "chauffe 2");
  expect(!score.update(50000.f, 40.f, &iaq), "chauffe 3");
  expect(score.update(50000.f, 40.f, &iaq), "premier score");
  expectEq(iaq, 0, "iaq air propre");
  expect(score.update(5000.f, 40.f, &iaq), "gaz bas");
  expectEq(iaq, 425, "iaq gaz bas");
  expect(score.update(50000.f, 90.f, &iaq), "retour humide");
  expectEq(iaq, 56, "iaq humide");
  expect(!score.update(0.f, 40.f, &iaq), "gaz nul ignoré");
  expectNear(estimatedEco2Ppm(50), 600.f, 0.01f, "eco2");
}

static void testDewAndIndices() {
  float dew = 0.f;
  expect(dewPointC(15.f, 55.f, &dew), "rosée 15/55");
  expectNear(dew, 6.025f, 0.02f, "rosée valeur");
  float feels = 0.f;
  expect(feelsLikeC(15.f, 55.f, &feels), "ressenti 15/55");
  expectNear(feels, 14.089f, 0.02f, "Steadman 15/55");
  expect(feelsLikeC(27.f, 40.f, &feels), "ressenti 27/40");
  expectNear(feels, 26.863f, 0.05f, "NWS 27/40");
  expect(feelsLikeC(30.f, 60.f, &feels), "ressenti 30/60");
  expectNear(feels, 32.832f, 0.05f, "NWS 30/60");
  expect(!feelsLikeC(15.f, -1.f, &feels), "hr négative");
  expect(dewPointC(0.f, 100.f, &dew), "rosée saturée");
  expectNear(dew, 0.f, 0.02f, "rosée 0");
  expectEq(frostIndex(-1.f, 95.f), 77, "gel -1/95");
  expectEq(frostIndex(0.f, 100.f), 100, "gel saturé");
  expectEq(frostIndex(15.f, 55.f), 0, "pas de gel");
  expectEq(frostIndex(1.f, 98.f), 60, "verglas doux");
  expectEq(fireWeatherIndex(15.f, 55.f), 2, "feu calme");
  expectEq(fireWeatherIndex(30.f, 20.f), 100, "feu sec");
  expectEq(fireWeatherIndex(35.f, 10.f), 100, "feu très sec");
  expectEq(fireWeatherIndex(10.f, 80.f), 0, "feu nul");
  expectEq(smokeIndex(50.f), 0, "fumée basse");
  expectEq(smokeIndex(200.f), 50, "fumée moyenne");
  expectEq(smokeIndex(300.f), 100, "fumée haute");
}

static void testCadence() {
  setenv("TZ", "CET-1CEST,M3.5.0,M10.5.0/3", 1);
  tzset();
  const uint32_t noon = 1793617200u;  // 2026-11-02 12:00 locale
  CivilClock civil = franceCivil(noon);
  expect(civil.valid && civil.hour == 12 && civil.minute == 0, "heure Paris hiver");
  CivilClock summer = franceCivil(1781517600u);  // 2026-06-15 12:00 locale
  expect(summer.valid && summer.hour == 12, "heure Paris été");

  StationBands bands = defaultBands();
  WeatherSample calm = emptySample();
  calm.temp_c = presentReading(15.f);
  calm.rh = presentReading(55.f);
  calm.pressure_hpa = presentReading(1013.f);
  calm.gas_ohm = presentReading(50000.f);
  calm.iaq = presentReading(50.f);
  fillDerived(&calm);

  Cadence normal = evaluateCadence(calm, true, calm, bands, noon);
  expect(normal.mode == TxMode::Normal, "mode calme");
  expectEq(static_cast<int>(normal.interval_s), 21600, "créneau 18h");
  expect(!txDue(true, noon + 3 * 3600, noon, normal.interval_s), "pas dû à 15h");
  expect(txDue(true, noon + 21600, noon, normal.interval_s), "dû à 18h");
  expect(txDue(false, noon, noon, normal.interval_s), "premier envoi");

  WeatherSample hot = calm;
  hot.temp_c = presentReading(18.f);
  fillDerived(&hot);
  Cadence shock = evaluateCadence(hot, true, calm, bands, noon);
  expect(shock.mode == TxMode::Shock, "choc température");
  expectEq(static_cast<int>(shock.interval_s), 300, "intervalle choc");
  expect(!txDue(true, noon + 299, noon, shock.interval_s), "choc pas encore");
  expect(txDue(true, noon + 300, noon, shock.interval_s), "choc dû");

  WeatherSample gas = calm;
  gas.gas_ohm = presentReading(70000.f);
  Cadence gas_shock = evaluateCadence(gas, true, calm, bands, noon);
  expect(gas_shock.mode == TxMode::Shock, "choc gaz 30%");
  gas.gas_ohm = presentReading(64000.f);
  expect(evaluateCadence(gas, true, calm, bands, noon).mode == TxMode::Normal, "gaz sous 30%");

  WeatherSample near = calm;
  near.rh = presentReading(89.f);
  fillDerived(&near);
  WeatherSample out = near;
  out.rh = presentReading(91.f);
  fillDerived(&out);
  Cadence alert = evaluateCadence(out, true, near, bands, noon);
  expect(alert.mode == TxMode::OutOfRange, "hors plage");
  expectEq(static_cast<int>(alert.interval_s), 3600, "intervalle hors plage");

  WeatherSample both = out;
  both.temp_c = presentReading(45.f);
  fillDerived(&both);
  expect(evaluateCadence(both, true, calm, bands, noon).mode == TxMode::Shock, "choc prioritaire");

  WeatherSample edge = calm;
  edge.temp_c = presentReading(-10.f);
  expect(evaluateCadence(edge, false, calm, bands, noon).mode == TxMode::Normal, "borne basse incluse");
  edge.temp_c = presentReading(-10.1f);
  expect(evaluateCadence(edge, false, calm, bands, noon).mode == TxMode::OutOfRange, "sous le mini");

  WeatherSample no_temp = emptySample();
  no_temp.pressure_hpa = presentReading(1013.f);
  expect(evaluateCadence(no_temp, true, calm, bands, noon).mode == TxMode::Normal, "temp absente ignorée");

  const uint32_t almost = 1793638770u;  // 17:59:30 locale
  Cadence floor = evaluateCadence(calm, true, calm, bands, almost);
  expectEq(static_cast<int>(floor.interval_s), 60, "plancher 60 s");

  expectEq(static_cast<int>(evaluateCadence(calm, true, calm, bands, 100).interval_s), 21600, "sans horloge");

  WeatherSample iaq_jump = calm;
  iaq_jump.iaq = presentReading(100.f);
  fillDerived(&iaq_jump);
  expect(evaluateCadence(iaq_jump, true, calm, bands, noon).mode == TxMode::Shock, "choc iaq et eco2");

  WeatherSample frost = calm;
  frost.temp_c = presentReading(0.f);
  frost.rh = presentReading(100.f);
  fillDerived(&frost);
  expect(frost.frost.value >= 70.f, "indice gel haut");
  expect(evaluateCadence(frost, true, calm, bands, noon).mode == TxMode::Shock, "choc gel");
}

static void testLpp() {
  uint8_t raw[64];
  LppWriter w(raw, sizeof(raw));
  expect(w.add(kLppChBme, kLppTemperature, 21.5f), "ajout temp");
  expect(w.add(kLppChBme, kLppHumidity, 55.f), "ajout hr");
  expect(w.add(kLppChBme, kLppPressure, 1013.25f), "ajout p");
  expect(w.add(kLppChBme, kLppGeneric, 50000.f), "ajout gaz");
  expect(w.add(kLppChBme, kLppTemperature, -10.f), "ajout gel");
  float v = 0.f;
  expect(lppFind(w.data(), w.size(), kLppChBme, kLppTemperature, &v), "lit temp");
  expectNear(v, 21.5f, 0.05f, "temp 21.5");
  expect(raw[0] == kLppChBme && raw[1] == kLppTemperature && raw[2] == 0x00 && raw[3] == 0xd7, "octets temp");
  expect(lppFind(w.data(), w.size(), kLppChBme, kLppHumidity, &v), "lit hr");
  expectNear(v, 55.f, 0.01f, "hr 55");
  expect(raw[4] == kLppChBme && raw[5] == kLppHumidity && raw[6] == 110, "hr sur 1 octet");
  expect(lppFind(w.data(), w.size(), kLppChBme, kLppPressure, &v), "lit p");
  expectNear(v, 1013.2f, 0.05f, "pression");
  expect(lppFind(w.data(), w.size(), kLppChBme, kLppGeneric, &v), "lit gaz");
  expectNear(v, 50000.f, 0.1f, "gaz");
  // Deux températures : la première est renvoyée.
  expectNear(v, 50000.f, 0.1f, "gaz stable");
  LppWriter cold(raw, sizeof(raw));
  expect(cold.add(2, kLppTemperature, -10.f), "temp négative");
  expect(lppFind(cold.data(), cold.size(), 2, kLppTemperature, &v), "lit négative");
  expectNear(v, -10.f, 0.05f, "-10 °C");
  expect(cold.data()[2] == 0xff && cold.data()[3] == 0x9c, "octets -10");
}

static void testBands() {
  StationBands bands = defaultBands();
  char text[1024];
  int n = formatBands(bands, text, sizeof(text));
  expect(n > 0 && n < static_cast<int>(sizeof(text)), "format bandes");
  StationBands parsed = defaultBands();
  parsed.band[0].mean = 0.f;
  char* cursor = text;
  bool ok = true;
  while (cursor && *cursor) {
    char* nl = strchr(cursor, '\n');
    if (nl) {
      *nl = '\0';
    }
    if (!parseBandLine(cursor, &parsed)) {
      ok = false;
    }
    if (!nl) {
      break;
    }
    cursor = nl + 1;
  }
  expect(ok, "parse bandes");
  expectNear(bandOf(parsed, BandId::Temp).low, -10.f, 0.01f, "temp low");
  expectNear(bandOf(parsed, BandId::Gas).high, 1.0e7f, 1.f, "gaz high");
  expect(!parseBandLine("temp 1 2", &parsed), "ligne courte");
  expect(parseBandLine("# commentaire", &parsed), "commentaire");
}

static uint32_t rotr32(uint32_t x, uint32_t n) {
  return (x >> n) | (x << (32u - n));
}

static void sha256_short(const uint8_t* msg, size_t len, uint8_t out[32]) {
  static const uint32_t k[64] = {
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2};
  uint8_t block[64];
  memset(block, 0, sizeof(block));
  if (len > 55) {
    out[0] = 0;
    return;
  }
  if (len) {
    memcpy(block, msg, len);
  }
  block[len] = 0x80;
  uint64_t bits = static_cast<uint64_t>(len) * 8u;
  for (int i = 0; i < 8; ++i) {
    block[63 - i] = static_cast<uint8_t>(bits >> (8 * i));
  }
  uint32_t s[8] = {0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19};
  uint32_t w[64];
  for (int i = 0; i < 16; ++i) {
    w[i] = (uint32_t)block[i * 4] << 24 | (uint32_t)block[i * 4 + 1] << 16 | (uint32_t)block[i * 4 + 2] << 8 |
           (uint32_t)block[i * 4 + 3];
  }
  for (int i = 16; i < 64; ++i) {
    uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
    uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
    w[i] = w[i - 16] + s0 + w[i - 7] + s1;
  }
  uint32_t a = s[0], b = s[1], c = s[2], d = s[3], e = s[4], f = s[5], g = s[6], h = s[7];
  for (int i = 0; i < 64; ++i) {
    uint32_t S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
    uint32_t ch = (e & f) ^ ((~e) & g);
    uint32_t t1 = h + S1 + ch + k[i] + w[i];
    uint32_t S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
    uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
    h = g;
    g = f;
    f = e;
    e = d + t1;
    d = c;
    c = b;
    b = a;
    a = t1 + S0 + maj;
  }
  s[0] += a;
  s[1] += b;
  s[2] += c;
  s[3] += d;
  s[4] += e;
  s[5] += f;
  s[6] += g;
  s[7] += h;
  for (int i = 0; i < 8; ++i) {
    out[i * 4] = static_cast<uint8_t>(s[i] >> 24);
    out[i * 4 + 1] = static_cast<uint8_t>(s[i] >> 16);
    out[i * 4 + 2] = static_cast<uint8_t>(s[i] >> 8);
    out[i * 4 + 3] = static_cast<uint8_t>(s[i]);
  }
}

static void testMtoTrigger() {
  uint8_t dig[32];
  sha256_short(reinterpret_cast<const uint8_t*>(""), 0, dig);
  expect(dig[0] == 0xe3 && dig[1] == 0xb0 && dig[31] == 0x55, "sha256 vide");
  uint8_t zeros[16] = {0};
  sha256_short(zeros, 16, dig);
  expectEq(dig[0], 0x37, "hash secret vide");
  expectEq(kPublicChannelHash, dig[0], "constante 0x37");
  const char* name = "#germacrisepublic";
  sha256_short(reinterpret_cast<const uint8_t*>(name), strlen(name), dig);
  expect(dig[0] != kPublicChannelHash, "le nom n'est pas le hash");
  const char* region = "#fr-42";
  sha256_short(reinterpret_cast<const uint8_t*>(region), strlen(region), dig);
  expect(dig[0] == 0xe7 && dig[1] == 0x89 && dig[2] == 0x8e && dig[3] == 0x6d, "clé fr-42");

  uint8_t pkt[40];
  memset(pkt, 0, sizeof(pkt));
  pkt[0] = 1;
  pkt[4] = 0;
  memcpy(pkt + 5, "Pager: mto_now", 14);
  expect(grpTxtRequestsCommand(pkt, 32, kMtoNow), "grp 1.18 paddé");
  pkt[4] = 1;
  expect(grpTxtRequestsCommand(pkt, 19, kMtoNow), "grp essai 1");
  pkt[4] = static_cast<uint8_t>(3 << 2);
  memcpy(pkt + 5, "mto_now", 7);
  expect(grpTxtRequestsCommand(pkt, 12, kMtoNow), "grp cli");
  memset(pkt, 0, sizeof(pkt));
  memcpy(pkt + 4, "Radio: mto_now", 14);
  expect(grpTxtRequestsCommand(pkt, 18, kMtoNow), "grp sans type");
  memset(pkt, 0, sizeof(pkt));
  memcpy(pkt + 4, "mto_now", 7);
  expect(grpTxtRequestsCommand(pkt, 11, kMtoNow), "commande collée au timestamp");
  memset(pkt, 0, sizeof(pkt));
  pkt[4] = 0;
  memcpy(pkt + 5, "bonjour", 7);
  expect(!grpTxtRequestsCommand(pkt, 12, kMtoNow), "autre texte");
  memcpy(pkt + 5, "mto_nowhere", 11);
  expect(!grpTxtRequestsCommand(pkt, 16, kMtoNow), "mot plus long");
  expect(!grpTxtRequestsCommand(pkt, 4, kMtoNow), "trop court");
  expect(containsCommand("MTO_NOW", kMtoNow), "casse libre");

  DutyPlan both = planDutyTx(5000, 1000, 2000, true);
  expect(both.send_data && both.send_text, "budget pour les deux");
  DutyPlan data_only = planDutyTx(2500, 1000, 2000, true);
  expect(data_only.send_data && !data_only.send_text, "le texte ne bloque pas la data");
  DutyPlan none = planDutyTx(500, 1000, 100, true);
  expect(!none.send_data && !none.send_text, "budget trop juste");
  DutyPlan no_text = planDutyTx(1000, 1000, 50, false);
  expect(no_text.send_data && !no_text.send_text, "sans demande de texte");
}

static void testChannel() {
  expect(strcmp(kProjectName, "Meshcore_Station_Meteo") == 0, "nom du projet");
  expect(strcmp(kFirmwareVersion, "Meshcore_Station_Meteo-0.0.1") == 0, "version d'image");
  expect(strcmp(kChannelName, "#germacrisepublic") == 0, "nom de canal");
  expect(strchr(kChannelName, '_') == nullptr, "pas d'underscore");
  expectEq(kStmetDataType, 0xFF42, "type groupe");
  expect(strcmp(kRegionNode, "fr-42") == 0 && strcmp(kRegionFlood, "fr-42") == 0, "flood fr-42");
  expect(containsCommand("mto_now", kMtoNow), "commande seule");
  expect(containsCommand("Pager: mto_now", kMtoNow), "préfixe compagnon");
  expect(!containsCommand("mto_nowish", kMtoNow), "pas un préfixe plus long");
  expect(!containsCommand("xmto_now", kMtoNow), "pas collé à gauche");
  WeatherSample sample = emptySample();
  sample.temp_c = presentReading(15.f);
  sample.rh = presentReading(55.f);
  fillDerived(&sample);
  char line[96];
  int n = formatMeteoLine(sample, line, sizeof(line));
  expect(n > 0, "ligne météo");
  expect(strstr(line, "rosée ") != nullptr && strstr(line, "ressenti ") != nullptr, "rosée et ressenti");
  expect(strstr(line, "gel ") != nullptr && strstr(line, "feu ") != nullptr, "indices");
  expect(strstr(line, kMtoNow) == nullptr, "la réponse ne redemande pas");
}

int main() {
  testIaq();
  testDewAndIndices();
  testCadence();
  testLpp();
  testBands();
  testMtoTrigger();
  testChannel();
  if (failures) {
    fprintf(stderr, "%d échec(s)\n", failures);
    return 1;
  }
  printf("ok\n");
  return 0;
}
