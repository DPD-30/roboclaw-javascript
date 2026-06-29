const request = Buffer.from('8015590C', 'hex');
const responsePayload = Buffer.from('55534220526F626F636C617720327837612076342E322E380A00', 'hex');
const combined = Buffer.concat([request, responsePayload]);

function calculateCrc(buffer, initialCrc, poly) {
    let crc = initialCrc;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= (buffer[i] << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ poly) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc;
}

const result = calculateCrc(combined, 0, 0x1021);
console.log(`Combined CRC: 0x${result.toString(16)}`);
console.log(`Target CRC: 0xac9e`);
console.log(result === 0xac9e ? 'MATCH!' : 'NO MATCH');
