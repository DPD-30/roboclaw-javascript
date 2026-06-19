# RoboClaw JavaScript Driver

Node.js driver for the RoboClaw motor controller, ported from Python.

## Project Goals
- Provide a reliable, asynchronous interface for RoboClaw via Node.js.
- Ensure 1:1 functional parity with the Python `basicmicro` library.
- Guarantee safety via a prioritized command queue (E-Stops always jump the line).
- Optimized for Raspberry Pi Zero 2.

## Tech Stack
- **Runtime**: Node.js (ESM)
- **Library**: `serialport`
- **Target**: RoboClaw Packet Serial Mode (38.4k baud)

## Development Guidelines
- **API Style**: Use modern `async/await` and camelCase methods.
- **Types**: All serial communication must use Big-Endian (`BE`) buffer methods.
- **Error Handling**: Throw structured errors (`NotConnectedError`, `CommunicationError`, etc.).
- **Testing**: Use the `/tests` directory for both mock-based and hardware-based tests.

## Commands
- `npm install`: Install dependencies.
- `npm test`: (TBD) Run test suite.

## Current Status
- [x] Project initialized and `package.json` configured for ESM.
- [x] `serialport` dependency installed.
- [x] `Commands` enum ported.
- [x] Base Error classes implemented.
- [ ] Core Packet Manager and CRC implementation (Next).
