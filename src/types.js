/**
 * Type mapping for RoboClaw communication.
 * Maps RoboClaw-specific types to Node.js Buffer methods (Big-Endian).
 */

export const TypeMap = {
    'byte': {
        size: 1,
        write: (buf, val, offset) => buf.writeUInt8(val, offset),
        read: (buf, offset) => buf.readUInt8(offset),
    },
    'sbyte': {
        size: 1,
        write: (buf, val, offset) => buf.writeInt8(val, offset),
        read: (buf, offset) => buf.readInt8(offset),
    },
    'word': {
        size: 2,
        write: (buf, val, offset) => buf.writeUInt16BE(val, offset),
        read: (buf, offset) => buf.readUInt16BE(offset),
    },
    'sword': {
        size: 2,
        write: (buf, val, offset) => buf.writeInt16BE(val, offset),
        read: (buf, offset) => buf.readInt16BE(offset),
    },
    'long': {
        size: 4,
        write: (buf, val, offset) => buf.writeUInt32BE(val, offset),
        read: (buf, offset) => buf.readUInt32BE(offset),
    },
    'slong': {
        size: 4,
        write: (buf, val, offset) => buf.writeInt32BE(val, offset),
        read: (buf, offset) => buf.readInt32BE(offset),
    },
};

/**
 * Validates if a given type is supported by the TypeMap.
 *
 * @param {string} type - The type string to validate.
 * @returns {boolean} True if supported.
 */
export function isSupportedType(type) {
    return type in TypeMap;
}
