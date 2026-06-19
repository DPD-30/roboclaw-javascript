export class RoboClawError extends Error {
    constructor(message) {
        super(message);
        this.name = this.constructor.name;
    }
}

export class NotConnectedError extends RoboClawError {
    constructor(message = "RoboClaw is not connected. Call connect() first.") {
        super(message);
    }
}

export class CommunicationError extends RoboClawError {
    constructor(message = "Communication failure with RoboClaw device.") {
        super(message);
    }
}

export class PacketTimeoutError extends CommunicationError {
    constructor(message = "Packet timeout occurred while waiting for RoboClaw response.") {
        super(message);
    }
}

export class CRCError extends CommunicationError {
    constructor(message = "CRC checksum verification failed.") {
        super(message);
    }
}
