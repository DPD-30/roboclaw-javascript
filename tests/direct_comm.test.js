import assert from 'assert';
import { SerialPort } from 'serialport';
import { PacketManager } from '../src/packet.js';
import { Commands } from '../src/commands.js';

async function testDirect() {
    const port = new SerialPort({
        path: '/dev/ttyACM0',
        baudRate: 38400,
        autoOpen: false
    });

    console.log('Opening port...');
    await port.open();
    console.log('Port open.');

    const address = 0x80;
    const command = Commands.GETVERSION;
    const packet = PacketManager.createPacket(address, command, []);

    console.log(`Sending GETVERSION: ${packet.toString('hex').toUpperCase()}`);
    await port.write(packet);

    const chunks = [];
    const dataPromise = new Promise((resolve) => {
        port.on('data', (data) => {
            chunks.push(data);
            // Simple heuristic for GETVERSION: look for null terminator then 2 bytes CRC
            const fullBuf = Buffer.concat(chunks);
            const nullIdx = fullBuf.indexOf(0);
            if (nullIdx !== -1 && fullBuf.length >= nullIdx + 3) {
                resolve(fullBuf);
            }
        });
    });

    const response = await Promise.race([
        dataPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000))
    ]);

    console.log(`Received raw response: ${response.toString('hex').toUpperCase()}`);

    // Verify CRC
    const dataPart = response.subarray(0, response.length - 2);
    const receivedCrc = response.readUInt16BE(response.length - 2);

    // We can't use PacketManager.verifyPacket because it expects a specific format,
    // but we can manually check.
    const { calculateCrc } = await import('../src/crc.js');
    const calcCrc = calculateCrc(dataPart);

    console.log(`Received CRC: 0x${receivedCrc.toString(16)}`);
    console.log(`Calculated CRC: 0x${calcCrc.toString(16)}`);

    assert.strictEqual(receivedCrc, calcCrc, 'CRC should match');
    console.log('Success! Communication works.');

    await port.close();
}

testDirect().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
