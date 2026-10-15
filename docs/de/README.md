# ioBroker.melhome – Deutsche Anleitung

[English](../../README.md)

> ⚠️ **In Entwicklung** – noch nicht für den produktiven Einsatz freigegeben.

Steuerung von Mitsubishi-Electric-Klimageräten über **MELCloud Home** – die neue Cloud-Plattform von Mitsubishi.
Der Adapter funktioniert **nicht** mit der klassischen MELCloud (dafür gibt es [ioBroker.melcloud](https://github.com/Black-Thunder/ioBroker.melcloud)).

## Funktionen
- Luft-Luft-Geräte (Klimageräte): Ein/Aus, Modus, Solltemperatur, Raum- und Außentemperatur, Lüfterstufe, Lamellen, Standby, Online- und Fehlerstatus, WLAN-Signal, Energie (falls das Gerät sie meldet)
- Abschalt-Timer, der im Adapter läuft und einen Neustart übersteht
- Echtzeit-Aktualisierung per WebSocket mit automatischem Rückfall auf Abfrage (Polling)
- Mitgeliefertes Klima-Dashboard für Browser und VIS-2
- Luft-Wasser-Geräte (Wärmepumpen) werden noch nicht unterstützt

## Voraussetzungen
- Ein MELCloud-Home-Konto; die Geräte müssen in der offiziellen MELCloud-Home-App eingerichtet sein und funktionieren
- Node.js 22 oder neuer, js-controller 6.0.11 oder neuer, Admin 7.6.20 oder neuer
- Für das Dashboard: eine **web-Adapter**-Instanz mit aktiver Socket-Schnittstelle (Standardeinstellung)
- Internetzugang vom ioBroker-Host zu `*.melcloudhome.com` und Amazon Web Services (Login und Echtzeit-Verbindung)

## Installation
Den Adapter in Admin auf der Seite *Adapter* installieren, danach eine Instanz anlegen und E-Mail-Adresse und Passwort von MELCloud Home eintragen.

Der Adapter ist noch in Entwicklung und noch nicht in den ioBroker-Repositories.

**Nur für Tests:** Bis dahin lässt sich der Entwicklungsstand direkt von GitHub installieren – nicht für den
Dauerbetrieb gedacht, Updates kommen dann nicht automatisch:

- **Admin:** auf der Seite *Adapter* das GitHub-Symbol (Installation aus eigener URL) anklicken, den Reiter für eine eigene URL wählen und `https://github.com/Sven-83/ioBroker.melhome` eintragen
- **Kommandozeile:** `iobroker url https://github.com/Sven-83/ioBroker.melhome`

## Konfiguration
| Einstellung | Beschreibung |
|---|---|
| E-Mail / Passwort | Zugangsdaten für MELCloud Home. Das Passwort wird verschlüsselt gespeichert. |
| Echtzeit-Aktualisierung | WebSocket-Push-Verbindung nutzen. Polling bleibt als Rückfallebene aktiv. |
| Abfrageintervall | REST-Abfrage in Sekunden (60–3600; mindestens 60, um die Cloud-Limits einzuhalten). |
| Raumsymbole | Symbol je Gerät im Dashboard (*Automatisch* wählt nach Reihenfolge). |

## Objekte
Jedes Gerät bekommt ein Gerät `melhome.<n>.devices.<Geräte-ID>` (die ID ist die UUID aus der Cloud, nie der Raumname).

**`info.*`** (nur lesen)

| State | Typ | Beschreibung |
|---|---|---|
| `name`, `building` | string | Raumname und Gebäude wie in der App |
| `isGuest` | boolean | Das Gebäude ist mit dir geteilt |
| `deviceOnline` | boolean | Das Gerät ist mit der Cloud verbunden |
| `hasError`, `errorCode` | boolean, string | Das Gerät meldet eine Störung und deren Code |
| `roomTemp`, `outdoorTemp` | number °C | Raumtemperatur; Außentemperatur (alle 30 min) |
| `outdoorTempTime` | number | Zeitpunkt der Außentemperatur (ms seit 1970) |
| `actualFanSpeed` | number | Aktuelle Lüfterstufe (0 = aus, 1–5) |
| `wifiSignal` | number dBm | WLAN-Signal (alle 30 min) |
| `icon` | string | Raumsymbol im Dashboard |
| `lastUpdate` | number | Letzte Aktualisierung aus der Cloud (ms seit 1970) |

**`control.*`** (schreibbar, sofern nicht anders angegeben)

| State | Typ | Werte |
|---|---|---|
| `power` | boolean | ein/aus |
| `mode` | number | 8 = Auto, 1 = Heizen, 3 = Kühlen, 2 = Trocknen, 7 = Lüften (nur Modi, die das Gerät kann) |
| `targetTemp` | number °C | Innerhalb der Grenzen des aktuellen Modus, gerundet auf die Schrittweite des Geräts (0,5 oder 1) |
| `fanSpeed` | number | 0 = Auto, 1–5 (Anzahl der Stufen je nach Gerät) |
| `vaneVerticalDirection` | number | 0 = Auto, 1 (oben) – 5 (unten), 7 = Swing |
| `vaneHorizontalDirection` | number | 0 = Auto, 1 (links) – 5 (rechts), 12 = Swing – nur schreibbar, wenn die Seitenlamelle verstellbar ist |
| `standby` | boolean | Nur bei Geräten mit Standby |
| `offTimer` | number min | Ausschalten nach 1–360 Minuten, 0 bricht ab |
| `offTimerRemaining`, `offTimerEnd` | number | Restzeit in Sekunden und Endzeit (nur lesen) |

Befehle werden kurz gesammelt und gemeinsam gesendet. Nimmt die Cloud einen Befehl an, wird der State mit `ack: true` bestätigt; schlägt er fehl, wird der vorherige Wert wiederhergestellt.

**`energy.*`** (nur lesen, nur wenn das Gerät Energie meldet): `total` (eigener Zähler in kWh, läuft über Neustarts weiter), `today`, `lastHour` (kWh).

**`capabilities.*`** (nur lesen): Temperaturgrenzen je Modus, Schrittweite, Anzahl der Lüfterstufen, verfügbare Modi sowie ob Lamellen, Standby, Energiezähler und Multi-Split vorhanden sind.

**Instanz-States:** `info.connection` (mit der REST-API von MELCloud Home verbunden) und `info.realtime` (WebSocket offen).

## Dashboard
Der Adapter bringt ein Klima-Dashboard mit. Es wird vom **web-Adapter** ausgeliefert:

`http://<iobroker>:8082/melhome/index.html` (für eine zweite Adapter-Instanz `?instance=1` anhängen)

- Zeigt alle Geräte automatisch, aktualisiert live, funktioniert auf Handy und Tablet.
- Für VIS-2: ein *iframe*-Widget mit dieser URL anlegen.
- Raumsymbole: Instanz-Einstellungen → *Dashboard* → *Raumsymbole*.
- Die Sprache folgt der ioBroker-Systemsprache (Deutsch oder Englisch).
- Keine externen Aufrufe: Die Schriften sind enthalten (Fraunces, Work Sans – SIL Open Font License 1.1).

## Sicherheit
- **Das Dashboard schaltet echte Geräte.** Wer die web-Adapter-Instanz öffnen kann, die es ausliefert, kann deine Klimageräte steuern. Aktiviere in dieser web-Adapter-Instanz die Authentifizierung und mache sie nie ohne HTTPS und Anmeldung aus dem Internet erreichbar.
- Das Passwort wird verschlüsselt in den Instanz-Einstellungen gespeichert. Login-Tokens liegen nur im Arbeitsspeicher und landen nie in States oder im Log.
- Sicherheitslücken bitte vertraulich melden, wie in [SECURITY.md](../../SECURITY.md) beschrieben.

## Bekannte Einschränkungen
- **Seitenlamelle Swing:** Nach einer festen Seitenposition ignoriert die Cloud einen neuen „Swing“-Befehl oft, bis sich das Gerät wieder meldet (bei einer Änderung der Raumtemperatur oder nach Aus/Ein). Das passiert auch in der offiziellen App. Der Adapter merkt sich den Swing-Wunsch 30 Minuten und sendet ihn automatisch erneut, sobald das Gerät seine alte Position meldet (bis zu 3-mal).
- **Lamellen-Auto** übernehmen die Geräte oft ebenfalls nicht (wie in der offiziellen App), deshalb hat das Dashboard keine Auto-Knöpfe für die Lamellen.
- Die tatsächliche Lamellenstellung lässt sich aus der Cloud nicht lesen; die States zeigen die zuletzt befohlene Position.
- Bis sich das Gerät wieder meldet, zeigt die Cloud die befohlenen Werte, nicht die tatsächlich übernommenen.
- Der Abschalt-Timer läuft im Adapter. Ist der Adapter beim Ablauf gestoppt, wird das Gerät beim nächsten Start ausgeschaltet, sofern das innerhalb von 30 Minuten geschieht; danach verfällt der Timer.
- **Multi-Split-Systeme:** Alle Innengeräte an einem Außengerät brauchen verträgliche Modi. Heizen in einem Raum und Kühlen oder Trocknen in einem anderen ist ein Moduskonflikt; das Dashboard zeigt dann einen Hinweis.

## Danksagung

Die API-Umsetzung basiert auf der Reverse-Engineering-Arbeit von [andrew-blake/melcloudhome](https://github.com/andrew-blake/melcloudhome) (Home-Assistant-Integration, MIT-Lizenz).

Dieses Projekt steht in keiner Verbindung zu Mitsubishi Electric. Nutzung auf eigene Gefahr.
