# roboclaw-javascript

Node.js driver for RoboClaw motor controllers.

## Install

```bash
npm install roboclaw-javascript
```

## Usage

```js
import { RoboClaw } from 'roboclaw-javascript';

const controller = new RoboClaw('/dev/ttyUSB0', 38400);
await controller.connect();
const version = await controller._execute(0x80, 0x1E, [], [], null);
console.log(version);
await controller.disconnect();
```

## License

MIT
