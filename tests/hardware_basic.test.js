import assert from 'assert';
import { RoboClaw } from '../src/index.js';

describe('RoboClaw Basic Hardware Test', function() {
    this.timeout(15000); // Generous timeout for hardware communication

    let driver;
    const ADDRESS = 0x80;
    const PORT = '/dev/ttyACM0';

    before(async () => {
        console.log('Connecting to RoboClaw...');
        driver = new RoboClaw(PORT, 38400, 1000, 2);
        await driver.connect();
        console.log('Connected.');
    });

    after(async () => {
        console.log('Disconnecting...');
        try {
            await driver.disconnect();
        } catch (e) {
            console.log('Disconnect error (might already be closed):', e.message);
        }
        console.log('Disconnected.');
    });

    it('should read the firmware version', async () => {
        console.log('Reading version...');
        const version = await driver.readVersion(ADDRESS);
        console.log(`Firmware Version: ${version}`);
        assert.ok(version && typeof version === 'string', 'Version should be a non-empty string');
    });

    it('should get status analysis', async () => {
        console.log('Getting status analysis...');
        const status = await driver.getStatusAnalysis(ADDRESS);
        console.log('Status Analysis:', JSON.stringify(status, null, 2));
        assert.ok(status.combinedStatus !== undefined, 'Should return a combined status');
    });

    it('should read encoder 1', async () => {
        console.log('Reading encoder 1...');
        const enc = await driver.readEncoder1(ADDRESS);
        console.log(`Encoder 1 Count: ${enc.count}, Status: ${enc.status}`);
        assert.ok(enc.success, 'Encoder read should be successful');
    });
});
