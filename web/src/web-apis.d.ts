interface SerialPortFilter {
  usbVendorId: number
  usbProductId?: number
}

interface SerialPort {
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  addEventListener(type: 'disconnect', listener: () => void): void
}

interface SerialPortRequestOptions {
  filters?: SerialPortFilter[]
}

interface Serial {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>
}

interface BluetoothRequestDeviceOptions {
  filters?: Array<{ services?: string[] }>
  optionalServices?: string[]
  acceptAllDevices?: boolean
}

interface Bluetooth {
  requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>
}

interface BluetoothDevice extends EventTarget {
  name?: string
  gatt?: BluetoothRemoteGATTServer | null
  addEventListener(type: 'gattserverdisconnected', listener: () => void): void
}

interface BluetoothRemoteGATTServer {
  connect(): Promise<BluetoothRemoteGATTServer>
  disconnect(): void
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>
}

interface BluetoothRemoteGATTService {
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>
}

interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  value?: DataView | null
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>
  writeValue(value: Uint8Array): Promise<void>
  writeValueWithoutResponse(value: Uint8Array): Promise<void>
  addEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void
  removeEventListener(type: 'characteristicvaluechanged', listener: (event: Event) => void): void
}

interface Navigator {
  serial?: Serial
  bluetooth?: Bluetooth
}
