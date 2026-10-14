/*
 * MELCloud Home dashboard - logic without DOM or socket access (unit tested).
 *
 * Works as a browser script (window.MelDashCore) and as a CommonJS module (tests).
 * Only dashboard value codes are used here (docs/api.md section 5) - the adapter
 * translates them to MELCloud Home values. All SVG markup below is constant.
 */
(function (/** @type {Record<string, unknown>} */ root, factory) {
    const core = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = core;
    } else {
        root.MelDashCore = core;
    }
})(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis)), function () {
    'use strict';

    /** @type {Record<string, Record<string, string>>} */
    const TEXTS = {
        de: {
            title: 'Klima',
            target: 'Soll',
            room: 'Raum',
            fan: 'Lüfter',
            vaneH: 'Seitenlamelle ↔',
            vaneV: 'Höhenlamelle ↕',
            running: 'in Betrieb',
            ready: 'bereit',
            unreachable: 'nicht erreichbar',
            error: 'Störung',
            modeConflict: 'Moduskonflikt',
            modeConflictHint:
                'Multi-Split: Heizen und Kühlen/Trocknen gehen nicht gleichzeitig – ein Gerät bleibt stehen',
            timer: 'Abschalt-Timer',
            timerHint: 'Rad drehen, dann Mitte antippen',
            timerCancel: 'Timer beenden',
            offIn: 'aus in',
            off: 'Aus',
            min: 'Min',
            hours: 'Std',
            power: 'Ein/Aus',
            close: 'Schließen',
            auto: 'Auto',
            swing: 'Swing',
            position: 'Position',
            mode8: 'Auto',
            mode1: 'Heizen',
            mode3: 'Kühlen',
            mode2: 'Trocken',
            mode7: 'Lüften',
            noDevices: 'Keine Geräte gefunden. Läuft die Adapter-Instanz?',
            disconnected: 'Keine Verbindung zu ioBroker',
            noSocket: 'Socket-Schnittstelle des web-Adapters nicht verfügbar',
        },
        en: {
            title: 'Climate',
            target: 'Target',
            room: 'Room',
            fan: 'Fan',
            vaneH: 'Horizontal vane ↔',
            vaneV: 'Vertical vane ↕',
            running: 'running',
            ready: 'standby',
            unreachable: 'unreachable',
            error: 'Fault',
            modeConflict: 'Mode conflict',
            modeConflictHint:
                'Multi-split: heating and cooling/drying cannot run at the same time - one unit stands still',
            timer: 'Off timer',
            timerHint: 'Turn the wheel, then tap the centre',
            timerCancel: 'Cancel timer',
            offIn: 'off in',
            off: 'Off',
            min: 'min',
            hours: 'h',
            power: 'On/off',
            close: 'Close',
            auto: 'Auto',
            swing: 'Swing',
            position: 'Position',
            mode8: 'Auto',
            mode1: 'Heat',
            mode3: 'Cool',
            mode2: 'Dry',
            mode7: 'Fan',
            noDevices: 'No units found. Is the adapter instance running?',
            disconnected: 'No connection to ioBroker',
            noSocket: 'Socket interface of the web adapter not available',
        },
    };

    /**
     * Dashboard language from the ioBroker system language.
     *
     * @param {unknown} language - system.config common.language
     * @returns {'de'|'en'}
     */
    function pickLanguage(language) {
        return language === 'de' ? 'de' : 'en';
    }

    /**
     * Translated text.
     *
     * @param {'de'|'en'} lang - Language
     * @param {string} key - Text key
     * @returns {string}
     */
    function t(lang, key) {
        const texts = TEXTS[lang] || TEXTS.en;
        return texts[key] !== undefined ? texts[key] : TEXTS.en[key] !== undefined ? TEXTS.en[key] : key;
    }

    /** Modes in display order: code, icon key, css class */
    const MODES = [
        { code: 8, icon: 'auto', cls: 'mode-auto' },
        { code: 1, icon: 'heat', cls: 'mode-heat' },
        { code: 3, icon: 'cool', cls: 'mode-cool' },
        { code: 2, icon: 'dry', cls: 'mode-dry' },
        { code: 7, icon: 'fan', cls: 'mode-fan' },
    ];

    const VANE_H_AUTO = 0;
    const VANE_H_SWING = 12;
    const VANE_V_AUTO = 0;
    const VANE_V_SWING = 7;

    const MODE_ICONS = {
        auto: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
        heat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3c2 3-1 4-1 6a3 3 0 106 0c0-1-1-2-1-3 2 1 4 4 4 7a8 8 0 11-16 0c0-4 3-6 4-9 1 1 2 2 4-1z"/></svg>',
        cool: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 2v20M4.9 4.9l14.2 14.2M19.1 4.9L4.9 19.1"/></svg>',
        dry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3s6 6.5 6 11a6 6 0 11-12 0c0-4.5 6-11 6-11z"/></svg>',
        fan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 12c0-3 2-6 4-6s2 3 0 5-4 1-4 1zM12 12c-3 0-6 2-6 4s3 2 5 0 1-4 1-4zM12 12c3 0 6-2 6-4s-3-2-5 0-1 4-1 4z"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/></svg>',
    };

    /** @type {Record<string, string>} */
    const ROOM_ICONS = {
        armchair: `<svg viewBox="0 0 24 24" fill="none">
    <rect x="8" y="5.5" width="8" height="8" rx="3" fill="currentColor"/>
    <circle cx="10.2" cy="8.3" r="0.7" fill="#16241b"/>
    <circle cx="13.8" cy="8.3" r="0.7" fill="#16241b"/>
    <circle cx="10.2" cy="10.8" r="0.7" fill="#16241b"/>
    <circle cx="13.8" cy="10.8" r="0.7" fill="#16241b"/>
    <path d="M5 11.5a2.5 2.5 0 0 1 2.5-2.5H8v8H7A2.5 2.5 0 0 1 5 14.5z" fill="currentColor"/>
    <path d="M19 11.5a2.5 2.5 0 0 0-2.5-2.5H16v8h1a2.5 2.5 0 0 0 2.5-2.5z" fill="currentColor"/>
    <rect x="6.5" y="13" width="11" height="4.5" rx="2" fill="currentColor"/>
    <path d="M7 18.5L5 21.5M17 18.5L19 21.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M10 17.5L8.5 21.5M14 17.5L15.5 21.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
        bed: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 12v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>
    <path d="M4 12a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2"/>
    <path d="M6 10V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2"/>
    <path d="M5 18v2M19 18v2"/>
  </svg>`,
        desk: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <rect x="7" y="3.5" width="10" height="7" rx="1"/>
    <path d="M12 10.5v2.5"/>
    <path d="M3 13h18"/>
    <path d="M5 13v7M19 13v7"/>
    <path d="M14 13v4h5"/>
  </svg>`,
        dining: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 10h16"/>
    <path d="M6 10v10M18 10v10"/>
    <path d="M8 6.5c0-1.4 1.8-2.5 4-2.5s4 1.1 4 2.5V10H8z"/>
  </svg>`,
        child: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="7" cy="5.5" r="2"/>
    <circle cx="17" cy="5.5" r="2"/>
    <circle cx="12" cy="10" r="4.5"/>
    <path d="M7.5 15.5a5 5 0 1 0 9 0"/>
    <circle cx="10.5" cy="9.5" r=".4" fill="currentColor"/>
    <circle cx="13.5" cy="9.5" r=".4" fill="currentColor"/>
  </svg>`,
        unit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="6" width="18" height="8" rx="2"/>
    <path d="M6 11.5h12"/>
    <path d="M8 17l-1 2.5M12 17v3M16 17l1 2.5"/>
  </svg>`,
    };

    const VANE_SPECIAL = {
        auto: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
    <path d="M4 12a8 8 0 0 1 13.5-5.5"/>
    <path d="M20 12a8 8 0 0 1-13.5 5.5"/>
    <path d="M16 4.5 L17.6 6.6 L15 7.6"/>
    <path d="M8 19.5 L6.4 17.4 L9 16.4"/>
  </svg>`,
        swing: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 15 Q12 4 20 15"/>
    <path d="M4 15 L6.6 13.4 M4 15 L6.2 17.4"/>
    <path d="M20 15 L17.4 13.4 M20 15 L17.8 17.4"/>
  </svg>`,
        swingVertical: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <g transform="rotate(-90 12 12)">
    <path d="M4 15 Q12 4 20 15"/>
    <path d="M4 15 L6.6 13.4 M4 15 L6.2 17.4"/>
    <path d="M20 15 L17.4 13.4 M20 15 L17.8 17.4"/>
    </g>
  </svg>`,
    };

    /**
     * Room icon markup; unknown or "auto" falls back by position (first unit armchair, others bed).
     *
     * @param {unknown} icon - info.icon value
     * @param {number} index - Position of the card
     * @returns {string}
     */
    function roomIconSvg(icon, index) {
        if (typeof icon === 'string' && Object.prototype.hasOwnProperty.call(ROOM_ICONS, icon)) {
            return ROOM_ICONS[icon];
        }
        return index === 0 ? ROOM_ICONS.armchair : ROOM_ICONS.bed;
    }

    /**
     * @param {number} deg - Angle
     * @param {number} cx - Centre x
     * @param {number} cy - Centre y
     * @param {number} r - Radius
     */
    function pieSlicePoint(deg, cx, cy, r) {
        const rad = (deg * Math.PI) / 180;
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    }

    /**
     * Fan with five slices, the active one highlighted.
     * Vertical vane (side view): 90° fan, pivot top left, position 1 next to the top edge,
     * position 5 next to the left edge - like the real unit.
     * Horizontal vane (top view): 180° fan, pivot bottom centre, position 1 left, 5 right.
     *
     * @param {'h'|'v'} axis - Vane
     * @param {number} idx - Active position 1-5
     * @returns {string}
     */
    function positionIconSvg(axis, idx) {
        const horizontal = axis === 'h';
        const cx = horizontal ? 12 : 3;
        const cy = horizontal ? 19 : 3;
        const r = horizontal ? 15 : 17;
        const angles = horizontal ? [180, 216, 252, 288, 324, 360] : [0, 18, 36, 54, 72, 90];
        const slices = angles.map(d => pieSlicePoint(d, cx, cy, r));
        let out = '';
        for (let i = 0; i < 5; i++) {
            const color = i + 1 === idx ? 'currentColor' : '#4a5c45';
            const a = slices[i];
            const b = slices[i + 1];
            out += `<path d="M${cx},${cy} L${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 0 1 ${b.x.toFixed(2)},${b.y.toFixed(2)} Z" fill="${color}" stroke="#101a14" stroke-width="1"/>`;
        }
        return `<svg viewBox="0 0 24 24" fill="none">${out}</svg>`;
    }

    /**
     * Icon for a vane code.
     *
     * @param {'h'|'v'} axis - Horizontal or vertical vane
     * @param {number} code - Dashboard code
     * @returns {string}
     */
    function vaneIconSvg(axis, code) {
        if (code === (axis === 'h' ? VANE_H_AUTO : VANE_V_AUTO)) {
            return VANE_SPECIAL.auto;
        }
        if (code === (axis === 'h' ? VANE_H_SWING : VANE_V_SWING)) {
            return axis === 'h' ? VANE_SPECIAL.swing : VANE_SPECIAL.swingVertical;
        }
        return positionIconSvg(axis, code);
    }

    /**
     * Tooltip for a vane code.
     *
     * @param {'de'|'en'} lang - Language
     * @param {'h'|'v'} axis - Axis
     * @param {number} code - Dashboard code
     * @returns {string}
     */
    function vaneLabel(lang, axis, code) {
        if (code === (axis === 'h' ? VANE_H_AUTO : VANE_V_AUTO)) {
            return t(lang, 'auto');
        }
        if (code === (axis === 'h' ? VANE_H_SWING : VANE_V_SWING)) {
            return t(lang, 'swing');
        }
        return `${t(lang, 'position')} ${code}`;
    }

    /**
     * Numeric codes of a common.states definition, sorted: auto first, positions, swing last.
     *
     * @param {unknown} states - common.states (object or array)
     * @returns {number[]}
     */
    function codesOf(states) {
        if (!states || typeof states !== 'object') {
            return [];
        }
        const keys = Array.isArray(states) ? states.map((_, i) => i) : Object.keys(states);
        const codes = keys.map(Number).filter(n => Number.isInteger(n) && n >= 0);
        const rank = (/** @type {number} */ n) => (n === 0 ? -1 : n === VANE_H_SWING || n === VANE_V_SWING ? 100 : n);
        return [...new Set(codes)].sort((a, b) => rank(a) - rank(b));
    }

    /**
     * Allowed target temperature range for a mode from the capability states.
     *
     * @param {Record<string, unknown>} caps - Capability values (minTempHeat, maxTempHeat, ...)
     * @param {unknown} mode - Mode code
     * @returns {{min: number, max: number, step: number}}
     */
    function temperatureRange(caps, mode) {
        const num = (/** @type {unknown} */ value, /** @type {number} */ fallback) =>
            typeof value === 'number' && Number.isFinite(value) ? value : fallback;
        const step = num(caps.tempStep, 0.5) > 0 ? num(caps.tempStep, 0.5) : 0.5;
        let min;
        let max;
        if (mode === 1) {
            min = num(caps.minTempHeat, 10);
            max = num(caps.maxTempHeat, 31);
        } else if (mode === 8) {
            min = num(caps.minTempAuto, 16);
            max = num(caps.maxTempAuto, 31);
        } else if (mode === 3 || mode === 2) {
            min = num(caps.minTempCoolDry, 16);
            max = num(caps.maxTempCoolDry, 31);
        } else {
            min = Math.min(num(caps.minTempHeat, 10), num(caps.minTempCoolDry, 16), num(caps.minTempAuto, 16));
            max = Math.max(num(caps.maxTempHeat, 31), num(caps.maxTempCoolDry, 31), num(caps.maxTempAuto, 31));
        }
        return min < max ? { min, max, step } : { min: 16, max: 31, step };
    }

    /**
     * Next target temperature after a +/- click, on the step grid and inside the range.
     *
     * @param {number} current - Current target
     * @param {number} delta - +1 or -1 steps
     * @param {{min: number, max: number, step: number}} range - Allowed range
     * @returns {number}
     */
    function stepTemperature(current, delta, range) {
        const base = typeof current === 'number' && Number.isFinite(current) ? current : (range.min + range.max) / 2;
        const next = Math.round((base + delta * range.step) / range.step) * range.step;
        return Math.min(range.max, Math.max(range.min, Math.round(next * 10) / 10));
    }

    /**
     * Rotation of the dial needle: -125° (min) to +125° (max).
     *
     * @param {unknown} target - Target temperature
     * @param {{min: number, max: number}} range - Range
     * @returns {number}
     */
    function needleAngle(target, range) {
        const value = typeof target === 'number' && Number.isFinite(target) ? target : (range.min + range.max) / 2;
        const pct = Math.min(1, Math.max(0, (value - range.min) / (range.max - range.min)));
        return -125 + pct * 250;
    }

    /**
     * Temperature for display, e.g. "21,5°" (de) or "21.5°" (en).
     *
     * @param {'de'|'en'} lang - Language
     * @param {unknown} value - Temperature
     * @returns {string}
     */
    function formatTemperature(lang, value) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return '–°';
        }
        const text = String(Math.round(value * 10) / 10);
        return `${lang === 'de' ? text.replace('.', ',') : text}°`;
    }

    /**
     * Timer wheel value, e.g. "1 Std 30 Min".
     *
     * @param {'de'|'en'} lang - Language
     * @param {number} minutes - Selected minutes
     * @returns {string}
     */
    function formatMinutes(lang, minutes) {
        const mins = Math.max(0, Math.round(minutes));
        if (mins <= 0) {
            return t(lang, 'off');
        }
        if (mins < 60) {
            return `${mins} ${t(lang, 'min')}`;
        }
        const h = Math.floor(mins / 60);
        const r = mins % 60;
        return r === 0 ? `${h} ${t(lang, 'hours')}` : `${h} ${t(lang, 'hours')} ${r} ${t(lang, 'min')}`;
    }

    /**
     * Countdown "m:ss" or "h:mm:ss".
     *
     * @param {number} ms - Remaining time
     * @returns {string}
     */
    function formatCountdown(ms) {
        const total = Math.max(0, Math.round(ms / 1000));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        const s = total % 60;
        const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
        return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    /**
     * Angle of a point around a centre: 0° = 12 o'clock, clockwise positive (like CSS rotate).
     *
     * @param {number} cx - Centre x
     * @param {number} cy - Centre y
     * @param {number} x - Point x
     * @param {number} y - Point y
     * @returns {number}
     */
    function angleDeg(cx, cy, x, y) {
        return (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
    }

    const TIMER_MAX_MIN = 360;

    /**
     * Wheel rotation applied to the selected minutes (one turn = 60 min, 0...360).
     *
     * @param {number} minutes - Current selection
     * @param {number} lastAngle - Previous pointer angle
     * @param {number} angle - Current pointer angle
     * @returns {number}
     */
    function rotateTimer(minutes, lastAngle, angle) {
        let delta = angle - lastAngle;
        if (delta > 180) {
            delta -= 360;
        }
        if (delta < -180) {
            delta += 360;
        }
        return Math.min(TIMER_MAX_MIN, Math.max(0, minutes + delta / 6));
    }

    /**
     * Minutes sent when the wheel is confirmed: the whole minutes the wheel shows.
     *
     * @param {number} minutes - Wheel selection
     * @returns {number}
     */
    function confirmedTimerMinutes(minutes) {
        return Math.min(TIMER_MAX_MIN, Math.max(0, Math.round(minutes)));
    }

    /**
     * Status line of a card.
     *
     * @param {{online: unknown, power: unknown}} values - Current values
     * @returns {'running'|'ready'|'unreachable'}
     */
    function statusKey(values) {
        if (values.online === false) {
            return 'unreachable';
        }
        return values.power === true ? 'running' : 'ready';
    }

    /**
     * Running multi-split units of one building whose modes need opposite operation of the shared
     * outdoor unit (heat against cool/dry). The outdoor unit serves only one side, the other unit stands still.
     *
     * @param {Array<{id: string, multiSplit: unknown, building: unknown, power: unknown, mode: unknown}>} units - Unit values
     * @returns {Set<string>} Ids of the units in conflict
     */
    function modeConflicts(units) {
        const side = (/** @type {unknown} */ mode) => (mode === 1 ? 'heat' : mode === 3 || mode === 2 ? 'cool' : null);
        const active = units.filter(unit => unit.multiSplit === true && unit.power === true && side(unit.mode));
        const ids = new Set();
        for (const a of active) {
            for (const b of active) {
                if (a.building === b.building && side(a.mode) !== side(b.mode)) {
                    ids.add(a.id);
                }
            }
        }
        return ids;
    }

    /**
     * Delays a call until no new call came for `ms` (one timer per key).
     *
     * @param {number} ms - Quiet time
     * @param {{setTimeout: (fn: () => void, ms: number) => unknown, clearTimeout: (handle: unknown) => void}} [timers] - Timer functions (tests)
     */
    function createDebouncer(ms, timers) {
        const set = timers ? timers.setTimeout : setTimeout;
        const clear = timers ? timers.clearTimeout : clearTimeout;
        const pending = new Map();
        return {
            /**
             * @param {string} key - Debounce key
             * @param {() => void} fn - Call to run later
             */
            run(key, fn) {
                if (pending.has(key)) {
                    clear(pending.get(key));
                }
                pending.set(
                    key,
                    set(() => {
                        pending.delete(key);
                        fn();
                    }, ms),
                );
            },
            /** @param {string} key - Debounce key */
            isPending(key) {
                return pending.has(key);
            },
        };
    }

    /**
     * Unit ids below `<namespace>.devices.` from object ids, sorted.
     *
     * @param {string[]} ids - Object ids of type device
     * @param {string} namespace - e.g. melcloudhome.0
     * @returns {string[]}
     */
    function unitIdsOf(ids, namespace) {
        const prefix = `${namespace}.devices.`;
        return ids
            .filter(id => id.startsWith(prefix) && !id.slice(prefix.length).includes('.'))
            .map(id => id.slice(prefix.length))
            .sort();
    }

    /**
     * Instance number from the page URL (?instance=1), default 0.
     *
     * @param {string} search - location.search
     * @returns {number}
     */
    function instanceFromSearch(search) {
        const match = /[?&]instance=(\d{1,3})(?:&|$)/.exec(search || '');
        return match ? Number(match[1]) : 0;
    }

    return {
        TEXTS,
        MODES,
        MODE_ICONS,
        ROOM_ICONS,
        TIMER_MAX_MIN,
        pickLanguage,
        t,
        roomIconSvg,
        positionIconSvg,
        vaneIconSvg,
        vaneLabel,
        codesOf,
        temperatureRange,
        stepTemperature,
        needleAngle,
        formatTemperature,
        formatMinutes,
        formatCountdown,
        angleDeg,
        rotateTimer,
        confirmedTimerMinutes,
        statusKey,
        modeConflicts,
        createDebouncer,
        unitIdsOf,
        instanceFromSearch,
    };
});
