import { EventEmitter } from 'events';

export class MockSerialPort extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.isOpen = false;
        this.writtenData = [];
    }

    async open() {
        this.isOpen = true;
        return Promise.resolve();
    }

    async close() {
        this.isOpen = false;
        return Promise.resolve();
    }

    async write(data) {
        if (!this.isOpen) throw new Error('Port not open');
        this.writtenData.push(data);
        return Promise.resolve();
    }

    async flushInput() {
        // Mock flush input does nothing as we control event emission
        return Promise.resolve();
    }

    /**
     * Helper to simulate data arriving from the controller.
     */
    simulateResponse(data) {
        if (!this.isOpen) return;
        this.emit('data', data);
    }
}
