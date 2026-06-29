import assert from 'assert';
import { RoboClaw } from '../src/index.js';
import { Priority } from '../src/queue.js';

describe('RoboClaw Hardware Stress Test', function() {
    this.timeout(30000); // Longer timeout for stress tests

    let driver;
    const ADDRESS = 0x80;
    const PORT = '/dev/ttyACM0';

    before(async () => {
        driver = new RoboClaw(PORT, 38400, 1000, 2);
        await driver.connect();
    });

    after(async () => {
        try {
            if (driver) await driver.disconnect();
        } catch (e) {
            console.log(`[Teardown] disconnect failed: ${e.message}`);
        }
    });

    it('should ensure E-Stop resets jump the queue during heavy telemetry load', async () => {
        const telemetryCount = 50;
        const telemetryTasks = [];

        console.log(`Enqueuing ${telemetryCount} telemetry reads...`);
        for (let i = 0; i < telemetryCount; i++) {
            telemetryTasks.push(driver.readEncoder1(ADDRESS));
        }

        console.log('Issuing critical E-Stop Reset...');
        const startTime = Date.now();
        const pCritical = driver.resetEStop(ADDRESS);

        const criticalResult = await pCritical;
        const endTime = Date.now();

        console.log(`Critical command executed in ${endTime - startTime}ms`);
        assert.strictEqual(criticalResult, true, 'Critical command should have succeeded');

        const results = await Promise.allSettled(telemetryTasks);

        let flushedCount = 0;
        let succeededCount = 0;

        for (const res of results) {
            if (res.status === 'rejected' && res.reason && res.reason.message === 'Queue flushed due to critical command') {
                flushedCount++;
            } else if (res.status === 'fulfilled') {
                succeededCount++;
            }
        }

        console.log(`Telemetry Results - Succeeded: ${succeededCount}, Flushed: ${flushedCount}, Total: ${results.length}`);

        assert.ok(flushedCount > 0, 'At least some telemetry tasks should have been flushed');
        assert.ok(succeededCount < telemetryCount, 'Not all telemetry tasks should have succeeded');
        console.log(`Successfully flushed ${flushedCount}/${telemetryCount} tasks.`);
    });
});
