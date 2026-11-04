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
// ajoutés à la télémétrie (requête, push et GRP_DATA). mto_now — GRP_TXT du
// canal (avec ou sans octet de type), message direct ou CLI — déclenche un
// flood. La copie canonique est fr-42. Une demande entendue en fr, sans
// région, ou sous une autre étiquette, est aussi renvoyée sur cette portée
// pour qu'un répéteur qui n'a que fr puisse la porter. Le GRP_DATA 0xFF42
// part dès qu'il y a au moins T ou P. Sans mesure, un GRP_TXT « pas de mesure »
// part quand même. Canal hashtag : secret = 16 premiers octets de
// SHA-256("#germacrisepublic"), hash d'air 0x81. MAC sur 32 octets
// (les 16 de queue à zéro), AES sur les 16 de tête.
// À chaque boot, la radio est recollée sur EU868 Narrow (le fichier de
// réglages survit au UF2). CAD coupé. Pas de sommeil. L'I2C capteur ne
// s'exécute pas dans le callback radio.

static const char kBandsPath[] = "/stmet.bands";
static const char kSeedPath[] = "/stmet.seed";
static const char kGpsPath[] = "/stmet.gps";
static const char kFranceTz[] = "CET-1CEST,M3.5.0,M10.5.0/3";
static const unsigned long kIaqGapMs = (kSamplePeriodS - 5) * 1000UL;
static const unsigned long kMtoQuietMs = 4000UL;
static const unsigned long kCaptureGapMs = 2000UL;

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
    memset(parent_key_.key, 0, sizeof(parent_key_.key));
  }

  void bringUp() {
    loadBands();
    prepareChannel();
    lockRadio();
    ensureRegions();
    if (!fileExists(kSeedPath)) {
      seedRadio();
    }
    loadGpsMarker();
    Serial.print("canal ");
    Serial.print(kChannelName);
    Serial.print(" h");
    Serial.print(channel_.hash[0], HEX);
    Serial.print(" cle ");
    mesh::Utils::printHex(Serial, channel_.secret, 16);
    Serial.println();
    Serial.println("RX armee");
    Serial.flush();
  }

  // Après sensors.begin(), pour que le GPS soit déjà détecté.
  void startGpsChase() { armGpsChase(); }

  void loop() {
    chaseGps();
    SensorMesh::loop();
    maybePublish();
    beat();
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

  // fr, fr-42, ou flood sans code de transport : on ne jette rien ici.
  // Le filtre répéteur (région inconnue) n'est pas celui d'un capteur.
  bool filterRecvFloodPacket(mesh::Packet* packet) override {
    (void)packet;
    return false;
  }

  mesh::DispatcherAction onRecvPacket(mesh::Packet* pkt) override {
    if (pkt != nullptr && pkt->isRouteFlood()) {
      rx_floods_++;
      uint8_t type = pkt->getPayloadType();
      if (type == PAYLOAD_TYPE_GRP_TXT || type == PAYLOAD_TYPE_GRP_DATA) {
        Serial.print("RX ");
        Serial.print(type == PAYLOAD_TYPE_GRP_TXT ? "txt" : "data");
        if (pkt->payload_len > 0) {
          Serial.print(" h");
          Serial.print(pkt->payload[0], HEX);
        }
        if (!pkt->hasTransportCodes() || pkt->transport_codes[0] == 0) {
          Serial.print(" ouvert");
        }
        Serial.println();
      }
    }
    return SensorMesh::onRecvPacket(pkt);
  }

  int searchChannelsByHash(const uint8_t* hash, mesh::GroupChannel channels[], int max_matches) override {
    // L'appelant ne fournit qu'un octet (PATH_HASH_SIZE). On ne lit pas plus loin.
    // Indépendant de la région : un GRP_TXT du canal hashtag se déchiffre
    // même si le flood n'est pas fr-42.
    if (!hash_ready_ || hash == nullptr || max_matches < 1) {
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
    (void)channel;
    if (type != PAYLOAD_TYPE_GRP_TXT || !grpTxtRequestsCommand(data, len, kMtoNow)) {
      return;
    }
    armMtoNow(scopeOf(packet));
  }

  void onPeerDataRecv(mesh::Packet* packet, uint8_t type, int sender_idx, const uint8_t* secret, uint8_t* data,
                      size_t len) override {
    if (type == PAYLOAD_TYPE_TXT_MSG && data != nullptr && len > 5) {
      uint8_t txt_type = static_cast<uint8_t>(data[4] >> 2);
      if (txt_type <= TXT_TYPE_CLI_COMMAND && bytesContainCommand(data + 5, len - 5, kMtoNow)) {
        armMtoNow(scopeOf(packet));
      }
    }
    SensorMesh::onPeerDataRecv(packet, type, sender_idx, secret, data, len);
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
    if (containsCommand(command, kMtoNow)) {
      armMtoNow(HearScope::Fr42);
      if (!have_latest_) {
        captureSample();
      }
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
  TransportKey parent_key_;
  HearScope hear_ = HearScope::Fr42;
  uint32_t rx_floods_ = 0;
  unsigned long last_beat_ms_ = 0;
  bool channel_ready_ = false;
  bool have_latest_ = false;
  bool have_prev_ = false;
  bool ever_sent_ = false;
  bool sample_pending_ = false;
  bool force_tx_ = false;
  bool reply_now_ = false;
  bool hash_ready_ = false;
  unsigned long last_capture_ms_ = 0;
  unsigned long last_mto_sent_ms_ = 0;
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
    // Hashtag MeshCore : SHA-256(nom complet, « # » compris), 16 premiers
    // octets. hash[] n'en fait qu'un et secret[] le suit en mémoire :
    // le digest d'air est calculé dans un tampon à part.
    uint8_t name_digest[32];
    memset(channel_.secret, 0, sizeof(channel_.secret));
    mesh::Utils::sha256(name_digest, sizeof(name_digest), reinterpret_cast<const uint8_t*>(kChannelName),
                        static_cast<int>(strlen(kChannelName)));
    memcpy(channel_.secret, name_digest, 16);
    uint8_t air[32];
    mesh::Utils::sha256(air, sizeof(air), channel_.secret, 16);
    memset(channel_.hash, 0, sizeof(channel_.hash));
    channel_.hash[0] = air[0];
    hash_ready_ = true;
    if (air[0] != kChannelAirHash) {
      Serial.println("hash canal inattendu");
    }
    char tagged[24];
    snprintf(tagged, sizeof(tagged), "#%s", kRegionFlood);
    mesh::Utils::sha256(region_key_.key, sizeof(region_key_.key), reinterpret_cast<const uint8_t*>(tagged),
                        static_cast<int>(strlen(tagged)));
    snprintf(tagged, sizeof(tagged), "#%s", kRegionParent);
    mesh::Utils::sha256(parent_key_.key, sizeof(parent_key_.key), reinterpret_cast<const uint8_t*>(tagged),
                        static_cast<int>(strlen(tagged)));
    channel_ready_ = hash_ready_ && !region_key_.isNull() && !parent_key_.isNull();
  }

  // Le UF2 n'efface pas InternalFS. Un ancien compagnon ou une image
  // précédente peut y avoir laissé CR 5, une autre fréquence, ou le CAD.
  void lockRadio() {
    NodePrefs* prefs = getNodePrefs();
    prefs->freq = LORA_FREQ;
    prefs->bw = LORA_BW;
    prefs->sf = LORA_SF;
    prefs->cr = LORA_CR;
    prefs->tx_power_dbm = LORA_TX_POWER;
    prefs->cad_enabled = 0;
    prefs->interference_threshold = 0;
    prefs->disable_fwd = 1;
    prefs->path_hash_mode = 1;
    prefs->rx_boosted_gain = 1;
    radio_driver.setParams(prefs->freq, prefs->bw, prefs->sf, prefs->cr);
    radio_driver.setTxPower(prefs->tx_power_dbm);
    radio_driver.setRxBoostedGainMode(true);
    radio_driver.setCADEnabled(false);
    savePrefs();
    Serial.print("radio ");
    Serial.print(prefs->freq, 3);
    Serial.print(" bw ");
    Serial.print(prefs->bw, 1);
    Serial.print(" sf ");
    Serial.print(prefs->sf);
    Serial.print(" cr ");
    Serial.println(prefs->cr);
  }

  void ensureRegions() {
    static const char* kCmds[] = {
        "region def eu europe fr",
        "region put fr-42 fr",
        "region allowf fr",
        "region allowf fr-42",
        "region allowf *",
        "region home fr-42",
        "region default fr-42",
        "region save",
    };
    for (size_t i = 0; i < sizeof(kCmds) / sizeof(kCmds[0]); ++i) {
      runCli(kCmds[i]);
    }
  }

  void captureSample() {
    unsigned long now_ms = millis();
    if (last_capture_ms_ != 0 && now_ms - last_capture_ms_ < kCaptureGapMs) {
      return;
    }
    last_capture_ms_ = now_ms;
    CayenneLPP local(MAX_PACKET_PAYLOAD - 4);
    float volts = static_cast<float>(board.getBattMilliVolts()) / 1000.0f;
    local.addVoltage(kLppChNode, volts);
    sensors.querySensors(0xFF, local);
    onTelemetryBuilt(local);
  }

  HearScope scopeOf(const mesh::Packet* packet) const {
    if (packet == nullptr || !hash_ready_) {
      return HearScope::Fr42;
    }
    bool has = packet->hasTransportCodes();
    uint16_t code = has ? packet->transport_codes[0] : 0;
    uint16_t code_fr42 = has ? region_key_.calcTransportCode(packet) : 0;
    uint16_t code_fr = has ? parent_key_.calcTransportCode(packet) : 0;
    return hearScopeOf(packet->isRouteFlood(), has, code, code_fr42, code_fr);
  }

  // Pas de lecture I2C ici : le callback est dans la boucle radio.
  void armMtoNow(HearScope scope) {
    unsigned long now_ms = millis();
    if (!reply_now_ && last_mto_sent_ms_ != 0 && now_ms - last_mto_sent_ms_ < kMtoQuietMs) {
      return;
    }
    bool first = !reply_now_;
    reply_now_ = true;
    hear_ = scope;
    if (first) {
      Serial.print("mto_now scope ");
      Serial.println(static_cast<int>(scope));
    }
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
        "set cad off",
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
    int body_len = have_latest_ ? formatMeteoLine(latest_, body, static_cast<int>(sizeof(body))) : -1;
    if (body_len <= 0) {
      body_len = snprintf(body, sizeof(body), "pas de mesure");
      if (body_len <= 0) {
        return nullptr;
      }
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

  void dispatchFlood(const TransportKey* scope, mesh::Packet* packet) {
    uint8_t hash_size = static_cast<uint8_t>(getNodePrefs()->path_hash_mode + 1);
    if (scope == nullptr || scope->isNull()) {
      sendFlood(packet, 0, hash_size);
    } else {
      sendFloodScoped(*scope, packet, 0, hash_size);
    }
  }

  mesh::Packet* makeDataPacket() {
    uint8_t lpp[128];
    LppWriter writer(lpp, static_cast<int>(sizeof(lpp)));
    if (!appendCurated(&writer) || writer.size() > MAX_GROUP_DATA_LENGTH) {
      return nullptr;
    }
    uint8_t plain[3 + sizeof(lpp)];
    plain[0] = static_cast<uint8_t>(kStmetDataType & 0xff);
    plain[1] = static_cast<uint8_t>(kStmetDataType >> 8);
    plain[2] = static_cast<uint8_t>(writer.size());
    memcpy(plain + 3, writer.data(), writer.size());
    return createGroupDatagram(PAYLOAD_TYPE_GRP_DATA, channel_, plain, 3 + writer.size());
  }

  // nullptr = flood sans code de transport.
  int queueScope(const TransportKey* scope, bool with_text, bool with_data, uint32_t now, int* bytes_out) {
    int sent = 0;
    if (with_data) {
      mesh::Packet* data_pkt = makeDataPacket();
      if (data_pkt != nullptr) {
        if (bytes_out != nullptr) {
          *bytes_out = data_pkt->payload_len;
        }
        dispatchFlood(scope, data_pkt);
        sent++;
      }
    }
    if (with_text) {
      mesh::Packet* text_pkt = buildGroupText(now);
      if (text_pkt != nullptr) {
        if (bytes_out != nullptr && *bytes_out == 0) {
          *bytes_out = text_pkt->payload_len;
        }
        dispatchFlood(scope, text_pkt);
        sent++;
      }
    }
    return sent;
  }

  void beat() {
    unsigned long now_ms = millis();
    if (last_beat_ms_ != 0 && now_ms - last_beat_ms_ < 10000UL) {
      return;
    }
    last_beat_ms_ = now_ms;
    NodePrefs* prefs = getNodePrefs();
    Serial.print("ecoute ");
    Serial.print(kChannelName);
    Serial.print(" h");
    Serial.print(channel_.hash[0], HEX);
    Serial.print(' ');
    Serial.print(kRegionFlood);
    Serial.print(" rx=");
    Serial.print(rx_floods_);
    Serial.print(" cr=");
    Serial.print(prefs->cr);
    Serial.print(" cad=");
    Serial.println(prefs->cad_enabled ? "on" : "off");
  }

  void maybePublish() {
    if (reply_now_ && !have_latest_) {
      captureSample();
    }
    if (!channel_ready_) {
      return;
    }
    bool now_reply = reply_now_;
    if (!now_reply && !have_latest_) {
      return;
    }
    if (!sample_pending_ && !force_tx_ && !now_reply) {
      return;
    }
    uint32_t now = getRTCClock()->getCurrentTime();
    Cadence cadence;
    cadence.mode = TxMode::Normal;
    cadence.interval_s = kNoClockIntervalS;
    if (have_latest_) {
      cadence = evaluateCadence(latest_, have_prev_, prev_, bands_, ever_sent_ ? last_tx_unix_ : now);
    }
    if (!force_tx_ && !now_reply && !txDue(ever_sent_, now, last_tx_unix_, cadence.interval_s)) {
      sample_pending_ = false;
      return;
    }

    bool with_data = true;
    bool with_text = false;
    if (now_reply) {
      DutyPlan plan = planReplyTx(have_latest_);
      with_data = plan.send_data;
      with_text = plan.send_text;
    } else {
      mesh::Packet* probe = makeDataPacket();
      if (probe == nullptr) {
        return;
      }
      uint32_t budget = static_cast<uint32_t>(getRemainingTxBudget());
      uint32_t data_air = airMs(probe);
      releasePacket(probe);
      DutyPlan plan = planDutyTx(budget, data_air, data_air, false);
      if (!plan.send_data) {
        return;
      }
    }

    int bytes = 0;
    int n = queueScope(&region_key_, with_text, with_data, now, &bytes);
    if (now_reply && replyAlsoOnParent(hear_)) {
      n += queueScope(&parent_key_, with_text, with_data, now, nullptr);
    }
    if (now_reply && replyAlsoOpen(hear_)) {
      n += queueScope(nullptr, with_text, with_data, now, nullptr);
    }
    if (n == 0) {
      return;
    }

    if (have_latest_) {
      prev_ = latest_;
      have_prev_ = true;
      ever_sent_ = true;
      last_tx_unix_ = now;
    }
    sample_pending_ = false;
    force_tx_ = false;
    if (now_reply) {
      last_mto_sent_ms_ = millis();
    }
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
    Serial.print(bytes);
    Serial.print(" o x");
    Serial.println(n);
  }
};

StdRNG fast_rng;
SimpleMeshTables tables;
MyMesh the_mesh(board, radio_driver, *new ArduinoMillis(), fast_rng, rtc_clock, tables);

static char command[160];
static bool radio_ok = false;
static bool mesh_up = false;
static bool sensors_booted = false;

static void bootMesh() {
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
  the_mesh.begin(fs);
  station_fs = fs;
  the_mesh.bringUp();
  mesh_up = true;

#if ENABLE_ADVERT_ON_BOOT == 1
  the_mesh.sendSelfAdvertisement(16000, false);
#endif
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println(kProjectName);
  Serial.println(kFirmwareVersion);
  Serial.flush();
  setFranceTz();

  board.begin();

  radio_ok = radio_init();
  if (!radio_ok) {
    Serial.println("radio init echec");
    Serial.flush();
    return;
  }
  bootMesh();
}

void loop() {
  if (!radio_ok) {
    radio_ok = radio_init();
    if (!radio_ok) {
      Serial.println("radio init echec");
      delay(2000);
      return;
    }
    bootMesh();
  }
  if (!mesh_up) {
    return;
  }
  if (!sensors_booted) {
    the_mesh.loop();
    sensors.begin();
    the_mesh.startGpsChase();
    sensors_booted = true;
    Serial.println("capteurs prets");
    Serial.flush();
  }

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
