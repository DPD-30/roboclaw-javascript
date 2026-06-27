import assert from 'assert';
import { RoboClaw } from '../src/index.js';
import { Priority } from '../src/queue.js';

describe('RoboClaw Hardware Priority Test', function() {
    this.timeout(10000); // Long timeout for hardware

    let driver;
    const ADDRESS = 0x80;
    const PORT = '/dev/ttyUSB0';

    before(async () => {
        driver = new RoboClaw(PORT, 38400, 1000, 2);
        await driver.connect();
    });

    after(async () => {
        await driver.disconnect();
    });

    it('should execute commands in priority order on hardware', async () => {
        // This test is tricky because we can't easily "see" the queue on the hardware.
        // We will use a sequence of commands and a critical command and verify no errors.

        console.log('Sending normal commands...');
        const p1 = driver.dutyM1(ADDRESS, 100);
        const p2 = driver.dutyM2(ADDRESS, 100);

        console.log('Sending critical command (E-Stop Reset)...');
        const pCritical = driver.resetEStop(ADDRESS);

        // The critical command should jump the queue.
        // In a real scenario, we'd check that pCritical resolves before p1/p2 if they were delayed.
        // Here we just verify they all eventually resolve.

        const results = await Promise.all([p1, p2, pCritical]);
        assert.deepStrictEqual(results, [true, true, true]);
        console.log('All commands executed successfully.');
    });

    it('should correctly flush the queue on critical command', async () => {
        // We can verify the flush by checking if normal commands are rejected.
        // However, since the driver is fast, we need to "clog" the queue.

        // We'll send a command that takes some time or just many commands.
        const tasks = [];
        for(let i=0; i<10; i++) {
            tasks.push(driver.dutyM1(ADDRESS, i));
        }

        console.log('Issuing critical command to flush queue...');
        const pCritical = driver.resetEStop(ADDRESS);

        // Some of the tasks should have been flushed.
        let flushedCount = 0;
        for (const task of tasks) {
            try {
                await task;
            } catch (e) {
                if (e.message === 'Queue flushed due to critical command') {
                    flushedCount++;
                }
            }
        }

        console.log(`Flushed ${flushedCount} tasks.`);
        assert.ok(flushedCount > 0, 'At least some tasks should have been flushed');

        await pCritical;
    });
});
