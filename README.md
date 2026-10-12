![Logo](admin/melcloudhome.png)
# ioBroker.melcloudhome

[![NPM version](https://img.shields.io/npm/v/iobroker.melcloudhome.svg)](https://www.npmjs.com/package/iobroker.melcloudhome)
[![Downloads](https://img.shields.io/npm/dm/iobroker.melcloudhome.svg)](https://www.npmjs.com/package/iobroker.melcloudhome)
![Number of Installations](https://iobroker.live/badges/melcloudhome-installed.svg)
![Current version in stable repository](https://iobroker.live/badges/melcloudhome-stable.svg)

**Tests:** ![Test and Release](https://github.com/Sven-83/ioBroker.melcloudhome/workflows/Test%20and%20Release/badge.svg)

> ⚠️ **Work in progress** – not ready for productive use yet.

[Deutsch](#deutsch) · [English](#english)

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

---

## Deutsch

Steuerung von Mitsubishi-Electric-Klimageräten über **MELCloud Home** – die neue Cloud-Plattform von Mitsubishi.
Der Adapter funktioniert **nicht** mit der klassischen MELCloud (dafür gibt es [ioBroker.melcloud](https://github.com/Black-Thunder/ioBroker.melcloud)).

### Geplanter Umfang (v1)
- Luft-Luft-Geräte (Klimageräte): Ein/Aus, Modus, Solltemperatur, Raum-/Außentemperatur, Lüfterstufe, Lamellen, Online- und Fehlerstatus, Energie (falls verfügbar), Abschalt-Timer
- Echtzeit-Aktualisierung per WebSocket mit automatischem Rückfall auf Abfrage (Polling)
- Mitgeliefertes Dashboard für VIS-2 / Browser

### Konfiguration
| Einstellung | Beschreibung |
|---|---|
| E-Mail / Passwort | Zugangsdaten für MELCloud Home. Das Passwort wird verschlüsselt gespeichert. |
| Echtzeit-Aktualisierung | WebSocket-Push-Verbindung nutzen. Polling bleibt als Rückfallebene aktiv. |
| Abfrageintervall | REST-Abfrage in Sekunden (mindestens 60, um die Cloud-Limits einzuhalten). |

---

## Credits

The MELCloud Home API implementation is based on the reverse-engineering work of
[andrew-blake/melcloudhome](https://github.com/andrew-blake/melcloudhome) (Home Assistant integration, MIT License).
Thank you!

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
