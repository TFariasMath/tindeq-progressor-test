/**
 * Real-Time BLE Process Tracer & Timeline Machine
 * Tracks the 8 sequential steps of Web Bluetooth lifecycle, captures system environment,
 * updates visual UI steppers, and exports full JSON diagnostic traces.
 */

export const TRACER_STEPS = Object.freeze({
    1: { id: 'browser', name: 'Navegador Web BLE', desc: 'Verificando soporte de Web Bluetooth API y HTTPS' },
    2: { id: 'device_select', name: 'Selección de Dispositivo', desc: 'Esperando que el usuario vincule el Tindeq en el diálogo nativo' },
    3: { id: 'gatt_connect', name: 'Conexión Servidor GATT', desc: 'Estableciendo enlace de radio BLE con la antena del sensor' },
    4: { id: 'service_discovery', name: 'Servicio Principal Tindeq', desc: 'Obteniendo Servicio 7e4e1701 y características Control/Data' },
    5: { id: 'notifications_sub', name: 'Suscripción de Notificaciones', desc: 'Activando receptor de notificaciones a 80 Hz en Data Point' },
    6: { id: 'metadata_read', name: 'Lectura de Metadatos', desc: 'Consultando versión de firmware y voltaje de batería' },
    7: { id: 'command_start', name: 'Transmisión Opcode 101', desc: 'Enviando comando START_WEIGHT_MEAS a Control Point' },
    8: { id: 'telemetry_stream', name: 'Telemetría a 80 Hz', desc: 'Procesando lecturas de fuerza continuas en tiempo real' }
});

export class BleProcessTracer {
    constructor() {
        this.stepState = {};
        this.timelineLog = [];
        this.startTime = Date.now();
        this.onStepUpdate = null;

        this._resetSteps();
    }

    _resetSteps() {
        this.stepState = {};
        for (let i = 1; i <= 8; i++) {
            this.stepState[i] = {
                step: i,
                id: TRACER_STEPS[i].id,
                name: TRACER_STEPS[i].name,
                desc: TRACER_STEPS[i].desc,
                status: 'idle', // 'idle', 'running', 'success', 'fail'
                timestamp: null,
                detail: null
            };
        }
    }

    reset() {
        this.startTime = Date.now();
        this.timelineLog = [];
        this._resetSteps();
        if (this.onStepUpdate) this.onStepUpdate(this.stepState);
    }

    setStepStatus(stepNumber, status, detail = null) {
        if (!this.stepState[stepNumber]) return;

        const current = this.stepState[stepNumber];
        current.status = status;
        current.timestamp = new Date().toLocaleTimeString();
        current.detail = detail;

        this.timelineLog.push({
            time: current.timestamp,
            elapsedMs: Date.now() - this.startTime,
            step: stepNumber,
            name: current.name,
            status,
            detail
        });

        if (this.onStepUpdate) {
            this.onStepUpdate(this.stepState);
        }
    }

    getSystemDiagnostics() {
        return {
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'Unknown',
            isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
            protocol: typeof location !== 'undefined' ? location.protocol : 'unknown',
            webBluetoothSupported: typeof navigator !== 'undefined' && 'bluetooth' in navigator,
            screenResolution: typeof window !== 'undefined' ? `${window.screen.width}x${window.screen.height}` : 'unknown',
            devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
            timestampISO: new Date().toISOString()
        };
    }

    exportDiagnosticJson() {
        const report = {
            appName: "Tindeq Progressor Web Telemetry Suite",
            version: "2.5.0-TRACER",
            system: this.getSystemDiagnostics(),
            stepStates: this.stepState,
            timelineHistory: this.timelineLog
        };
        return JSON.stringify(report, null, 2);
    }
}
