# Le TWIM de l'Arduino nRF52 attend les événements sans délai. Un bus
# Grove muet (BME688) bloque alors setup() pour toujours : plus de console
# USB, plus de radio. On borne chaque attente et on réarme le périphérique.

Import("env")

import os

MARKER = "meshcore-station-twim-timeout"
HELPER = r"""
/* meshcore-station-twim-timeout */
static void twim_recover(NRF_TWIM_Type* twim) {
  twim->TASKS_STOP = 1;
  uint32_t start = millis();
  while (!twim->EVENTS_STOPPED && (millis() - start) < 5) {
  }
  twim->ENABLE = (TWIM_ENABLE_ENABLE_Disabled << TWIM_ENABLE_ENABLE_Pos);
  twim->EVENTS_STOPPED = 0;
  twim->EVENTS_ERROR = 0;
  twim->EVENTS_TXSTARTED = 0;
  twim->EVENTS_LASTTX = 0;
  twim->EVENTS_RXSTARTED = 0;
  twim->EVENTS_LASTRX = 0;
  twim->EVENTS_SUSPENDED = 0;
  twim->ERRORSRC = twim->ERRORSRC;
  twim->ENABLE = (TWIM_ENABLE_ENABLE_Enabled << TWIM_ENABLE_ENABLE_Pos);
}

static void twim_wait(volatile uint32_t* event, volatile uint32_t* error_event, NRF_TWIM_Type* twim) {
  uint32_t start = millis();
  while (!(*event) && (error_event == nullptr || !(*error_event))) {
    if ((millis() - start) > 25) {
      twim_recover(twim);
      *event = 1;
      if (error_event) {
        *error_event = 1;
      }
      return;
    }
  }
}

"""

REPLACEMENTS = [
    (
        "while(!_p_twim->EVENTS_TXSTARTED && !_p_twim->EVENTS_ERROR);",
        "twim_wait(&_p_twim->EVENTS_TXSTARTED, &_p_twim->EVENTS_ERROR, _p_twim);",
    ),
    (
        "while(!_p_twim->EVENTS_LASTTX && !_p_twim->EVENTS_ERROR);",
        "twim_wait(&_p_twim->EVENTS_LASTTX, &_p_twim->EVENTS_ERROR, _p_twim);",
    ),
    (
        "while(!_p_twim->EVENTS_RXSTARTED && !_p_twim->EVENTS_ERROR);",
        "twim_wait(&_p_twim->EVENTS_RXSTARTED, &_p_twim->EVENTS_ERROR, _p_twim);",
    ),
    (
        "while(!_p_twim->EVENTS_LASTRX && !_p_twim->EVENTS_ERROR);",
        "twim_wait(&_p_twim->EVENTS_LASTRX, &_p_twim->EVENTS_ERROR, _p_twim);",
    ),
    (
        "while(!_p_twim->EVENTS_STOPPED);",
        "twim_wait(&_p_twim->EVENTS_STOPPED, nullptr, _p_twim);",
    ),
    (
        "while(!_p_twim->EVENTS_SUSPENDED);",
        "twim_wait(&_p_twim->EVENTS_SUSPENDED, nullptr, _p_twim);",
    ),
]


def patch_wire():
    pkg = env.PioPlatform().get_package_dir("framework-arduinoadafruitnrf52")
    path = os.path.join(pkg, "libraries", "Wire", "Wire_nRF52.cpp")
    if not os.path.isfile(path):
        print("fix_wire_timeout: Wire_nRF52.cpp introuvable, build continué")
        return
    with open(path, "r", encoding="utf-8") as handle:
        text = handle.read()
    if MARKER in text:
        print("fix_wire_timeout: déjà en place")
        return
    anchor = '#include "Wire.h"\n'
    if anchor not in text:
        print("fix_wire_timeout: ancre absente, build continué")
        return
    updated = text.replace(anchor, anchor + HELPER, 1)
    for old, new in REPLACEMENTS:
        count = updated.count(old)
        if count == 0:
            print("fix_wire_timeout: motif absent: " + old)
            return
        updated = updated.replace(old, new)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(updated)
    print("fix_wire_timeout: TWIM borné à 25 ms (%s)" % path)


patch_wire()
