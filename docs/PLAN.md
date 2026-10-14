# Projektplan – ioBroker.melcloudhome

Status-Legende: ☐ offen · ◐ in Arbeit · ☑ erledigt

## Stand 2026-10-12 / Nächster Einstieg
- Phase 0 erledigt bis auf die Gegenprüfung mit Svens Account. Ergebnis: `docs/api.md`.
- Phase 1 lokal erledigt (Gerüst, Admin-UI). GitHub-Repo noch nicht angelegt.
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
- ◐ MIT-Lizenz + Attribution andrew-blake (LICENSE, README) – ☐ GitHub-Repo `Sven-83/ioBroker.melcloudhome` anlegen + pushen (nach OK von Sven)

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
- ☐ Nach `www/` übernehmen; Auslieferung über web-Adapter (`/melcloudhome/`)
- ☐ Datenzugriff: simple-api → `@iobroker/socket-client` (Auth + Live-Subscriptions statt Polling)
- ☐ Geräte automatisch aus Objektbaum, keine hartcodierten IDs/Hosts
- ☐ Raum-Icons (Sessel, Bett, …) als Icon-Set, Zuordnung pro Gerät aus Adapter-Config
- ☐ Wertecodes = Dashboard-Codes (klassische MELCloud, siehe api.md §5), Übersetzung nur im Adapter (`mapping.ts`), kein Wissen über MELCloud-Home-Codes im Frontend
- ☐ Temperaturbereich und Lüfterstufen aus Geräte-Fähigkeiten statt hart (16–31 °C, 5 Stufen)
- ☐ Zeile „Seitenlamelle ↔“ nur anzeigen, wenn `capabilities.supportsWideVane` true ist (zweites Testgerät hat keine horizontale Lamelle, Sichtprüfung 2026-10-13). Die Höhenlamelle hängt entsprechend an `capabilities.hasAirDirection`. Optik (Entscheidung Sven): Karten bleiben gleich hoch, die Stelle bleibt leer.
- ☐ Timer-Rad bedient `control.offTimer`, Countdown aus Restzeit-State (kein localStorage mehr)
- ☐ +/- mit optimistischer Anzeige + Debounce
- ☐ Gerätenamen escapen (XSS), Fonts (Fraunces, Work Sans, OFL) lokal
- ☐ Layout dynamisch 1…n Geräte; bei 2 Geräten identisch zur Referenz (bis auf ausgeblendete Zeilen für fehlende Funktionen)
- ☐ Unverändert übernehmen: Farben/Tokens, Drehregler, Lüfterpunkte, 5-Segment-Lamellen-Icons, Auto/Swing-Icons (Split-Button **entfernen**, gibt es in MELCloud Home nicht), Timer-Rad, Online-Punkt, Störungs-Badge
- ☐ Visueller Test: Desktop, Tablet, VIS-2-iframe

## Phase 5 – Qualität
- ☐ Unit- + Integrationstests grün, Coverage sinnvoll
- ☐ Adapter-Checker ohne Errors
- ☐ Audit mit Universal Audit Template (+ Auth, WebSocket, Rate-Limits, Dashboard-XSS)

## Phase 6 – Release
- ☐ README DE/EN, Changelog, Screenshots
- ☐ GitHub-Release v0.1.0, Forum-Testthread, danach Latest-Repo
