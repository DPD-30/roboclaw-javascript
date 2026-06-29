import assert from 'assert';
import { SerialPort } from 'serialport';
import { PacketManager } from '../src/packet.js';
import { Commands } from '../src/commands.js';

function calculateCrcCustom(buffer, initialCrc) {
    let crc = initialCrc;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= (buffer[i] << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc;
}

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

    const dataPart = response.subarray(0, response.length - 2);
    const receivedCrc = response.readUInt16BE(response.length - 2);

    const crc0 = calculateCrcCustom(dataPart, 0x0000);
    const crcFFFF = calculateCrcCustom(dataPart, 0xFFFF);

    console.log(`Received CRC: 0x${receivedCrc.toString(16)}`);
    console.log(`Calculated CRC (init 0x0000): 0x${crc0.toString(16)}`);
    console.log(`Calculated CRC (init 0xFFFF): 0x${crcFFFF.toString(16)}`);

    if (receivedCrc === crc0) {
        console.log('MATCH found with initial 0x0000');
    } else if (receivedCrc === crcFFFF) {
        console.log('MATCH found with initial 0xFFFF');
    } else {
        console.log('NO MATCH found with either common initial value.');
    }

    await port.close();
}

testDirect().catch(e => {
    console.error('Test failed:', e);
    process.exit(1);
});
