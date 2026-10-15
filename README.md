![Logo](admin/melhome.png)
# ioBroker.melhome

[![NPM version](https://img.shields.io/npm/v/iobroker.melhome.svg)](https://www.npmjs.com/package/iobroker.melhome)
[![Downloads](https://img.shields.io/npm/dm/iobroker.melhome.svg)](https://www.npmjs.com/package/iobroker.melhome)
![Number of Installations](https://iobroker.live/badges/melhome-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/melhome-stable.svg)
[![License](https://img.shields.io/github/license/Sven-83/ioBroker.melhome)](LICENSE)

**Tests:** ![Test and Release](https://github.com/Sven-83/ioBroker.melhome/workflows/Test%20and%20Release/badge.svg)

> ⚠️ **Work in progress** – not ready for productive use yet.

German documentation: [docs/de/README.md](docs/de/README.md)

---

## MELCloud Home adapter for ioBroker

Control Mitsubishi Electric air conditioners via **MELCloud Home** – the new Mitsubishi cloud platform.
This adapter does **not** work with the classic MELCloud (use [ioBroker.melcloud](https://github.com/Black-Thunder/ioBroker.melcloud) for that).

### Features
- Air-to-air units (air conditioners): power, mode, target temperature, room and outdoor temperature, fan speed, vanes, standby, online and error status, Wi-Fi signal, energy (if the unit reports it)
- Off timer that runs inside the adapter and survives a restart
- Real-time updates via WebSocket with automatic polling fallback
- Bundled climate dashboard for the browser and VIS-2
- Air-to-water units (heat pumps) are not supported yet

### Requirements
- A MELCloud Home account; the units must be registered and working in the official MELCloud Home app
- Node.js 22 or newer, js-controller 6.0.11 or newer, admin 7.6.20 or newer
- For the dashboard: a **web adapter** instance with the socket interface enabled (the default)
- Internet access from the ioBroker host to `*.melcloudhome.com` and Amazon Web Services (login and real-time connection)

### Installation
Install the adapter in Admin on the *Adapters* page, then add an instance and enter your MELCloud Home e-mail address and password.

The adapter is still in development and not yet listed in the ioBroker repositories.

### Configuration
| Setting | Description |
|---|---|
| E-mail / Password | Your MELCloud Home login. The password is stored encrypted. |
| Real-time updates | Use the WebSocket push connection. Polling remains active as fallback. |
| Polling interval | REST polling interval in seconds (60–3600; at least 60 to respect the cloud rate limits). |
| Room icons | Icon per unit for the dashboard (*Automatic* picks one by position). |

### States
Each unit gets a device `melhome.<n>.devices.<unit id>` (the id is the unit's UUID from the cloud, never the room name).

**`info.*`** (read-only)

| State | Type | Description |
|---|---|---|
| `name`, `building` | string | Room name and building as set in the app |
| `isGuest` | boolean | The building is shared with you |
| `deviceOnline` | boolean | The unit is connected to the cloud |
| `hasError`, `errorCode` | boolean, string | The unit reports a fault, and its code |
| `roomTemp`, `outdoorTemp` | number °C | Room temperature; outdoor temperature (updated every 30 min) |
| `outdoorTempTime` | number | Time of the outdoor reading (ms since epoch) |
| `actualFanSpeed` | number | Fan speed the unit is running at (0 = off, 1–5) |
| `wifiSignal` | number dBm | Wi-Fi signal (updated every 30 min) |
| `icon` | string | Dashboard room icon |
| `lastUpdate` | number | Last update from the cloud (ms since epoch) |

**`control.*`** (writable unless noted)

| State | Type | Values |
|---|---|---|
| `power` | boolean | on/off |
| `mode` | number | 8 = Auto, 1 = Heat, 3 = Cool, 2 = Dry, 7 = Fan (only modes the unit supports) |
| `targetTemp` | number °C | Within the limits of the current mode, rounded to the unit's step (0.5 or 1) |
| `fanSpeed` | number | 0 = Auto, 1–5 (number of speeds depends on the unit) |
| `vaneVerticalDirection` | number | 0 = Auto, 1 (top) – 5 (bottom), 7 = Swing |
| `vaneHorizontalDirection` | number | 0 = Auto, 1 (left) – 5 (right), 12 = Swing – writable only if the unit has an adjustable horizontal vane |
| `standby` | boolean | Only for units with standby mode |
| `offTimer` | number min | Switch off after 1–360 minutes, 0 cancels |
| `offTimerRemaining`, `offTimerEnd` | number | Remaining seconds and end time (read-only) |

Commands are collected for a moment and sent together. After the cloud accepts a command, the state is confirmed with `ack: true`; if a command fails, the previous value is restored.

**`energy.*`** (read-only, only if the unit reports energy): `total` (own counter in kWh, continues across restarts), `today`, `lastHour` (kWh).

**`capabilities.*`** (read-only): temperature limits per mode, step width, number of fan speeds, available modes, and whether vanes, standby, energy meter and multi-split are available.

**Instance states:** `info.connection` (connected to the MELCloud Home REST API) and `info.realtime` (WebSocket open).

### Dashboard
The adapter ships a climate dashboard. It is served by the **web adapter**:

`http://<iobroker>:8082/melhome/index.html` (add `?instance=1` for a second adapter instance)

- Shows all units automatically, updates live, works on phones and tablets.
- For VIS-2: add an *iframe* widget with this URL.
- Room icons: instance settings → *Dashboard* → *Room icons*.
- Language follows the ioBroker system language (German or English).
- No external requests: fonts are included (Fraunces, Work Sans – SIL Open Font License 1.1).

### Security
- **The dashboard switches real devices.** Anyone who can open the web adapter instance that serves it can control your air conditioners. Enable authentication in that web adapter instance, and never expose it to the internet without HTTPS and authentication.
- The password is stored encrypted in the instance settings. Login tokens are kept in memory only and are never written to states or logs.
- Please report security issues privately as described in [SECURITY.md](SECURITY.md).

### Known limitations
- **Horizontal vane swing:** After a fixed horizontal position, the cloud often ignores a new "Swing" command until the unit reports its state again (on a room temperature change or when switched off and on). This also happens with the official app. The adapter remembers the swing request for 30 minutes and sends it again automatically once the unit reports its old position (up to 3 times).
- **Vane auto** is often not applied by the units either (same behaviour as in the official app), so the dashboard offers no vane auto buttons.
- The actual vane position cannot be read from the cloud; the states show the last commanded position.
- Until the unit reports again, the cloud shows the commanded values, not the values the unit actually applied.
- The off timer runs inside the adapter. If the adapter is stopped when the timer ends, the unit is switched off on the next start if that happens within 30 minutes; after that the timer is dropped.
- **Multi-split systems:** all indoor units on one outdoor unit must use compatible modes. Heating in one room and cooling or drying in another is a mode conflict; the dashboard shows a hint.

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
* (Sven-83) adapter renamed to `melhome` (object IDs `melhome.<n>`, dashboard at `/melhome/index.html`)
* (Sven-83) rate limits: HTTP 429 is honoured including Retry-After, random start delay, 15 s timeouts
* (Sven-83) instance settings check the e-mail address and require the password
* (Sven-83) Node.js 22 or newer required
* (Sven-83) documentation: requirements, states, security notes; SECURITY.md for private vulnerability reports

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
