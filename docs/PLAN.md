# Projektplan – ioBroker.melhome

Status-Legende: ☐ offen · ◐ in Arbeit · ☑ erledigt

## Stand 2026-10-15 / Nächster Einstieg
- Produktivbetrieb seit 2026-10-15: klassischer `melcloud.0` gelöscht, `melhome.0` per `iob url` von GitHub `main` installiert, 2 Geräte verbunden, Echtzeit aktiv. Dashboard als VIS-2-iframe (`/melhome/index.html`, 1050×575 px) eingerichtet.
- Dashboard für Touch vergrößert (54141b3): Knöpfe ≥ 44 px, aktive Knöpfe gefüllt, klarere Lamellen-Icons, Lüfterstufen als Ziffern, Spalten exakt bündig. Auf dem Pi geprüft (Sven: „sieht gut aus“).
- **Nächster Schritt:** Betrieb einige Tage beobachten (Log, Reconnects, Rate-Limits). Optional: dev-server neu aufsetzen (alte Instanz `melcloudhome.0`), N2 (OAuth-state) dort live testen, Konflikt-Badge live mit beiden Räumen.
- Keine Releases/Tags (Entscheidung Sven) – nur grüne Stände auf `main` pushen.

## Stand 2026-10-12 (Archiv)
- Phase 0 erledigt bis auf die Gegenprüfung mit Svens Account. Ergebnis: `docs/api.md`.
- Phase 1 erledigt (Gerüst, Admin-UI). GitHub-Repo öffentlich seit 2026-10-15.
- Phase 2 erledigt (nur gegen die simulierte Cloud getestet): Login, Token-Erneuerung, REST-Client, Parser, Connection-Manager. 84 Unit-Tests, Lint, Build und Integrationstest grün.
- Entscheidungen von Sven (Details in api.md): State-Codes/Symbole wie Jäger-Dashboard (§5), Split entfällt (MELCloud Home kann es nicht, §5.4), kein Modell (nur Raumname), Tokens nur im RAM, Wiederverbindung in jeder Lage (§2.3), Außentemperatur in v1.
- Autor: `Sven-83 <svmorgen@gmx.de>` (öffentlich sichtbar, mit Sven abgestimmt).
- `reference/` und `CLAUDE.md` sind nur lokal von git ausgeschlossen (`.git/info/exclude`), weil sie die private Host-IP und Raumnamen enthalten.
- Lesender Testlauf mit Svens Account am 2026-10-12 erfolgreich (Ergebnisse in api.md §9, Testdaten in `test/fixtures/live/`).
- Phase 3 umgesetzt und getestet (nur gegen Fakes und echte Testdaten). Live-Test mit dem dev-server steht noch aus.
- Lamellen-Frage geklärt (2026-10-13, Sichtprüfung durch Sven): Das zweite Gerät hat keine horizontale Lamelle, `supportsWideVane=false` stimmt. Die App zeigt die Option trotzdem an. Der Adapter bleibt wie er ist (`vaneHorizontalDirection` nur bei `supportsWideVane` schreibbar).
- **Nächster Schritt:** Live-Test Phase 3 mit dem dev-server (erst nur lesen, dann Befehle nach OK von Sven), dann Phase 4 (WebSocket).
- Offen bei Sven:
  - `gh auth login` und OK zum Anlegen des GitHub-Repos (öffentlich/privat)
- Hinweise: npm 11 blockiert install-scripts (esbuild-postinstall) – der Build läuft trotzdem. Die Admin-Übersetzungen sind bisher nur DE/EN.

## Phase 0 – API-Analyse (Fundament)
- ☑ andrew-blake/melcloudhome analysieren: Auth-Flow (Login, Token/Session, Refresh, Ablauf), REST-Endpunkte, WebSocket-Protokoll, Datenmodell ATA (Stand `main`, 2026-10-11)
- ☑ Wertecodes dokumentieren: Betriebsmodi, Lüfterstufen, Seitenlamelle, Höhenlamelle, Temperaturgrenzen je Modus, Fehlerstatus
- ☑ Rate-Limits und bekannte Stolperfallen aus ADRs/Research-Docs der Referenz gesammelt (GitHub-Issues nicht einzeln durchgesehen)
- ☑ Ergebnis: `docs/api.md` (eigene API-Spezifikation) + Mapping-Tabelle API ↔ ioBroker-States (Vorschlag, Entscheidungen offen → api.md §5, §8)
- ☑ Mit Svens Account gegenprüfen – Ergebnisse in api.md §9 (Login, Werteformate, Energie, Außentemperatur, WebSocket, Split)
  - nach Phase 2 (auth.ts + client.ts fertig): **nur lesender** Testlauf (`/context`, Energie, RSSI, trendsummary, WebSocket mithören, **kein PUT**), Responses anonymisiert als Fixtures sichern

## Phase 1 – Gerüst
- ☑ `@iobroker/create-adapter` v3.1.5 (TypeScript, jsonConfig, ESLint/Prettier, release-script, GitHub Actions, dev-server lokal), ohne CLAUDE.md / docs / reference zu überschreiben
- ☑ Ordnerstruktur laut CLAUDE.md (Rümpfe in `src/lib/api`, `src/lib/devices`, `mapping.ts`, `www/`, `test/fixtures/`)
- ◐ Admin: E-Mail, Passwort (encrypted + protected), Polling-Intervall (min. 60 s), Echtzeit an/aus – ☐ Geräte-Icons fürs Dashboard (Phase 4b)
- ☑ MIT-Lizenz + Attribution andrew-blake (LICENSE, README) – ☑ GitHub-Repo `Sven-83/ioBroker.melhome` öffentlich angelegt und gepusht 2026-10-15 (Verlauf vorher auf persönliche Daten geprüft), Themen gesetzt, Private Vulnerability Reporting aktiv

## Phase 2 – API-Client
- ☑ `http.ts`: alle Requests seriell mit min. 0,5 s Abstand (auch Login), 30 s Timeout, Abbruch beim Unload
- ☑ `auth.ts`: PAR → authorize → Cognito-Formular → Callback → Token, inkl. Abkürzung bei bestehender Session. Eigener Cookie-Jar (`tough-cookie`). `TokenManager`: Refresh 60 s vor Ablauf, nie parallel, Re-Login nur bei abgelehntem Refresh-Token
- ☑ `connection.ts`: zentraler Connection-Manager mit Backoff je Fehlerart (api.md §2.3), gibt nie auf. Jede Tabellenzeile ist ein Test.
- ☑ `client.ts`: `/context`, Steuerung (PUT), Energie, WLAN-Signal, Außentemperatur, WS-Credential. 401-Kaskade Refresh → Login. GET bei 5xx/Netzfehler einmal wiederholt, PUT nie automatisch. Zwei Fehlversuche toleriert (im Connection-Manager), beim dritten offline.
- ☑ `types.ts`: defensives Parsen. Unbekannte Werte werden `null` mit einer einzigen Warnung, Ziffern und US-Schreibweise werden normalisiert, Gerätenamen ohne Zeilenumbrüche.
- ☑ `errors.ts`: Fehlerklassen und Redaktion von Codes, Tokens, Hash, Passwort und E-Mail in allen Meldungen
- ☑ Unit-Tests gegen die simulierte Cloud (`test/helpers/fake-cloud.ts`) mit anonymisierten Fixtures
- ☑ Lesender Testlauf mit Svens Account, echte anonymisierte Antworten als Fixtures (`test/fixtures/live/`), Parser ohne Warnungen

## Phase 3 – Objektbaum & Steuerung (ATA)
- ☑ `devices.<uuid>` (Typ device, statusStates online/error), Kanäle info, control, energy, capabilities. Objekt-IDs aus der UUID.
- ☑ `info.*`: name, building, isGuest, deviceOnline, hasError, errorCode, roomTemp, outdoorTemp(+Time), actualFanSpeed, wifiSignal, lastUpdate
- ☑ `control.*`: power, mode, targetTemp, fanSpeed, vaneVerticalDirection, vaneHorizontalDirection (nur bei `supportsWideVane` schreibbar), standby (nur bei `hasStandby`), offTimer, offTimerRemaining, offTimerEnd
- ☑ `energy.*`: total (eigener Zähler, Stand in `native.energyTracker` des Geräts), lastHour, today
- ☑ `mapping.ts`: Dashboard-Codes, `common.states` nach Capabilities, Temperaturgrenzen je Modus. Labels englisch, weil `common.states` nicht übersetzbar ist.
- ☑ Command-Queue: 800 ms Debounce je Gerät, Zusammenführen, Einschalten immer mit Modus, Lamellen je eigener Request, 1,5 s Abstand, Temperatur geklemmt
- ☑ Optimistische Anzeige: Wert wird nach Annahme mit ack=true gesetzt und bis zu 2 min gegen abweichende `/context`-Werte gehalten. Solange der Befehl wartet, wird nichts bestätigt. Bei Fehler wird der gemeldete Wert zurückgeschrieben.
- ☑ Abschalt-Timer im Adapter (max. 360 min). Die Endzeit steht in `offTimerEnd` und übersteht einen Neustart. Ist er während der Pause abgelaufen, wird bis 30 min später noch ausgeschaltet.
- ☑ Telemetrie alle 30 min: Energie, WLAN-Signal, Außentemperatur. Fehler beeinflussen `info.connection` nicht.
- ☑ Unit-Tests (134 gesamt), u. a. Objektbaum aus den echten Daten, Befehlsfluss, Timer-Neustart
- ☑ Live-Test mit dem dev-server: erst nur lesen, dann Befehle **nach OK von Sven** (abgeschlossen 2026-10-14)
  - ☑ 2026-10-13 lesend: Login, Objektbaum beider Geräte, Werte = App, Seitenlamelle nur beim Wohnraum schreibbar, Debug-Log ohne Geheimnisse, keine Warnungen
  - ☑ 2026-10-13 Befehl Solltemperatur 17 → 17,5 → 17 °C: PUT 200, ack=true, App und Cloud-Abfrage nach Ablauf der Sperre bestätigen den Wert
  - ☑ Energie erstes Gerät: erste Abfragen ohne Stundenwerte – kein Fehler, kaum Verbrauch und Werte kommen verzögert in der Cloud an (Rohantwort 21:10 enthielt sie)
  - ☑ 2026-10-13 Lüfter 3 → 2, Höhenlamelle 5 → 3, Seitenlamelle Swing → Mitte und zurück: je PUT 200, ack=true, Cloud nach Sperre + App/Gerät bestätigt
  - ☑ 2026-10-13 Seitenlamelle Swing: Ursache gefunden (Cloud verwirft Swing bis zum nächsten Gerätebericht, betrifft auch die offizielle App, api.md §9.1). Kein Adapterfehler.
  - ☑ Swing-Umgehung (`ata.ts`, `checkSwingWish`): Wunsch 30 min merken; zeigt `/context` erst Swing und dann wieder die alte Position, Swing erneut senden (max. 3×, Info-Log mit Klartext-Position). 8 Unit-Tests. **Live-Test 2026-10-14 bestanden** (api.md §9.1).
  - ☑ 2026-10-14 geprüft (nur lesend): Echte Lamellenstellung ist **nicht** abfragbar. Telemetrie nimmt nur `rssi` an, ein „Gerät soll sich melden“-Befehl ist nicht bekannt (api.md §9.1). Umgehung bleibt.
  - ☑ 2026-10-14 Abschalt-Timer 1 min: nach 60 s PUT `{power:false}` 200, Timer-States auf 0, Gerät aus. Einschalten per Adapter sendet `{power:true, operationMode:"Cool"}` (200). Log-Meldungen von Queue/Timer nennen jetzt den Gerätenamen statt der UUID.
  - Hinweis: Windows 11 ohne `wmic` → `dev-server watch` stürzt ab (nodemon), `dev-server run` verwenden

## Phase 4 – Echtzeit
- ☑ WebSocket-Push (`websocket.ts`, Paket `ws`): Hash je Verbindung, Ping 30 s / Pong-Timeout 10 s, Reconnect 5 → 300 s ±20 %, nach stabiler Sitzung (≥ 60 s, z. B. 2-h-Limit) sofort neu und Backoff zurück. Hash nie im Log. 12 Unit-Tests.
- ☑ Fallback: Polling läuft immer weiter. Der WebSocket folgt REST (Start bei `info.connection` true, Stopp bei false → keine eigenen Login-Versuche). Status-State `info.realtime` (`indicator.connected`).
- ☑ Entscheidung statt „Geräteberichte als Ist-Wert übernehmen“: Jede Unit-Nachricht (`unitStateChanged`, `unitCommunicationLost/Restored`) löst nur einen `/context`-Abruf nach 2 s aus. `/context` enthält die Geräteberichte bereits (Swing-Live-Test). REST bleibt einzige Wahrheitsquelle; nach jedem (Re-)Connect ein Abruf.
- ☑ README „Bekannte Einschränkungen“ (DE/EN): Seitenlamelle Swing, befohlene vs. übernommene Werte
- ☑ 2026-10-14 live: Verbindung + `info.realtime`, kein Hash im Log; Einschalten in der App → WS-Nachricht 10:16:44 → Abruf 10:16:47 → `control.power` true (3 s statt bis 60 s)
- ☑ 2026-10-14 live: Swing-Umgehung mit WS – Wiederholung 2 s nach dem Gerätebericht statt bis 60 s. Beobachtet: ein veralteter Bericht („Left“ bei laufendem Swing) löst eine harmlose Wiederholung aus (api.md §9.1).
- ☑ 2026-10-14 live: Trennung 11:43:58 (Code 1006, nach ~1 h 30 min, nicht genau 2 h) → neuer Hash → wieder offen 11:44:00 (1,8 s), nur Debug-Log

## Phase 4b – Jäger-Dashboard
Referenz: `reference/melcloud_vis2_iframe.html`
- ☑ Nach `www/` übernommen (`index.html`, `dashboard.css`, `js/core.js` Logik, `js/app.js` DOM/Socket); web-Adapter liefert `/melhome/index.html`, Admin-Link per `localLinks`
- ☑ Datenzugriff: Socket-Client des web-Adapters (`../lib/js/socket.io.js`, gleiche Origin, Login des web-Adapters gilt), `getStates` + `subscribe`, Befehle per `setState` ack=false
- ☑ Geräte automatisch aus Objektbaum (`getObjectView` device), Instanz per `?instance=N`
- ☑ Raum-Icons (Sessel, Bett, Schreibtisch, Tisch, Teddy, Innengerät): Tabelle in den Instanz-Einstellungen (`selectSendTo` getUnits) → State `info.icon`; „auto“ = Sessel für das erste, Bett für weitere Geräte
- ☑ Wertecodes = Dashboard-Codes (klassische MELCloud, siehe api.md §5), Übersetzung nur im Adapter (`mapping.ts`), kein Wissen über MELCloud-Home-Codes im Frontend
- ☑ Temperaturbereich je Modus aus `capabilities.*`, Modi/Lüfterstufen/Lamellen aus `common.states` der control-States
- ☑ Zeile „Seitenlamelle ↔“ nur anzeigen, wenn `capabilities.supportsWideVane` true ist (zweites Testgerät hat keine horizontale Lamelle, Sichtprüfung 2026-10-13). Die Höhenlamelle hängt entsprechend an `capabilities.hasAirDirection`. Optik (Entscheidung Sven): Karten bleiben gleich hoch, die Stelle bleibt leer.
- ☑ Timer-Rad bedient `control.offTimer` (schaltet bei Bedarf vorher ein), Countdown aus `control.offTimerEnd`, kein localStorage
- ☑ +/- mit optimistischer Anzeige + 600 ms Debounce, übrige Klicks sofort mit optimistischer Markierung
- ☑ Cloud-Strings nur per `textContent`, `innerHTML` nur für konstante SVGs; Fonts (Fraunces opsz, Work Sans, OFL) lokal in `www/fonts/`
- ☑ Layout dynamisch 1…n Geräte; bei 2 Geräten identisch zur Referenz (bis auf ausgeblendete Zeilen für fehlende Funktionen)
- ☑ Unverändert übernommen: Farben/Tokens, Drehregler, Lüfterpunkte, 5-Segment-Lamellen-Icons, Auto/Swing-Icons (Split-Button **entfernen**, gibt es in MELCloud Home nicht), Timer-Rad, Online-Punkt, Störungs-Badge
- ☑ Visueller Test 2026-10-14 (dev-server mit web 9.1.14, Edge headless): 900 px, 768 px, 375 px, DE + EN, Werte = States ✔. VIS-2-iframe auf dem Produktivsystem eingerichtet 2026-10-15 ✔
- ☑ Touch-Überarbeitung 2026-10-15 (54141b3, Wunsch Sven): Referenz-Layout beibehalten, alle Knöpfe ≥ 44 px, Lüfter-/Lamellen-Spalten bündig (52×46 px), aktive Knöpfe gefüllt, Lamellen-Segmente per CSS (aktiv voll, Rest blass, Drehpunkt), Lüfterstufen als Ziffern; Handy: Beschriftung über den Knöpfen. Auf dem Pi bei 1050×575 geprüft ✔
- ☑ Bedientest 2026-10-14 (Sven, echte Befehle): Ein/Aus, Modi, Solltemperatur, Lüfter, Lamellen-Positionen ✔. Befunde:
  - ☑ Timer sendete nichts: Bestätigen rundete auf 5 min (1 min → 0). Jetzt wird der angezeigte Minutenwert gesendet. Live: Timer + Countdown ✔
  - ☑ Lamelle Swing/Auto wirkt nach fester Position nicht – Cloud-Verhalten, auch mit der offiziellen App (api.md §9.1). Die Wiederholung gilt jetzt auch für Auto (beide Lamellen). Auto wirkt auch so nicht (Seitenlamelle, Gegenprobe mit der App) → Auto-Schaltflächen im Dashboard entfernt (Entscheidung Sven, `core.vaneButtonCodes`). Der State akzeptiert Auto weiterhin.
  - ☑ „Heizen schaltet aus“ – auch am selben Gerät allein (Sven), also **kein** Moduskonflikt. Cloud meldet weiter `power` an, PUT `{"operationMode":"Heat"}` mit 200 angenommen. Verdacht: kein Heizbedarf (Raum 22 °C, Soll 21 °C) bzw. Mitsubishi-Anlaufschutz beim Heizen (3–5 min). **Live 2026-10-14 (Wohnraum): Heizen mit Soll über Raumtemperatur funktioniert** → kein Fehler, das Gerät hatte keinen Heizbedarf.
  - ☑ Badge „Moduskonflikt“ (Entscheidung Sven: bleibt): eingeschaltete Multi-Split-Geräte eines Gebäudes mit Heizen gegen Kühlen/Trocknen (`core.modeConflicts`). ☐ Live-Test mit beiden Räumen
- Dry-Run-Test im Browser: Edge headless über CDP, `setState` des Sockets wird abgefangen (kein Befehl an die Geräte)
- ☑ Unit-Tests `src/dashboard.test.ts` (13) für `core.js`
- Hinweis: Der web-Adapter liefert `system.config` aus seinem Start-Zwischenspeicher – Sprachwechsel greift erst nach Neustart der web-Instanz

## Phase 5 – Qualität
- ☑ Unit- + Integrationstests grün (173 Unit, 61 Package, Integration), 2026-10-15
- ◐ Adapter-Checker (repochecker 5.23.0, lokal mit GitHub-Stub) 2026-10-15: Code-/Konfig-Befunde behoben (c377b9a). Namenskonflikt `iobroker.melcloudhome` auf npm (konrad2002, 0.3.1) -> Adapter am 2026-10-15 in `melhome` umbenannt. Offen: E3012 (kein deploy-Job, bewusst); E4051 Fehlalarm (Drittanbieter-Copyright). Gegen das echte Repo am 2026-10-15 wiederholt: CI grün (Node 22/24/26 × Linux/Windows/macOS); offen E2000 (kein npm), E3012 (kein deploy-Job), E3032 (Version nicht getaggt → erstes Release), E4051 (Fehlalarm).
- ◐ Audit mit Universal Audit Template v1.2 am 2026-10-15: `docs/audit/AUDIT-2026-10-15.md` – 0 kritisch, 0 hoch, 8 mittel (M1 HTTP 429/Retry-After, M2 Start-Jitter, M3 *Async, M4 tier 2, M5 Admin-Validierung, M6 SECURITY.md, M7 README, M8 Timeouts), 11 niedrig. Phase 2 behoben 2026-10-15 (M1–M5, M8, N3–N6, N9); N1 zurückgenommen (W1137); M6 + M7 behoben (SECURITY.md, README). Offen: N2 (Live-Login), N7, N8, N10, N11; Private Vulnerability Reporting beim Anlegen des GitHub-Repos aktivieren.
- ☑ Voraussetzungen Produktivsystem geprüft 2026-10-15: Node 22.23, js-controller 7.2.2, admin 8.0.14, web 8.0.0 (Port 8082, Socket integriert, ohne Anmeldung) – erfüllt. Klassischer `melcloud`-Adapter wurde von Sven gelöscht (kein Parallelbetrieb); `melhome.0` läuft dort seit 2026-10-15.

## Phase 6 – Release
- ☐ README DE/EN, Changelog, Screenshots
- ☐ GitHub-Release v0.1.0, Forum-Testthread, danach Latest-Repo
