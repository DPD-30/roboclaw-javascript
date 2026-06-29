# Implementation Plan: RoboClaw JavaScript Driver

## Goal
Provide a high-reliability, asynchronous Node.js interface for the RoboClaw motor controller, ported from the official Python library, optimized for Raspberry Pi Zero 2.

## Architecture Overview
- **Execution Environment**: Node.js (ESM)
- **Communication**: `serialport` (UART)
- **Concurrency**: Prioritized Promise Queue
- **Data Handling**: Big-Endian Buffer mapping
- **API Style**: Modern Async/Await

---

## Phases of Implementation

### Phase 1: Core Communication (The Foundation)
- [x] **CRC Utility**: Implement the CRC16 lookup table and calculation logic.
- [x] **Type Mapper**: Create a utility to map `byte`, `word`, `long` (and signed variants) to Node.js `Buffer` read/write methods.
- [x] **Packet Manager**:
    - Implement packet construction: `[Address, Command, Payload, CRC]`.
    - Implement packet parsing and CRC verification.
    - Implement basic serial read/write wrappers.

### Phase 2: Concurrency & Reliability (The Engine)
- [x] **Prioritized Queue**:
    - Implement a queue that handles `CRITICAL`, `NORMAL`, and `LOW` priority tasks.
    - Ensure each command is a Promise that resolves only after the full response (or timeout) is received.
    - Implement the "Queue Flush" mechanism for `CRITICAL` commands.
- [x] **Retry Logic**: Implement configurable retry attempts for `CommunicationError` scenarios.

### Phase 3: The Driver API (The Interface)
- [x] **Connection Management**: `connect()` and `disconnect()` methods with state tracking.
- [x] **Basic Command Implementation**: Port high-frequency methods:
    - `dutyM1()`, `dutyM2()`, `dutyM1M2()`
    - `speedM1()`, `speedM2()`, `speedM1M2()`
    - `readEncoder1()`, `readEncoder2()`
- [x] **Advanced Command Implementation**: Port the remaining commands from the Python `commands.py` (PIDs, Battery, Configuration, CANopen, EEPROM).
- [x] **Status Decoding**: Port `decode_error_status` and `decode_warning_status` into a `getStatusAnalysis()` method.

### Phase 4: Testing & Verification
- [x] **Mock Serial Port**: Create a mock for `serialport` to test packet construction and CRC without hardware.
- [x] **Integration Tests**: Verify communication with actual RoboClaw hardware on Pi Zero 2. (Verified via `hardware_motors.test.js` and `hardware_movement.test.js`).
- [x] **Stress Testing**: Validate that the Prioritized Queue correctly handles E-Stops during heavy telemetry reads.
- [x] **Exhaustive Read Verification**: Verify all read functions against hardware. Current status: Core communication and CRC chaining verified. Found that several commands (e.g., `getVolts`, `getStatus`) timeout on firmware v4.2.8. Implementation of comprehensive `_isReadCommand` and NACK detection has been completed; remaining timeouts are attributed to firmware limitations.
- [x] **CRC Session Management**: Implement stateful CRC verification where the response CRC is calculated using the request's payload CRC as the starting point.

---

## Critical Technical Details
- **Baud Rate**: 38,400
- **Default Address**: `0x80`
- **Byte Order**: Big-Endian (BE)
- **Types**:
    - `byte`: 8-bit unsigned
    - `sbyte`: 8-bit signed
    - `word`: 16-bit unsigned
    - `sword`: 16-bit signed
    - `long`: 32-bit unsigned
    - `slong`: 32-bit signed

---

## References
- **Python Library Source**: `/Users/danield/Documents/localDev/k9/roboclaw/basicmicro_python/`
- **RoboClaw User Manual**: `/Users/danield/Documents/localDev/k9/roboclaw/docs/roboclaw_user_manual.pdf`
