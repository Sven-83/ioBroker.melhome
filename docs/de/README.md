# ioBroker.melhome – Deutsche Anleitung

[English](../../README.md)

Steuerung von Mitsubishi-Electric-Klimageräten über **MELCloud Home** – die neue Cloud-Plattform von Mitsubishi.
Der Adapter funktioniert **nicht** mit der klassischen MELCloud (dafür gibt es [ioBroker.melcloud](https://github.com/Black-Thunder/ioBroker.melcloud)).

## Geplanter Umfang (v1)
- Luft-Luft-Geräte (Klimageräte): Ein/Aus, Modus, Solltemperatur, Raum-/Außentemperatur, Lüfterstufe, Lamellen, Online- und Fehlerstatus, Energie (falls verfügbar), Abschalt-Timer
- Echtzeit-Aktualisierung per WebSocket mit automatischem Rückfall auf Abfrage (Polling)
- Mitgeliefertes Dashboard für VIS-2 / Browser

## Konfiguration
| Einstellung | Beschreibung |
|---|---|
| E-Mail / Passwort | Zugangsdaten für MELCloud Home. Das Passwort wird verschlüsselt gespeichert. |
| Echtzeit-Aktualisierung | WebSocket-Push-Verbindung nutzen. Polling bleibt als Rückfallebene aktiv. |
| Abfrageintervall | REST-Abfrage in Sekunden (mindestens 60, um die Cloud-Limits einzuhalten). |

Der State `info.realtime` zeigt, ob die WebSocket-Verbindung offen ist. `info.connection` hängt nur an der REST-Verbindung.

## Dashboard
Der Adapter bringt ein Klima-Dashboard mit. Es wird vom **web-Adapter** ausgeliefert (dessen Socket-Schnittstelle muss aktiv sein, das ist die Standardeinstellung):

`http://<iobroker>:8082/melhome/index.html` (für eine zweite Adapter-Instanz `?instance=1` anhängen)

- Zeigt alle Geräte automatisch, aktualisiert live, funktioniert auf Handy und Tablet.
- Für VIS-2: ein *iframe*-Widget mit dieser URL anlegen.
- Raumsymbole: Instanz-Einstellungen → *Dashboard* → *Raumsymbole*.
- Die Sprache folgt der ioBroker-Systemsprache (Deutsch oder Englisch).
- Keine externen Aufrufe: Die Schriften sind enthalten (Fraunces, Work Sans – SIL Open Font License 1.1).

## Bekannte Einschränkungen
- **Seitenlamelle Swing:** Nach einer festen Seitenposition ignoriert die Cloud einen neuen „Swing“-Befehl oft, bis sich das Gerät wieder meldet (bei einer Änderung der Raumtemperatur oder nach Aus/Ein). Das passiert auch in der offiziellen App. Der Adapter merkt sich den Swing-Wunsch 30 Minuten und sendet ihn automatisch erneut, sobald das Gerät seine alte Position meldet (bis zu 3-mal).
- Bis sich das Gerät wieder meldet, zeigt die Cloud die befohlenen Werte, nicht die tatsächlich übernommenen.

## Danksagung

Die API-Umsetzung basiert auf der Reverse-Engineering-Arbeit von [andrew-blake/melcloudhome](https://github.com/andrew-blake/melcloudhome) (Home-Assistant-Integration, MIT-Lizenz).

Dieses Projekt steht in keiner Verbindung zu Mitsubishi Electric. Nutzung auf eigene Gefahr.
