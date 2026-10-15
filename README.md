![Logo](admin/melcloudhome.png)
# ioBroker.melcloudhome

[![NPM version](https://img.shields.io/npm/v/iobroker.melcloudhome.svg)](https://www.npmjs.com/package/iobroker.melcloudhome)
[![Downloads](https://img.shields.io/npm/dm/iobroker.melcloudhome.svg)](https://www.npmjs.com/package/iobroker.melcloudhome)
![Number of Installations](https://iobroker.live/badges/melcloudhome-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/melcloudhome-stable.svg)

**Tests:** ![Test and Release](https://github.com/Sven-83/ioBroker.melcloudhome/workflows/Test%20and%20Release/badge.svg)

> ⚠️ **Work in progress** – not ready for productive use yet.

German documentation: [docs/de/README.md](docs/de/README.md)

---

## English

Control Mitsubishi Electric air conditioners via **MELCloud Home** – the new Mitsubishi cloud platform.
This adapter does **not** work with the classic MELCloud (use [ioBroker.melcloud](https://github.com/Black-Thunder/ioBroker.melcloud) for that).

### Planned features (v1)
- Air-to-air units (air conditioners): power, mode, target temperature, room/outdoor temperature, fan speed, vanes, online and error status, energy (if provided), off-timer
- Real-time updates via WebSocket with automatic polling fallback
- Bundled dashboard for VIS-2 / browser

### Configuration
| Setting | Description |
|---|---|
| E-mail / Password | Your MELCloud Home login. The password is stored encrypted. |
| Real-time updates | Use the WebSocket push connection. Polling remains active as fallback. |
| Polling interval | REST polling interval in seconds (minimum 60 to respect the cloud rate limits). |

The state `info.realtime` shows whether the WebSocket is open. `info.connection` only depends on the REST connection.

### Dashboard
The adapter ships a climate dashboard. It is served by the **web adapter** (its socket interface must be enabled, which is the default):

`http://<iobroker>:8082/melcloudhome/index.html` (add `?instance=1` for a second adapter instance)

- Shows all units automatically, updates live, works on phones and tablets.
- For VIS-2: add an *iframe* widget with this URL.
- Room icons: instance settings → *Dashboard* → *Room icons*.
- Language follows the ioBroker system language (German or English).
- No external requests: fonts are included (Fraunces, Work Sans – SIL Open Font License 1.1).

### Known limitations
- **Horizontal vane swing:** After a fixed horizontal position, the cloud often ignores a new "Swing" command until the unit reports its state again (on a room temperature change or when switched off and on). This also happens with the official app. The adapter remembers the swing request for 30 minutes and sends it again automatically once the unit reports its old position (up to 3 times).
- Until the unit reports again, the cloud shows the commanded values, not the values the unit actually applied.

---

## Credits

The MELCloud Home API implementation is based on the reverse-engineering work of
[andrew-blake/melcloudhome](https://github.com/andrew-blake/melcloudhome) (Home Assistant integration, MIT License).
Thank you!

The dashboard uses the fonts [Fraunces](https://github.com/undercasetype/Fraunces) and [Work Sans](https://github.com/weiweihuanghuang/Work-Sans) under the SIL Open Font License 1.1 (see `www/fonts/`).

## Disclaimer

This project is not affiliated with, endorsed by or connected to Mitsubishi Electric.
MELCloud and Mitsubishi Electric are trademarks of their respective owners. Use at your own risk.

## Changelog
<!--
    Placeholder for the next version (at the beginning of the line):
    ### **WORK IN PROGRESS**
-->
### **WORK IN PROGRESS**
* (Sven-83) initial project setup
* (Sven-83) real-time updates via WebSocket (`info.realtime`), polling continues as fallback
* (Sven-83) climate dashboard served by the web adapter, room icons in the instance settings
* (Sven-83) dashboard: off timer sends the minutes shown on the wheel, mode conflict hint for multi-split systems
* (Sven-83) vane auto is repeated like swing when the unit did not apply it
* (Sven-83) dashboard: no vane auto buttons (the units do not apply vane auto reliably)

## License
MIT License

Copyright (c) 2026 Sven-83 <svmorgen@gmx.de>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
