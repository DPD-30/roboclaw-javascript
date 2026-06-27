import assert from 'assert';
import { RoboClaw } from '../src/index.js';
import { MockSerialPort } from './mocks/serialport.mock.js';
import { Priority } from '../src/queue.js';
import { Commands } from '../src/commands.js';
import { PacketManager } from '../src/packet.js';
import { calculateCrc } from '../src/crc.js';

describe('RoboClaw Driver', () => {
    let port;
    let driver;
    const ADDRESS = 0x80;

    beforeEach(() => {
        port = new MockSerialPort();
        driver = new RoboClaw('/dev/ttyUSB0', 38400, 1000, 0, port);
    });

    it('should connect and disconnect', async () => {
        await driver.connect();
        assert.strictEqual(driver.connected, true);
        assert.strictEqual(port.isOpen, true);

        await driver.disconnect();
        assert.strictEqual(driver.connected, false);
        assert.strictEqual(port.isOpen, false);
    });

    it('should execute a simple command and receive ACK', async () => {
        await driver.connect();

        // Prepare to send ACK (1)
        const promise = driver.dutyM1(ADDRESS, 1000);

        // Small delay to ensure it's sent
        await new Promise(r => setTimeout(r, 10));

        // Verify packet sent
        const sentPacket = port.writtenData[0];
        const expectedPacket = PacketManager.createPacket(ADDRESS, Commands.M1DUTY, [{value: 1000, type: 'sword'}]);
        assert.deepStrictEqual(sentPacket, expectedPacket);

        // Simulate ACK
        port.simulateResponse(Buffer.from([1]));

        const result = await promise;
        assert.strictEqual(result, true);
    });

    it('should execute a read command and parse response', async () => {
        await driver.connect();

        const promise = driver.readEncoder1(ADDRESS);

        await new Promise(r => setTimeout(r, 10));

        const respPayload = Buffer.alloc(5);
        respPayload.writeUInt32BE(12345, 0);
        respPayload[4] = 0;

        const crc = calculateCrc(respPayload);
        const responseBuffer = Buffer.concat([respPayload, Buffer.from([crc >> 8, crc & 0xFF])]);

        port.simulateResponse(responseBuffer);

        const result = await promise;
        assert.strictEqual(result.count, 12345);
        assert.strictEqual(result.status, 0);
    });

    it('should ensure critical commands jump the queue and flush others', async () => {
        await driver.connect();

        console.log('Test: Enqueuing p1, p2, p3');
        // 1. Enqueue several tasks
        const p1 = driver.dutyM1(ADDRESS, 1000); // Processing first
        const p2 = driver.dutyM2(ADDRESS, 2000); // Waiting
        const p3 = driver.readEncoder1(ADDRESS);  // Waiting

        console.log('Test: Enqueuing pCritical');
        // 2. Issue critical command (triggers flush of p2, p3)
        const pCritical = driver.resetEStop(ADDRESS);

        console.log('Test: Resolving p1');
        // 3. Resolve p1 (currently processing)
        port.simulateResponse(Buffer.from([1]));
        await p1;
        console.log('Test: p1 resolved');

        // 4. Verify p2 and p3 were flushed
        try {
            await p2;
            assert.fail('p2 should have been flushed');
        } catch (e) {
            console.log('Test: p2 rejected as expected');
            assert.strictEqual(e.message, 'Queue flushed due to critical command');
        }
        try {
            await p3;
            assert.fail('p3 should have been flushed');
        } catch (e) {
            console.log('Test: p3 rejected as expected');
            assert.strictEqual(e.message, 'Queue flushed due to critical command');
        }

        console.log('Test: Resolving pCritical');
        // 5. Resolve critical command (should be next)
        await new Promise(r => setTimeout(r, 200));
        port.simulateResponse(Buffer.from([1]));
        await pCritical;
        console.log('Test: pCritical resolved');
    });
});
