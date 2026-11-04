#include "SensorMesh.h"

#include "CivilTime.h"
#include "DerivedIndices.h"
#include "IaqScore.h"
#include "LppEncoder.h"
#include "MeteoText.h"
#include "StationBands.h"
#include "StationConfig.h"
#include "WeatherCadence.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

// Capteur MeshCore (type 4). Les extras LPP (rosée, ressenti, indices) sont
// ajoutés à la télémétrie (requête, push et GRP_DATA). mto_now sur
// #germacrisepublic déclenche un flood fr-42 : GRP_TXT de mesure + GRP_DATA
// 0xFF42, secret vide. Pas de sommeil : le nœud reste en écoute.

static const char kBandsPath[] = "/stmet.bands";
static const char kSeedPath[] = "/stmet.seed";
static const char kGpsPath[] = "/stmet.gps";
static const char kFranceTz[] = "CET-1CEST,M3.5.0,M10.5.0/3";
static const unsigned long kIaqGapMs = (kSamplePeriodS - 5) * 1000UL;

static FILESYSTEM* station_fs = nullptr;

static void setFranceTz() {
  setenv("TZ", kFranceTz, 1);
  tzset();
}

static bool fileExists(const char* path) {
  return station_fs && station_fs->exists(path);
}

static int readFile(const char* path, char* dest, int cap) {
  if (!station_fs || cap < 2 || !station_fs->exists(path)) {
    return -1;
  }
#if defined(NRF52_PLATFORM) || defined(STM32_PLATFORM)
  File file = station_fs->open(path);
#else
  File file = station_fs->open(path, "r");
#endif
  if (!file) {
    return -1;
  }
  int n = file.read(reinterpret_cast<uint8_t*>(dest), cap - 1);
  file.close();
  if (n < 0) {
    return -1;
  }
  dest[n] = 0;
  return n;
}

static bool writeFile(const char* path, const char* text) {
  if (!station_fs) {
    return false;
  }
  station_fs->remove(path);
#if defined(NRF52_PLATFORM) || defined(STM32_PLATFORM)
  File file = station_fs->open(path, FILE_O_WRITE);
#else
  File file = station_fs->open(path, "w");
#endif
  if (!file) {
    return false;
  }
  size_t n = strlen(text);
  bool ok = file.write(reinterpret_cast<const uint8_t*>(text), n) == n;
  file.close();
  return ok;
}

class MyMesh : public SensorMesh {
 public:
  MyMesh(mesh::MainBoard& board, mesh::Radio& radio, mesh::MillisecondClock& ms, mesh::RNG& rng, mesh::RTCClock& rtc,
         mesh::MeshTables& tables)
      : SensorMesh(board, radio, ms, rng, rtc, tables),
        battery_data(12 * 24, 5 * 60),
        temp_data(12 * 24, 5 * 60),
        bands_(defaultBands()),
        latest_(emptySample()),
        prev_(emptySample()) {
    memset(channel_.secret, 0, sizeof(channel_.secret));
    memset(channel_.hash, 0, sizeof(channel_.hash));
    memset(region_key_.key, 0, sizeof(region_key_.key));
  }

  void bringUp() {
    loadBands();
    prepareChannel();
    Serial.print("canal ");
    Serial.println(kChannelName);
    if (!fileExists(kSeedPath)) {
      seedRadio();
    }
    loadGpsMarker();
    armGpsChase();
  }

  void loop() {
    chaseGps();
    SensorMesh::loop();
    maybePublish();
  }

 protected:
  void onSensorDataRead() override {}

  void onTelemetryBuilt(CayenneLPP& telemetry) override {
    const uint8_t* buf = telemetry.getBuffer();
    int len = telemetry.getSize();
    WeatherSample sample = emptySample();
    take(buf, len, kLppChBme, kLppTemperature, &sample.temp_c);
    take(buf, len, kLppChBme, kLppHumidity, &sample.rh);
    take(buf, len, kLppChBme, kLppPressure, &sample.pressure_hpa);
    take(buf, len, kLppChBme, kLppGeneric, &sample.gas_ohm);
    take(buf, len, kLppChNode, kLppVoltage, &sample.battery_v);
    if (sample.gas_ohm.present && !(sample.gas_ohm.value > 0.0f)) {
      sample.gas_ohm = absentReading();
    }

    unsigned long now_ms = millis();
    bool fresh = last_iaq_ms_ == 0 || (now_ms - last_iaq_ms_) >= kIaqGapMs;
    if (fresh) {
      last_iaq_ms_ = now_ms;
      if (sample.gas_ohm.present) {
        uint16_t iaq = 0;
        float rh = sample.rh.present ? sample.rh.value : GasIaqScore::kRhRef;
        if (iaq_.update(sample.gas_ohm.value, rh, &iaq)) {
          have_iaq_ = true;
          last_iaq_ = iaq;
        }
      }
    }
    if (have_iaq_) {
      sample.iaq = presentReading(static_cast<float>(last_iaq_));
    }
    fillDerived(&sample);

    float lat = 0.0f;
    float lon = 0.0f;
    float alt = 0.0f;
    sample.has_position = currentPosition(&lat, &lon, &alt);
    if (sample.has_position) {
      sample.lat = lat;
      sample.lon = lon;
      sample.alt_m = alt;
    }

    appendExtras(telemetry, sample);

    bool usable = sample.temp_c.present || sample.rh.present || sample.pressure_hpa.present || sample.gas_ohm.present;
    if (!usable) {
      return;
    }
    latest_ = sample;
    have_latest_ = true;
    if (fresh) {
      sample_pending_ = true;
      if (sample.battery_v.present) {
        battery_data.recordData(getRTCClock(), sample.battery_v.value);
      }
      if (sample.temp_c.present) {
        temp_data.recordData(getRTCClock(), sample.temp_c.value);
      }
    }
  }

  int querySeriesData(uint32_t start_secs_ago, uint32_t end_secs_ago, MinMaxAvg dest[], int max_num) override {
    int n = 0;
    if (n < max_num) {
      battery_data.calcMinMaxAvg(getRTCClock(), start_secs_ago, end_secs_ago, &dest[n], kLppChNode, kLppVoltage);
      ++n;
    }
    if (n < max_num) {
      temp_data.calcMinMaxAvg(getRTCClock(), start_secs_ago, end_secs_ago, &dest[n], kLppChBme, kLppTemperature);
      ++n;
    }
    return n;
  }

  int searchChannelsByHash(const uint8_t* hash, mesh::GroupChannel channels[], int max_matches) override {
    if (!channel_ready_ || hash == nullptr || max_matches < 1) {
      return 0;
    }
    if (hash[0] != channel_.hash[0]) {
      return 0;
    }
    channels[0] = channel_;
    return 1;
  }

  void onGroupDataRecv(mesh::Packet* packet, uint8_t type, const mesh::GroupChannel& channel, uint8_t* data,
                       size_t len) override {
    (void)packet;
    (void)channel;
    if (type != PAYLOAD_TYPE_GRP_TXT || data == nullptr || len < 6) {
      return;
    }
    uint8_t txt_type = data[4];
    if ((txt_type >> 2) != 0) {
      return;
    }
    char text[120];
    size_t n = len - 5;
    if (n >= sizeof(text)) {
      n = sizeof(text) - 1;
    }
    memcpy(text, data + 5, n);
    text[n] = 0;
    if (!containsCommand(text, kMtoNow)) {
      return;
    }
    reply_now_ = true;
    Serial.println("mto_now");
  }

  bool handleCustomCommand(uint32_t sender_timestamp, char* command, char* reply) override {
    (void)sender_timestamp;
    if (strcmp(command, "bands") == 0) {
      char buf[1200];
      int n = formatBands(bands_, buf, static_cast<int>(sizeof(buf)));
      if (n < 0) {
        strcpy(reply, "Err");
        return true;
      }
      Serial.print(buf);
      strcpy(reply, "OK");
      return true;
    }
    if (memcmp(command, "bands ", 6) == 0) {
      char name[16];
      BandId id;
      if (sscanf(command + 6, "%15s", name) != 1 || !bandFromName(name, &id) || !parseBandLine(command + 6, &bands_)) {
        strcpy(reply, "Err");
        return true;
      }
      if (!saveBands()) {
        strcpy(reply, "Err");
        return true;
      }
      strcpy(reply, "OK");
      return true;
    }
    if (strcmp(command, "meteo") == 0) {
      printMeteo();
      strcpy(reply, have_latest_ ? "OK" : "pas de mesure");
      return true;
    }
    if (strcmp(command, "tx") == 0) {
      force_tx_ = true;
      strcpy(reply, "OK");
      return true;
    }
    return false;
  }

 private:
  TimeSeriesData battery_data;
  TimeSeriesData temp_data;
  StationBands bands_;
  GasIaqScore iaq_;
  WeatherSample latest_;
  WeatherSample prev_;
  mesh::GroupChannel channel_;
  TransportKey region_key_;
  bool channel_ready_ = false;
  bool have_latest_ = false;
  bool have_prev_ = false;
  bool ever_sent_ = false;
  bool sample_pending_ = false;
  bool force_tx_ = false;
  bool reply_now_ = false;
  bool have_iaq_ = false;
  bool chase_active_ = false;
  bool gps_settled_ = false;
  uint16_t last_iaq_ = 0;
  uint32_t last_tx_unix_ = 0;
  unsigned long last_iaq_ms_ = 0;
  unsigned long chase_started_ms_ = 0;
  double pinned_alt_ = 0.0;

  static void take(const uint8_t* buf, int len, uint8_t channel, uint8_t type, Reading* out) {
    float value = 0.0f;
    if (!lppFind(buf, len, channel, type, &value) || !isfinite(value)) {
      *out = absentReading();
      return;
    }
    *out = presentReading(value);
  }

  static void appendExtras(CayenneLPP& telemetry, const WeatherSample& sample) {
    if (sample.eco2_ppm.present) {
      telemetry.addConcentration(kLppChBme, static_cast<uint32_t>(lroundf(sample.eco2_ppm.value)));
    }
    if (sample.iaq.present) {
      telemetry.addGenericSensor(kLppChIaq, sample.iaq.value);
    }
    if (sample.frost.present) {
      telemetry.addPercentage(kLppChFrost, static_cast<uint32_t>(lroundf(sample.frost.value)));
    }
    if (sample.fire.present) {
      telemetry.addPercentage(kLppChFire, static_cast<uint32_t>(lroundf(sample.fire.value)));
    }
    if (sample.smoke.present) {
      telemetry.addPercentage(kLppChSmoke, static_cast<uint32_t>(lroundf(sample.smoke.value)));
    }
    if (sample.dew_c.present) {
      telemetry.addTemperature(kLppChDew, sample.dew_c.value);
    }
    if (sample.feels_c.present) {
      telemetry.addTemperature(kLppChFeels, sample.feels_c.value);
    }
  }

  bool currentPosition(float* lat, float* lon, float* alt) const {
    LocationProvider* gps = sensors.getLocationProvider();
    if (gps && gps->isValid() && !(sensors.node_lat == 0.0 && sensors.node_lon == 0.0)) {
      *lat = static_cast<float>(sensors.node_lat);
      *lon = static_cast<float>(sensors.node_lon);
      *alt = static_cast<float>(sensors.node_altitude);
      return true;
    }
    NodePrefs* prefs = const_cast<MyMesh*>(this)->getNodePrefs();
    if (prefs->advert_loc_policy == ADVERT_LOC_PREFS && !(prefs->node_lat == 0.0 && prefs->node_lon == 0.0)) {
      *lat = static_cast<float>(prefs->node_lat);
      *lon = static_cast<float>(prefs->node_lon);
      *alt = static_cast<float>(pinned_alt_);
      return true;
    }
    return false;
  }

  void prepareChannel() {
    // Canal public, sans clé. MeshCore hash un secret 128 bits : ici, 16 zéros.
    memset(channel_.secret, 0, sizeof(channel_.secret));
    mesh::Utils::sha256(channel_.hash, sizeof(channel_.hash), channel_.secret, 16);
    char tagged[24];
    snprintf(tagged, sizeof(tagged), "#%s", kRegionFlood);
    mesh::Utils::sha256(region_key_.key, sizeof(region_key_.key), reinterpret_cast<const uint8_t*>(tagged),
                        static_cast<int>(strlen(tagged)));
    channel_ready_ = !region_key_.isNull();
  }

  void loadBands() {
    bands_ = defaultBands();
    char buf[1200];
    int n = readFile(kBandsPath, buf, static_cast<int>(sizeof(buf)));
    if (n <= 0) {
      return;
    }
    char* line = buf;
    while (line && *line) {
      char* nl = strchr(line, '\n');
      if (nl) {
        *nl = 0;
      }
      parseBandLine(line, &bands_);
      if (!nl) {
        break;
      }
      line = nl + 1;
    }
  }

  bool saveBands() {
    char buf[1200];
    int n = formatBands(bands_, buf, static_cast<int>(sizeof(buf)));
    if (n < 0 || n >= static_cast<int>(sizeof(buf))) {
      return false;
    }
    return writeFile(kBandsPath, buf);
  }

  void loadGpsMarker() {
    char buf[96];
    int n = readFile(kGpsPath, buf, static_cast<int>(sizeof(buf)));
    if (n <= 0) {
      return;
    }
    if (buf[0] == 'P') {
      long alt_dm = 0;
      if (sscanf(buf, "P %ld", &alt_dm) == 1) {
        pinned_alt_ = static_cast<double>(alt_dm) / 10.0;
      }
      gps_settled_ = true;
    } else if (buf[0] == 'N') {
      gps_settled_ = true;
    }
  }

  void armGpsChase() {
    if (gps_settled_) {
      return;
    }
    NodePrefs* prefs = getNodePrefs();
    bool manual = prefs->advert_loc_policy == ADVERT_LOC_PREFS && !(prefs->node_lat == 0.0 && prefs->node_lon == 0.0);
    if (manual) {
      gps_settled_ = true;
      return;
    }
    prefs->advert_loc_policy = ADVERT_LOC_NONE;
    prefs->node_lat = 0.0;
    prefs->node_lon = 0.0;
    savePrefs();
    if (sensors.setSettingValue("gps", "1")) {
      chase_active_ = true;
      chase_started_ms_ = millis();
      Serial.println("chasse GPS 8 min");
    }
  }

  void chaseGps() {
    if (!chase_active_) {
      return;
    }
    LocationProvider* gps = sensors.getLocationProvider();
    bool fix = gps && gps->isValid() && !(sensors.node_lat == 0.0 && sensors.node_lon == 0.0);
    if (fix) {
      pinGps(true);
      return;
    }
    if ((millis() - chase_started_ms_) >= kGpsChaseMs) {
      pinGps(false);
    }
  }

  void pinGps(bool fix) {
    chase_active_ = false;
    gps_settled_ = true;
    NodePrefs* prefs = getNodePrefs();
    prefs->gps_enabled = 0;
    sensors.setSettingValue("gps", "0");
    if (fix) {
      prefs->node_lat = sensors.node_lat;
      prefs->node_lon = sensors.node_lon;
      prefs->advert_loc_policy = ADVERT_LOC_PREFS;
      pinned_alt_ = sensors.node_altitude;
      char line[32];
      snprintf(line, sizeof(line), "P %ld\n", lround(pinned_alt_ * 10.0));
      writeFile(kGpsPath, line);
      Serial.println("GPS figé");
    } else {
      prefs->node_lat = 0.0;
      prefs->node_lon = 0.0;
      prefs->advert_loc_policy = ADVERT_LOC_NONE;
      pinned_alt_ = 0.0;
      writeFile(kGpsPath, "N\n");
      Serial.println("GPS sans fix");
    }
    savePrefs();
  }

  bool runCli(const char* line) {
    char cmd[96];
    char reply[160];
    strncpy(cmd, line, sizeof(cmd) - 1);
    cmd[sizeof(cmd) - 1] = 0;
    reply[0] = 0;
    handleCommand(nullptr, 0, cmd, reply);
    Serial.print("# ");
    Serial.println(line);
    if (reply[0]) {
      Serial.print("  -> ");
      Serial.println(reply);
    }
    if (strncmp(reply, "Err", 3) == 0 || strncmp(reply, "Error", 5) == 0 || strncmp(reply, "ERROR", 5) == 0 ||
        strncmp(reply, "Unknown", 7) == 0) {
      return false;
    }
    return true;
  }

  void seedRadio() {
    static const char* kCmds[] = {
        "region def eu europe fr",
        "region put fr-42 fr",
        "region put fr-ara fr",
        "region home fr-42",
        "region default fr-42",
        "region save",
        "set repeat off",
        "set dutycycle 10",
        "set path.hash.mode 1",
        "set advert.interval 240",
        "set flood.advert.interval 12",
        "set cad on",
    };
    bool ok = true;
    for (size_t i = 0; i < sizeof(kCmds) / sizeof(kCmds[0]); ++i) {
      ok = runCli(kCmds[i]) && ok;
    }
    if (ok && writeFile(kSeedPath, "ok\n")) {
      Serial.println("réglages radio enregistrés");
    } else {
      Serial.println("réglages radio incomplets, nouvel essai au prochain boot");
    }
  }

  void printReading(const char* name, const Reading& reading, const char* unit) {
    Serial.print(name);
    Serial.print('=');
    if (!reading.present) {
      Serial.print("n/a");
    } else {
      Serial.print(reading.value, 1);
      Serial.print(unit);
    }
    Serial.print(' ');
  }

  void printMeteo() {
    if (!have_latest_) {
      Serial.println("pas de mesure");
      return;
    }
    printReading("temp", latest_.temp_c, "C");
    printReading("hr", latest_.rh, "%");
    printReading("p", latest_.pressure_hpa, "hPa");
    printReading("gaz", latest_.gas_ohm, "ohm");
    printReading("iaq", latest_.iaq, "");
    printReading("eco2", latest_.eco2_ppm, "ppm");
    printReading("rosee", latest_.dew_c, "C");
    printReading("ressenti", latest_.feels_c, "C");
    printReading("gel", latest_.frost, "");
    printReading("feu", latest_.fire, "");
    printReading("fumee", latest_.smoke, "");
    printReading("batterie", latest_.battery_v, "V");
    Serial.println();
    if (latest_.has_position) {
      Serial.print("pos ");
      Serial.print(latest_.lat, 5);
      Serial.print(' ');
      Serial.print(latest_.lon, 5);
      Serial.print(' ');
      Serial.println(latest_.alt_m, 0);
    }
  }

  bool appendCurated(LppWriter* out) const {
    if (latest_.battery_v.present && !out->add(kLppChNode, kLppVoltage, latest_.battery_v.value)) {
      return false;
    }
    if (latest_.has_position && !out->addGps(kLppChNode, latest_.lat, latest_.lon, latest_.alt_m)) {
      return false;
    }
    if (latest_.temp_c.present && !out->add(kLppChBme, kLppTemperature, latest_.temp_c.value)) {
      return false;
    }
    if (latest_.rh.present && !out->add(kLppChBme, kLppHumidity, latest_.rh.value)) {
      return false;
    }
    if (latest_.pressure_hpa.present && !out->add(kLppChBme, kLppPressure, latest_.pressure_hpa.value)) {
      return false;
    }
    if (latest_.gas_ohm.present && !out->add(kLppChBme, kLppGeneric, latest_.gas_ohm.value)) {
      return false;
    }
    if (latest_.eco2_ppm.present && !out->add(kLppChBme, kLppConcentration, latest_.eco2_ppm.value)) {
      return false;
    }
    if (latest_.iaq.present && !out->add(kLppChIaq, kLppGeneric, latest_.iaq.value)) {
      return false;
    }
    if (latest_.frost.present && !out->add(kLppChFrost, kLppPercentage, latest_.frost.value)) {
      return false;
    }
    if (latest_.fire.present && !out->add(kLppChFire, kLppPercentage, latest_.fire.value)) {
      return false;
    }
    if (latest_.smoke.present && !out->add(kLppChSmoke, kLppPercentage, latest_.smoke.value)) {
      return false;
    }
    if (latest_.dew_c.present && !out->add(kLppChDew, kLppTemperature, latest_.dew_c.value)) {
      return false;
    }
    if (latest_.feels_c.present && !out->add(kLppChFeels, kLppTemperature, latest_.feels_c.value)) {
      return false;
    }
    return out->size() > 0;
  }

  uint32_t airMs(const mesh::Packet* packet) const {
    return radio_driver.getEstAirtimeFor(2 + 4 + packet->payload_len);
  }

  mesh::Packet* buildGroupText(uint32_t now) {
    char body[96];
    int body_len = formatMeteoLine(latest_, body, static_cast<int>(sizeof(body)));
    if (body_len <= 0) {
      return nullptr;
    }
    char prefixed[128];
    int prefix = snprintf(prefixed, sizeof(prefixed), "%s: ", kNodeName);
    if (prefix < 0 || prefix + body_len >= static_cast<int>(sizeof(prefixed))) {
      return nullptr;
    }
    memcpy(prefixed + prefix, body, static_cast<size_t>(body_len));
    int text_len = prefix + body_len;
    uint8_t plain[5 + sizeof(prefixed)];
    memcpy(plain, &now, 4);
    plain[4] = 0;
    memcpy(plain + 5, prefixed, static_cast<size_t>(text_len));
    return createGroupDatagram(PAYLOAD_TYPE_GRP_TXT, channel_, plain, static_cast<size_t>(5 + text_len));
  }

  void floodNow(mesh::Packet* packet) {
    uint8_t hash_size = static_cast<uint8_t>(getNodePrefs()->path_hash_mode + 1);
    sendFloodScoped(region_key_, packet, 0, hash_size);
  }

  void maybePublish() {
    if (!have_latest_ || !channel_ready_) {
      return;
    }
    bool now_reply = reply_now_;
    if (!sample_pending_ && !force_tx_ && !now_reply) {
      return;
    }
    uint32_t now = getRTCClock()->getCurrentTime();
    Cadence cadence = evaluateCadence(latest_, have_prev_, prev_, bands_, ever_sent_ ? last_tx_unix_ : now);
    if (!force_tx_ && !now_reply && !txDue(ever_sent_, now, last_tx_unix_, cadence.interval_s)) {
      sample_pending_ = false;
      return;
    }

    uint8_t lpp[128];
    LppWriter writer(lpp, static_cast<int>(sizeof(lpp)));
    if (!appendCurated(&writer) || writer.size() > MAX_GROUP_DATA_LENGTH) {
      return;
    }
    uint8_t plain[3 + sizeof(lpp)];
    plain[0] = static_cast<uint8_t>(kStmetDataType & 0xff);
    plain[1] = static_cast<uint8_t>(kStmetDataType >> 8);
    plain[2] = static_cast<uint8_t>(writer.size());
    memcpy(plain + 3, writer.data(), writer.size());

    mesh::Packet* data_pkt = createGroupDatagram(PAYLOAD_TYPE_GRP_DATA, channel_, plain, 3 + writer.size());
    if (data_pkt == nullptr) {
      return;
    }
    mesh::Packet* text_pkt = now_reply ? buildGroupText(now) : nullptr;
    uint32_t need = airMs(data_pkt);
    if (text_pkt != nullptr) {
      need += airMs(text_pkt);
    }
    if (getRemainingTxBudget() < need) {
      releasePacket(data_pkt);
      if (text_pkt != nullptr) {
        releasePacket(text_pkt);
      }
      return;
    }
    floodNow(data_pkt);
    if (text_pkt != nullptr) {
      floodNow(text_pkt);
    }

    prev_ = latest_;
    have_prev_ = true;
    ever_sent_ = true;
    last_tx_unix_ = now;
    sample_pending_ = false;
    force_tx_ = false;
    reply_now_ = false;
    const char* mode = "normal";
    if (now_reply) {
      mode = "mto_now";
    } else if (cadence.mode == TxMode::Shock) {
      mode = "choc";
    } else if (cadence.mode == TxMode::OutOfRange) {
      mode = "hors-plage";
    }
    Serial.print("TX ");
    Serial.print(mode);
    Serial.print(' ');
    Serial.print(writer.size());
    Serial.println(" o");
  }
};

StdRNG fast_rng;
SimpleMeshTables tables;
MyMesh the_mesh(board, radio_driver, *new ArduinoMillis(), fast_rng, rtc_clock, tables);

void halt() {
  while (1) {
  }
}

static char command[160];

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println(kProjectName);
  setFranceTz();

  board.begin();

  if (!radio_init()) {
    halt();
  }

  fast_rng.begin(radio_driver.getRngSeed());

  FILESYSTEM* fs;
#if defined(NRF52_PLATFORM) || defined(STM32_PLATFORM)
  InternalFS.begin();
  fs = &InternalFS;
  IdentityStore store(InternalFS, "");
#elif defined(ESP32)
  SPIFFS.begin(true);
  fs = &SPIFFS;
  IdentityStore store(SPIFFS, "/identity");
#elif defined(RP2040_PLATFORM)
  LittleFS.begin();
  fs = &LittleFS;
  IdentityStore store(LittleFS, "/identity");
  store.begin();
#else
#error "need to define filesystem"
#endif
  if (!store.load("_main", the_mesh.self_id)) {
    the_mesh.self_id = radio_new_identity();
    int count = 0;
    while (count < 10 && (the_mesh.self_id.pub_key[0] == 0x00 || the_mesh.self_id.pub_key[0] == 0xFF)) {
      the_mesh.self_id = radio_new_identity();
      count++;
    }
    store.save("_main", the_mesh.self_id);
  }

  Serial.print("Sensor ID: ");
  mesh::Utils::printHex(Serial, the_mesh.self_id.pub_key, PUB_KEY_SIZE);
  Serial.println();

  command[0] = 0;
  sensors.begin();
  the_mesh.begin(fs);
  station_fs = fs;
  the_mesh.bringUp();

#if ENABLE_ADVERT_ON_BOOT == 1
  the_mesh.sendSelfAdvertisement(16000, false);
#endif
}

void loop() {
  int len = strlen(command);
  if (len >= static_cast<int>(sizeof(command))) {
    command[0] = 0;
    len = 0;
  }
  while (Serial.available() && len < static_cast<int>(sizeof(command)) - 1) {
    char c = Serial.read();
    if (c != '\n') {
      command[len++] = c;
      command[len] = 0;
    }
    Serial.print(c);
  }
  if (len == static_cast<int>(sizeof(command)) - 1) {
    command[sizeof(command) - 2] = '\r';
    command[sizeof(command) - 1] = 0;
  }

  if (len > 0 && command[len - 1] == '\r') {
    command[len - 1] = 0;
    char reply[160];
    the_mesh.handleCommand(nullptr, 0, command, reply);
    if (reply[0]) {
      Serial.print("  -> ");
      Serial.println(reply);
    }
    command[0] = 0;
  }

  board.loop();
  the_mesh.loop();
  sensors.loop();
  rtc_clock.tick();
}
