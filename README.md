# RoboClaw JavaScript Driver

A high-reliability, asynchronous Node.js driver for RoboClaw motor controllers. This library is a functional port of the official Python `basicmicro` library, designed for precise motor control and telemetry in robotics applications.

## 🚀 Features

- **Async/Await API**: Fully promisified interface for modern Node.js development.
- **Prioritized Command Queue**: Built-in priority management (`CRITICAL`, `NORMAL`, `LOW`). Emergency commands (like E-Stop resets) jump the queue and flush pending low-priority tasks to ensure immediate execution.
- **Robust Communication**: Implements CRC16 CCITT with session-based CRC chaining for guaranteed packet integrity.
- **Comprehensive Command Set**: Full parity with the Python `basicmicro` library, covering Duty Cycle, Speed, Position, and System Telemetry.
- **Optimized for SBCs**: Tested and verified on Raspberry Pi Zero 2.

## 🛠 Installation

```bash
npm install roboclaw-javascript
```

## ⚙️ Hardware Configuration

To communicate with the RoboClaw, ensure your controller is configured for **Packet Serial Mode**.

- **Baud Rate**: 38,400
- **Default Address**: `0x80`
- **Typical Port (Raspberry Pi)**: `/dev/ttyACM0`

## 📖 Quick Start

```javascript
import { RoboClaw } from 'roboclaw-javascript';

async function main() {
    // Initialize: port, baudRate, timeout(ms), retries
    const controller = new RoboClaw('/dev/ttyACM0', 38400, 1000, 2);

    try {
        await controller.connect();
        console.log('Connected to RoboClaw');

        // 1. Verify Connection
        const version = await controller.readVersion(0x80);
        console.log(`Firmware Version: ${version}`);

        // 2. Read Telemetry
        const voltage = await controller.readMainBatteryVoltage(0x80);
        console.log(`Main Battery: ${voltage / 10}V`);

        // 3. Basic Movement (Low Power)
        // Duty cycle range: -32767 to 32767
        console.log('Moving motors forward at 10% power...');
        await controller.dutyM1M2(0x80, 3276, 3276);
        
        // Wait for 1 second
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Stop Motors
        await controller.dutyM1M2(0x80, 0, 0);
        console.log('Motors stopped.');

    } catch (error) {
        console.error(`Communication Error: ${error.message}`);
    } finally {
        await controller.disconnect();
    }
}

main();
```

## ⚠️ Safety Guidelines

**Motor control can be dangerous.** When developing and testing:

1. **Use a Stand**: Always keep the robot wheels **OFF the ground** until you have verified your code logic.
2. **Physical E-Stop**: Have a physical way to kill power to the motors immediately.
3. **Incremental Testing**: Start with very low duty cycles (e.g., 5-10%) before increasing power.
4. **Stop on Exit**: Always ensure your code sends a stop command (`0, 0`) in the `finally` block or during cleanup.

## 🛠 API Reference

### Connection
- `connect()`: Opens the serial port.
- `disconnect()`: Closes the serial port.

### Motor Control
- `dutyM1(address, value)` / `dutyM2(...)` / `dutyM1M2(...)`: Sets PWM duty cycle (**-32767 to 32767**).
- `speedM1(address, value)` / `speedM2(...)` / `speedM1M2(...)`: Sets velocity (**signed 32-bit integer**).
- `positionM1(address, pos, buffer)` / `positionM2(...)` / `positionM1M2(...)`: Absolute position control.
- `percentPositionM1(address, percent, buffer)`: Position as a percentage of range.

### Telemetry & System
- `readVersion(address)`: Returns firmware version string.
- `readMainBatteryVoltage(address)`: Returns main battery voltage (tenths of a volt).
- `readLogicBatteryVoltage(address)`: Returns logic battery voltage (tenths of a volt).
- `readEncoder1(address)` / `readEncoder2(...)`: Returns encoder count and status.
- `getStatusAnalysis(address)`: Returns a decoded object of current error and warning bits.

### Emergency
- `resetEStop(address)`: Resets the emergency stop (High Priority).

## 📝 Known Limitations

- **Firmware v4.2.8**: Some advanced read commands (e.g., `getVolts`, `getStatus`, `getNodeID`) may timeout or return NACK on this specific firmware version. This is a confirmed hardware/firmware limitation and not a driver bug.

## 📄 License
MIT
