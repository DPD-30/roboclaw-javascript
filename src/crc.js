/**
 * CRC16 CCITT implementation for RoboClaw motor controllers.
 * Ported from official Python basicmicro library.
 */

const CRC_POLYNOMIAL = 0x1021;
const CRC_TABLE = new Uint16Array(256);

/**
 * Initializes the CRC lookup table.
 * This is executed once at module load.
 */
(function initializeCrcTable() {
    for (let i = 0; i < 256; i++) {
        let crc = i << 8;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 0x8000)
                ? ((crc << 1) ^ CRC_POLYNOMIAL) & 0xFFFF
                : (crc << 1) & 0xFFFF;
        }
        CRC_TABLE[i] = crc;
    }
})();

/**
 * Updates a CRC value with a single byte of data.
 *
 * @param {number} crc - The current 16-bit CRC value.
 * @param {number} data - The byte of data to process.
 * @returns {number} The updated 16-bit CRC value.
 */
export function updateCrc(crc, data) {
    return ((crc << 8) ^ CRC_TABLE[((crc >> 8) ^ (data & 0xFF)) & 0xFF]) & 0xFFFF;
}

/**
 * Calculates the CRC16 for a given buffer.
 *
 * @param {Buffer} buffer - The data buffer to calculate CRC for.
 * @returns {number} The resulting 16-bit CRC value.
 */
export function calculateCrc(buffer) {
    let crc = 0;
    for (let i = 0; i < buffer.length; i++) {
        crc = updateCrc(crc, buffer[i]);
    }
    return crc;
}
