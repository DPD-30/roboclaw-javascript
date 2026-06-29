import assert from 'assert';
import { RoboClaw } from '../src/index.js';

describe('RoboClaw Exhaustive Hardware Read Tests', function() {
    this.timeout(30000);

    let driver;
    const ADDRESS = 0x80;
    const PORT = '/dev/ttyACM0';

    before(async () => {
        console.log('Connecting to RoboClaw for read tests...');
        driver = new RoboClaw(PORT, 38400, 1000, 2);
        await driver.connect();
        console.log('Connected.');
    });

    after(async () => {
        console.log('Disconnecting...');
        try {
            await driver.disconnect();
        } catch (e) {
            console.log('Disconnect error:', e.message);
        }
    });

    const testRead = async (name, fn) => {
        try {
            console.log(`Reading ${name}...`);
            const result = await fn();
            console.log(`${name}:`, JSON.stringify(result, null, 2));

            if (result && typeof result === 'object' && 'success' in result) {
                assert.strictEqual(result.success, true, `${name} should return success: true`);
            } else {
                assert.notStrictEqual(result, undefined, `${name} should not be undefined`);
            }
        } catch (e) {
            console.error(`Error reading ${name}: ${e.message}`);
            throw e;
        }
    };

    it('should read battery voltages', async () => {
        await testRead('readMainBatteryVoltage', () => driver.readMainBatteryVoltage(ADDRESS));
        await testRead('readLogicBatteryVoltage', () => driver.readLogicBatteryVoltage(ADDRESS));
        await testRead('getVolts', () => driver.getVolts(ADDRESS));
    });

    it('should read encoder and speed data', async () => {
        await testRead('readEncoder1', () => driver.readEncoder1(ADDRESS));
        await testRead('readEncoder2', () => driver.readEncoder2(ADDRESS));
        await testRead('getEncoders', () => driver.getEncoders(ADDRESS));
        await testRead('getISpeeds', () => driver.getISpeeds(ADDRESS));
        await testRead('getSpeeds', () => driver.getSpeeds(ADDRESS));
        await testRead('getEncStatus', () => driver.getEncStatus(ADDRESS));
    });

    it('should read system information', async () => {
        await testRead('readVersion', () => driver.readVersion(ADDRESS));
        await testRead('getNodeID', () => driver.getNodeID(ADDRESS));
        await testRead('getSerialNumber', () => driver.getSerialNumber(ADDRESS));
        await testRead('getConfig', () => driver.getConfig(ADDRESS));
        await testRead('getPriority', () => driver.getPriority(ADDRESS));
        await testRead('getAddressMixed', () => driver.getAddressMixed(ADDRESS));
    });

    it('should read configuration and limits', async () => {
        await testRead('getCtrlSettings', () => driver.getCtrlSettings(ADDRESS));
        await testRead('getSpeedErrorLimit', () => driver.getSpeedErrorLimit(ADDRESS));
        await testRead('getSpeedErrors', () => driver.getSpeedErrors(ADDRESS));
        await testRead('getPosErrorLimit', () => driver.getPosErrorLimit(ADDRESS));
        await testRead('getPosErrors', () => driver.getPosErrors(ADDRESS));
        await testRead('getOffsets', () => driver.getOffsets(ADDRESS));
        await testRead('getM1LR', () => driver.getM1LR(ADDRESS));
        await testRead('getM2LR', () => driver.getM2LR(ADDRESS));
        await testRead('getDefaultAccels', () => driver.getDefaultAccels(ADDRESS));
        await testRead('getDefaultSpeeds', () => driver.getDefaultSpeeds(ADDRESS));
        await testRead('getPWMIdle', () => driver.getPWMIdle(ADDRESS));
    });

    it('should read real-time telemetry', async () => {
        await testRead('getStatus', () => driver.getStatus(ADDRESS));
        await testRead('getStatusAnalysis', () => driver.getStatusAnalysis(ADDRESS));
        await testRead('getTemps', () => driver.getTemps(ADDRESS));
        await testRead('readTemp', () => driver.readTemp(ADDRESS));
        await testRead('readTemp2', () => driver.readTemp2(ADDRESS));
        await testRead('readCurrents', () => driver.readCurrents(ADDRESS));
        await testRead('readPWMs', () => driver.readPWMs(ADDRESS));
        await testRead('readBuffers', () => driver.readBuffers(ADDRESS));
        await testRead('getAuxDutys', () => driver.getAuxDutys(ADDRESS));
        await testRead('getDOUTS', () => driver.getDOUTS(ADDRESS));
    });

    it('should read advanced configuration', async () => {
        await testRead('getStreams', () => driver.getStreams(ADDRESS));
        await testRead('getSignals', () => driver.getSignals(ADDRESS));
        await testRead('getSignalsData', () => driver.getSignalsData(ADDRESS));
        await testRead('readEEPROM', () => driver.readEEPROM(ADDRESS, 0));
        await testRead('readNVM', () => driver.readNVM(ADDRESS));
    });
});
