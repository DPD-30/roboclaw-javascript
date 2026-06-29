import assert from 'assert';
import { RoboClaw } from '../src/index.js';

/**
 * 🚨 CRITICAL SAFETY WARNING 🚨
 * These tests will result in physical motor movement.
 *
 * ENSURE:
 * 1. Robot is SECURELY on a stand (wheels OFF the ground).
 * 2. You have a physical E-Stop or power kill-switch ready.
 * 3. There are no obstructions around the wheels.
 *
 * DO NOT RUN without explicit confirmation from the operator.
 */

describe('RoboClaw Physical Movement Verification', function() {
    this.timeout(60000); // Increased timeout for movement durations

    let driver;
    const ADDRESS = 0x80;
    const PORT = '/dev/ttyACM0';

    // 30% Duty Cycle (~10,000 / 32,767)
    const MOVE_POWER = 10000;
    const MOVE_DURATION_MS = 1000;

    before(async () => {
        console.log('Connecting to RoboClaw for movement tests...');
        driver = new RoboClaw(PORT, 38400, 1000, 2);
        await driver.connect();
        console.log('Connected.');
    });

    after(async () => {
        console.log('Ensuring motors are stopped and disconnecting...');
        try {
            await driver.dutyM1M2(ADDRESS, 0, 0);
            await driver.disconnect();
        } catch (e) {
            console.log('Teardown error:', e.message);
        }
    });

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    const executeMovement = async (label, m1Power, m2Power) => {
        console.log(`--- ${label} ---`);
        console.log(`Setting Power: M1=${m1Power}, M2=${m2Power}`);

        // 1. Start Movement
        const startResult = await driver.dutyM1M2(ADDRESS, m1Power, m2Power);
        assert.strictEqual(startResult, true, `Failed to start movement for ${label}`);
        console.log(`Movement started. Waiting ${MOVE_DURATION_MS}ms...`);

        // 2. Maintain movement
        await sleep(MOVE_DURATION_MS);

        // 3. Stop Movement
        console.log(`Stopping ${label}...`);
        const stopResult = await driver.dutyM1M2(ADDRESS, 0, 0);
        assert.strictEqual(stopResult, true, `Failed to stop movement for ${label}`);
        console.log(`${label}: SUCCESS`);

        // Small pause between tests to let motors settle
        await sleep(500);
    };

    it('should move Motor 1 forward', async () => {
        await executeMovement('M1 Forward', MOVE_POWER, 0);
    });

    it('should move Motor 2 forward', async () => {
        await executeMovement('M2 Forward', 0, MOVE_POWER);
    });

    it('should move both motors forward', async () => {
        await executeMovement('Both Forward', MOVE_POWER, MOVE_POWER);
    });

    it('should move both motors backward', async () => {
        await executeMovement('Both Backward', -MOVE_POWER, -MOVE_POWER);
    });
});
