import { expect } from 'chai';
import { PacketManager } from '../src/packet.js';
import { Commands } from '../src/commands.js';

describe('PacketManager', () => {
    it('should create a correct packet for a simple command', () => {
        const address = 0x80;
        const command = Commands.M1DUTY;
        const args = [{ value: 1000, type: 'sword' }];

        const packet = PacketManager.createPacket(address, command, args);

        // Expected packet: [Address, Command, Payload..., CRC_High, CRC_Low]
        // Address: 0x80
        // Command: M1DUTY (32 = 0x20)
        // Payload: 1000 = 0x03E8 (Big Endian: 0x03, 0xE8)
        // CRC: calculateCrc([0x80, 0x20, 0x03, 0xE8])

        expect(packet[0]).to.equal(0x80);
        expect(packet[1]).to.equal(Commands.M1DUTY);
        expect(packet[2]).to.equal(0x03);
        expect(packet[3]).to.equal(0xE8);
        expect(packet.length).to.equal(6); // 2 + 2 + 2
    });

    it('should verify a valid packet', () => {
        const address = 0x80;
        const command = Commands.M1DUTY;
        const args = [{ value: 1000, type: 'sword' }];
        const packet = PacketManager.createPacket(address, command, args);

        expect(PacketManager.verifyPacket(packet)).to.be.true;
    });

    it('should throw CRCError for an invalid packet', () => {
        const address = 0x80;
        const command = Commands.M1DUTY;
        const args = [{ value: 1000, type: 'sword' }];
        const packet = PacketManager.createPacket(address, command, args);

        // Corrupt the CRC
        packet[packet.length - 1] ^= 0xFF;

        expect(() => PacketManager.verifyPacket(packet)).to.throw(/CRC mismatch/);
    });

    it('should parse a response correctly', () => {
        const types = ['long', 'byte'];
        const buffer = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x02, 0x00, 0x00]); // Value 1, Status 2, CRC 0
        // Note: verifyPacket would fail here because CRC is not correct,
        // but parseResponse doesn't call verifyPacket.

        const results = PacketManager.parseResponse(buffer, types);
        expect(results).to.deep.equal([1, 2]);
    });
});
