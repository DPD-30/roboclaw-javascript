import assert from 'assert';
import { RoboClaw } from '../src/index.js';

/**
 * SAFETY WARNING:
 * These tests will send movement commands to the RoboClaw controller.
 * Ensure:
 * 1. The wheels are off the ground (on a stand).
 * 2. There is a clear path if the robot moves.
 * 3. You have an E-Stop ready.
 *
 * DO NOT RUN without explicit confirmation from the operator.
 */

describe('RoboClaw Hardware Motor Control Tests', function() {
    this.timeout(30000);

    let driver;
    const ADDRESS = 0x80;
    const PORT = '/dev/ttyACM0';

    before(async () => {
        console.log('Connecting to RoboClaw for motor tests...');
        driver = new RoboClaw(PORT, 38400, 1000, 2);
        await driver.connect();
        console.log('Connected.');
    });

    after(async () => {
        console.log('Stopping motors and disconnecting...');
        try {
            // Attempt to stop motors before disconnecting
            await driver.dutyM1M2(ADDRESS, 0, 0);
            await driver.disconnect();
        } catch (e) {
            console.log('Teardown error:', e.message);
        }
    });

    const testCommand = async (name, fn) => {
        try {
            console.log(`Executing ${name}...`);
            const result = await fn();
            console.log(`${name}: SUCCESS`);
            assert.strictEqual(result, true, `${name} should have been ACKed`);
        } catch (e) {
            console.error(`Error executing ${name}: ${e.message}`);
            throw e;
        }
    };

    it('should verify basic Duty Cycle commands (Low Power)', async () => {
        // Using small values (approx 10% duty) for safety
        const LOW_DUTY = 3000;

        await testCommand('dutyM1 (low fwd)', () => driver.dutyM1(ADDRESS, LOW_DUTY));
        await testCommand('dutyM2 (low fwd)', () => driver.dutyM2(ADDRESS, LOW_DUTY));
        await testCommand('dutyM1M2 (low fwd)', () => driver.dutyM1M2(ADDRESS, LOW_DUTY, LOW_DUTY));
        await testCommand('dutyM1M2 (stop)', () => driver.dutyM1M2(ADDRESS, 0, 0));
    });

    it('should verify basic Speed commands', async () => {
        // Low speed value
        const LOW_SPEED = 1000;

        await testCommand('speedM1 (low)', () => driver.speedM1(ADDRESS, LOW_SPEED));
        await testCommand('speedM2 (low)', () => driver.speedM2(ADDRESS, LOW_SPEED));
        await testCommand('speedM1M2 (low)', () => driver.speedM1M2(ADDRESS, LOW_SPEED, LOW_SPEED));
        await testCommand('speedM1M2 (stop)', () => driver.speedM1M2(ADDRESS, 0, 0));
    });

    it('should verify Speed + Accel commands', async () => {
        const ACCEL = 100000;
        const SPEED = 1000;

        await testCommand('speedAccelM1', () => driver.speedAccelM1(ADDRESS, ACCEL, SPEED));
        await testCommand('speedAccelM2', () => driver.speedAccelM2(ADDRESS, ACCEL, SPEED));
        await testCommand('speedAccelM1M2', () => driver.speedAccelM1M2(ADDRESS, ACCEL, SPEED, SPEED));
        await testCommand('speedM1M2 (stop)', () => driver.speedM1M2(ADDRESS, 0, 0));
    });

    it('should verify Position commands (No Encoders)', async () => {
        // Note: Encoders are disconnected, so these will likely move indefinitely
        // or stop immediately depending on controller config.
        // We are testing command acceptance (ACK).
        const POS = 1000;
        const BUFFER = 10;

        await testCommand('positionM1', () => driver.positionM1(ADDRESS, POS, BUFFER));
        await testCommand('positionM2', () => driver.positionM2(ADDRESS, POS, BUFFER));
        await testCommand('positionM1M2', () => driver.positionM1M2(ADDRESS, POS, POS, BUFFER));
        await testCommand('dutyM1M2 (stop)', () => driver.dutyM1M2(ADDRESS, 0, 0));
    });

    it('should verify Percent Position commands', async () => {
        const PERCENT = 100; // 1%
        const BUFFER = 10;

        await testCommand('percentPositionM1', () => driver.percentPositionM1(ADDRESS, PERCENT, BUFFER));
        await testCommand('percentPositionM2', () => driver.percentPositionM2(ADDRESS, PERCENT, BUFFER));
        await testCommand('percentPositionM1M2', () => driver.percentPositionM1M2(ADDRESS, PERCENT, PERCENT, BUFFER));
        await testCommand('dutyM1M2 (stop)', () => driver.dutyM1M2(ADDRESS, 0, 0));
    });
});
