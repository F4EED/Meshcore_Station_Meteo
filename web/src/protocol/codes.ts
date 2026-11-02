export const APP_NAME = 'stmeteo-web'
export const APP_VERSION = '0.1.0'
export const APP_TARGET_VER = 11

export const CMD_APP_START = 0x01
export const CMD_GET_DEVICE_TIME = 0x05
export const CMD_SET_DEVICE_TIME = 0x06
export const CMD_SET_RADIO_PARAMS = 0x0b
export const CMD_GET_BATT = 0x14
export const CMD_DEVICE_QUERY = 0x16
export const CMD_GET_CHANNEL = 0x1f
export const CMD_SET_CHANNEL = 0x20
export const CMD_TELEMETRY = 0x27
export const CMD_GET_CUSTOM_VARS = 0x28
export const CMD_SET_CUSTOM_VAR = 0x29
export const CMD_SET_DEFAULT_FLOOD_SCOPE = 0x3f
export const CMD_GET_DEFAULT_FLOOD_SCOPE = 0x40

export const CMD_STATION_GET_READING = 0x70
export const CMD_STATION_GET_BAND = 0x71
export const CMD_STATION_SET_BAND = 0x72

export const RESP_OK = 0x00
export const RESP_ERR = 0x01
export const RESP_SELF = 0x05
export const RESP_BATT = 0x0c
export const RESP_DEVICE = 0x0d
export const RESP_CUSTOM_VARS = 0x15
export const RESP_CHANNEL = 0x12
export const RESP_FLOOD = 0x1c
export const RESP_STATION_READING = 0x70
export const RESP_STATION_BAND = 0x71

export const PUSH_ADVERT = 0x80
export const PUSH_ACK = 0x82
export const PUSH_MSG_WAITING = 0x83
export const PUSH_LOG = 0x88
export const PUSH_TELEM = 0x8b

export const IGNORABLE_PUSH = new Set([PUSH_ADVERT, PUSH_ACK, PUSH_MSG_WAITING, PUSH_LOG])

export const ERR_UNSUPPORTED = 1
export const ERR_NOT_FOUND = 2
export const ERR_TABLE_FULL = 3
export const ERR_BAD_STATE = 4
export const ERR_FILE = 5
export const ERR_ILLEGAL = 6

export const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e'
export const NUS_RX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'
export const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'

export const RADIO_FREQ_KHZ = 869618
export const RADIO_BW_MILLIKHZ = 62500
export const RADIO_SF = 8
export const RADIO_CR = 8

export const FACTORY_CHANNEL_NAME = 'Germacrise'
export const FACTORY_CHANNEL_KEY_HEX = 'dce843f4d5c2ed416b4ce17db83df618'
export const FACTORY_REGION = 'fr-ara'
export const FACTORY_CHANNEL_SLOT = 1

export const MIN_UNIX = 1_577_836_800
