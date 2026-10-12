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
- **Nächster Schritt:** Phase 3 (Objektbaum & Steuerung).
- Offen bei Sven:
  - optional: Testlauf mit WebSocket (`$env:PROBE_WS_SECONDS=120; npm run probe`, dabei in der App etwas ändern)
  - `gh auth login` und OK zum Anlegen des GitHub-Repos (öffentlich/privat)
- Hinweise: npm 11 blockiert install-scripts (esbuild-postinstall) – der Build läuft trotzdem. Die Admin-Übersetzungen sind bisher nur DE/EN.

## Phase 0 – API-Analyse (Fundament)
- ☑ andrew-blake/melcloudhome analysieren: Auth-Flow (Login, Token/Session, Refresh, Ablauf), REST-Endpunkte, WebSocket-Protokoll, Datenmodell ATA (Stand `main`, 2026-10-11)
- ☑ Wertecodes dokumentieren: Betriebsmodi, Lüfterstufen, Seitenlamelle, Höhenlamelle, Temperaturgrenzen je Modus, Fehlerstatus
- ☑ Rate-Limits und bekannte Stolperfallen aus ADRs/Research-Docs der Referenz gesammelt (GitHub-Issues nicht einzeln durchgesehen)
- ☑ Ergebnis: `docs/api.md` (eigene API-Spezifikation) + Mapping-Tabelle API ↔ ioBroker-States (Vorschlag, Entscheidungen offen → api.md §5, §8)
- ◐ Mit Svens Account gegenprüfen – Ergebnisse in api.md §9. Split geklärt (gibt es nicht). Offen: WebSocket-Echo
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
- ☐ `devices.<uuid>.info.*` (Raumname aus der App, online, Fehler, Raumtemp, Außentemp, WLAN-Signal – kein Modell)
- ☐ `devices.<uuid>.control.*` (power, mode, targetTemp, fanSpeed, vaneHorizontal, vaneVertical, standby, offTimer). Seitenlamelle nur bei `supportsWideVane` steuerbar (Wohnraum ja, zweites Gerät nein)
- ☐ `devices.<uuid>.energy.*` (falls verfügbar)
- ☐ Neutrale Wertebereiche via `mapping.ts`, `states`-Definitionen für Enums
- ☐ Command-Queue mit Debounce (~800 ms), optimistisches ack-Handling
- ☐ Abschalt-Timer serverseitig (`control.offTimer` in Minuten, Restzeit-State), überlebt Adapter-Neustart

## Phase 4 – Echtzeit
- ☐ WebSocket-Push, Heartbeat, Reconnect mit Backoff
- ☐ Automatischer Fallback auf Polling, Status-State

## Phase 4b – Jäger-Dashboard
Referenz: `reference/melcloud_vis2_iframe.html`
- ☐ Nach `www/` übernehmen; Auslieferung über web-Adapter (`/melcloudhome/`)
- ☐ Datenzugriff: simple-api → `@iobroker/socket-client` (Auth + Live-Subscriptions statt Polling)
- ☐ Geräte automatisch aus Objektbaum, keine hartcodierten IDs/Hosts
- ☐ Raum-Icons (Sessel, Bett, …) als Icon-Set, Zuordnung pro Gerät aus Adapter-Config
- ☐ Wertecodes = Dashboard-Codes (klassische MELCloud, siehe api.md §5), Übersetzung nur im Adapter (`mapping.ts`), kein Wissen über MELCloud-Home-Codes im Frontend
- ☐ Temperaturbereich und Lüfterstufen aus Geräte-Fähigkeiten statt hart (16–31 °C, 5 Stufen)
- ☐ Timer-Rad bedient `control.offTimer`, Countdown aus Restzeit-State (kein localStorage mehr)
- ☐ +/- mit optimistischer Anzeige + Debounce
- ☐ Gerätenamen escapen (XSS), Fonts (Fraunces, Work Sans, OFL) lokal
- ☐ Layout dynamisch 1…n Geräte; bei 2 Geräten identisch zur Referenz
- ☐ Unverändert übernehmen: Farben/Tokens, Drehregler, Lüfterpunkte, 5-Segment-Lamellen-Icons, Auto/Swing-Icons (Split-Button **entfernen**, gibt es in MELCloud Home nicht), Timer-Rad, Online-Punkt, Störungs-Badge
- ☐ Visueller Test: Desktop, Tablet, VIS-2-iframe

## Phase 5 – Qualität
- ☐ Unit- + Integrationstests grün, Coverage sinnvoll
- ☐ Adapter-Checker ohne Errors
- ☐ Audit mit Universal Audit Template (+ Auth, WebSocket, Rate-Limits, Dashboard-XSS)

## Phase 6 – Release
- ☐ README DE/EN, Changelog, Screenshots
- ☐ GitHub-Release v0.1.0, Forum-Testthread, danach Latest-Repo
