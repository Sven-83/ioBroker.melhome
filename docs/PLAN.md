# Projektplan – ioBroker.melcloudhome

Status-Legende: ☐ offen · ◐ in Arbeit · ☑ erledigt

## Stand 2026-10-11 / Nächster Einstieg
- Phase 0 erledigt bis auf die Account-Gegenprüfung (siehe unten). Ergebnis: `docs/api.md`.
- Entscheidungen von Sven (Details in api.md):
  - State-Codes und Symbole exakt wie im Jäger-Dashboard (§5)
  - Split nur, wenn MELCloud Home es kann (§5.4)
  - kein Modell, nur der Raumname aus der App
  - Tokens nur im Arbeitsspeicher, Login beim Start
  - automatische Wiederverbindung in jeder Lage (§2.3)
  - Außentemperatur in v1
- **Nächster Schritt:** Phase 1 (Gerüst).
- Voraussetzungen:
  - `git` auf dem Windows-Rechner fehlt noch (`winget install Git.Git`)
  - Node.js ≥ 20 prüfen
- Offen bei Sven: in der offiziellen App nachsehen, ob die MSZ-AY eine Split-/Wide-Einstellung der Seitenlamelle haben.

## Phase 0 – API-Analyse (Fundament)
- ☑ andrew-blake/melcloudhome analysieren: Auth-Flow (Login, Token/Session, Refresh, Ablauf), REST-Endpunkte, WebSocket-Protokoll, Datenmodell ATA (Stand `main`, 2026-10-11)
- ☑ Wertecodes dokumentieren: Betriebsmodi, Lüfterstufen, Seitenlamelle, Höhenlamelle, Temperaturgrenzen je Modus, Fehlerstatus
- ☑ Rate-Limits und bekannte Stolperfallen aus ADRs/Research-Docs der Referenz gesammelt (GitHub-Issues nicht einzeln durchgesehen)
- ☑ Ergebnis: `docs/api.md` (eigene API-Spezifikation) + Mapping-Tabelle API ↔ ioBroker-States (Vorschlag, Entscheidungen offen → api.md §5, §8)
- ☐ Mit Svens Account gegenprüfen – Prüfliste in api.md §9:
  - Sven, jederzeit: in der offiziellen App nachsehen, ob die MSZ-AY eine Split-/Wide-Einstellung der Seitenlamelle anbieten
  - nach Phase 2 (auth.ts + client.ts fertig): **nur lesender** Testlauf (`/context`, Energie, RSSI, trendsummary, WebSocket mithören, **kein PUT**), Responses anonymisiert als Fixtures sichern

## Phase 1 – Gerüst
- ☐ `@iobroker/create-adapter` (TypeScript, jsonConfig, ESLint/Prettier, release-script, GitHub Actions) – in Temp-Ordner erzeugen und in dieses Repo übernehmen, ohne CLAUDE.md / docs / reference zu überschreiben
- ☐ Ordnerstruktur laut CLAUDE.md anlegen
- ☐ Admin: E-Mail, Passwort (encrypted), Polling-Intervall (min. 60 s), Echtzeit an/aus, Geräte-Icons fürs Dashboard
- ☐ GitHub-Repo `Sven-83/ioBroker.melcloudhome`, MIT-Lizenz, Attribution andrew-blake

## Phase 2 – API-Client
- ☐ `auth.ts`: Login, Refresh, Ablauferkennung, Re-Login mit exponentiellem Backoff
- ☐ Wiederverbindung in **jeder** Lage, ohne Aufgeben und ohne manuellen Neustart (api.md §2.3), jede Situation als Test
- ☐ `client.ts`: Rate-Limit-Guard, Retry bei 5xx/Timeout, Toleranz für 2 Fehlversuche bevor offline
- ☐ `types.ts`: Schema-Validierung, defensiv
- ☐ Unit-Tests gegen Mock-Server mit Fixtures

## Phase 3 – Objektbaum & Steuerung (ATA)
- ☐ `devices.<uuid>.info.*` (Raumname aus der App, online, Fehler, Raumtemp, Außentemp, WLAN-Signal – kein Modell)
- ☐ `devices.<uuid>.control.*` (power, mode, targetTemp, fanSpeed, vaneHorizontal, vaneVertical, offTimer)
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
- ☐ Unverändert übernehmen: Farben/Tokens, Drehregler, Lüfterpunkte, 5-Segment-Lamellen-Icons, Auto/Swing-Icons (Split nur, wenn MELCloud Home es unterstützt – sonst entfernen), Timer-Rad, Online-Punkt, Störungs-Badge
- ☐ Visueller Test: Desktop, Tablet, VIS-2-iframe

## Phase 5 – Qualität
- ☐ Unit- + Integrationstests grün, Coverage sinnvoll
- ☐ Adapter-Checker ohne Errors
- ☐ Audit mit Universal Audit Template (+ Auth, WebSocket, Rate-Limits, Dashboard-XSS)

## Phase 6 – Release
- ☐ README DE/EN, Changelog, Screenshots
- ☐ GitHub-Release v0.1.0, Forum-Testthread, danach Latest-Repo
