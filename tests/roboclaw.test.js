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

        // Expected response for readEncoder1: [long (4 bytes), byte (1 byte), CRC (2 bytes)]
        // Long = 12345, Status = 0, CRC = ...
        const data = Buffer.alloc(5);
        data.writeUInt32BE(12345, 0);
        data[4] = 0;

        const fullPacket = PacketManager.createPacket(ADDRESS, 0, [
            {value: 12345, type: 'long'},
            {value: 0, type: 'byte'}
        ], true); // true for response packet simulation?
        // Wait, createPacket is for outgoing. I need to manually construct the response buffer.

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

    it('should ensure critical commands jump the queue', async () => {
        await driver.connect();

        // We'll track the order of packets sent to the port
        const sentPackets = [];
        const originalWrite = port.write.bind(port);
        port.write = async (data) => {
            sentPackets.push(data);
            return originalWrite(data);
        };

        // 1. Enqueue a normal task (won't resolve until we simulate ACK)
        const promise1 = driver.dutyM1(ADDRESS, 1000);

        // 2. Enqueue another normal task (will wait in queue)
        const promise2 = driver.dutyM2(ADDRESS, 2000);

        // 3. Enqueue a critical task (should jump to front of queue)
        const promiseCritical = driver.resetEStop(ADDRESS);

        // Now we simulate responses.
        // First response resolves promise1.
        await new Promise(r => setTimeout(r, 10));
        port.simulateResponse(Buffer.from([1]));
        await promise1;

        // Now the queue should process the next item.
        // It should pick the CRITICAL one before the other NORMAL one.

        // Small delay to let queue process
        await new Promise(r => setTimeout(r, 50));

        // The second packet sent should be the resetEStop (Critical)
        // Packet 0: dutyM1 (Normal)
        // Packet 1: resetEStop (Critical)
        // Packet 2: dutyM2 (Normal)

        const packet1 = sentPackets[1];
        const expectedCritical = PacketManager.createPacket(ADDRESS, Commands.RESETESTOP, []);
        assert.deepStrictEqual(packet1, expectedCritical);

        // Resolve the critical task
        port.simulateResponse(Buffer.from([1]));
        await promiseCritical;

        // Finally resolve the second normal task
        await new Promise(r => setTimeout(r, 10));
        port.simulateResponse(Buffer.from([1]));
        await promise2;

    it('should flush the queue when a critical command is issued', async () => {
        await driver.connect();

        // 1. Enqueue several normal tasks
        const p1 = driver.dutyM1(ADDRESS, 1000);
        const p2 = driver.dutyM2(ADDRESS, 2000);
        const p3 = driver.readEncoder1(ADDRESS);

        // 2. Issue a critical command (triggers flush)
        const pCritical = driver.resetEStop(ADDRESS);

        // 3. Simulate response for first task (already processing)
        port.simulateResponse(Buffer.from([1]));
        await p1;

        // 4. Verify others were flushed
        try {
            await p2;
            assert.fail('p2 should have been flushed');
        } catch (e) {
            assert.strictEqual(e.message, 'Queue flushed due to critical command');
        }

        try {
            await p3;
            assert.fail('p3 should have been flushed');
        } catch (e) {
            assert.strictEqual(e.message, 'Queue flushed due to critical command');
        }

        // 5. Resolve critical command
        port.simulateResponse(Buffer.from([1]));
        await pCritical;
    });
});
