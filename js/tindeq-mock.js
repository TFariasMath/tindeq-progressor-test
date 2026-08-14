/**
 * Tindeq Progressor Hardware Simulator (Mock Driver - Extended Edge Cases)
 * Emulates the physical Tindeq BLE sensor for development without hardware.
 * Supports Edge Cases stress testing (disconnects, low battery, spikes, self-test, tracer).
 */

export class TindeqMockDriver {
    constructor() {
        this.isConnected = false;
        this.isMeasuring = false;
        this.tracer = null; // Assigned by orchestrator

        this.onLog = null;
        this.onStatusChange = null;
        this.onWeightData = null;
        this.onBatteryRead = null;
        this.onFirmwareRead = null;
        this.onErrorInfoRead = null;
        this.onLowBatteryWarning = null;
        this.onDisconnected = null;

        // Simulation state
        this.targetDeviceName = "Progressor-MOCK-DEV";
        this.timerId = null;
        this.currentMicroseconds = 0;

        this.tareOffsetKg = 0.0;
        this.simulatedBatteryMv = 3150; // ~83%
        this.firmwareVersion = "2.1.0-MOCK";

        this.pullTargetKg = 42.5;
        this.noiseMagnitude = 0.15;
        this.simulateExtremeSpike = false;
    }

    static isSupported() {
        return true;
    }

    log(msg, type = 'info') {
        const timeStr = new Date().toLocaleTimeString();
        if (this.onLog) {
            this.onLog({ time: timeStr, text: `[SIMULADOR] ${msg}`, type });
        } else {
            console.log(`[Tindeq MOCK ${type.toUpperCase()}] ${msg}`);
        }
    }

    async connect() {
        if (this.tracer) this.tracer.setStepStatus(1, 'success', 'Simulador Dev');
        if (this.tracer) this.tracer.setStepStatus(2, 'running');

        this.log("Conectando al sensor Tindeq SIMULADO...", "info");
        await new Promise(r => setTimeout(r, 200));

        if (this.tracer) this.tracer.setStepStatus(2, 'success', this.targetDeviceName);
        if (this.tracer) this.tracer.setStepStatus(3, 'running');
        await new Promise(r => setTimeout(r, 150));

        if (this.tracer) this.tracer.setStepStatus(3, 'success');
        if (this.tracer) this.tracer.setStepStatus(4, 'success');
        if (this.tracer) this.tracer.setStepStatus(5, 'success');
        if (this.tracer) this.tracer.setStepStatus(6, 'running');

        this.isConnected = true;
        this.log(`Dispositivo simulado conectado: "${this.targetDeviceName}"`, "success");

        if (this.onStatusChange) {
            this.onStatusChange({ connected: true, measuring: false, deviceName: this.targetDeviceName });
        }

        await this.getFirmwareVersion();
        await this.getBatteryVoltage();
        if (this.tracer) this.tracer.setStepStatus(6, 'success');
    }

    async disconnect() {
        this.log("Desconectando simulador...", "info");
        this.stopMeasurement();
        this.isConnected = false;
        if (this.onStatusChange) {
            this.onStatusChange({ connected: false, measuring: false, deviceName: null });
        }
    }

    async tare() {
        this.log("Comando TARA recibido (Poner a cero)", "info");
        this.tareOffsetKg = (Math.random() * 0.2 - 0.1);
        await new Promise(r => setTimeout(r, 100));
    }

    async startMeasurement() {
        if (!this.isConnected) throw new Error("Simulador no conectado.");
        if (this.isMeasuring) return;

        if (this.tracer) this.tracer.setStepStatus(7, 'running');
        this.log("Iniciando streaming continuo a ~80 Hz (Modo Simulador)", "success");
        await new Promise(r => setTimeout(r, 100));

        if (this.tracer) this.tracer.setStepStatus(7, 'success');
        if (this.tracer) this.tracer.setStepStatus(8, 'running');

        this.isMeasuring = true;
        this.currentMicroseconds = 0;

        if (this.onStatusChange) {
            this.onStatusChange({ connected: true, measuring: true, deviceName: this.targetDeviceName });
        }

        this.timerId = setInterval(() => {
            this._generateSampleBatch();
        }, 50);
    }

    async stopMeasurement() {
        if (this.timerId) {
            clearInterval(this.timerId);
            this.timerId = null;
        }
        this.isMeasuring = false;
        this.log("Medición continua detenida.", "info");

        if (this.tracer && this.tracer.stepState[8].status === 'running') {
            this.tracer.setStepStatus(8, 'success', 'Finalizado');
        }

        if (this.onStatusChange) {
            this.onStatusChange({ connected: true, measuring: false, deviceName: this.targetDeviceName });
        }
    }

    async getBatteryVoltage() {
        this.simulatedBatteryMv = Math.max(2350, this.simulatedBatteryMv - 2);
        const percent = Math.round(((this.simulatedBatteryMv - 2400) / (3300 - 2400)) * 100);
        this.log(`Batería Simulada: ${this.simulatedBatteryMv} mV (${Math.max(0, percent)}%)`, "info");
        
        if (this.simulatedBatteryMv < 2400) {
            if (this.onLowBatteryWarning) this.onLowBatteryWarning();
        }

        if (this.onBatteryRead) {
            this.onBatteryRead({ millivolts: this.simulatedBatteryMv, percent: Math.max(0, percent) });
        }
    }

    async getFirmwareVersion() {
        this.log(`Firmware Simulado: v${this.firmwareVersion}`, "info");
        if (this.onFirmwareRead) {
            this.onFirmwareRead(this.firmwareVersion);
        }
    }

    async enterSleep() {
        this.log("Simulador ingresando a reposo (Sleep)", "warning");
        await this.disconnect();
    }

    async runSelfTest() {
        this.log("INICIANDO PRUEBA DE DIAGNÓSTICO AUTOMÁTICO (MODO SIMULADOR)...", "info");
        await this.getFirmwareVersion();
        await new Promise(r => setTimeout(r, 200));
        await this.getBatteryVoltage();
        await new Promise(r => setTimeout(r, 200));
        await this.tare();
        await new Promise(r => setTimeout(r, 200));

        this.log("Muestreo de verificación continuo (2.5s)...", "info");
        await this.startMeasurement();
        await new Promise(r => setTimeout(r, 2500));
        await this.stopMeasurement();

        this.log("DIAGNÓSTICO SIMULADO OK: Todos los componentes operativos.", "success");
        return true;
    }

    triggerUnexpectedDisconnect() {
        this.log("INYECTANDO EDGE CASE: Desconexión abrupta de señal BLE...", "error");
        if (this.timerId) clearInterval(this.timerId);
        this.isConnected = false;
        this.isMeasuring = false;
        if (this.tracer) this.tracer.setStepStatus(3, 'fail', 'Señal caída');
        if (this.onDisconnected) this.onDisconnected();
    }

    triggerForceSpike() {
        this.log("INYECTANDO EDGE CASE: Pico de fuerza extremo (120 kg)...", "warning");
        this.simulateExtremeSpike = true;
    }

    _generateSampleBatch() {
        const samples = [];
        const batchCount = 4;

        for (let i = 0; i < batchCount; i++) {
            this.currentMicroseconds += 12500;
            const tSeconds = this.currentMicroseconds / 1000000.0;

            let simulatedForce = 0.0;
            const cycleTime = tSeconds % 10.0;

            if (this.simulateExtremeSpike) {
                simulatedForce = 125.0;
                this.simulateExtremeSpike = false;
            } else if (cycleTime > 2.0 && cycleTime <= 3.5) {
                const progress = (cycleTime - 2.0) / 1.5;
                simulatedForce = Math.pow(progress, 0.7) * this.pullTargetKg;
            } else if (cycleTime > 3.5 && cycleTime <= 7.0) {
                simulatedForce = this.pullTargetKg + (Math.sin(tSeconds * 25.0) * 0.8);
            } else if (cycleTime > 7.0 && cycleTime <= 8.5) {
                const progress = 1.0 - ((cycleTime - 7.0) / 1.5);
                simulatedForce = Math.pow(Math.max(0, progress), 1.2) * this.pullTargetKg;
            } else {
                simulatedForce = 0.0;
            }

            const noise = (Math.random() - 0.5) * this.noiseMagnitude;
            const netWeightKg = Math.max(0, simulatedForce - this.tareOffsetKg + noise);

            samples.push({
                weightKg: parseFloat(netWeightKg.toFixed(3)),
                timestampUs: Math.round(this.currentMicroseconds)
            });
        }

        if (this.onWeightData) {
            if (this.tracer && this.tracer.stepState[8].status === 'running') {
                this.tracer.setStepStatus(8, 'success', '80 Hz Simulado');
            }
            this.onWeightData(samples);
        }
    }
}
