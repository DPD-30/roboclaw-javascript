/**
 * Status bit definitions and decoding for RoboClaw controllers.
 */

export const ErrorBits = {
    ESTOP: 0x0001,
    TEMP: 0x0002,
    TEMP2: 0x0004,
    MBATHIGH: 0x0008,
    LBATHIGH: 0x0010,
    LBATLOW: 0x0020,
    SPEED1: 0x0100,
    SPEED2: 0x0200,
    POS1: 0x0400,
    POS2: 0x0800,
    CURRENTM1: 0x1000,
    CURRENTM2: 0x2000,
    MBATLOW: 0x4000,
    MBATHIGH_HYST: 0x8000,
};

export const WarningBits = {
    OVERCURRENTM1: 0x0001,
    OVERCURRENTM2: 0x0002,
    MBATHIGH: 0x0004,
    MBATLOW: 0x0008,
    TEMP: 0x0010,
    TEMP2: 0x0020,
    S4: 0x0040,
    S5: 0x0080,
    SPEED1: 0x0100,
    SPEED2: 0x0200,
    POS1: 0x0400,
    POS2: 0x0800,
    CAN: 0x1000,
    BOOT: 0x2000,
    OVERREGENM1: 0x4000,
    OVERREGENM2: 0x8000,
};

export const ErrorDescriptions = {
    [ErrorBits.ESTOP]: "Emergency Stop",
    [ErrorBits.TEMP]: "Temperature Sensor 1 Error",
    [ErrorBits.TEMP2]: "Temperature Sensor 2 Error",
    [ErrorBits.MBATHIGH]: "Main Battery Voltage Too High",
    [ErrorBits.LBATHIGH]: "Logic Battery Voltage Too High",
    [ErrorBits.LBATLOW]: "Logic Battery Voltage Too Low",
    [ErrorBits.SPEED1]: "Motor 1 Speed Error",
    [ErrorBits.SPEED2]: "Motor 2 Speed Error",
    [ErrorBits.POS1]: "Motor 1 Position Error",
    [ErrorBits.POS2]: "Motor 2 Position Error",
    [ErrorBits.CURRENTM1]: "Motor 1 Current Error",
    [ErrorBits.CURRENTM2]: "Motor 2 Current Error",
    [ErrorBits.MBATLOW]: "Main Battery Voltage Too Low",
    [ErrorBits.MBATHIGH_HYST]: "Main Battery Voltage Too High (Hysteresis)",
};

export const WarningDescriptions = {
    [WarningBits.OVERCURRENTM1]: "Motor 1 Overcurrent",
    [WarningBits.OVERCURRENTM2]: "Motor 2 Overcurrent",
    [WarningBits.MBATHIGH]: "Main Battery Voltage High Warning",
    [WarningBits.MBATLOW]: "Main Battery Voltage Low Warning",
    [WarningBits.TEMP]: "Temperature Warning",
    [WarningBits.TEMP2]: "Temperature 2 Warning",
    [WarningBits.S4]: "S4 Signal Warning",
    [WarningBits.S5]: "S5 Signal Warning",
    [WarningBits.SPEED1]: "Motor 1 Speed Warning",
    [WarningBits.SPEED2]: "Motor 2 Speed Warning",
    [WarningBits.POS1]: "Motor 1 Position Warning",
    [WarningBits.POS2]: "Motor 2 Position Warning",
    [WarningBits.CAN]: "CAN Bus Warning",
    [WarningBits.BOOT]: "Boot Warning",
    [WarningBits.OVERREGENM1]: "Motor 1 Over-Regeneration Warning",
    [WarningBits.OVERREGENM2]: "Motor 2 Over-Regeneration Warning",
};

/**
 * Decodes a 16-bit status value into a list of descriptions.
 *
 * @param {number} statusValue - The 16-bit status word.
 * @param {Object} bitsMap - The bit definition map.
 * @param {Object} descMap - The description map.
 * @returns {string[]} List of matching descriptions.
 */
export function decodeStatus(statusValue, bitsMap, descMap) {
    const matches = [];
    for (const [bitName, bitValue] of Object.entries(bitsMap)) {
        if (statusValue & bitValue) {
            matches.push(descMap[bitValue] || bitName);
        }
    }
    return matches;
}
