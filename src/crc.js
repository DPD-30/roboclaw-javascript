/**
 * CRC16 CCITT implementation for RoboClaw motor controllers.
 * Ported from official Python basicmicro library.
 */

const CRC_POLYNOMIAL = 0x1021;

/**
 * Calculates the CRC16 for a given buffer.
 *
 * @param {Buffer} buffer - The data buffer to calculate CRC for.
 * @param {number} [initialCrc=0] - The starting CRC value.
 * @returns {number} The resulting 16-bit CRC value.
 */
export function calculateCrc(buffer, initialCrc = 0) {
    let crc = initialCrc;
    for (let i = 0; i < buffer.length; i++) {
        crc ^= (buffer[i] << 8);
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ CRC_POLYNOMIAL) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return crc;
}

/**
 * Updates a CRC value with a single byte of data.
 *
 * @param {number} crc - The current 16-bit CRC value.
 * @param {number} data - The byte of data to process.
 * @returns {number} The updated 16-bit CRC value.
 */
export function updateCrc(crc, data) {
    crc ^= (data << 8);
    for (let j = 0; j < 8; j++) {
        if ((crc & 0x8000) !== 0) {
            crc = ((crc << 1) ^ CRC_POLYNOMIAL) & 0xFFFF;
        } else {
            crc = (crc << 1) & 0xFFFF;
        }
    }
    return crc;
}
