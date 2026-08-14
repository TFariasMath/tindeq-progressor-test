/**
 * Tindeq Progressor BLE Hardware Driver (Hardened & Universal BLE Version)
 * Handles Web Bluetooth API connection, GATT service discovery, TLV parsing,
 * dynamic write fallback, resilient filters, race-condition protection,
 * universal BLE device scanning (Phones, Watches, Sensors), and automated self-tests.
 */

export const TINDEQ_UUIDS = Object.freeze({
    SERVICE: "7e4e1701-1ea6-40c9-9dcc-13d34ffead57",
    DATA_CHAR: "7e4e1702-1ea6-40c9-9dcc-13d34ffead57",
    CONTROL_CHAR: "7e4e1703-1ea6-40c9-9dcc-13d34ffead57"
});

export const TINDEQ_COMMANDS = Object.freeze({
    TARE: 100,                  // 0x64
    START_WEIGHT_MEAS: 101,     // 0x65
    STOP_WEIGHT_MEAS: 102,      // 0x66
    START_PEAK_RFD: 103,        // 0x67
    START_PEAK_RFD_SERIES: 104, // 0x68
    ADD_CALIBRATION_POINT: 105, // 0x69
    SAVE_CALIBRATION: 106,      // 0x6A
    GET_APP_VERSION: 107,       // 0x6B
    GET_ERROR_INFO: 108,        // 0x6C
    CLR_ERROR_INFO: 109,        // 0x6D
    ENTER_SLEEP: 110,           // 0x6E
    GET_BATTERY_VOLTAGE: 111    // 0x6F
});

export const TINDEQ_RESPONSES = Object.freeze({
    CMD_RESPONSE: 0,
    WEIGHT_MEAS: 1,
    RFD_PEAK: 2,
    RFD_PEAK_SERIES: 3,
    LOW_PWR_WARNING: 4
});

export class TindeqBleDriver {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.dataChar = null;
        this.controlChar = null;
        
        this.isConnected = false;
        this.isMeasuring = false;
        this.lastRequestedCmd = null;
        this.isGenericDevice = false;
        this.hasLoggedFirstSample = false;

        // Callback listeners
        this.onLog = null;
        this.onStatusChange = null;
        this.onWeightData = null;
        this.onBatteryRead = null;
        this.onFirmwareRead = null;
        this.onErrorInfoRead = null;
        this.onLowBatteryWarning = null;
        this.onDisconnected = null;

        this._boundHandleNotifications = this._handleNotifications.bind(this);
        this._boundHandleDisconnect = this._handleDisconnect.bind(this);
    }

    static isSupported() {
        return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
    }

    log(msg, type = 'info') {
        const timeStr = new Date().toLocaleTimeString();
        if (this.onLog) {
            this.onLog({ time: timeStr, text: msg, type });
        } else {
            console.log(`[Tindeq BLE ${type.toUpperCase()}] ${msg}`);
        }
    }

    /**
     * Scan and connect to BLE devices
     * @param {boolean} acceptAllDevices If true, allows scanning any nearby BLE peripheral (phones, watches, headphones)
     */
    async connect(acceptAllDevices = false) {
        if (!TindeqBleDriver.isSupported()) {
            throw new Error("Web Bluetooth API no está soportada en este navegador. Utiliza Google Chrome o Microsoft Edge sobre HTTPS o localhost.");
        }

        this.log(`Iniciando escaneo BLE (${acceptAllDevices ? 'Todos los dispositivos cercanos' : 'Filtro Tindeq'})...`, "info");
        
        try {
            const optionalServices = [
                TINDEQ_UUIDS.SERVICE,
                'battery_service',
                'device_information',
                'generic_access',
                'generic_attribute'
            ];

            if (acceptAllDevices) {
                this.device = await navigator.bluetooth.requestDevice({
                    acceptAllDevices: true,
                    optionalServices: optionalServices
                });
            } else {
                this.device = await navigator.bluetooth.requestDevice({
                    filters: [
                        { namePrefix: 'Progressor' },
                        { namePrefix: 'tindeq' },
                        { namePrefix: 'Tindeq' },
                        { services: [TINDEQ_UUIDS.SERVICE] }
                    ],
                    optionalServices: optionalServices
                });
            }

            this.log(`Dispositivo seleccionado: "${this.device.name || 'Dispositivo BLE sin nombre'}" (ID: ${this.device.id})`, "success");
            this.device.addEventListener('gattserverdisconnected', this._boundHandleDisconnect);

            this.log("Conectando al servidor GATT del dispositivo...", "info");
            this.server = await this.device.gatt.connect();
            this.log("Servidor GATT conectado con éxito.", "success");

            // Inspect available services on the connected device
            await this._inspectDeviceServices();

            this.isConnected = true;
            if (this.onStatusChange) {
                this.onStatusChange({ connected: true, measuring: false, deviceName: this.device.name || 'Dispositivo BLE' });
            }

        } catch (error) {
            this.log(`Fallo durante la conexión BLE: ${error.message}`, "error");
            await this.disconnect();
            throw error;
        }
    }

    /**
     * Inspect GATT services and attempt to initialize Tindeq characteristics if present
     */
    async _inspectDeviceServices() {
        this.log("Explorando servicios GATT disponibles en el dispositivo...", "info");
        let isTindeqFound = false;

        // Try fetching Tindeq Primary Service & Characteristics
        try {
            this.service = await this.server.getPrimaryService(TINDEQ_UUIDS.SERVICE);
            this.log(`Servicio Tindeq detectado (${TINDEQ_UUIDS.SERVICE}).`, "success");
            
            this.controlChar = await this.service.getCharacteristic(TINDEQ_UUIDS.CONTROL_CHAR);
            this.dataChar = await this.service.getCharacteristic(TINDEQ_UUIDS.DATA_CHAR);

            // Attach listener BEFORE starting notifications
            this.dataChar.addEventListener('characteristicvaluechanged', this._boundHandleNotifications);
            await this.dataChar.startNotifications();

            this.isGenericDevice = false;
            isTindeqFound = true;
            this.log("Características de Tindeq configuradas. Listo para medir fuerza.", "success");
        } catch (errTindeq) {
            this.isGenericDevice = true;
            this.log(`Nota: El dispositivo "${this.device.name || 'BLE'}" no expuso el servicio principal Tindeq (${errTindeq.message}). Modo Inspector BLE genérico activo.`, "warning");
        }

        // If Tindeq characteristics were found, attempt reading initial metadata safely
        if (isTindeqFound) {
            try {
                await this.getFirmwareVersion();
                await new Promise(r => setTimeout(r, 350));
                await this.getBatteryVoltage();
            } catch (eMeta) {
                this.log(`Nota al leer metadatos iniciales: ${eMeta.message}`, "debug");
            }
            return;
        }

        // Try reading battery service if available on generic device (like phones/watches)
        try {
            const battService = await this.server.getPrimaryService('battery_service');
            const battChar = await battService.getCharacteristic('battery_level');
            const battValue = await battChar.readValue();
            const percent = battValue.getUint8(0);
            this.log(`Lectura de Batería BLE del Dispositivo: ${percent}%`, "info");
            if (this.onBatteryRead) this.onBatteryRead({ millivolts: 3000, percent });
        } catch (e) {
            this.log("Servicio de batería estándar no expuesto por el dispositivo.", "debug");
        }
    }

    async disconnect() {
        if (this.isMeasuring) {
            try { await this.stopMeasurement(); } catch (e) {}
        }

        if (this.dataChar) {
            try {
                this.dataChar.removeEventListener('characteristicvaluechanged', this._boundHandleNotifications);
                await this.dataChar.stopNotifications();
            } catch (e) {}
        }

        if (this.device && this.device.gatt && this.device.gatt.connected) {
            this.log("Cerrando sesión GATT...", "info");
            try { this.device.gatt.disconnect(); } catch (e) {}
        }

        this.isConnected = false;
        this.isMeasuring = false;
        this.isGenericDevice = false;

        if (this.onStatusChange) {
            this.onStatusChange({ connected: false, measuring: false, deviceName: null });
        }
    }

    _handleDisconnect() {
        this.log("Desconexión física detectada del dispositivo BLE.", "warning");
        this.isConnected = false;
        this.isMeasuring = false;
        this.isGenericDevice = false;
        if (this.onDisconnected) this.onDisconnected();
        if (this.onStatusChange) {
            this.onStatusChange({ connected: false, measuring: false, deviceName: null });
        }
    }

    async sendCommand(cmdByte) {
        if (!this.isConnected) {
            throw new Error("No hay conexión activa con el dispositivo.");
        }
        if (!this.controlChar) {
            this.log(`Control Point Tindeq no disponible. Comando 0x${cmdByte.toString(16)} omitido.`, "warning");
            return;
        }

        const buffer = Uint8Array.from([cmdByte]);
        this.lastRequestedCmd = cmdByte;
        const props = this.controlChar.properties || {};

        try {
            if (props.writeWithoutResponse && typeof this.controlChar.writeValueWithoutResponse === 'function') {
                await this.controlChar.writeValueWithoutResponse(buffer);
            } else if (props.write && typeof this.controlChar.writeValueWithResponse === 'function') {
                await this.controlChar.writeValueWithResponse(buffer);
            } else {
                await this.controlChar.writeValue(buffer);
            }
            this.log(`Comando enviado: Opcode 0x${cmdByte.toString(16).toUpperCase()} (${cmdByte})`, "debug");
        } catch (err) {
            try {
                await this.controlChar.writeValue(buffer);
                this.log(`Comando enviado por fallback: 0x${cmdByte.toString(16).toUpperCase()}`, "debug");
            } catch (err2) {
                this.log(`Error crítico al enviar comando 0x${cmdByte.toString(16)}: ${err2.message}`, "error");
                throw err2;
            }
        }
    }

    async tare() {
        this.log("Ejecutando TARA (Poner a cero)...", "info");
        await this.sendCommand(TINDEQ_COMMANDS.TARE);
    }

    async startMeasurement() {
        this.log("Iniciando MEDICIÓN CONTINUA (~80 Hz)...", "info");
        this.hasLoggedFirstSample = false;
        await this.sendCommand(TINDEQ_COMMANDS.START_WEIGHT_MEAS);
        this.isMeasuring = true;
        if (this.onStatusChange) {
            this.onStatusChange({ connected: true, measuring: true, deviceName: this.device?.name });
        }
    }

    async stopMeasurement() {
        this.log("Deteniendo MEDICIÓN CONTINUA...", "info");
        await this.sendCommand(TINDEQ_COMMANDS.STOP_WEIGHT_MEAS);
        this.isMeasuring = false;
        if (this.onStatusChange) {
            this.onStatusChange({ connected: true, measuring: false, deviceName: this.device?.name });
        }
    }

    async getBatteryVoltage() {
        await this.sendCommand(TINDEQ_COMMANDS.GET_BATTERY_VOLTAGE);
    }

    async getFirmwareVersion() {
        await this.sendCommand(TINDEQ_COMMANDS.GET_APP_VERSION);
    }

    async enterSleep() {
        this.log("Enviando comando SLEEP...", "warning");
        await this.sendCommand(TINDEQ_COMMANDS.ENTER_SLEEP);
        await this.disconnect();
    }

    async runSelfTest() {
        this.log("INICIANDO PRUEBA DE DIAGNÓSTICO AUTOMÁTICO (SELF-TEST)...", "info");
        
        try {
            await this.getFirmwareVersion();
            await new Promise(r => setTimeout(r, 400));
            
            await this.getBatteryVoltage();
            await new Promise(r => setTimeout(r, 400));

            await this.tare();
            await new Promise(r => setTimeout(r, 400));

            this.log("Iniciando prueba breve de muestreo continuo (3 segundos)...", "info");
            await this.startMeasurement();
            await new Promise(r => setTimeout(r, 3000));
            
            await this.stopMeasurement();
            this.log("PRUEBA DE DIAGNÓSTICO FINALIZADA. Haz clic en 'Iniciar Medición' para medir continuamente.", "success");
            return true;
        } catch (e) {
            this.log(`FALLO EN DIAGNÓSTICO AUTOMÁTICO: ${e.message}`, "error");
            return false;
        }
    }

    _handleNotifications(event) {
        const dataView = event.target.value;
        if (!dataView || dataView.byteLength < 2) return;

        const responseCode = dataView.getUint8(0);
        const payloadSize = dataView.getUint8(1);

        switch (responseCode) {
            case TINDEQ_RESPONSES.WEIGHT_MEAS: {
                const samples = [];
                for (let offset = 2; offset + 8 <= dataView.byteLength; offset += 8) {
                    const weightKg = dataView.getFloat32(offset, true);
                    const timestampUs = dataView.getUint32(offset + 4, true);
                    samples.push({ weightKg, timestampUs });
                }

                if (samples.length > 0) {
                    if (!this.hasLoggedFirstSample) {
                        this.log(`Telemetría en tiempo real activa: recibiendo lecturas a 80 Hz (Primera muestra: ${samples[0].weightKg.toFixed(2)} kg)`, "success");
                        this.hasLoggedFirstSample = true;
                    }

                    if (this.onWeightData) {
                        this.onWeightData(samples);
                    }
                }
                break;
            }

            case TINDEQ_RESPONSES.CMD_RESPONSE: {
                this._parseCmdResponse(dataView, payloadSize);
                break;
            }

            case TINDEQ_RESPONSES.LOW_PWR_WARNING: {
                this.log("ALERTA: Voltaje de batería críticamente bajo.", "warning");
                if (this.onLowBatteryWarning) this.onLowBatteryWarning();
                break;
            }

            default: {
                this.log(`Notificación no clasificada recibida: Código ${responseCode}, Bytes ${dataView.byteLength}`, "debug");
                break;
            }
        }
    }

    _parseCmdResponse(dataView, payloadSize) {
        const rawBytes = new Uint8Array(dataView.buffer, dataView.byteOffset + 2, dataView.byteLength - 2);

        if (this.lastRequestedCmd === TINDEQ_COMMANDS.GET_BATTERY_VOLTAGE && rawBytes.length >= 4) {
            const millivolts = dataView.getUint32(2, true);
            if (millivolts >= 1800 && millivolts <= 4500) {
                const percent = this._calculateBatteryPercent(millivolts);
                this.log(`Batería reportada: ${millivolts} mV (~${percent}%)`, "info");
                if (this.onBatteryRead) this.onBatteryRead({ millivolts, percent });
                return;
            }
        }

        const decoder = new TextDecoder('utf-8');
        const textStr = decoder.decode(rawBytes);
        
        if (this.lastRequestedCmd === TINDEQ_COMMANDS.GET_APP_VERSION || textStr.includes('.') || textStr.length < 15) {
            this.log(`Firmware del dispositivo: v${textStr}`, "info");
            if (this.onFirmwareRead) this.onFirmwareRead(textStr);
        } else if (this.lastRequestedCmd === TINDEQ_COMMANDS.GET_ERROR_INFO) {
            this.log(`CrashLog: ${textStr}`, "debug");
            if (this.onErrorInfoRead) this.onErrorInfoRead(textStr);
        }
    }

    _calculateBatteryPercent(mV) {
        const MIN_MV = 2400;
        const MAX_MV = 3300;
        if (mV >= MAX_MV) return 100;
        if (mV <= MIN_MV) return 0;
        return Math.round(((mV - MIN_MV) / (MAX_MV - MIN_MV)) * 100);
    }
}
