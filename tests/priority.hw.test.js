import assert from 'assert';
import { RoboClaw } from '../src/index.js';
import { Priority } from '../src/queue.js';

describe('RoboClaw Hardware Priority Test', function() {
    this.timeout(10000); // Long timeout for hardware

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

    it('should execute commands in priority order on hardware', async () => {
        console.log('Sending normal commands...');
        const p1 = driver.dutyM1(ADDRESS, 100);
        const p2 = driver.dutyM2(ADDRESS, 100);

        console.log('Sending critical command (E-Stop Reset)...');
        const pCritical = driver.resetEStop(ADDRESS);

        const results = await Promise.allSettled([p1, p2, pCritical]);

        // Critical command MUST succeed
        assert.strictEqual(results[2].status, 'fulfilled', 'Critical command should have succeeded');
        assert.strictEqual(results[2].value, true);

        console.log('Critical command executed. Others may have been flushed.');
    });

    it('should correctly flush the queue on critical command', async () => {
        // We can verify the flush by checking if normal commands are rejected.
        const tasks = [];
        for(let i=0; i<10; i++) {
            tasks.push(driver.dutyM1(ADDRESS, i));
        }

        console.log('Issuing critical command to flush queue...');
        const pCritical = driver.resetEStop(ADDRESS);

        const results = await Promise.allSettled(tasks);
        let flushedCount = 0;
        for (const res of results) {
            if (res.status === 'rejected' && res.reason && res.reason.message === 'Queue flushed due to critical command') {
                flushedCount++;
            }
        }

        console.log(`Flushed ${flushedCount} tasks.`);
        assert.ok(flushedCount > 0, 'At least some tasks should have been flushed');

        await pCritical;
    });
});
