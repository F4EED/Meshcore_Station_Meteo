#include "CivilTime.h"
#include "DerivedIndices.h"
#include "IaqScore.h"
#include "LppEncoder.h"
#include "MeteoText.h"
#include "StationBands.h"
#include "WeatherCadence.h"

#include <math.h>
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
  testChannel();
  if (failures) {
    fprintf(stderr, "%d échec(s)\n", failures);
    return 1;
  }
  printf("ok\n");
  return 0;
}
