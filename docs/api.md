# MELCloud Home API – Spezifikation für ioBroker.melcloudhome

> **Quelle / Attribution:** Diese Spezifikation basiert auf der Analyse von
> [andrew-blake/melcloudhome](https://github.com/andrew-blake/melcloudhome) (Home-Assistant-Integration,
> MIT-Lizenz, © 2025-2026 Andrew Blake), Stand Branch `main`, abgerufen 2026-10-11.
> Die API ist **inoffiziell** (reverse-engineered) und kann sich jederzeit ändern.
>
> **Status:** Phase 0 – aus Referenz-Code und dessen Captures abgeleitet, **noch nicht** mit Svens Account
> gegengeprüft. Werte mit ⚠️ sind in der Referenz nur abgeleitet oder widersprüchlich.

---

## 1. Überblick

| Komponente | Host | Zweck |
|---|---|---|
| Auth (IdentityServer, Duende) | `https://auth.melcloudhome.com` | OAuth 2.0 Authorization Code + PKCE, PAR |
| Login-UI (AWS Cognito, eu-west-1) | `https://live-melcloudhome.auth.eu-west-1.amazoncognito.com` | Formular-Login (E-Mail/Passwort) |
| REST (Mobile BFF) | `https://mobile.bff.melcloudhome.com` | Gerätestatus, Steuerung, Telemetrie |
| WS-Credential (AWS Lambda) | `https://6x2dgdulg7omjsxalnhmo4ynba0dcgwk.lambda-url.eu-west-1.on.aws/` | liefert `hash` für WebSocket |
| WebSocket | `wss://ws.melcloudhome.com/?hash=<hash>` | Push von Zustandsänderungen |

Wir sprechen – wie die Referenz – die **Mobile-BFF** an (nicht die Web-App `melcloudhome.com`, die
Cookie-Session + CSRF nutzt). Es gibt **keine Regionen-/Länder-Weiche**: ein Cognito-Pool, ein Host.

**Pflicht-Header** für alle Requests:

```
User-Agent: MonitorAndControl.App.Mobile/52 CFNetwork/3860.400.51 Darwin/25.3.0
Accept: application/json
Authorization: Bearer <access_token>      (nur REST + Lambda)
```

---

## 2. Authentifizierung

OAuth-Parameter (Mobile-App-Client):

| Parameter | Wert |
|---|---|
| `client_id` | `homemobile` |
| `redirect_uri` | `melcloudhome://` (Custom-Scheme – wird nie aufgerufen, nur aus `Location` gelesen) |
| `scope` | `openid profile email offline_access IdentityServerApi` |
| PKCE | S256, Verifier = base64url(32 Zufallsbytes) |

### 2.1 Login-Ablauf

1. **PAR** – `POST {auth}/connect/par` (form-urlencoded):
   `response_type=code, state, code_challenge, code_challenge_method=S256, client_id, scope, redirect_uri`
   → `201` mit `{ "request_uri": "...", ... }`. Anderer Status = Fehler, ≥ 500 = Dienst nicht verfügbar.
2. **Authorize** – `GET {auth}/connect/authorize?client_id=homemobile&request_uri=<request_uri>`,
   Redirects folgen (Cookie-Jar nötig!). Zwei mögliche Ausgänge:
   - **Normalfall:** Landung auf Cognito `…amazoncognito.com/login` (HTML). `_csrf` aus
     `<input name="_csrf" value="…">` extrahieren (Attribut-Reihenfolge variiert).
   - **Abkürzung (bestehende IdentityServer-Session):** Redirect direkt zur Callback-URL bzw. nach
     `melcloudhome://?code=…` → Code direkt übernehmen, weiter mit Schritt 5.
3. **Credentials** – `POST <cognito-login-url>` (form-urlencoded):
   `_csrf, username=<E-Mail>, password, cognitoAsfData=""`; Header `Origin`/`Referer` = Cognito-Host,
   Browser-artiger User-Agent (iPhone Safari). Redirects folgen.
   - Endet die Kette **wieder auf dem Cognito-Host** → falsche Zugangsdaten.
4. **Callback** – Aus der Antwortseite `/connect/authorize/callback?…` extrahieren (`&amp;` → `&`),
   `GET` ohne Redirect-Following; `Location` enthält `melcloudhome://?code=…`
   (ggf. einen weiteren Hop folgen).
5. **Token** – `POST {auth}/connect/token` (form-urlencoded):
   `grant_type=authorization_code, code, redirect_uri, code_verifier, client_id`
   → `200` `{ access_token, refresh_token, expires_in, … }`.

**Node-Hinweis:** `fetch` folgt Redirects auf `melcloudhome://` nicht sinnvoll → Redirects **manuell**
(`redirect: 'manual'`) mit eigenem Cookie-Jar (z. B. `tough-cookie`) verfolgen. Login ist HTML-Scraping
und damit die fragilste Stelle der Integration.

### 2.2 Token-Lebenszyklus

- `expires_in` aus der Antwort (Fallback 3600 s). Proaktiv erneuern **60 s vor Ablauf**.
- **Refresh:** `POST {auth}/connect/token` mit `grant_type=refresh_token, refresh_token, client_id`.
  Neuer `refresh_token` in der Antwort ersetzt den alten (**rotierend, Einmalgebrauch**).
- Refresh **nur seriell** (Mutex): zwei parallele Refreshes mit demselben Token → einer wird mit
  HTTP 400 abgelehnt.
- Fehlerkaskade bei `401`: Refresh → bei Fehlschlag kompletter Re-Login → bei Fehlschlag Auth-Fehler
  (dann `info.connection=false`, Backoff).
- Bei `5xx` **kein** Re-Login (Ausfall ≠ Auth-Problem).
- **Entscheidung (Sven):** Tokens nur im Arbeitsspeicher. Login einmal beim Adapterstart, danach nur
  Refresh. Ein erneuter Login mit Passwort passiert nur, wenn der Refresh abgelehnt wird (z. B. nach
  längerem Cloud-Ausfall oder serverseitigem Session-Ende).

### 2.3 Wiederverbindung – Pflichtanforderung (Sven)

**Der Adapter verbindet sich in jeder Lage selbstständig wieder. Er gibt nie auf, beendet sich nicht und
braucht keinen manuellen Neustart.**

| Situation | Verhalten |
|---|---|
| Netzwerk weg / DNS / Timeout | Retry mit Backoff 30 s → max. 5 min, unbegrenzt |
| Cloud-Ausfall (`5xx`) | Backoff 120 s · 2ⁿ, max. 15 min, unbegrenzt; danach Refresh, bei Ablehnung Re-Login |
| Access-Token abgelaufen / `401` | Refresh → bei Ablehnung sofort Re-Login mit Passwort |
| Refresh-Token abgelehnt | Re-Login mit Passwort |
| Re-Login scheitert technisch (Cognito-Seite geändert, unerwartete Antwort) | Retry mit Backoff bis max. 15 min, unbegrenzt |
| Re-Login: Zugangsdaten abgelehnt | **weiter versuchen, aber langsam** (alle 30 min), Fehler einmal als `error` loggen. Grund: Schutz vor Konto-Sperre durch Cognito bei vielen Fehlversuchen. Sobald das Passwort stimmt, verbindet der Adapter ohne Eingriff wieder. |
| Adapterstart ohne Internet | normaler Retry-Zyklus, kein Abbruch |
| WebSocket getrennt (inkl. 2-h-Cap) | Reconnect 5 → 300 s mit Jitter, unbegrenzt; Polling läuft parallel weiter |
| Ein Gerät offline (`isConnected=false`) | nur `info.deviceOnline=false`, Adapter bleibt verbunden |

- Ein einziger zentraler „Connection-Manager“ steuert die Zustände (verbunden, Refresh, Re-Login, Backoff),
  damit nie zwei Logins oder Refreshes gleichzeitig laufen.
- Jeder Erfolg setzt den Backoff zurück; `info.connection` spiegelt jederzeit den echten Zustand.
- Log-Disziplin: Zustandswechsel als `info`/`warn`, Wiederholungen nur auf `debug`. Kein Log-Spam bei
  stundenlangem Ausfall.
- Alle Timer laufen über die Adapter-Timer (`this.setTimeout`), damit `onUnload` sie sauber beendet.
- Testfälle in Phase 2/5: jede Zeile dieser Tabelle mit gemocktem Server simulieren.

---

## 3. REST-Endpunkte (Mobile BFF)

Antworten haben oft `Content-Type: text/plain` trotz JSON-Body → immer selbst `JSON.parse`.
Steuer-Endpunkte antworten `200` mit **leerem Body**.

| Methode | Pfad | Zweck | v1 |
|---|---|---|---|
| GET | `/context` | Benutzer, Gebäude, alle Geräte inkl. Zustand + Capabilities | ✅ Polling |
| PUT | `/monitor/ataunit/{unitId}` | ATA steuern | ✅ |
| GET | `/telemetry/telemetry/energy/{unitId}` | Energie (Wh je Stunde) | ✅ |
| GET | `/telemetry/telemetry/actual/{unitId}?measure=rssi` | WLAN-Signal (dBm) | ✅ |
| GET | `/report/v1/trendsummary` | Raum-/Soll-/Außentemperatur-Verlauf | ✅ Außentemp. |
| — | Szenen, Zeitpläne, Frost-/Überhitzungsschutz, Urlaubsmodus | nur Web-Host bestätigt | ❌ nicht v1 |

### 3.1 `GET /context`

Struktur (gekürzt, anonymisiert):

```jsonc
{
  "id": "<userId>", "email": "…", "firstname": "…",          // PII – nie loggen
  "buildings": [ {
    "id": "<uuid>", "name": "MyHome", "timezone": "Europe/Berlin",
    "airToAirUnits": [ {
      "id": "<uuid>",                       // stabile Geräte-ID → ioBroker-Objekt-ID
      "givenDisplayName": "Wohnraum",       // frei vom Nutzer wählbar → escapen!
      "displayIcon": "LivingRoom",
      "settings": [                          // Name/Wert-Paare, Werte IMMER Strings
        { "name": "Power", "value": "False" },
        { "name": "OperationMode", "value": "Heat" },
        { "name": "SetTemperature", "value": "21.5" },
        { "name": "RoomTemperature", "value": "20" },
        { "name": "SetFanSpeed", "value": "0" },          // "0"–"5" ODER "Auto"/"One"…
        { "name": "ActualFanSpeed", "value": "Two" },     // "Off","One"…"Five"
        { "name": "VaneVerticalDirection", "value": "Auto" },
        { "name": "VaneHorizontalDirection", "value": "Centre" },
        { "name": "InStandbyMode", "value": "False" },
        { "name": "IsInError", "value": "False" },
        { "name": "ErrorCode", "value": "" }
      ],
      "isConnected": true,                   // Cloud ↔ Gerät erreichbar
      "isInError": false,
      "capabilities": { … siehe 3.2 … },
      "rssi": -48,                           // ⚠️ wird laut Referenz nicht mehr aktualisiert
      "timeZone": "Europe/Berlin",
      "schedule": [ … ], "scheduleEnabled": false,
      "frostProtection": null, "overheatProtection": null, "holidayMode": null,
      "connectedInterfaceIdentifier": "<MAC>",  // MAC → nicht loggen/nicht exportieren
      "systemId": "<uuid>"
    } ],
    "airToWaterUnits": [ … ]                 // später (ATW)
  } ],
  "guestBuildings": [ … gleiche Struktur … ] // geteilte Gebäude
}
```

**Parsing-Regeln (defensiv):**
- `settings` in Map umwandeln; fehlende Einträge → `null`, nicht crashen.
- Bool: `"True"/"False"` (case-insensitive) oder echtes Bool.
- Zahlen: `parseFloat`, `""` → `null`.
- `SetFanSpeed`, `VaneVerticalDirection`: sowohl Ziffern-Strings als auch Wörter akzeptieren.
- `VaneHorizontalDirection`: auch amerikanische Schreibweise (`Center`, `CenterLeft`, `CenterRight`)
  normalisieren.
- `ErrorCode: ""` → kein Fehler.
- Unbekannte Werte: einmal pro Gerät/Wert warnen (gedrosselt), State auf `null`.
- `buildings` **und** `guestBuildings` einlesen.
- Gerätenamen: Zeilenumbrüche (`\r \n     \x85`) durch Leerzeichen ersetzen (Log-Injection).

### 3.2 Capabilities (ATA)

| Feld | Default (Referenz) | Verwendung |
|---|---|---|
| `numberOfFanSpeeds` | 5 | Anzahl Lüfterstufen (⚠️ `ActualFanSpeed` kann trotzdem höher liegen) |
| `hasAutomaticFanSpeed` | true | Lüfter „Auto“ anbieten |
| `minTempHeat` / `maxTempHeat` | 10 / 31 | Sollwertgrenzen Heizen |
| `minTempCoolDry` / `maxTempCoolDry` | 16 / 31 | Kühlen + Trocknen |
| `minTempAutomatic` / `maxTempAutomatic` | 16 / 31 | Automatik |
| `hasHalfDegreeIncrements` | true | Schrittweite 0,5 statt 1,0 |
| `hasExtendedTemperatureRange` | true | (erklärt die 10 °C beim Heizen) |
| `hasCool/Heat/Auto/DryOperationMode` | true | verfügbare Modi (Fan immer) |
| `hasSwing`, `hasAirDirection` | true | Lamellen verfügbar |
| `supportsWideVane` | false | ⚠️ vermutlich: horizontale Lamelle motorisch steuerbar |
| `hasStandby` | false | `inStandbyMode` nutzbar |
| `hasEnergyConsumedMeter` | false | Energie-Endpunkt abfragen |
| `isMultiSplitSystem` | – | Info (Svens Anlage: MXZ-3F54VF4 → true erwartet) |
| `hasDemandSideControl`, `isLegacyDevice` | – | nur Info |

### 3.3 `PUT /monitor/ataunit/{unitId}` – Steuerung

**Immer alle 8 Felder senden**, unveränderte auf `null`:

```json
{
  "power": null,
  "operationMode": null,
  "setFanSpeed": null,
  "vaneHorizontalDirection": null,
  "vaneVerticalDirection": null,
  "setTemperature": null,
  "temperatureIncrementOverride": null,
  "inStandbyMode": null
}
```

Header zusätzlich `Content-Type: application/json; charset=utf-8`. Antwort `200`, leerer Body.
**`200` heißt nur „angenommen“**, nicht „vom Gerät umgesetzt“ – Wahrheit kommt mit dem nächsten
`/context` bzw. Gerätebericht (30–60 s Verzögerung möglich).

Regeln:
- `power`, `operationMode`, `setFanSpeed`, `setTemperature` dürfen **in einem Request** kombiniert werden
  (verifiziert).
- **Beide Lamellen-Achsen nie im selben Request** – sonst `200`, aber das Gerät übernimmt keine von beiden
  (Issue #100). Je Achse ein eigener Request.
- **Einschalten immer mit Modus** (`power: true` + `operationMode`): `power` mit `operationMode: null` kann
  bei **Multi-Split** als Moduskonflikt interpretiert werden → Störung/Blinken.
- Zwei Requests kurz hintereinander an dasselbe Gerät können von der Cloud angenommen, **vom Gerät aber
  ignoriert** werden → Befehle je Gerät bündeln (Debounce) und zu **einem** PUT zusammenführen.
- Nur Werte senden, die die offizielle App auch sendet; Sollwert gegen die Capability-Grenzen des aktuellen
  Modus klemmen.

### 3.4 Energie – `GET /telemetry/telemetry/energy/{unitId}`

Query: `from=YYYY-MM-DD HH:mm&to=YYYY-MM-DD HH:mm&interval=Hour&measure=cumulative_energy_consumed_since_last_upload`
(UTC). Nur wenn `hasEnergyConsumedMeter = true`.

```json
{ "measureData": [ { "values": [ { "time": "2025-12-09 09:00:00.000000000", "value": "400.0" } ] } ] }
```

- Werte in **Wh je Stunde** (nicht kumuliert) → ÷ 1000 für kWh.
- **Stunden wachsen nachträglich** (2–4 Aktualisierungen pro Stunde, final ~10 min nach Stundenende).
- Stunden ohne Verbrauch fehlen; `304 Not Modified` = keine Daten.
- `from` **auf volle Stunde abrunden** (sonst sinken Werte scheinbar). Referenz: Fenster 23 h.
- Gesamtzähler im Adapter selbst führen: pro Stunde zuletzt gesehenen Wert merken, nur positive Deltas
  addieren, beim ersten Lauf historische Werte nur als „gesehen“ markieren (sonst Sprung).
  Plausibilitätsgrenze: > 100 kWh/h verwerfen.
- ⚠️ Multi-Split: MELCloud bucht die Energie der Außeneinheit teils auf **eine** Inneneinheit; andere
  Inneneinheiten liefern ggf. nie Werte.
- Abfrageintervall: **30 min**.

### 3.5 WLAN-Signal – `GET /telemetry/telemetry/actual/{unitId}`

Query: `from` / `to` (UTC, `YYYY-MM-DD HH:mm`, Fenster **genau 1 h** bis jetzt), `measure=rssi`.
Antwort wie Energie (`measureData[].values[{time, value}]`), neuester Zeitstempel gewinnt.
`rssi` in `/context` wird laut Referenz nicht mehr aktualisiert. Intervall: 30 min.

### 3.6 Außentemperatur (v1) – `GET /report/v1/trendsummary`

Query: `unitId`, `period=Hourly`, `from`/`to` als `YYYY-MM-DDTHH:mm:ss.0000000Z` (UTC **mit** `Z`,
`to` auf Sekunde 0 gekürzt), Fenster 48 h. Antwort: Liste mit `datasets[]`; Datensatz mit Label
`…OUTDOOR_TEMPERATURE` → Punkte `{x, y}`. **Nur Punkte mit Sekunde ≠ 0 sind echte Messungen**, der Rest
sind synthetische Chart-Punkte. `x` ist Ortszeit des Geräts (`timeZone`). > 72 h langsam, 7 Tage → 500.
Intervall: 30 min. Gibt es im Fenster keine echte Messung (Gerät lange aus), bleibt der letzte Wert stehen;
`info.outdoorTempTime` zeigt das Alter der Messung.

---

## 4. WebSocket (Echtzeit)

1. **Credential:** `GET <Lambda-URL>` mit `Authorization: Bearer <access_token>` →
   `{ "hash": "<uuid>", "userId": "<uuid>" }` (`401/403` → Auth-Fehler). Hash ist benutzergebunden.
2. **Verbinden:** `wss://ws.melcloudhome.com/?hash=<hash>` – Auth **nur** über den Query-Parameter
   (kein Bearer/Cookie). `permessage-deflate`, kein Subprotokoll.
   ⚠️ Die URL enthält das Credential → **nie** ungefiltert loggen (auch Fehlermeldungen des WS-Clients).
3. **Kein Client→Server-Verkehr** nötig (kein Subscribe). Ein Socket bedient alle Geräte des Accounts.
4. **Keepalive:** eigener Ping alle 30 s; Server trennt **hart nach 2 h** (Close 1006/1001) → sofort
   neu verbinden, das ist Normalbetrieb.

**Nachrichten** (Text-Frames, JSON-Array oder Einzelobjekt):

```json
[{ "messageType": "unitStateChanged",
   "Data": { "id": "<unitId>", "unitType": "ata",
             "settings": [ { "name": "Power", "value": true } ] } }]
```

| `messageType` | Inhalt | Verwendung |
|---|---|---|
| `unitStateChanged` | nur **geänderte** Settings | Trigger für `/context`-Refresh (debounced ~2 s) |
| `unitCommunicationLost` | `{ id, timestamp }` | Refresh (Adapter setzt `deviceOnline` bewusst nicht direkt, kein Flackern) |
| `unitCommunicationRestored` | `{ id, timestamp }` | Refresh |

- Feldname mal `Data`, mal `data`.
- Werte-Typen sind inkonsistent: Befehls-Echo = Ints/Bool, Gerätebericht = Wörter/Strings, ein Bericht kann
  sogar den Stand **vor** dem letzten Befehl enthalten.
- **Empfehlung (wie Referenz):** Frames **nicht** als Zustand übernehmen, sondern nur als Auslöser für einen
  REST-Refresh. REST bleibt die einzige Wahrheitsquelle; Polling läuft immer weiter.

**Reconnect:** exponentieller Backoff 5 s → 300 s, ±20 % Jitter; Backoff erst zurücksetzen, wenn eine
Sitzung ≥ 60 s stabil war (sonst Endlosschleife bei sofort schließendem Server). Jeder Reconnect holt einen
neuen Hash (ggf. vorher Token-Refresh).

---

## 5. Wertecodes ATA

Die API benutzt **drei Kodierungen** für dieselben Werte:
**PUT** = Wort-Strings · **`/context`** = Wort-Strings (Lüfter/Lamelle vertikal teils Ziffern-Strings) ·
**WebSocket-Echo / Zeitpläne / Szenen** = Ints.

**Entscheidung (Sven, 2026-10-11):** Die ioBroker-States übernehmen **exakt die Codes, Optionen und Symbole
des Jäger-Dashboards** (`reference/melcloud_vis2_iframe.html`). Das sind die Codes der klassischen MELCloud,
damit sind die States zugleich kompatibel zu `ioBroker.melcloud`. Die Übersetzung in die
MELCloud-Home-Kodierung macht ausschließlich `mapping.ts`.

### 5.1 Betriebsmodus (`operationMode` / `OperationMode`)

| Dashboard (Label · Symbol) | ioBroker `control.mode` | PUT + `/context` | Int (WS/Zeitplan) |
|---|---|---|---|
| Auto · Uhr | **8** | `Automatic` (**nicht** `Auto`) | 5 |
| Heizen · Flamme | **1** | `Heat` | 1 |
| Kühlen · Stern | **3** | `Cool` | 3 |
| Trocken · Tropfen | **2** | `Dry` | 2 |
| Lüften · Ventilator | **7** | `Fan` | 4 |

### 5.2 Lüfterstufe (`setFanSpeed` / `SetFanSpeed`)

| Dashboard | ioBroker `control.fanSpeed` | PUT | `/context` | Int |
|---|---|---|---|---|
| „A“ | **0** | `Auto` | `Auto` oder `"0"` | 0 |
| Punkt 1–5 | **1–5** | `One` … `Five` | Wort oder `"1"`–`"5"` | 1–5 |

`ActualFanSpeed` (nur lesen): `Off`, `One` … `Five` (WS: Ziffern-String `"0"`–`"4"` …).

### 5.3 Vertikale Lamelle / Höhe (`vaneVerticalDirection`)

| Dashboard (Symbol) | ioBroker `control.vaneVerticalDirection` | PUT + `/context` | Int (WS-Echo) |
|---|---|---|---|
| Auto (Kreispfeile) | **0** | `Auto` | 0 |
| Position 1–5 (5-Segment-Fächer) | **1–5** | `One` … `Five` | 1–5 |
| Swing (Bogen mit Pfeilen) | **7** | `Swing` | **6** (⚠️ Fallback-Map der Referenz für `/context` nutzt `"7"`) |

### 5.4 Horizontale Lamelle / Seite (`vaneHorizontalDirection`)

| Dashboard (Symbol) | ioBroker `control.vaneHorizontalDirection` | PUT + `/context` | Int (WS-Echo) |
|---|---|---|---|
| Auto (Kreispfeile) | **0** | `Auto` | 0 |
| Position 1 (5-Segment-Fächer) | **1** | `Left` | 1 |
| Position 2 | **2** | `LeftCentre` | 2 |
| Position 3 | **3** | `Centre` | 3 |
| Position 4 | **4** | `RightCentre` | 4 |
| Position 5 | **5** | `Right` | 5 |
| Swing (Bogen mit Pfeilen) | **12** | `Swing` | 7 |

**Split (8) entfällt (Entscheidung Sven, geprüft 2026-10-12):** Die offizielle App bietet für die Seitenlamelle nur
Position 1–5, Swing und Auto an, die API kennt keinen Split-Wert. Kein State-Wert, kein Button im Dashboard.

### 5.5 Temperaturen

- `setTemperature`: Zahl, Schritt 0,5 (bei `hasHalfDegreeIncrements`), Grenzen modusabhängig aus Capabilities
  (Heizen 10–31, Kühlen/Trocknen/Auto 16–31 bei Svens Gerätetyp erwartet).
- `RoomTemperature`: nur lesen, String-Zahl.

### 5.6 Abgleich mit dem Referenz-Dashboard

Das Dashboard nutzt Codes der klassischen MELCloud. Diese werden laut Entscheidung oben **unverändert
als ioBroker-Werte übernommen**. Das Dashboard braucht deshalb keine Code-Änderung, nur andere State-IDs.
Verbleibende Abweichungen:

| Dashboard | MELCloud Home | Konsequenz |
|---|---|---|
| Seitenlamelle 8 = Split | gibt es nicht | entfällt (§5.4) |
| Seitenlamelle Position 1–5 | benannt Links … Rechts | 1:1 über `mapping.ts` |
| Sollwert fest 16–31 | Heizen ab 10 °C | Grenzen aus `capabilities.*` |

---

## 6. Rate-Limits, Timing, Resilienz

Kein offizielles Limit dokumentiert; in der Referenz wurde **nie ein HTTP 429 beobachtet**. Gemessen:
48 PUTs im 0,5-s-Takt über 6 Geräte → alle `200`. Höhere Frequenzen bewusst nicht getestet (Bann-Risiko).

| Aspekt | Referenz (HA) | ioBroker-Vorgabe |
|---|---|---|
| Globaler Request-Abstand | 0,5 s, seriell (ein Mutex für alle Requests inkl. Auth) | übernehmen |
| `/context`-Polling | 60 s | Konfig, **min. 60 s** |
| Refresh nach Befehl / WS-Delta | debounced ~2 s | übernehmen |
| Befehls-Bündelung | 10 ms Coalescing | Debounce ~800 ms je Gerät, ein PUT |
| Energie | 30 min | **min. 30 min** |
| RSSI / Außentemperatur | 30 min | 30 min |
| HTTP-Timeout | 30 s | 30 s |
| 5xx-Backoff | 120 s · 2ⁿ, max 900 s | übernehmen |
| WS-Reconnect | 5 → 300 s, ±20 % Jitter | übernehmen |

---

## 7. Bekannte Stolperfallen (Kurzliste)

1. `Automatic` statt `Auto` beim Modus; Lüfter/Lamellen als **Wort-Strings** senden, nicht als Zahlen.
2. Alle 8 Felder im PUT, unveränderte `null`.
3. Lamellen-Achsen getrennt senden.
4. Einschalten zusammen mit `operationMode` (Multi-Split-Störung).
5. Befehle je Gerät bündeln – schnell aufeinanderfolgende PUTs werden vom Gerät evtl. ignoriert.
6. `200` ≠ umgesetzt; optimistisch anzeigen, mit nächstem `/context` korrigieren.
7. **Kein Dedup** gegen den Cache (Referenz hat es entfernt: verschluckte sonst Befehle bei veraltetem Cache).
8. `text/plain` bei JSON-Antworten.
9. Refresh-Token rotiert und ist einmalig → serialisieren; bei Fehler Re-Login.
10. Login = HTML-Scraping (Cognito `_csrf`) → robuste Regexe, klare Fehlermeldung bei Änderungen.
11. WS-URL und Callback-URLs enthalten Credentials (`hash`, `code`, `state`) → vor dem Loggen redigieren.
12. Report-Zeitstempel in Geräte-Ortszeit; Anfragen mit `Z` senden.
13. Energie wächst nachträglich, ist lückenhaft, Delta-Tracking nötig.
14. `rssi` aus `/context` veraltet → Telemetrie nutzen.
15. Gerätenamen sind Fremdeingaben (auch aus geteilten Gebäuden) → im Log Zeilenumbrüche entfernen, im
    Dashboard escapen.

---

## 8. Mapping API ↔ ioBroker-States (Vorschlag für Phase 3)

Pfad: `melcloudhome.<inst>.devices.<unitId>.…` (`<unitId>` = UUID aus `/context`, nie der Anzeigename).
Rollen sind Vorschläge und werden in Phase 3 gegen den ioBroker type-detector (Gerätetyp *airCondition*)
geprüft.

### 8.1 `info.*` (nur lesen, `ack=true`)

| State | Typ | Rolle | Quelle | Umrechnung |
|---|---|---|---|---|
| `info.name` | string | `info.name` | `givenDisplayName` (der in der MELCloud-Home-App vergebene Raumname) | Zeilenumbrüche entfernen |
| `info.building` | string | `text` | `buildings[].name` | – |
| `info.isGuest` | boolean | `indicator` | aus `guestBuildings` | – |
| `info.deviceOnline` | boolean | `indicator.reachable` | `isConnected`; WS `unitCommunicationLost/Restored` | – |
| `info.hasError` | boolean | `indicator.maintenance.alarm` | `settings.IsInError` (Fallback `isInError`) | Bool-Parse |
| `info.errorCode` | string | `text` | `settings.ErrorCode` | `""` → `""` |
| `info.roomTemp` | number °C | `value.temperature` | `settings.RoomTemperature` | parseFloat |
| `info.actualFanSpeed` | number | `value` | `settings.ActualFanSpeed` | Off→0, One…Five→1…5 |
| `info.wifiSignal` | number dBm | `value` | Telemetrie `rssi` | neuester Punkt |
| `info.outdoorTemp` | number °C | `value.temperature` | trendsummary | nur echte Messpunkte (Sekunde ≠ 0) |
| `info.outdoorTempTime` | number | `value.time` | Zeitstempel dieser Messung | Geräte-Ortszeit → UTC-ms |
| `info.lastUpdate` | number | `value.time` | Zeitpunkt letzter erfolgreicher `/context` | ms |

### 8.2 `control.*` (lesen + schreiben; Befehl bei `ack=false`, Rückmeldung `ack=true`)

| State | Typ | Rolle | API lesen (`/context`) | API schreiben (PUT-Feld) | Werte / `common.states` |
|---|---|---|---|---|---|
| `control.power` | boolean | `switch.power` | `Power` | `power` (+ aktueller `operationMode`) | true/false |
| `control.mode` | number | `level.mode.airconditioner` | `OperationMode` | `operationMode` | 8 Auto, 1 Heizen, 3 Kühlen, 2 Trocken, 7 Lüften (§5.1; nur laut Capabilities) |
| `control.targetTemp` | number °C | `level.temperature` | `SetTemperature` | `setTemperature` | min/max/step aus Capabilities je Modus |
| `control.fanSpeed` | number | `level.mode.fan` | `SetFanSpeed` | `setFanSpeed` | 0 Auto, 1–n (n=`numberOfFanSpeeds`) (§5.2) |
| `control.vaneVerticalDirection` | number | `level.mode.swing` | `VaneVerticalDirection` | `vaneVerticalDirection` (allein) | 0 Auto, 1–5 Position, 7 Swing (§5.3) |
| `control.vaneHorizontalDirection` | number | `level.mode.swing` | `VaneHorizontalDirection` | `vaneHorizontalDirection` (allein) | 0 Auto, 1–5 Position, 12 Swing (kein Split, §5.4); nur bei `supportsWideVane` schreibbar |
| `control.standby` | boolean | `switch` | `InStandbyMode` | `inStandbyMode` | nur bei `hasStandby` |
| `control.offTimer` | number min | `level.timer` | – (Adapter-intern) | bei Ablauf `power:false` | 0 = aus, max 360 |
| `control.offTimerRemaining` | number s | `value.interval` | – (Adapter-intern) | – | read-only, überlebt Neustart (Endzeit persistieren) |

`common.states` tragen die Dashboard-Labels (z. B. `{8:"Auto",1:"Heizen",3:"Kühlen",2:"Trocken",7:"Lüften"}`,
mehrsprachig DE/EN). Die State-IDs der Lamellen heißen wie im Dashboard (`…Direction`), damit es mit
minimalen Änderungen weiterläuft.

### 8.3 `energy.*` (nur lesen, nur bei `hasEnergyConsumedMeter`)

| State | Typ | Rolle | Quelle |
|---|---|---|---|
| `energy.total` | number kWh | `value.energy.consumed` | Summe positiver Stunden-Deltas (Adapter führt Zähler, persistent) |
| `energy.lastHour` | number kWh | `value.energy` | jüngster Stundenwert |
| `energy.today` | number kWh | `value.energy` | Summe Stunden des lokalen Tages |

### 8.4 `capabilities.*` (nur lesen, für Dashboard/VIS)

| State | Quelle |
|---|---|
| `capabilities.minTempHeat`, `maxTempHeat` | `minTempHeat`, `maxTempHeat` |
| `capabilities.minTempCoolDry`, `maxTempCoolDry` | dto. |
| `capabilities.minTempAuto`, `maxTempAuto` | `minTempAutomatic`, `maxTempAutomatic` |
| `capabilities.tempStep` | `hasHalfDegreeIncrements` ? 0.5 : 1 |
| `capabilities.fanSpeeds` | `numberOfFanSpeeds` |
| `capabilities.modes` | JSON-Array der verfügbaren Modi |
| `capabilities.hasSwing`, `hasAirDirection`, `supportsWideVane`, `hasStandby`, `hasEnergyMeter`, `isMultiSplit` | dto. |

### 8.5 Adapter-weit

| State | Rolle | Bedeutung |
|---|---|---|
| `info.connection` | `indicator.connected` | Login ok und letzter `/context` erfolgreich |
| `info.websocket` | `indicator.connected` | WebSocket verbunden (Polling-Fallback aktiv, wenn false) |

---

## 9. Verifikation mit Svens Account

Lesender Testlauf am 2026-10-12 mit `tools/probe.ts` (nur GET, kein PUT): 2× MSZ-AY an MXZ-3F54VF4.
Anonymisierte Antworten liegen in `test/fixtures/live/`, Tests in `src/lib/api/live-fixtures.test.ts`.

| Frage | Ergebnis |
|---|---|
| Login-Flow (PAR → Cognito → Callback → Token) | ✅ funktioniert wie beschrieben, Cognito-Normalfall (keine Abkürzung) |
| `expires_in` des Access-Tokens | **3600 s** |
| `SetFanSpeed` / `VaneVerticalDirection` in `/context`: Ziffern oder Wörter? | **Wörter** (`Three`, `Auto`, `Swing`). Die Ziffern-Normalisierung bleibt als Absicherung. |
| `supportsWideVane` / `hasAirDirection` | `hasAirDirection=true` bei beiden. `supportsWideVane` ist **je Gerät verschieden**: Wohnraum-Gerät `true` (Seitenlamelle steht auf `Swing`), zweites Gerät `false` (`Centre`). Steuerbarkeit der Seitenlamelle also je Gerät aus der Capability ableiten. |
| Split-/Wide-Einstellung (Code 8) | **gibt es nicht**: kein Wert in den Daten, die App bietet nur Position 1–5, Swing, Auto (Sven, 2026-10-12) → entfällt |
| Energie bei Multi-Split | **beide** Inneneinheiten liefern Stundenwerte (Auflösung 100 Wh). `isEnergyUsageCompatible` ist trotzdem `false` – nicht auswerten. |
| `hasStandby` | `true` bei beiden (Referenz-Default war `false`) → `control.standby` anlegen |
| `rssi` in `/context` veraltet? | **ja**: `/context` -30, Telemetrie -44/-42 dBm |
| Außentemperatur | ✅ Antwort ist eine **Liste** mit einem Report; Dataset-`id` `outside_temperature`. Echte Messpunkte alle ~10 min (Sekunde ≠ 0), Ortszeit des Geräts. Der Server rundet `from` auf Mitternacht (Ortszeit) ab. |
| WS-Echo für vertikales Swing (`6`?) | ✅ **`6`** bestätigt (Mitschnitt 2026-10-12, `test/fixtures/live/websocket-frames.json`) |
| WebSocket allgemein | ✅ Verbindung mit Hash klappt. 12 Nachrichten in 240 s, alle `unitStateChanged` mit **genau einem** Setting, Feld `Data` (groß). Werte als Bool/Zahl: `Power` true/false, `SetTemperature` 17.5, `SetFanSpeed` 2, `VaneVerticalDirection` 6 (Swing) / 1, `VaneHorizontalDirection` 3/4/5 (= Centre/RightCentre/Right, passt zu §5.4). Echo kommt ~1 s nach der Änderung in der App. **Keine** verzögerten Geräteberichte (Wort-Strings) und kein `ActualFanSpeed` im Fenster beobachtet. → Bestätigt die Strategie: Frames nur als Auslöser für `/context`. |

### 9.1 Steuer-Tests 2026-10-13 (dev-server, erstes Gerät, Svens OK)

- Solltemperatur, Lüfter, Höhenlamelle, Seitenlamelle Position 1–5: PUT 200, WS-Echo sofort, Gerät setzt um,
  `/context` bestätigt nach Ablauf der Optimistik-Sperre.
- **Seitenlamelle Swing (WS-Echo `7`) wirkt nach einer festen Position oft nicht** – bei jedem Absender
  (Adapter, Web-App `melcloudhome.com`, Handy-App). PUT-Bodies der Web-App für Position und Swing sind
  **byte-identisch** zu unseren; Abstand (20–99 s) und Umweg über Auto sind nicht die Ursache.
- **Ursache (Modell, durch Vorhersage bestätigt 22:39):** Die Cloud kennt den Ist-Zustand nur aus **Geräteberichten**
  und reicht einen Befehl offenbar nur weiter, wenn er vom zuletzt *gemeldeten* Wert abweicht. Nach Swing → Position
  bleibt „Swing“ der letzte Bericht, ein erneutes Swing wird verworfen. `/context` zeigt währenddessen den
  *befohlenen* Wert (`Swing`), nicht den echten.
- **Geräteberichte** kommen selten: zusammen mit einer Änderung der Raumtemperatur (beobachtet 21:13:34, 21:53:35,
  22:33:59 – Lamelle + `RoomTemperature` im selben Frame bzw. derselben `/context`-Änderung) und nach Aus/Ein.
  Im WS als Wort-String (`VaneHorizontalDirection = "Left"`), Befehls-Echos dagegen als Zahl.
- Direkt nach so einem Bericht wirkt Swing sofort (Vorhersage getestet: Bericht „4“ um 22:33:59, Swing 22:39 ✔).
- **Umgehung (Plan):** Swing-Wunsch merken; meldet `/context`/WS danach einen neuen Ist-Wert (≠ Swing), Swing
  automatisch erneut senden. Auto (`0`) zeigte am Gerät keine sichtbare Bewegung – vermutlich gleiches Verhalten.
- **Echte Stellung abfragen – nicht möglich (Probe 2026-10-14, nur GET, `PROBE_MEASURES=1`):**
  - `/telemetry/telemetry/actual` (Mobile BFF) nimmt nur noch `measure=rssi` an (200). Alle anderen Namen → **400**,
    auch die früher dokumentierten `room_temperature` / `set_temperature` sowie geratene Lamellen-, Lüfter-, Power-
    und Modus-Namen.
  - `/telemetry/telemetry/operationmode/{id}` → 404, `/report/v1/comfort-graph` (Trendsummary-Parameter) → 500.
  - Einen Befehl „Gerät soll sich melden“ kennt auch die Referenz-Integration nicht (keine Doku, keine App-Mitschnitte).
  - Die Referenz bestätigt das Modell an anderer Stelle: Issue #310 (`/context` meldet Power an, Gerät ist aus), danach
    ADR-026 „jeden Befehl senden, nie gegen den Cache entprellen“. Unser Adapter entprellt ebenfalls nicht gegen `/context`.
  - Folge: Die Umgehung über Swing-Wunsch + Wiederholung nach Gerätebericht bleibt der Weg.
- **Live-Test der Umgehung 2026-10-14 (Wohnraum, Svens OK):**
  - Gerät aus, Links → Swing gesendet, dann eingeschaltet: Gerät übernimmt Swing direkt (letzter Befehl wirkt beim
    Einschalten), keine Wiederholung nötig.
  - Gerät an, letzter Bericht Swing: Links (wirkt) → Swing 09:33:12 (PUT 200, Lamelle **bleibt links** – Problem
    nachgestellt) → Aus/Ein → Bericht Links → Adapter 09:34:14 „sending swing again (1/3)“ → Lamelle schwenkt ✔.
- **Wiederholung mit WebSocket 2026-10-14 (Aus/Ein über die App):**
  - Links 10:35:11 (WS-Echo 70 ms nach dem PUT) → Swing 10:35:47 (bleibt links) → Aus 10:41:49 (Bericht ohne Lamelle,
    `/context` weiter Swing) → Ein 10:42:05: Gerät **schwenkt sofort**, `/context` zeigt Swing.
  - 10:43:37 Gerätebericht (zusammen mit neuer Raumtemperatur) meldet trotzdem **„Left“**, obwohl die Lamelle sichtbar
    schwenkt → **Geräteberichte können veraltet sein.** Adapter wiederholt Swing 10:43:39 (2 s nach dem Bericht, PUT
    10:43:40) – unnötig, aber harmlos; Swing läuft weiter.
  - Folge: Die Wiederholung bleibt richtig, weil sie im schlimmsten Fall einen wirkungslosen PUT kostet (max. 3×).

Weitere Beobachtungen in `/context` (werden toleriert, v1 nutzt sie nicht): `connectedInterfaceType`
(`melCloudWiFi`), `energyProducedOptIn`, `unitSettings`, `scenes`, Konto-Limits (`numberOfDevicesAllowed` …),
`frostProtection`/`overheatProtection` als Objekte `{active, enabled, min, max}`, Zeitpläne mit **kleingeschriebenen**
Wörtern (`cool`, `swing`, `five`).
