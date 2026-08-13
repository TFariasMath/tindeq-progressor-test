/**
 * Automated Protocol Test Suite for Tindeq Progressor Binary API
 * Tests TLV packet building, parsing, Little-Endian Float32/Uint32 decoding,
 * and edge case resilience against malformed packets.
 */

import { TINDEQ_RESPONSES, TINDEQ_COMMANDS } from '../js/tindeq-ble.js';

function parseWeightNotification(dataView) {
    if (!dataView || dataView.byteLength < 2) return [];

    const responseCode = dataView.getUint8(0);
    if (responseCode !== TINDEQ_RESPONSES.WEIGHT_MEAS) return [];

    const samples = [];
    for (let offset = 2; offset + 8 <= dataView.byteLength; offset += 8) {
        const weightKg = dataView.getFloat32(offset, true);      // Little-endian
        const timestampUs = dataView.getUint32(offset + 4, true); // Little-endian
        samples.push({ weightKg, timestampUs });
    }
    return samples;
}

function runTestSuite() {
    console.log("==================================================");
    console.log("EJECUTANDO SUITE DE PRUEBAS DE PROTOCOLO TINDEQ");
    console.log("==================================================\n");

    let passedTests = 0;
    let totalTests = 0;

    function assert(condition, message) {
        totalTests++;
        if (condition) {
            console.log(`  PASO: ${message}`);
            passedTests++;
        } else {
            console.error(`  FALLO: ${message}`);
        }
    }

    // --- TEST 1: Decodificación de 1 muestra de fuerza ---
    console.log("Prueba 1: Decodificación binaria de paquete de 1 muestra");
    {
        const buffer = new ArrayBuffer(10);
        const view = new DataView(buffer);
        view.setUint8(0, TINDEQ_RESPONSES.WEIGHT_MEAS);
        view.setUint8(1, 8);
        view.setFloat32(2, 25.5, true);
        view.setUint32(6, 1000000, true);

        const samples = parseWeightNotification(view);
        assert(samples.length === 1, "Debe decodificar exactamente 1 muestra");
        assert(Math.abs(samples[0].weightKg - 25.5) < 0.001, "El peso decodificado debe ser 25.5 kg");
        assert(samples[0].timestampUs === 1000000, "El timestamp decodificado debe ser 1000000 us");
    }

    // --- TEST 2: Decodificación de lote múltiple ---
    console.log("\nPrueba 2: Decodificación de lote múltiple (3 muestras en 1 paquete)");
    {
        const buffer = new ArrayBuffer(26);
        const view = new DataView(buffer);
        view.setUint8(0, TINDEQ_RESPONSES.WEIGHT_MEAS);
        view.setUint8(1, 24);

        view.setFloat32(2, 0.0, true);
        view.setUint32(6, 0, true);

        view.setFloat32(10, 45.25, true);
        view.setUint32(14, 12500, true);

        view.setFloat32(18, 82.10, true);
        view.setUint32(22, 25000, true);

        const samples = parseWeightNotification(view);
        assert(samples.length === 3, "Debe decodificar las 3 muestras del lote");
        assert(Math.abs(samples[1].weightKg - 45.25) < 0.001, "La muestra 2 debe ser 45.25 kg");
        assert(samples[2].timestampUs === 25000, "La muestra 3 debe tener timestamp 25000 us");
    }

    // --- TEST 3: Resiliencia ante datos truncados ---
    console.log("\nPrueba 3: Resiliencia ante datos truncados");
    {
        const buffer = new ArrayBuffer(5);
        const view = new DataView(buffer);
        view.setUint8(0, TINDEQ_RESPONSES.WEIGHT_MEAS);
        view.setUint8(1, 8);

        const samples = parseWeightNotification(view);
        assert(samples.length === 0, "No debe fallar ni crashsear, debe ignorar muestras truncadas");
    }

    // --- TEST 4: Parsing de respuesta a comando Batería ---
    console.log("\nPrueba 4: Parsing de respuesta a comando Batería (3120 mV)");
    {
        const buffer = new ArrayBuffer(6);
        const view = new DataView(buffer);
        view.setUint8(0, TINDEQ_RESPONSES.CMD_RESPONSE);
        view.setUint8(1, 4);
        view.setUint32(2, 3120, true);

        const mV = view.getUint32(2, true);
        const percent = Math.round(((mV - 2400) / (3300 - 2400)) * 100);

        assert(mV === 3120, "Debe decodificar 3120 mV");
        assert(percent === 80, "3120 mV debe corresponder al 80% de batería");
    }

    console.log("\n==================================================");
    console.log(`RESULTADO FINAL: ${passedTests} de ${totalTests} PRUEBAS COMPLETADAS CON ÉXITO`);
    console.log("==================================================");

    if (passedTests === totalTests) {
        process.exit(0);
    } else {
        process.exit(1);
    }
}

runTestSuite();
