/**
 * Tindeq Progressor Web Application Orchestrator (Hardened Edition)
 * Connects BLE Driver / Software Simulator with Canvas Chart Engine & BleProcessTracer,
 * computes real-time athletic metrics, exports telemetry and diagnostic JSON traces.
 */

import { TindeqBleDriver } from './tindeq-ble.js';
import { TindeqMockDriver } from './tindeq-mock.js';
import { ForceChartEngine } from './chart-engine.js';
import { BleProcessTracer, TRACER_STEPS } from './process-tracer.js';

class TindeqApp {
    constructor() {
        this.driver = null;
        this.chartEngine = null;
        this.tracer = new BleProcessTracer();
        
        // App State
        this.selectedMode = 'mock'; // Default mock for dev
        this.activeSessionData = []; // Full raw telemetry buffer for CSV export
        
        // Real-time metric state
        this.currentKg = 0.0;
        this.peakKg = 0.0;
        this.rfd100 = 0;
        
        // Sampling rate calculator (Hz)
        this.sampleTimesWindow = [];
        this.currentHz = 0;

        // RFD calculation window
        this.pullStartTimestampUs = null;
        this.pullBaselineKg = 0.0;

        this.initDOM();
        this.initChart();
        this.initTracerUi();
        this.setDriverMode(this.selectedMode);
    }

    initDOM() {
        this.elements = {
            driverModeSelect: document.getElementById('driverModeSelect'),
            statusPill: document.getElementById('statusPill'),
            statusText: document.getElementById('statusText'),
            
            stepperGrid: document.getElementById('stepperGrid'),
            btnDownloadDiagnosticJson: document.getElementById('btnDownloadDiagnosticJson'),

            btnConnect: document.getElementById('btnConnect'),
            btnConnectText: document.getElementById('btnConnectText'),
            btnTare: document.getElementById('btnTare'),
            btnStart: document.getElementById('btnStart'),
            btnStop: document.getElementById('btnStop'),
            btnSleep: document.getElementById('btnSleep'),
            btnSelfTest: document.getElementById('btnSelfTest'),
            btnExportCsv: document.getElementById('btnExportCsv'),
            btnClearChart: document.getElementById('btnClearChart'),
            
            btnSimulateDisconnect: document.getElementById('btnSimulateDisconnect'),
            btnSimulateSpike: document.getElementById('btnSimulateSpike'),
            edgeCasePanel: document.getElementById('edgeCasePanel'),
            
            infoDeviceName: document.getElementById('infoDeviceName'),
            infoFirmware: document.getElementById('infoFirmware'),
            infoBatteryText: document.getElementById('infoBatteryText'),
            batteryFill: document.getElementById('batteryFill'),
            
            valCurrentKg: document.getElementById('valCurrentKg'),
            valCurrentN: document.getElementById('valCurrentN'),
            valPeakKg: document.getElementById('valPeakKg'),
            valPeakN: document.getElementById('valPeakN'),
            valRfd: document.getElementById('valRfd'),
            valHz: document.getElementById('valHz'),
            
            canvas: document.getElementById('forceCanvas'),
            logConsole: document.getElementById('logConsole'),
            btnCopyLog: document.getElementById('btnCopyLog'),
            btnClearLog: document.getElementById('btnClearLog')
        };

        this.elements.driverModeSelect.addEventListener('change', (e) => {
            this.setDriverMode(e.target.value);
        });

        this.elements.btnConnect.addEventListener('click', () => this.toggleConnect());
        this.elements.btnTare.addEventListener('click', () => this.handleTare());
        this.elements.btnStart.addEventListener('click', () => this.handleStart());
        this.elements.btnStop.addEventListener('click', () => this.handleStop());
        this.elements.btnSleep.addEventListener('click', () => this.handleSleep());
        this.elements.btnSelfTest.addEventListener('click', () => this.handleSelfTest());
        this.elements.btnExportCsv.addEventListener('click', () => this.exportCsv());
        this.elements.btnClearChart.addEventListener('click', () => this.clearSessionData());
        
        this.elements.btnDownloadDiagnosticJson.addEventListener('click', () => this.downloadDiagnosticJson());

        // Edge Case simulator triggers
        this.elements.btnSimulateDisconnect.addEventListener('click', () => {
            if (this.driver && typeof this.driver.triggerUnexpectedDisconnect === 'function') {
                this.driver.triggerUnexpectedDisconnect();
            }
        });

        this.elements.btnSimulateSpike.addEventListener('click', () => {
            if (this.driver && typeof this.driver.triggerForceSpike === 'function') {
                this.driver.triggerForceSpike();
            }
        });

        this.elements.btnClearLog.addEventListener('click', () => {
            this.elements.logConsole.innerHTML = '';
        });

        this.elements.btnCopyLog.addEventListener('click', () => {
            const text = this.elements.logConsole.innerText;
            navigator.clipboard.writeText(text).then(() => {
                this.addLogEntry({ time: new Date().toLocaleTimeString(), text: 'Log copiado al portapapeles', type: 'info' });
            });
        });
    }

    initChart() {
        this.chartEngine = new ForceChartEngine(this.elements.canvas);
        this.chartEngine.startRenderLoop();
    }

    initTracerUi() {
        this.tracer.onStepUpdate = (stepStates) => {
            this.renderStepperUi(stepStates);
        };
        this.renderStepperUi(this.tracer.stepState);
    }

    renderStepperUi(stepStates) {
        const grid = this.elements.stepperGrid;
        if (!grid) return;

        let html = '';
        for (let i = 1; i <= 8; i++) {
            const st = stepStates[i];
            const statusClass = st.status || 'idle';
            const detailText = st.detail ? ` (${st.detail})` : (st.timestamp ? ` - ${st.timestamp}` : '');

            html += `
                <div class="step-card ${statusClass}" title="${st.desc}">
                    <div class="step-card-header">
                        <span class="step-num">PASO 0${i}</span>
                        <span class="step-status-dot"></span>
                    </div>
                    <div class="step-name">${st.name}</div>
                    <div class="step-desc">${st.desc}${detailText}</div>
                </div>
            `;
        }

        grid.innerHTML = html;
    }

    setDriverMode(mode) {
        if (this.driver && this.driver.isConnected) {
            alert("Desconecta el dispositivo antes de cambiar el modo de operación.");
            this.elements.driverModeSelect.value = this.selectedMode;
            return;
        }

        this.selectedMode = mode;
        this.tracer.reset();

        if (mode === 'ble' || mode === 'ble-any') {
            this.driver = new TindeqBleDriver();
            this.elements.edgeCasePanel.style.display = 'none';
            const label = mode === 'ble-any' ? 'Hardware Real (Modo Universal: Teléfonos, Relojes, Audífonos)' : 'Hardware Real (Filtro Tindeq)';
            this.addLogEntry({ time: new Date().toLocaleTimeString(), text: `Modo activo: ${label}`, type: 'info' });
        } else {
            this.driver = new TindeqMockDriver();
            this.elements.edgeCasePanel.style.display = 'flex';
            this.addLogEntry({ time: new Date().toLocaleTimeString(), text: 'Modo activo: Simulador de Software (Dev sin Tindeq)', type: 'info' });
        }

        this.driver.tracer = this.tracer;
        this.bindDriverEvents();
        this.updateUiState();
    }

    bindDriverEvents() {
        if (!this.driver) return;

        this.driver.onLog = (entry) => this.addLogEntry(entry);
        
        this.driver.onStatusChange = (status) => {
            this.updateUiStatusPill(status);
        };

        this.driver.onWeightData = (samples) => {
            this.processIncomingSamples(samples);
        };

        this.driver.onBatteryRead = ({ millivolts, percent }) => {
            this.elements.infoBatteryText.innerText = `${percent}% (${millivolts} mV)`;
            this.elements.batteryFill.style.width = `${percent}%`;
        };

        this.driver.onFirmwareRead = (fw) => {
            this.elements.infoFirmware.innerText = `v${fw}`;
        };

        this.driver.onDisconnected = () => {
            this.chartEngine.stopRenderLoop();
            this.updateUiState();
        };
    }

    async toggleConnect() {
        if (this.driver.isConnected) {
            await this.driver.disconnect();
            this.updateUiState();
        } else {
            try {
                this.elements.btnConnect.disabled = true;
                this.elements.btnConnectText.innerText = 'Conectando...';
                
                const acceptAllDevices = (this.selectedMode === 'ble-any');
                await this.driver.connect(acceptAllDevices);
                
                this.elements.infoDeviceName.innerText = this.driver.device?.name || this.driver.targetDeviceName || 'Dispositivo BLE';
                this.updateUiState();
            } catch (err) {
                alert(`Fallo de conexión: ${err.message}`);
                this.updateUiState();
            }
        }
    }

    async handleTare() {
        try {
            await this.driver.tare();
            this.addLogEntry({ time: new Date().toLocaleTimeString(), text: 'Cero/Tara configurado correctamente', type: 'success' });
        } catch (e) {
            this.addLogEntry({ time: new Date().toLocaleTimeString(), text: `Error en Tara: ${e.message}`, type: 'error' });
        }
    }

    async handleStart() {
        try {
            this.clearSessionData();
            await this.driver.startMeasurement();
            this.chartEngine.startRenderLoop();
            this.updateUiState();
        } catch (e) {
            this.addLogEntry({ time: new Date().toLocaleTimeString(), text: `Error al iniciar: ${e.message}`, type: 'error' });
        }
    }

    async handleStop() {
        try {
            await this.driver.stopMeasurement();
            this.updateUiState();
        } catch (e) {
            this.addLogEntry({ time: new Date().toLocaleTimeString(), text: `Error al detener: ${e.message}`, type: 'error' });
        }
    }

    async handleSelfTest() {
        if (!this.driver || !this.driver.isConnected) {
            alert("Conecta el dispositivo primero para ejecutar el Diagnóstico Automático.");
            return;
        }

        this.elements.btnSelfTest.disabled = true;
        await this.driver.runSelfTest();
        this.updateUiState();
    }

    async handleSleep() {
        if (confirm("¿Deseas enviar el comando para apagar / poner en reposo el dispositivo Tindeq?")) {
            await this.driver.enterSleep();
            this.updateUiState();
        }
    }

    downloadDiagnosticJson() {
        const jsonStr = this.tracer.exportDiagnosticJson();
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `tindeq_diagnostic_trace_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.addLogEntry({ time: new Date().toLocaleTimeString(), text: 'Informe de traza completa descargado (JSON)', type: 'success' });
    }

    processIncomingSamples(samples) {
        this.chartEngine.pushSamples(samples);
        const nowMs = performance.now();

        for (const sample of samples) {
            const kg = Math.max(0, sample.weightKg);
            const n = kg * 9.80665;

            this.currentKg = kg;
            this.activeSessionData.push({
                timestampUs: sample.timestampUs,
                timeSec: sample.timestampUs / 1000000.0,
                weightKg: kg,
                weightN: parseFloat(n.toFixed(2))
            });

            if (kg > this.peakKg) {
                this.peakKg = kg;
            }

            if (kg > 1.5 && this.pullStartTimestampUs === null) {
                this.pullStartTimestampUs = sample.timestampUs;
                this.pullBaselineKg = kg;
            } else if (kg < 0.8) {
                this.pullStartTimestampUs = null;
            }

            if (this.pullStartTimestampUs !== null) {
                const elapsedUs = sample.timestampUs - this.pullStartTimestampUs;
                if (elapsedUs >= 80000 && elapsedUs <= 120000) {
                    const deltaKg = kg - this.pullBaselineKg;
                    const deltaSec = elapsedUs / 1000000.0;
                    this.rfd100 = Math.round(deltaKg / deltaSec);
                }
            }

            this.sampleTimesWindow.push(nowMs);
        }

        const cutoffHzMs = nowMs - 1000;
        while (this.sampleTimesWindow.length > 0 && this.sampleTimesWindow[0] < cutoffHzMs) {
            this.sampleTimesWindow.shift();
        }
        this.currentHz = this.sampleTimesWindow.length;

        this.renderMetricsDOM();
    }

    renderMetricsDOM() {
        this.elements.valCurrentKg.innerText = this.currentKg.toFixed(1);
        this.elements.valCurrentN.innerText = (this.currentKg * 9.80665).toFixed(1);
        
        this.elements.valPeakKg.innerText = this.peakKg.toFixed(1);
        this.elements.valPeakN.innerText = (this.peakKg * 9.80665).toFixed(1);
        
        this.elements.valRfd.innerText = this.rfd100 > 0 ? this.rfd100 : 0;
        this.elements.valHz.innerText = this.currentHz;
    }

    clearSessionData() {
        this.activeSessionData = [];
        this.currentKg = 0.0;
        this.peakKg = 0.0;
        this.rfd100 = 0;
        this.pullStartTimestampUs = null;
        this.chartEngine.clear();
        this.renderMetricsDOM();
        this.elements.btnExportCsv.disabled = true;
    }

    exportCsv() {
        if (this.activeSessionData.length === 0) {
            alert("No hay datos de telemetría registrados para exportar.");
            return;
        }

        let csvContent = "data:text/csv;charset=utf-8,Timestamp_us,Time_sec,Weight_kg,Force_N\n";
        for (const row of this.activeSessionData) {
            csvContent += `${row.timestampUs},${row.timeSec.toFixed(4)},${row.weightKg.toFixed(3)},${row.weightN.toFixed(2)}\n`;
        }

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        const filename = `tindeq_session_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
        link.setAttribute("download", filename);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        this.addLogEntry({ time: new Date().toLocaleTimeString(), text: `Archivo CSV descargado: ${filename}`, type: 'success' });
    }

    updateUiState() {
        const isConnected = this.driver?.isConnected || false;
        const isMeasuring = this.driver?.isMeasuring || false;

        this.elements.btnConnectText.innerText = isConnected ? 'Desconectar' : 'Conectar Dispositivo';
        this.elements.btnConnect.disabled = false;
        
        if (isConnected) {
            this.elements.btnConnect.classList.replace('btn-primary', 'btn-secondary');
        } else {
            this.elements.btnConnect.classList.replace('btn-secondary', 'btn-primary');
        }

        this.elements.btnTare.disabled = !isConnected || isMeasuring;
        this.elements.btnSleep.disabled = !isConnected;
        this.elements.btnSelfTest.disabled = !isConnected;

        if (isMeasuring) {
            this.elements.btnStart.classList.add('hidden');
            this.elements.btnStop.classList.remove('hidden');
            this.elements.btnExportCsv.disabled = true;
        } else {
            this.elements.btnStart.classList.remove('hidden');
            this.elements.btnStop.classList.add('hidden');
            this.elements.btnStart.disabled = !isConnected;
            this.elements.btnExportCsv.disabled = this.activeSessionData.length === 0;
        }
    }

    updateUiStatusPill({ connected, measuring, deviceName }) {
        const pill = this.elements.statusPill;
        const text = this.elements.statusText;

        pill.className = 'status-pill';

        if (measuring) {
            pill.classList.add('measuring');
            text.innerText = `Transmitiendo (80 Hz) - ${deviceName || 'Dispositivo'}`;
        } else if (connected) {
            pill.classList.add('connected');
            text.innerText = `Conectado - ${deviceName || 'Dispositivo'}`;
        } else {
            pill.classList.add('disconnected');
            text.innerText = 'Desconectado';
        }
    }

    addLogEntry({ time, text, type }) {
        const logContainer = this.elements.logConsole;
        if (!logContainer) return;

        const entry = document.createElement('div');
        entry.className = `log-entry ${type || 'info'}`;
        entry.innerHTML = `<span class="log-time">[${time}]</span> ${text}`;

        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;
    }
}

window.addEventListener('DOMContentLoaded', () => {
    window.tindeqApp = new TindeqApp();
});
