import SerialPort from 'serialport';
import { PriorityQueue, Priority } from './queue.js';
import { PacketManager } from './packet.js';
import { TypeMap } from './types.js';
import { Commands } from './commands.js';
import { decodeStatus, ErrorBits, WarningBits, ErrorDescriptions, WarningDescriptions } from './status.js';
import {
    NotConnectedError,
    CommunicationError,
    PacketTimeoutError,
    CRCError
} from './errors.js';

/**
 * Main driver class for RoboClaw motor controllers.
 */
export class RoboClaw {
    constructor(path, baudRate = 38400, timeout = 100, retries = 2, port = null) {
        this.path = path;
        this.baudRate = baudRate;
        this.timeout = timeout;
        this.retries = retries;

        this.port = port;
        this.queue = new PriorityQueue();
        this.connected = false;
    }

    /**
     * Opens the serial connection.
     */
    async connect() {
        if (this.connected) return;

        try {
            if (!this.port) {
                this.port = new SerialPort({
                    path: this.path,
                    baudRate: this.baudRate,
                    autoOpen: false
                });
            }

            await this.port.open();
            this.connected = true;
        } catch (error) {
            throw new CommunicationError(`Failed to open serial port: ${error.message}`);
        }
    }

    /**
     * Closes the serial connection.
     */
    async disconnect() {
        if (!this.connected) return;

        try {
            await this.port.close();
            this.connected = false;
        } catch (error) {
            throw new CommunicationError(`Failed to close serial port: ${error.message}`);
        }
    }

    /**
     * Internal method to execute a command through the priority queue.
     * Handles retries and timeouts.
     */
    async _execute(address, command, args = [], types = [], respTypes = null, priority = Priority.NORMAL) {
        if (!this.connected) throw new NotConnectedError();

        if (priority === Priority.CRITICAL) {
            this.queue.flush();
        }

        const task = async () => {
            let lastError;

            for (let attempt = 0; attempt <= this.retries; attempt++) {
                try {
                    return await this._sendAndReceive(address, command, args, types, respTypes);
                } catch (error) {
                    lastError = error;
                    if (!(error instanceof CommunicationError) || attempt === this.retries) {
                        throw error;
                    }
                    // Exponential backoff or simple delay could be added here
                }
            }
            throw lastError;
        };

        return this.queue.enqueue(task, priority);
    }

    /**
     * Low-level send and receive logic.
     */
    async _sendAndReceive(address, command, args, argTypes, respTypes) {
        // 1. Construct packet
        const formattedArgs = args.map((val, i) => ({ value: val, type: argTypes[i] || 'byte' }));
        const packet = PacketManager.createPacket(address, command, formattedArgs);

        // 2. Send
        await this.port.write(packet);

        // 3. Handle response based on whether command expects data
        const isReadCommand = this._isReadCommand(command);

        if (!isReadCommand) {
            // Expect a single ACK byte
            const ack = await this._readByteWithTimeout();
            if (ack === 0) throw new CommunicationError("Controller returned NACK");
            return true;
        } else {
            // Expect data + CRC
            const effectiveRespTypes = respTypes !== null ? respTypes : argTypes;
            let responseBuffer;
            if (command === Commands.GETVERSION) {
                responseBuffer = await this._readVariableResponseWithTimeout(48);
            } else {
                responseBuffer = await this._readResponseWithTimeout(effectiveRespTypes);
            }

            PacketManager.verifyPacket(responseBuffer);

            if (command === Commands.GETVERSION) {
                const nullIndex = responseBuffer.indexOf(0);
                const dataPart = nullIndex === -1
                    ? responseBuffer.subarray(0, responseBuffer.length - 2)
                    : responseBuffer.subarray(0, nullIndex);
                return dataPart.toString('utf8');
            }

            return PacketManager.parseResponse(responseBuffer, effectiveRespTypes);
        }
    }


    _isReadCommand(command) {
        // Simple check: does this command usually return a value?
        // In a full implementation, we'd use a lookup table.
        const readCommands = new Set([
            Commands.GETTIMEOUT, Commands.GETM1ENC, Commands.GETM2SPEED,
            Commands.GETVERSION, Commands.GETMBATT, Commands.GETLBATT,
            Commands.READM1PID, Commands.READM2PID, Commands.GETSTATUS
            // ... add others
        ]);
        return readCommands.has(command);
    }

    async _readByteWithTimeout() {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new PacketTimeoutError()), this.timeout);
            this.port.once('data', (data) => {
                clearTimeout(timer);
                resolve(data[0]);
            });
        });
    }

    async _readResponseWithTimeout(types) {
        // Calculate expected size: sum of type sizes + 2 bytes for CRC
        let expectedSize = 0;
        for (const type of types) {
            expectedSize += (TypeMap[type]?.size || 1);
        }
        expectedSize += 2;

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new PacketTimeoutError()), this.timeout * 5);
            const chunks = [];
            let bytesRead = 0;

            const onData = (data) => {
                chunks.push(data);
                bytesRead += data.length;
                if (bytesRead >= expectedSize) {
                    this.port.removeListener('data', onData);
                    clearTimeout(timer);
                    resolve(Buffer.concat(chunks).subarray(0, expectedSize));
                }
            };

            this.port.on('data', onData);
        });
    }

    async _readVariableResponseWithTimeout(maxSize) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new PacketTimeoutError()), this.timeout * 5);
            const chunks = [];
            let bytesRead = 0;
            let foundNull = false;
            let crcBytesRead = 0;

            const onData = (data) => {
                for (let i = 0; i < data.length; i++) {
                    const byte = data[i];
                    if (!foundNull) {
                        chunks.push(Buffer.from([byte]));
                        bytesRead++;
                        if (byte === 0 || bytesRead >= maxSize) {
                            foundNull = true;
                        }
                    } else {
                        chunks.push(Buffer.from([byte]));
                        crcBytesRead++;
                        if (crcBytesRead >= 2) {
                            this.port.removeListener('data', onData);
                            clearTimeout(timer);
                            resolve(Buffer.concat(chunks));
                            return;
                        }
                    }
                }
            };

            this.port.on('data', onData);
        });
    }

    async _readCountedResponse(maxCount, itemSize) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new PacketTimeoutError()), this.timeout * 5);
            const chunks = [];
            let totalBytesRead = 0;
            let count = -1;
            let itemsBytesRead = 0;
            let crcBytesRead = 0;

            const onData = (data) => {
                for (let i = 0; i < data.length; i++) {
                    const byte = data[i];

                    if (count === -1) {
                        // Reading the count byte
                        chunks.push(Buffer.from([byte]));
                        totalBytesRead++;
                        count = byte;
                        if (count > maxCount) {
                            this.port.removeListener('data', onData);
                            clearTimeout(timer);
                            reject(new Error(`Count ${count} exceeds maxCount ${maxCount}`));
                            return;
                        }
                    } else if (itemsBytesRead < count * itemSize) {
                        // Reading the items
                        chunks.push(Buffer.from([byte]));
                        totalBytesRead++;
                        itemsBytesRead++;
                    } else {
                        // Reading the 2-byte CRC
                        chunks.push(Buffer.from([byte]));
                        totalBytesRead++;
                        crcBytesRead++;
                        if (crcBytesRead >= 2) {
                            this.port.removeListener('data', onData);
                            clearTimeout(timer);
                            resolve(Buffer.concat(chunks));
                            return;
                        }
                    }
                }
            };

            this.port.on('data', onData);
        });
    }

    // --- Basic Command API ---

    /**
     * Set duty cycle for Motor 1.
     * @param {number} address - Controller address.
     * @param {number} value - Duty cycle (-32767 to 32767).
     */
    async dutyM1(address, value) {
        return this._execute(address, Commands.M1DUTY, [value], ['sword']);
    }

    /**
     * Set duty cycle for Motor 2.
     * @param {number} address - Controller address.
     * @param {number} value - Duty cycle (-32767 to 32767).
     */
    async dutyM2(address, value) {
        return this._execute(address, Commands.M2DUTY, [value], ['sword']);
    }

    /**
     * Set duty cycle for both motors.
     * @param {number} address - Controller address.
     * @param {number} m1 - Duty cycle for M1.
     * @param {number} m2 - Duty cycle for M2.
     */
    async dutyM1M2(address, m1, m2) {
        return this._execute(address, Commands.MIXEDDUTY, [m1, m2], ['sword', 'sword']);
    }

    /**
     * Set speed for Motor 1.
     * @param {number} address - Controller address.
     * @param {number} value - Speed value.
     */
    async speedM1(address, value) {
        return this._execute(address, Commands.M1SPEED, [value], ['slong']);
    }

    /**
     * Set speed for Motor 2.
     * @param {number} address - Controller address.
     * @param {number} value - Speed value.
     */
    async speedM2(address, value) {
        return this._execute(address, Commands.M2SPEED, [value], ['slong']);
    }

    /**
     * Set speed for both motors.
     * @param {number} address - Controller address.
     * @param {number} m1 - Speed for M1.
     * @param {number} m2 - Speed for M2.
     */
    async speedM1M2(address, m1, m2) {
        return this._execute(address, Commands.MIXEDSPEED, [m1, m2], ['slong', 'slong']);
    }

    /**
     * Sets the acceleration and speed for motor 1.
     * @param {number} address - Controller address.
     * @param {number} accel - Acceleration value.
     * @param {number} speed - Speed value.
     */
    async speedAccelM1(address, accel, speed) {
        return this._execute(address, Commands.M1SPEEDACCEL, [accel, speed], ['long', 'slong']);
    }

    /**
     * Sets the acceleration and speed for motor 2.
     * @param {number} address - Controller address.
     * @param {number} accel - Acceleration value.
     * @param {number} speed - Speed value.
     */
    async speedAccelM2(address, accel, speed) {
        return this._execute(address, Commands.M2SPEEDACCEL, [accel, speed], ['long', 'slong']);
    }

    /**
     * Sets the acceleration and speed for both motors.
     * @param {number} address - Controller address.
     * @param {number} accel - Acceleration value.
     * @param {number} speed1 - Speed value for motor 1.
     * @param {number} speed2 - Speed value for motor 2.
     */
    async speedAccelM1M2(address, accel, speed1, speed2) {
        return this._execute(address, Commands.MIXEDSPEEDACCEL, [accel, speed1, speed2], ['long', 'slong', 'slong']);
    }

    /**
     * Sets the speed and distance for motor 1.
     * @param {number} address - Controller address.
     * @param {number} speed - Maximum speed.
     * @param {number} distance - Target distance.
     * @param {number} buffer - The buffer value to set.
     */
    async speedDistanceM1(address, speed, distance, buffer) {
        return this._execute(address, Commands.M1SPEEDDIST, [speed, distance, buffer], ['slong', 'long', 'byte']);
    }

    /**
     * Sets the speed and distance for motor 2.
     * @param {number} address - Controller address.
     * @param {number} speed - Maximum speed.
     * @al_ laC-word distance - Target distance.
     * @param {number} buffer - The buffer value to set.
     */
    async speedDistanceM2(address, speed, distance, buffer) {
        return this._execute(address, Commands.M2SPEEDDIST, [speed, distance, buffer], ['slong', 'long', 'byte']);
    }

    /**
     * Sets the speed and distance for both motors.
     * @param {number} address - Controller address.
     * @param {number} speed1 - Speed for motor 1.
     * @param {number} distance1 - Distance for motor 1.
     * @param {number} speed2 - Speed for motor 2.
     * @param {number} distance2 - Distance for motor 2.
     * @param {number} buffer - The buffer value to set.
     */
    async speedDistanceM1M2(address, speed1, distance1, speed2, distance2, buffer) {
        return this._execute(address, Commands.MIXEDSPEEDDIST, [speed1, distance1, speed2, distance2, buffer], ['slong', 'long', 'slong', 'long', 'byte']);
    }

    /**
     * Sets the acceleration, speed, and distance for motor 1.
     * @param {number} address - Controller address.
     * @param {number} accel - Acceleration value.
     * @param {number} speed - Maximum speed.
     * @param {number} distance - Target distance.
     * @param {number} buffer - The buffer value to set.
     */
    async speedAccelDistanceM1(address, accel, speed, distance, buffer) {
        return this._execute(address, Commands.M1SPEEDACCELDIST, [accel, speed, distance, buffer], ['long', 'slong', 'long', 'byte']);
    }

    /**
     * Sets the acceleration, speed, and distance for motor 2.
     * @param {number} address - Controller address.
     * @param {number} accel - Acceleration value.
     * @param {number} speed - Maximum speed.
     * @param {number} distance - Target distance.
     * @param {number} buffer - The buffer value to set.
     */
    async speedAccelDistanceM2(address, accel, speed, distance, buffer) {
        return this._execute(address, Commands.M2SPEEDACCELDIST, [accel, speed, distance, buffer], ['long', 'slong', 'long', 'byte']);
    }

    /**
     * Sets the acceleration, speed, and distance for both motors.
     * @param {number} address - Controller address.
     * @param {number} accel1 - Acceleration for motor 1.
     * @param {number} speed1 - Speed for motor 1.
     * @param {number} distance1 - Distance for motor 1.
     * @param {number} accel2 - Acceleration for motor 2.
     * @param {number} speed2 - Speed for motor 2.
     * @param {number} distance2 - Distance for motor 2.
     * @param {number} buffer - The buffer value to set.
     */
    async speedAccelDistanceM1M2(address, accel1, speed1, distance1, accel2, speed2, distance2, buffer) {
        return this._execute(address, Commands.MIXEDSPEEDACCELDIST, [accel1, speed1, distance1, accel2, speed2, distance2, buffer], ['long', 'slong', 'long', 'long', 'slong', 'long', 'byte']);
    }

    /**
     * Read encoder count for Motor 1.
     * @param {number} address - Controller address.
     */
    async readEncoder1(address) {
        const results = await this._execute(address, Commands.GETM1ENC, [], ['long', 'byte']);
        return {
            success: true,
            count: results[0],
            status: results[1]
        };
    }

    /**
     * Read encoder count for Motor 2.
     * @param {number} address - Controller address.
     */
    async readEncoder2(address) {
        const results = await this._execute(address, Commands.GETM2ENC, [], ['long', 'byte']);
        return {
            success: true,
            count: results[0],
            status: results[1]
        };
    }

    /**
     * Reads the encoder values for both motors.
     * @param {number} address - Controller address.
     */
    async getEncoders(address) {
        const results = await this._execute(address, Commands.GETENCODERS, [], ['long', 'long']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Reads the instantaneous speeds for both motors.
     * @param {number} address - Controller address.
     */
    async getISpeeds(address) {
        const results = await this._execute(address, Commands.GETISPEEDS, [], ['long', 'long']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Set velocity PID for Motor 1.
     * @param {number} address - Controller address.
     * @param {number} p - Proportional constant.
     * @param {number} i - Integral constant.
     * @param {number} d - Derivative constant.
     * @param {number} qpps - Quadrature pulses per second.
     */
    async setM1VelocityPID(address, p, i, d, qpps) {
        // Python uses a scale of 65536.0
        const scale = 65536.0;
        return this._execute(address, Commands.SETM1PID, [
            Math.floor(d * scale),
            Math.floor(p * scale),
            Math.floor(i * scale),
            qpps
        ], ['long', 'long', 'long', 'long']);
    }

    /**
     * Set velocity PID for Motor 2.
     * @param {number} address - Controller address.
     * @param {number} p - Proportional constant.
     * @param {number} i - Integral constant.
     * @param {number} d - Derivative constant.
     * @param {number} qpps - Quadrature pulses per second.
     */
    async setM2VelocityPID(address, p, i, d, qpps) {
        const scale = 65536.0;
        return this._execute(address, Commands.SETM2PID, [
            Math.floor(d * scale),
            Math.floor(p * scale),
            Math.floor(i * scale),
            qpps
        ], ['long', 'long', 'long', 'long']);
    }

    /**
     * Read main battery voltage.
     * @param {number} address - Controller address.
     */
    async readMainBatteryVoltage(address) {
        const results = await this._execute(address, Commands.GETMBATT, [], ['word']);
        return results[0];
    }

    /**
     * Read logic battery voltage.
     * @param {number} address - Controller address.
     */
    async readLogicBatteryVoltage(address) {
        const results = await this._execute(address, Commands.GETLBATT, [], ['word']);
        return results[0];
    }

    /**
     * Read firmware version.
     * @param {number} address - Controller address.
     */
    async readVersion(address) {
        return this._execute(address, Commands.GETVERSION, [], []);
    }

    /**
     * Reads and analyzes error and warning status from the controller.
     * @param {number} address - Controller address.
     * @returns {Promise<Object>} Analysis result.
     */
    async getStatusAnalysis(address) {
        const results = await this._execute(address, Commands.GETERROR, [], ['long']);
        const combinedStatus = results[0];

        const errorStatus = combinedStatus & 0xFFFF;
        const warnStatus = (combinedStatus >> 16) & 0xFFFF;

        return {
            combinedStatus,
            errorStatus,
            warnStatus,
            errors: decodeStatus(errorStatus, ErrorBits, ErrorDescriptions),
            warnings: decodeStatus(warnStatus, WarningBits, WarningDescriptions),
            hasErrors: errorStatus !== 0,
            hasWarnings: warnStatus !== 0
        };
    }

    /**
     * Reads the full status of the controller.
     * @param {number} address - Controller address.
     */
    /**
     * Sets the functions of pins S3, S4, and S5.
     * @param {number} address - Controller address.
     * @param {number} s3mode - Mode for pin S3.
     * @param {number} s4mode - Mode for pin S4.
     * @param {number} s5mode - Mode for pin S5.
     * @param {number} d1mode - Mode for pin CTRL1.
     * @param {number} d2mode - Mode for pin CTRL2.
     */
    async setPinFunctions(address, s3mode, s4mode, s5mode, d1mode, d2mode) {
        return this._execute(address, Commands.SETPINFUNCTIONS, [s3mode, s4mode, s5mode, d1mode, d2mode], ['byte', 'byte', 'byte', 'byte', 'byte']);
    }

    /**
     * Reads the functions of pins S3, S4, and S5.
     * @param {number} address - Controller address.
     */
    async readPinFunctions(address) {
        const results = await this._execute(address, Commands.GETPINFUNCTIONS, [], ['byte', 'byte', 'byte', 'byte', 'byte']);
        return {
            success: true,
            s3mode: results[0],
            s4mode: results[1],
            s5mode: results[2],
            d1mode: results[3],
            d2mode: results[4]
        };
    }

    /**
     * Sets the deadband and range values.
     * @param {number} address - Controller address.
     * @param {Object} settings - Settings object.
     */
    async setCtrlSettings(address, s) {
        return this._execute(address, Commands.SETCTRLSETTINGS, [
            s.s1revdeadband, s.s1fwddeadband, s.s1revlimit, s.s1fwdlimit, s.s1rangecenter, s.s1rangemin, s.s1rangemax,
            s.s2revdeadband, s.s2fwddeadband, s.s2revlimit, s.s2fwdlimit, s.s2rangecenter, s.s2rangemin, s.s2rangemax
        ], ['byte', 'byte', 'word', 'word', 'word', 'word', 'word', 'byte', 'byte', 'word', 'word', 'word', 'word', 'word']);
    }

    /**
     * Reads the deadband and range values.
     * @param {number} address - Controller address.
     */
    async getCtrlSettings(address) {
        const results = await this._execute(address, Commands.GETCTRLSETTINGS, [], ['byte', 'byte', 'word', 'word', 'word', 'word', 'word', 'byte', 'byte', 'word', 'word', 'word', 'word', 'word']);
        return {
            success: true,
            s1revdeadband: results[0],
            s1fwddeadband: results[1],
            s1revlimit: results[2],
            s1fwdlimit: results[3],
            s1rangecenter: results[4],
            s1rangemin: results[5],
            s1rangemax: results[6],
            s2revdeadband: results[7],
            s2fwddeadband: results[8],
            s2revlimit: results[9],
            s2fwdlimit: results[10],
            s2rangecenter: results[11],
            s2rangemin: results[12],
            s2rangemax: results[13]
        };
    }

    // --- Advanced Command API ---

    /**
     * Saves the active settings to non-volatile memory (NVM).
     * @param {number} address - Controller address.
     */
    async readNVM(address) {
        return this._execute(address, Commands.READNVM, [], []);
    }

    /**
     * Saves the active settings to non-volatile memory (NVM).
     * @param {number} address - Controller address.
     */
    async writeNVM(address) {
        return this._execute(address, Commands.WRITENVM, [0xE22EAB7A], ['long']);
    }

    /**
     * Restores the default settings.
     * @param {number} address - Controller address.
     */
    async restoreDefaults(address) {
        return this._execute(address, Commands.RESTOREDEFAULTS, [0xE22EAB7A], ['long']);
    }

    /**
     * Reads the configuration.
     * @param {number} address - Controller address.
     */
    async getConfig(address) {
        const results = await this._execute(address, Commands.GETCONFIG, [], ['word']);
        return results[0];
    }

    /**
     * Sets the configuration of the controller.
     * @param {number} address - Controller address.
     * @param {number} config - The configuration value (16-bit).
     */
    async setConfig(address, config) {
        return this._execute(address, Commands.SETCONFIG, [config], ['word']);
    }

    /**
     * Reads the encoder modes for both motors.
     * @param {number} address - Controller address.
     */
    async readEncoderModes(address) {
        const results = await this._execute(address, Commands.GETENCODERMODE, [], ['byte', 'byte']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Sets the encoder mode for motor 1.
     * @param {number} address - Controller address.
     * @param {number} mode - The encoder mode to set.
     */
    async setM1EncoderMode(address, mode) {
        return this._execute(address, Commands.SETM1ENCODERMODE, [mode], ['byte']);
    }

    /**
     * Sets the encoder mode for motor 2.
     * @param {number} address - Controller address.
     * @param {number} mode - The encoder mode to set.
     */
    async setM2EncoderMode(address, mode) {
        return this._execute(address, Commands.SETM2ENCODERMODE, [mode], ['byte']);
    }

    /**
     * Reads main and logic battery voltages.
     * @param {number} address - Controller address.
     */
    async getVolts(address) {
        const results = await this._execute(address, Commands.GETVOLTS, [], ['word', 'word']);
        return {
            success: true,
            mbat: results[0],
            lbat: results[1]
        };
    }

    /**
     * Reads temperature sensor values.
     * @param {number} address - Controller address.
     */
    async getTemps(address) {
        const results = await this._execute(address, Commands.GETTEMPS, [], ['word', 'word']);
        return {
            success: true,
            temp1: results[0],
            temp2: results[1]
        };
    }

    /**
     * Sets auxiliary PWM duty cycles.
     * @param {number} address - Controller address.
     * @param {number} d1, d2, d3, d4, d5 - Duty cycle values (-32767 to +32767).
     */
    async setAuxDutys(address, d1, d2, d3, d4, d5) {
        return this._execute(address, Commands.SETAUXDUTYS, [d1, d2, d3, d4, d5], ['word', 'word', 'word', 'word', 'word']);
    }

    /**
     * Reads auxiliary PWM duty cycles.
     * @param {number} address - Controller address.
     */
    async getAuxDutys(address) {
        const results = await this._execute(address, Commands.GETAUXDUTYS, [], ['word', 'word', 'word', 'word', 'word']);
        return {
            success: true,
            duties: results
        };
    }

    /**
     * Sets the maximum and minimum current limits for motor 1.
     * @param {number} address - Controller address.
     * @param {number} maxi - Maximum current limit.
     * @param {number} mini - Minimum current limit.
     */
    async setM1MaxCurrent(address, maxi, mini) {
        return this._execute(address, Commands.SETM1MAXCURRENT, [maxi, mini], ['long', 'long']);
    }

    /**
     * Sets the maximum and minimum current limits for motor 2.
     * @param {number} address - Controller address.
     * @param {number} maxi - Maximum current limit.
     * @param {number} mini - Minimum current limit.
     */
    async setM2MaxCurrent(address, maxi, mini) {
        return this._execute(address, Commands.SETM2MAXCURRENT, [maxi, mini], ['long', 'long']);
    }

    /**
     * Reads the maximum and minimum current limits for motor 1.
     * @param {number} address - Controller address.
     */
    async readM1MaxCurrent(address) {
        const results = await this._execute(address, Commands.GETM1MAXCURRENT, [], ['long', 'long']);
        return {
            success: true,
            maxi: results[0],
            mini: results[1]
        };
    }

    /**
     * Reads the maximum and minimum current limits for motor 2.
     * @param {number} address - Controller address.
     */
    async readM2MaxCurrent(address) {
        const results = await this._execute(address, Commands.GETM2MAXCURRENT, [], ['long', 'long']);
        return {
            success: true,
            maxi: results[0],
            mini: results[1]
        };
    }

    /**
     * Sets the priority levels.
     * @param {number} address - Controller address.
     * @param {number} p1, p2, p3 - Priority levels (0 to 255).
     */
    async setPriority(address, p1, p2, p3) {
        return this._execute(address, Commands.SETPRIORITY, [p1, p2, p3], ['byte', 'byte', 'byte']);
    }

    /**
     * Gets the priority levels.
     * @param {number} address - Controller address.
     */
    async getPriority(address) {
        const results = await this._execute(address, Commands.GETPRIORITY, [], ['byte', 'byte', 'byte']);
        return {
            success: true,
            p1: results[0],
            p2: results[1],
            p3: results[2]
        };
    }

    /**
     * Sets the mixed address.
     * @param {number} address - Controller address.
     * @param {number} newAddress - New address (0 to 255).
     * @param {number} enableMixing - Enable mixing (0 or 1).
     */
    async setAddressMixed(address, newAddress, enableMixing) {
        return this._execute(address, Commands.SETADDRESSMIXED, [newAddress, enableMixing], ['byte', 'byte']);
    }

    /**
     * Gets the mixed address.
     * @param {number} address - Controller address.
     */
    async getAddressMixed(address) {
        const results = await this._execute(address, Commands.GETADDRESSMIXED, [], ['byte', 'byte']);
        return {
            success: true,
            newAddress: results[0],
            mixed: results[1]
        };
    }

    /**
     * Reads the temperature from the first sensor.
     * @param {number} address - Controller address.
     */
    async readTemp(address) {
        const results = await this._execute(address, Commands.GETTEMP, [], ['word']);
        return results[0];
    }

    /**
     * Reads the temperature from the second sensor.
     * @param {number} address - Controller address.
     */
    async readTemp2(address) {
        const results = await this._execute(address, Commands.GETTEMP2, [], ['word']);
        return results[0];
    }

    /**
     * Reads the error status.
     * @param {number} address - Controller address.
     */
    async readError(address) {
        const results = await this._execute(address, Commands.GETERROR, [], ['long']);
        return results[0];
    }

    /**
     * Reads encoder error statuses.
     * @param {number} address - Controller address.
     */
    async getEncStatus(address) {
        const results = await this._execute(address, Commands.GETENCSTATUS, [], ['byte', 'byte']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Sets auto mode 1 value.
     * @param {number} address - Controller address.
     * @param {number} value - Auto mode configuration.
     */
    async setAuto1(address, value) {
        return this._execute(address, Commands.SETAUTO1, [value], ['long']);
    }

    /**
     * Sets auto mode 2 value.
     * @param {number} address - Controller address.
     * @param {number} value - Auto mode configuration.
     */
    async setAuto2(address, value) {
        return this._execute(address, Commands.SETAUTO2, [value], ['long']);
    }

    /**
     * Reads auto mode values.
     * @param {number} address - Controller address.
     */
    async getAutos(address) {
        const results = await this._execute(address, Commands.GETAUTOS, [], ['long', 'long']);
        return {
            success: true,
            auto1: results[0],
            auto2: results[1]
        };
    }

    /**
     * Reads current speed values for both motors.
     * @param {number} address - Controller address.
     */
    async getSpeeds(address) {
        const results = await this._execute(address, Commands.GETSPEEDS, [], ['long', 'long']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Reads speed error limits.
     * @param {number} address - Controller address.
     */
    async getSpeedErrorLimit(address) {
        const results = await this._execute(address, Commands.GETSPEEDERRORLIMIT, [], ['word', 'word']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Sets speed error limits.
     * @param {number} address - Controller address.
     * @param {number} limit1 - Motor 1 speed error limit.
     * @param {number} limit2 - Motor 2 speed error limit.
     */
    async setSpeedErrorLimit(address, limit1, limit2) {
        return this._execute(address, Commands.SETSPEEDERRORLIMIT, [limit1, limit2], ['word', 'word']);
    }

    /**
     * Reads current speed errors.
     * @param {number} address - Controller address.
     */
    async getSpeedErrors(address) {
        const results = await this._execute(address, Commands.GETSPEEDERRORS, [], ['word', 'word']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Commands motor 1 to absolute position.
     * @param {number} address - Controller address.
     * @param {number} position - Target position value.
     * @param {number} buffer - The buffer value to set.
     */
    async positionM1(address, position, buffer) {
        return this._execute(address, Commands.M1POS, [position, buffer], ['long', 'byte']);
    }

    /**
     * Commands motor 2 to absolute position.
     * @param {number} address - Controller address.
     * @param {number} position - Target position value.
     * @param {number} buffer - The buffer value to set.
     */
    async positionM2(address, position, buffer) {
        return this._execute(address, Commands.M2POS, [position, buffer], ['long', 'byte']);
    }

    /**
     * Commands both motors to positions simultaneously.
     * @param {number} address - Controller address.
     * @param {number} position1 - Motor 1 target position.
     * @param {number} position2 - Motor 2 target position.
     * @param {number} buffer - The buffer value to set.
     */
    async positionM1M2(address, position1, position2, buffer) {
        return this._execute(address, Commands.MIXEDPOS, [position1, position2, buffer], ['long', 'long', 'byte']);
    }

    /**
     * Commands motor 1 position with speed.
     * @param {number} address - Controller address.
     * @param {number} speed - Maximum speed.
     * @param {number} position - Target position.
     * @param {number} buffer - The buffer value to set.
     */
    async speedPositionM1(address, speed, position, buffer) {
        return this._execute(address, Commands.M1SPEEDPOS, [speed, position, buffer], ['long', 'long', 'byte']);
    }

    /**
     * Commands motor 2 position with speed.
     * @param {number} address - Controller address.
     * @param {number} speed - Maximum speed.
     * @param {number} position - Target position.
     * @param {number} buffer - The buffer value to set.
     */
    async speedPositionM2(address, speed, position, buffer) {
        return this._execute(address, Commands.M2SPEEDPOS, [speed, position, buffer], ['long', 'long', 'byte']);
    }

    /**
     * Commands both motors with speed and position.
     * @param {number} address - Controller address.
     * @param {number} speed1 - Motor 1 speed.
     * @param {number} position1 - Motor 1 position.
     * @param {number} speed2 - Motor 2 speed.
     * @param {number} position2 - Motor 2 position.
     * @param {number} buffer - The buffer value to set.
     */
    async speedPositionM1M2(address, speed1, position1, speed2, position2, buffer) {
        return this._execute(address, Commands.MIXEDSPEEDPOS, [speed1, position1, speed2, position2, buffer], ['long', 'long', 'long', 'long', 'byte']);
    }

    /**
     * Commands motor 1 to a percent position.
     * @param {number} address - Controller address.
     * @param {number} position - Target position as percentage (-32767 to +32767).
     * @param {number} buffer - The buffer value to set.
     */
    async percentPositionM1(address, position, buffer) {
        return this._execute(address, Commands.M1PPOS, [position, buffer], ['sword', 'byte']);
    }

    /**
     * Commands motor 2 to a percent position.
     * @param {number} address - Controller address.
     * @param {number} position - Target position as percentage (-32767 to +32767).
     * @param {number} buffer - The buffer value to set.
     */
    async percentPositionM2(address, position, buffer) {
        return this._execute(address, Commands.M2PPOS, [position, buffer], ['sword', 'byte']);
    }

    /**
     * Commands both motors to percent positions.
     * @param {number} address - Controller address.
     * @param {number} position1 - Motor 1 target position percentage (-32767 to +32767).
     * @param {number} position2 - Motor 2 target position percentage (-32767 to +32767).
     * @param {number} buffer - The buffer value to set.
     */
    async percentPositionM1M2(address, position1, position2, buffer) {
        return this._execute(address, Commands.MIXEDPPOS, [position1, position2, buffer], ['sword', 'sword', 'byte']);
    }

    /**
     * Sets the position error limits for both motors.
     * @param {number} address - Controller address.
     * @param {number} limit1 - Motor 1 position error limit (0 to 65535).
     * @param {number} limit2 - Motor 2 position error limit (0 to 65535).
     */
    async setPosErrorLimit(address, limit1, limit2) {
        return this._execute(address, Commands.SETPOSERRORLIMIT, [limit1, limit2], ['word', 'word']);
    }

    /**
     * Reads the position error limits.
     * @param {number} address - Controller address.
     */
    async getPosErrorLimit(address) {
        const results = await this._execute(address, Commands.GETPOSERRORLIMIT, [], ['word', 'word']);
        return {
            success: true,
            limit1: results[0],
            limit2: results[1]
        };
    }

    /**
     * Reads current position errors.
     * @param {number} address - Controller address.
     */
    async getPosErrors(address) {
        const results = await this._execute(address, Commands.GETPOSERRORS, [], ['word', 'word']);
        return {
            success: true,
            error1: results[0],
            error2: results[1]
        };
    }

    /**
     * Sets voltage offsets.
     * @param {number} address - Controller address.
     * @param {number} offset1 - MBat voltage offset (0 to 255).
     * @param {number} offset2 - LBat voltage offset (0 to 255).
     */
    async setOffsets(address, offset1, offset2) {
        return this._execute(address, Commands.SETOFFSETS, [offset1, offset2], ['byte', 'byte']);
    }

    /**
     * Reads voltage offsets.
     * @param {number} address - Controller address.
     */
    async getOffsets(address) {
        const results = await this._execute(address, Commands.GETOFFSETS, [], ['byte', 'byte']);
        return {
            success: true,
            mbatoffset: results[0] ? (results[0] & 0x80 ? results[0] - 256 : results[0]) : 0,
            lbatoffset: results[1] ? (results[1] & 0x80 ? results[1] - 256 : results[1]) : 0
        };
    }

    /**
     * Sets motor 1 Inductance/Resistance.
     * @param {number} address - Controller address.
     * @param {number} L - Inductance in Henries.
     * @param {number} R - Resistance in Ohms.
     */
    async setM1LR(address, L, R) {
        const scale = 0x1000000;
        return this._execute(address, Commands.SETM1LR, [Math.floor(L * scale), Math.floor(R * scale)], ['long', 'long']);
    }

    /**
     * Reads motor 1 Inductance/Resistance.
     * @param {number} address - Controller address.
     */
    async getM1LR(address) {
        const results = await this._execute(address, Commands.GETM1LR, [], ['long', 'long']);
        const scale = 0x1000000;
        return {
            success: true,
            L: results[0] / scale,
            R: results[1] / scale
        };
    }

    /**
     * Sets motor 2 Inductance/Resistance.
     * @param {number} address - Controller address.
     * @param {number} L - Inductance in Henries.
     * @param {number} R - Resistance in Ohms.
     */
    async setM2LR(address, L, R) {
        const scale = 0x1000000;
        return this._execute(address, Commands.SETM2LR, [Math.floor(L * scale), Math.floor(R * scale)], ['long', 'long']);
    }

    /**
     * Reads motor 2 Inductance/Resistance.
     * @param {number} address - Controller address.
     */
    async getM2LR(address) {
        const results = await this._execute(address, Commands.GETM2LR, [], ['long', 'long']);
        const scale = 0x1000000;
        return {
            success: true,
            L: results[0] / scale,
            R: results[1] / scale
        };
    }

    /**
     * Sets the node ID.
     * @param {number} address - Controller address.
     * @param {number} nodeid - Node ID (0 to 255).
     */
    async setNodeID(address, nodeid) {
        return this._execute(address, Commands.SETNODEID, [nodeid], ['byte']);
    }

    /**
     * Gets the node ID.
     * @param {number} address - Controller address.
     */
    async getNodeID(address) {
        const results = await this._execute(address, Commands.GETNODEID, [], ['byte']);
        return {
            success: true,
            nodeid: results[0]
        };
    }

    /**
     * Sets the PWM idle parameters.
     * @param {number} address - Controller address.
     * @param {number} idledelay1 - Idle delay 1 (0 to 12.7 seconds).
     * @param {boolean} idlemode1 - Idle mode 1 (True = enable, False = disable).
     * @param {number} idledelay2 - Idle delay 2 (0 to 12.7 seconds).
     * @param {boolean} idlemode2 - Idle mode 2 (True = enable, False = disable).
     */
    async setPWMIdle(address, idledelay1, idlemode1, idledelay2, idlemode2) {
        const byte1 = (Math.floor(idledelay1 * 10) & 0x7F) | (idlemode1 ? 0x80 : 0x00);
        const byte2 = (Math.floor(idledelay2 * 10) & 0x7F) | (idlemode2 ? 0x80 : 0x00);
        return this._execute(address, Commands.SETPWMIDLE, [byte1, byte2], ['byte', 'byte']);
    }

    /**
     * Gets the PWM idle parameters.
     * @param {number} address - Controller address.
     */
    async getPWMIdle(address) {
        const results = await this._execute(address, Commands.GETPWMIDLE, [], ['byte', 'byte']);
        const val1 = results[0];
        const val2 = results[1];
        return {
            success: true,
            idledelay1: (val1 & 0x7F) / 10,
            idlemode1: Boolean(val1 & 0x80),
            idledelay2: (val2 & 0x7F) / 10,
            idlemode2: Boolean(val2 & 0x80)
        };
    }

    /**
     * Resets the emergency stop.
     * @param {number} address - Controller address.
     */
    async resetEStop(address) {
        return this._execute(address, Commands.RESETESTOP, [], [], null, Priority.CRITICAL);
    }

    /**
     * Sets the emergency stop lock state.
     * @param {number} address - Controller address.
     * @param {number} state - State value (0x55, 0xAA, or 0).
     */
    async setEStopLock(address, state) {
        if (![0x55, 0xAA, 0].includes(state)) {
            throw new Error("Invalid state value. Must be 0x55, 0xAA, or 0.");
        }
        return this._execute(address, Commands.SETESTOPLOCK, [state], ['byte'], null, Priority.CRITICAL);
    }

    /**
     * Gets the emergency stop lock state.
     * @param {number} address - Controller address.
     */
    async getEStopLock(address) {
        const results = await this._execute(address, Commands.GETESTOPLOCK, [], ['byte']);
        return results[0];
    }

    /**
     * Sets the script auto run time.
     * @param {number} address - Controller address.
     * @param {number} time - Auto run time in milliseconds.
     */
    async setScriptAutoRun(address, time) {
        if (time < 100 && time !== 0) {
            throw new Error("Scriptauto_time value is below 100! Script will not autorun.");
        }
        return this._execute(address, Commands.SETSCRIPTAUTORUN, [time], ['long']);
    }

    /**
     * Gets the script auto run time.
     * @param {number} address - Controller address.
     */
    async getScriptAutoRun(address) {
        const results = await this._execute(address, Commands.GETSCRIPTAUTORUN, [], ['long']);
        return results[0];
    }

    /**
     * Starts the script.
     * @param {number} address - Controller address.
     */
    async startScript(address) {
        return this._execute(address, Commands.STARTSCRIPT, [], []);
    }

    /**
     * Stops the script.
     * @param {number} address - Controller address.
     */
    async stopScript(address) {
        return this._execute(address, Commands.STOPSCRIPT, [], []);
    }

    /**
     * Sets the PWM modes for both motors.
     * @param {number} address - Controller address.
     * @param {number} mode1 - PWM mode for motor 1.
     * @param {number} mode2 - PWM mode for motor 2.
     */
    async setPWMMode(address, mode1, mode2) {
        return this._execute(address, Commands.SETPWMMODE, [mode1, mode2], ['byte', 'byte']);
    }

    /**
     * Reads the PWM modes for both motors.
     * @param {number} address - Controller address.
     */
    async readPWMMode(address) {
        const results = await this._execute(address, Commands.GETPWMMODE, [], ['byte', 'byte']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Gets the digital outputs.
     * @param {number} address - Controller address.
     */
    async getDOUTS(address) {
        if (!this.connected) throw new NotConnectedError();

        const task = async () => {
            for (let attempt = 0; attempt <= this.retries; attempt++) {
                try {
                    await this.port.flushInput();
                    await this.port.write(PacketManager.createPacket(address, Commands.GETDOUTS, []));

                    const responseBuffer = await this._readCountedResponse(255, 1);
                    PacketManager.verifyPacket(responseBuffer);

                    const count = responseBuffer[0];
                    const actions = [];
                    for (let i = 1; i <= count; i++) {
                        actions.push(responseBuffer[i]);
                    }

                    return {
                        success: true,
                        count,
                        actions
                    };
                } catch (error) {
                    if (!(error instanceof CommunicationError || error instanceof CRCError || error instanceof PacketTimeoutError) || attempt === this.retries) {
                        throw error;
                    }
                }
            }
            throw new CommunicationError(`Failed to read digital outputs after ${this.retries + 1} attempts`);
        };

        return this.queue.enqueue(task, Priority.NORMAL);
    }

    /**
     * Sets the device serial number (36 bytes).
     * @param {number} address - Controller address.
     * @param {string} serialNumber - Serial number string.
     */
    async setSerialNumber(address, serialNumber) {
        let truncatedSerial = serialNumber;
        if (truncatedSerial.length > 36) {
            truncatedSerial = truncatedSerial.substring(0, 36);
        }

        const args = [truncatedSerial.length];
        const types = ['byte'];

        for (let i = 0; i < 36; i++) {
            args.push(truncatedSerial.charCodeAt(i) || 0);
            types.push('byte');
        }

        return this._execute(address, Commands.SETSERIALNUMBER, args, types);
    }

    async getSerialNumber(address) {
        if (!this.connected) throw new NotConnectedError();

        const task = async () => {
            for (let attempt = 0; attempt <= this.retries; attempt++) {
                try {
                    await this.port.flushInput();
                    await this.port.write(PacketManager.createPacket(address, Commands.GETSERIALNUMBER, []));

                    const responseBuffer = await this._readSerialNumberResponse();
                    PacketManager.verifyPacket(responseBuffer);

                    const count = responseBuffer[0];
                    const serialStr = responseBuffer.subarray(1, 1 + count).toString('ascii');
                    return {
                        success: true,
                        serialNumber: serialStr
                    };
                } catch (error) {
                    if (!(error instanceof CommunicationError || error instanceof CRCError || error instanceof PacketTimeoutError) || attempt === this.retries) {
                        throw error;
                    }
                }
            }
            throw new CommunicationError(`Failed to read serial number after ${this.retries + 1} attempts`);
        };

        return this.queue.enqueue(task, Priority.NORMAL);
    }

    /**
     * Reads the buffer status.
     * @param {number} address - Controller address.
     */
    async readBuffers(address) {
        const results = await this._execute(address, Commands.GETBUFFERS, [], ['byte', 'byte']);
        return {
            success: true,
            buffer1: results[0],
            buffer2: results[1]
        };
    }

    /**
     * Reads the PWM values.
     * @param {number} address - Controller address.
     */
    async readPWMs(address) {
        const results = await this._execute(address, Commands.GETPWMS, [], ['word', 'word']);
        const convert = (val) => (val & 0x8000) ? val - 0x10000 : val;
        return {
            success: true,
            pwm1: convert(results[0]),
            pwm2: convert(results[1])
        };
    }

    /**
     * Reads the current values.
     * @param {number} address - Controller address.
     */
    async readCurrents(address) {
        const results = await this._execute(address, Commands.GETCURRENTS, [], ['word', 'word']);
        const convert = (val) => (val & 0x8000) ? val - 0x10000 : val;
        return {
            success: true,
            current1: convert(results[0]),
            current2: convert(results[1])
        };
    }

    /**
     * Sets the default acceleration and deceleration for motor 1.
     * @param {number} address - Controller address.
     * @param {number} accel - Acceleration.
     * @param {number} decel - Deceleration.
     */
    async setM1DefaultAccel(address, accel, decel) {
        return this._execute(address, Commands.SETM1DEFAULTACCEL, [accel, decel], ['long', 'long']);
    }

    /**
     * Sets the default acceleration and deceleration for motor 2.
     * @param {number} address - Controller address.
     * @param {number} accel - Acceleration.
     * @param {number} decel - Deceleration.
     */
    async setM2DefaultAccel(address, accel, decel) {
        return this._execute(address, Commands.SETM2DEFAULTACCEL, [accel, decel], ['long', 'long']);
    }

    /**
     * Reads the default accelerations for both motors.
     * @param {number} address - Controller address.
     */
    async getDefaultAccels(address) {
        const results = await this._execute(address, Commands.GETDEFAULTACCELS, [], ['long', 'long', 'long', 'long']);
        return {
            success: true,
            accel1: results[0],
            decel1: results[1],
            accel2: results[2],
            decel2: results[3]
        };
    }

    /**
     * Sets the default speed for motor 1.
     * @param {number} address - Controller address.
     * @param {number} speed - Speed.
     */
    async setM1DefaultSpeed(address, speed) {
        return this._execute(address, Commands.SETM1DEFAULTSPEED, [speed], ['word']);
    }

    /**
     * Sets the default speed for motor 2.
     * @param {number} address - Controller address.
     * @param {number} speed - Speed.
     */
    async setM2DefaultSpeed(address, speed) {
        return this._execute(address, Commands.SETM2DEFAULTSPEED, [speed], ['word']);
    }

    /**
     * Reads the default speeds for both motors.
     * @param {number} address - Controller address.
     */
    async getDefaultSpeeds(address) {
        const results = await this._execute(address, Commands.GETDEFAULTSPEEDS, [], ['word', 'word']);
        return {
            success: true,
            m1: results[0],
            m2: results[1]
        };
    }

    /**
     * Sets the signal parameters.
     * @param {number} address - Controller address.
     * @param {Object} p - Parameters.
     */
    async setSignal(address, p) {
        return this._execute(address, Commands.SETSIGNAL, [
            p.index, p.signalType, p.mode, p.target,
            p.minAction, p.maxAction, p.lowpass, p.timeout,
            p.loadHome, p.minVal, p.maxVal, p.center,
            p.deadband, p.powerexp, p.minout, p.maxout,
            p.powermin, p.potentiometer
        ], [
            'byte', 'byte', 'byte', 'byte', 'word', 'word', 'byte', 'long',
            'slong', 'slong', 'slong', 'slong', 'long', 'long', 'long', 'long', 'long', 'long'
        ]);
    }

    /**
     * Gets the signal parameters.
     * @param {number} address - Controller address.
     */
    async getSignals(address) {
        if (!this.connected) throw new NotConnectedError();

        const task = async () => {
            for (let attempt = 0; attempt <= this.retries; attempt++) {
                try {
                    await this.port.flushInput();
                    await this.port.write(PacketManager.createPacket(address, Commands.GETSIGNALS, []));

                    const responseBuffer = await this._readCountedResponse(255, 56);
                    PacketManager.verifyPacket(responseBuffer);

                    const count = responseBuffer[0];
                    const signals = [];
                    let offset = 1;

                    for (let i = 0; i < count; i++) {
                        const s = {};
                        s.type = responseBuffer[offset++];
                        s.mode = responseBuffer[offset++];
                        s.target = responseBuffer[offset++];
                        s.minAction = responseBuffer.readUInt16BE(offset); offset += 2;
                        s.maxAction = responseBuffer.readUInt16BE(offset); offset += 2;
                        s.lowpass = responseBuffer[offset++];
                        s.timeout = responseBuffer.readUInt32BE(offset); offset += 4;
                        s.loadHome = responseBuffer.readInt32BE(offset); offset += 4;
                        s.minVal = responseBuffer.readInt32BE(offset); offset += 4;
                        s.maxVal = responseBuffer.readInt32BE(offset); offset += 4;
                        s.center = responseBuffer.readInt32BE(offset); offset += 4;
                        s.deadband = responseBuffer.readUInt32BE(offset); offset += 4;
                        s.powerexp = responseBuffer.readUInt32BE(offset); offset += 4;
                        s.minout = responseBuffer.readUInt32BE(offset); offset += 4;
                        s.maxout = responseBuffer.readUInt32BE(offset); offset += 4;
                        s.powermin = responseBuffer.readUInt32BE(offset); offset += 4;
                        s.potentiometer = responseBuffer.readUInt32BE(offset); offset += 4;
                        signals.push(s);
                    }
                    return { success: true, count, signals };
                } catch (error) {
                    if (!(error instanceof CommunicationError || error instanceof CRCError || error instanceof PacketTimeoutError) || attempt === this.retries) {
                        throw error;
                    }
                }
            }
            throw new CommunicationError(`Failed to read signals after ${this.retries + 1} attempts`);
        };
        return this.queue.enqueue(task, Priority.NORMAL);
    }

    /**
     * Gets the current signals data from the controller.
     * @param {number} address - Controller address.
     */
    async getSignalsData(address) {
        if (!this.connected) throw new NotConnectedError();

        const task = async () => {
            for (let attempt = 0; attempt <= this.retries; attempt++) {
                try {
                    await this.port.flushInput();
                    await this.port.write(PacketManager.createPacket(address, Commands.GETSIGNALSDATA, []));

                    const responseBuffer = await this._readCountedResponse(255, 20);
                    PacketManager.verifyPacket(responseBuffer);

                    const count = responseBuffer[0];
                    const signalsData = [];
                    let offset = 1;

                    for (let i = 0; i < count; i++) {
                        signalsData.push({
                            command: responseBuffer.readInt32BE(offset),
                            position: responseBuffer.readInt32BE(offset + 4),
                            percent: responseBuffer.readInt32BE(offset + 8),
                            speed: responseBuffer.readInt32BE(offset + 12),
                            speeds: responseBuffer.readInt32BE(offset + 16)
                        });
                        offset += 20;
                    }
                    return { success: true, count, signalsData };
                } catch (error) {
                    if (!(error instanceof CommunicationError || error instanceof CRCError || error instanceof PacketTimeoutError) || attempt === this.retries) {
                        throw error;
                    }
                }
            }
            throw new CommunicationError(`Failed to read signals data after ${this.retries + 1} attempts`);
        };
        return this.queue.enqueue(task, Priority.NORMAL);
    }

    /**
     * Gets CAN ESR register.
     * @param {number} address - Controller address.
     */
    async canGetESR(address) {
        const results = await this._execute(address, Commands.CANGETESR, [], ['long']);
        return {
            success: true,
            esr: results[0]
        };
    }

    /**
     * Sends a CAN packet.
     * @param {number} address - Controller address.
     * @param {number} cobId - CAN object identifier.
     * @param {number} rtr - Remote Transmission Request (0 or 1).
     * @param {number[]} data - Data bytes (max 8).
     */
    async canPutPacket(address, cobId, rtr, data) {
        if (data.length > 8) throw new Error("Data length must be no more than 8 bytes");

        const paddedData = [...data, ...new Array(8 - data.length).fill(0)];
        const args = [cobId, rtr, data.length, ...paddedData];
        const types = ['word', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte'];

        return this._execute(address, Commands.CANPUTPACKET, args, types);
    }

    /**
     * Reads a CAN packet from the controller.
     * @param {number} address - Controller address.
     */
    async canGetPacket(address) {
        if (!this.connected) throw new NotConnectedError();

        const task = async () => {
            for (let attempt = 0; attempt <= this.retries; attempt++) {
                try {
                    await this.port.flushInput();
                    await this.port.write(PacketManager.createPacket(address, Commands.CANGETPACKET, []));

                    const responseBuffer = await this._readResponseWithTimeout(['byte', 'word', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte', 'byte']);
                    PacketManager.verifyPacket(responseBuffer);

                    if (responseBuffer[0] === 0xFF) {
                        return {
                            success: true,
                            valid: true,
                            cobId: responseBuffer.readUInt16BE(1),
                            rtr: responseBuffer[3],
                            length: responseBuffer[4],
                            data: Array.from(responseBuffer.subarray(5, 13))
                        };
                    } else {
                        return { success: true, valid: false, cobId: 0, rtr: 0, length: 0, data: [] };
                    }
                } catch (error) {
                    if (!(error instanceof CommunicationError || error instanceof CRCError || error instanceof PacketTimeoutError) || attempt === this.retries) {
                        throw error;
                    }
                }
            }
            throw new CommunicationError(`Failed to read CAN packet after ${this.retries + 1} attempts`);
        };

        return this.queue.enqueue(task, Priority.NORMAL);
    }

    /**
     * Writes to the local CANopen dictionary.
     * @param {number} address - Controller address.
     * @param {number} nodeId - Node ID.
     * @param {number} index - Dictionary index.
     * @param {number} subindex - Subindex.
     * @param {number} value - Value to write.
     * @param {number} size - Size in bytes.
     */
    async canOpenWriteLocalDict(address, nodeId, index, subindex, value, size) {
        return this._execute(address, Commands.CANOPENWRITEDICT, [nodeId, index, subindex, value, size], ['byte', 'word', 'byte', 'long', 'byte']);
    }

    /**
     * Reads from the local CANopen dictionary.
     * @param {number} address - Controller address.
     * @param {number} nodeId - Node ID.
     * @param {number} index - Dictionary index.
     * @param {number} subindex - Subindex.
     */
    async canOpenReadLocalDict(address, nodeId, index, subindex) {
        return this._execute(address, Commands.CANOPENREADDICT, [nodeId, index, subindex], ['byte', 'word', 'byte'], ['long', 'byte', 'byte', 'long']);
    }

    /**
     * Reads a word from the EEPROM.
     * @param {number} address - Controller address.
     * @param {number} eeAddress - EEPROM address (0-255).
     */
    async readEEPROM(address, eeAddress) {
        if (!this.connected) throw new NotConnectedError();

        const task = async () => {
            for (let attempt = 0; attempt <= this.retries; attempt++) {
                try {
                    await this.port.flushInput();
                    await this.port.write(PacketManager.createPacket(address, Commands.READEEPROM, []));
                    await this.port.write(Buffer.from([eeAddress & 0xFF]));

                    const responseBuffer = await this._readResponseWithTimeout(['word', 'word']); // Word value + Word CRC
                    PacketManager.verifyPacket(responseBuffer);

                    return {
                        success: true,
                        value: responseBuffer.readUInt16BE(0)
                    };
                } catch (error) {
                    if (!(error instanceof CommunicationError || error instanceof CRCError || error instanceof PacketTimeoutError) || attempt === this.retries) {
                        throw error;
                    }
                }
            }
            throw new CommunicationError(`Failed to read EEPROM after ${this.retries + 1} attempts`);
        };
        return this.queue.enqueue(task, Priority.NORMAL);
    }

    /**
     * Writes a word to the EEPROM.
     * @param {number} address - Controller address.
     * @param {number} eeAddress - EEPROM address.
     * @ laC-word - Word value to write.
     */
    async writeEEPROM(address, eeAddress, eeWord) {
        return this._execute(address, Commands.WRITEEEPROM, [eeAddress, (eeWord >> 8) & 0xFF, eeWord & 0xFF], ['byte', 'byte', 'byte']);
    }
}
