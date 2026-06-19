import { TypeMap } from './types.js';
import { calculateCrc } from './crc.js';
import { CRCError } from './errors.js';

/**
 * Utility for constructing and verifying RoboClaw packets.
 */
export class PacketManager {
    /**
     * Constructs a RoboClaw packet buffer.
     *
     * @param {number} address - Controller address (0x80-0x87).
     * @param {number} command - Command ID.
     * @param {Array<{value: number, type: string}>} args - List of arguments with types.
     * @returns {Buffer} The complete packet buffer including CRC.
     * @throws {Error} If an unsupported type is provided.
     */
    static createPacket(address, command, args = []) {
        let payloadSize = 0;
        for (const arg of args) {
            const type = TypeMap[arg.type];
            if (!type) throw new Error(`Unsupported type: ${arg.type}`);
            payloadSize += type.size;
        }

        const buffer = Buffer.alloc(2 + payloadSize + 2);

        // 1. Address
        buffer.writeUInt8(address, 0);
        // 2. Command
        buffer.writeUInt8(command, 1);

        // 3. Payload
        let offset = 2;
        for (const arg of args) {
            const type = TypeMap[arg.type];
            type.write(buffer, arg.value, offset);
            offset += type.size;
        }

        // 4. CRC
        // Calculate CRC over Address, Command, and Payload
        const dataToCrc = buffer.subarray(0, 2 + payloadSize);
        const crc = calculateCrc(dataToCrc);
        buffer.writeUInt16BE(crc, offset);

        return buffer;
    }

    /**
     * Verifies a received packet against its calculated CRC.
     *
     * @param {Buffer} buffer - The received buffer.
     * @returns {boolean} True if CRC is valid.
     * @throws {CRCError} If CRC verification fails.
     */
    static verifyPacket(buffer) {
        if (buffer.length < 4) {
            throw new CRCError("Packet too short to contain CRC");
        }

        const dataPart = buffer.subarray(0, buffer.length - 2);
        const receivedCrc = buffer.readUInt16BE(buffer.length - 2);
        const calculatedCrc = calculateCrc(dataPart);

        if (receivedCrc !== calculatedCrc) {
            throw new CRCError(`CRC mismatch: received 0x${receivedCrc.toString(16)}, calculated 0x${calculatedCrc.toString(16)}`);
        }

        return true;
    }

    /**
     * Parses a response buffer into typed values.
     *
     * @param {Buffer} buffer - The response buffer.
     * @param {string[]} types - Ordered list of types to read.
     * @returns {number[]} The parsed values.
     */
    static parseResponse(buffer, types) {
        let offset = 0;
        const results = [];

        for (const typeStr of types) {
            const type = TypeMap[typeStr];
            if (!type) throw new Error(`Unsupported type: ${typeStr}`);

            if (offset + type.size > buffer.length) {
                throw new Error(`Buffer underflow while reading type ${typeStr}`);
            }

            results.push(type.read(buffer, offset));
            offset += type.size;
        }

        return results;
    }
}
