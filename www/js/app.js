/*
 * MELCloud Home dashboard - DOM and socket part.
 *
 * Data comes from the socket interface of the web adapter (same origin): all states below
 * melcloudhome.<instance>.devices are loaded once and then subscribed. Commands are plain
 * setState calls with ack=false - the adapter debounces, sends and confirms them.
 *
 * Security: strings from the cloud (room names) only reach the page via textContent.
 * innerHTML is used for constant markup (icons, card skeleton) only.
 */
(function () {
    'use strict';

    const C = window.MelDashCore;
    const instance = C.instanceFromSearch(window.location.search);
    const namespace = `melcloudhome.${instance}`;
    const prefix = `${namespace}.devices.`;
    const STEP_DEBOUNCE_MS = 600;

    let lang = C.pickLanguage((navigator.language || '').slice(0, 2));
    let socket = null;
    /** full state id -> value */
    const values = new Map();
    /** full object id -> common */
    const commons = new Map();
    /** unit id -> card context */
    const cards = new Map();
    /** unit id -> target temperature waiting for the debounce */
    const pendingTarget = new Map();
    const debouncer = C.createDebouncer(STEP_DEBOUNCE_MS);

    const $ = id => document.getElementById(id);

    // ------------------------------------------------------------ socket helpers

    function call(command, ...args) {
        return new Promise((resolve, reject) => {
            socket.emit(command, ...args, (error, result) => {
                if (error) {
                    reject(new Error(String(error)));
                } else {
                    resolve(result);
                }
            });
        });
    }

    function value(unitId, relative) {
        return values.get(`${prefix}${unitId}.${relative}`);
    }

    function common(unitId, relative) {
        return commons.get(`${prefix}${unitId}.${relative}`) || {};
    }

    function setValue(unitId, relative, val) {
        const id = `${prefix}${unitId}.${relative}`;
        values.set(id, val);
        updateCard(unitId);
        socket.emit('setState', id, { val, ack: false }, error => {
            if (error) {
                console.warn(`Setting ${relative} failed: ${error}`);
                refreshUnit(unitId);
            }
        });
    }

    function refreshUnit(unitId) {
        call('getStates', `${prefix}${unitId}.*`)
            .then(states => {
                for (const [id, state] of Object.entries(states || {})) {
                    values.set(id, state ? state.val : null);
                }
                updateCard(unitId);
            })
            .catch(() => undefined);
    }

    function showBanner(key) {
        const banner = $('banner');
        banner.textContent = key ? C.t(lang, key) : '';
        banner.classList.toggle('show', !!key);
    }

    // ------------------------------------------------------------ loading

    async function load() {
        showBanner(null);
        try {
            const config = await call('getObject', 'system.config').catch(() => null);
            if (config && config.common && config.common.language) {
                lang = C.pickLanguage(config.common.language);
            }
            document.documentElement.lang = lang;
            document.title = `${C.t(lang, 'title')} – MELCloud Home`;

            const range = { startkey: prefix, endkey: `${prefix}香` };
            const [devices, stateObjects, states] = await Promise.all([
                call('getObjectView', 'system', 'device', range),
                call('getObjectView', 'system', 'state', range),
                call('getStates', `${prefix}*`),
            ]);
            commons.clear();
            const deviceNames = new Map();
            for (const row of (devices && devices.rows) || []) {
                if (row && row.value) {
                    deviceNames.set(row.id, row.value.common ? row.value.common.name : '');
                }
            }
            for (const row of (stateObjects && stateObjects.rows) || []) {
                if (row && row.value && row.value.common) {
                    commons.set(row.id, row.value.common);
                }
            }
            for (const [id, state] of Object.entries(states || {})) {
                values.set(id, state ? state.val : null);
            }
            buildCards(C.unitIdsOf([...deviceNames.keys()], namespace), deviceNames);
            socket.emit('subscribe', `${prefix}*`);
        } catch (error) {
            console.warn(`Loading failed: ${error.message}`);
            showBanner('disconnected');
        }
    }

    function onStateChange(id, state) {
        if (typeof id !== 'string' || !id.startsWith(prefix)) {
            return;
        }
        values.set(id, state ? state.val : null);
        const unitId = id.slice(prefix.length).split('.')[0];
        if (cards.has(unitId)) {
            updateCard(unitId);
        }
    }

    // ------------------------------------------------------------ cards

    function textName(name) {
        if (typeof name === 'string') {
            return name;
        }
        if (name && typeof name === 'object') {
            return name[lang] || name.en || '';
        }
        return '';
    }

    function buildCards(unitIds, deviceNames) {
        const container = $('cards');
        container.textContent = '';
        cards.clear();
        container.className = `cards${unitIds.length === 1 ? ' count-1' : ''}${unitIds.length > 2 ? ' many' : ''}`;
        document.documentElement.classList.toggle('scroll', unitIds.length > 2);
        const empty = $('empty');
        empty.textContent = C.t(lang, 'noDevices');
        empty.classList.toggle('show', unitIds.length === 0);

        unitIds.forEach((unitId, index) => {
            const element = createCard();
            container.appendChild(element);
            const ctx = {
                unitId,
                index,
                element,
                fallbackName: textName(deviceNames.get(`${prefix}${unitId}`)),
                q: selector => element.querySelector(selector),
                timerMinutes: 0,
            };
            cards.set(unitId, ctx);
            setupCard(ctx);
            updateCard(unitId);
        });
    }

    function tick(count) {
        let out = '';
        for (let i = 0; i < count; i++) {
            out += `<div class="tw-tick" style="transform:rotate(${i * 30}deg)"></div>`;
        }
        return out;
    }

    /** Card skeleton - constant markup only, texts and data are filled in afterwards */
    function createCard() {
        const element = document.createElement('div');
        element.className = 'card';
        element.innerHTML = `
    <div class="card-head">
      <div>
        <div class="name"><span class="room-icon"></span><span class="room-name"></span></div>
        <div class="status"><span class="dot"></span><span class="status-text">–</span>
          <span class="err-badge"></span>
        </div>
      </div>
      <div class="head-actions">
        <div class="power-toggle" role="switch" tabindex="0"><div class="knob"></div></div>
        <div class="timer-btn" role="button" tabindex="0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>
        </div>
        <div class="countdown-badge" role="button" tabindex="0">–:–</div>
      </div>
    </div>
    <div class="dial-row">
      <div class="dial">
        <div class="needle" style="transform:rotate(0deg)"></div>
        <div class="hub">
          <div class="target-temp">–°</div>
          <div class="target-label"></div>
        </div>
      </div>
      <div class="temp-steppers">
        <div class="step-btn" data-delta="1" role="button" tabindex="0">+</div>
        <div class="step-btn" data-delta="-1" role="button" tabindex="0">–</div>
      </div>
      <div class="room-temp">
        <div class="val">–°</div>
        <div class="lbl"></div>
      </div>
    </div>
    <div class="modes"></div>
    <div class="subrow row-fan"><span class="lbl"></span><div class="fan-dots"></div></div>
    <div class="subrow row-vane-h"><span class="lbl"></span><div class="vane-icons"></div></div>
    <div class="subrow row-vane-v"><span class="lbl"></span><div class="vane-icons"></div></div>
    <div class="timer-overlay">
      <div class="timer-close" role="button" tabindex="0">✕</div>
      <div class="timer-wheel">
        <div class="tw-ticks">${tick(12)}</div>
        <div class="tw-needle"></div>
        <div class="tw-hub" role="button" tabindex="0">
          <div class="tw-value"></div>
          <div class="tw-ok">OK</div>
        </div>
      </div>
      <div class="timer-hint"></div>
    </div>`;
        return element;
    }

    function onActivate(element, handler) {
        element.addEventListener('click', handler);
        element.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handler(event);
            }
        });
    }

    function setupCard(ctx) {
        const { q, unitId } = ctx;
        q('.target-label').textContent = C.t(lang, 'target');
        q('.room-temp .lbl').textContent = C.t(lang, 'room');
        q('.err-badge').textContent = C.t(lang, 'error');
        q('.row-fan .lbl').textContent = C.t(lang, 'fan');
        q('.row-vane-h .lbl').textContent = C.t(lang, 'vaneH');
        q('.row-vane-v .lbl').textContent = C.t(lang, 'vaneV');
        q('.timer-hint').textContent = C.t(lang, 'timerHint');
        q('.power-toggle').title = C.t(lang, 'power');
        q('.timer-btn').title = C.t(lang, 'timer');
        q('.countdown-badge').title = C.t(lang, 'timerCancel');
        q('.timer-close').title = C.t(lang, 'close');

        // modes
        const modes = q('.modes');
        for (const mode of C.MODES) {
            const button = document.createElement('div');
            button.className = `mode-btn ${mode.cls}`;
            button.dataset.code = String(mode.code);
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
            button.innerHTML = C.MODE_ICONS[mode.icon];
            const label = document.createElement('span');
            label.textContent = C.t(lang, `mode${mode.code}`);
            button.appendChild(label);
            onActivate(button, () => setValue(unitId, 'control.mode', mode.code));
            modes.appendChild(button);
        }

        // fan speeds from common.states of control.fanSpeed
        const fanDots = q('.fan-dots');
        const fanCodes = C.codesOf(common(unitId, 'control.fanSpeed').states);
        for (const code of fanCodes.length ? fanCodes : [0, 1, 2, 3, 4, 5]) {
            const dot = document.createElement('div');
            dot.className = code === 0 ? 'fan-dot auto' : 'fan-dot';
            dot.dataset.code = String(code);
            dot.setAttribute('role', 'button');
            dot.tabIndex = 0;
            dot.title = code === 0 ? C.t(lang, 'auto') : String(code);
            if (code === 0) {
                dot.textContent = 'A';
            }
            onActivate(dot, () => setValue(unitId, 'control.fanSpeed', code));
            fanDots.appendChild(dot);
        }

        // vanes from common.states of the control states
        for (const axis of ['h', 'v']) {
            const relative = axis === 'h' ? 'control.vaneHorizontalDirection' : 'control.vaneVerticalDirection';
            const box = q(`.row-vane-${axis} .vane-icons`);
            for (const code of C.codesOf(common(unitId, relative).states)) {
                const button = document.createElement('div');
                button.className = 'vane-btn';
                button.dataset.code = String(code);
                button.setAttribute('role', 'button');
                button.tabIndex = 0;
                button.title = C.vaneLabel(lang, axis, code);
                button.innerHTML = C.vaneIconSvg(axis, code);
                onActivate(button, () => setValue(unitId, relative, code));
                box.appendChild(button);
            }
        }

        onActivate(q('.power-toggle'), () =>
            setValue(unitId, 'control.power', value(unitId, 'control.power') !== true),
        );

        for (const button of ctx.element.querySelectorAll('.step-btn')) {
            onActivate(button, () => {
                const range = rangeOf(unitId);
                const current = pendingTarget.has(unitId)
                    ? pendingTarget.get(unitId)
                    : value(unitId, 'control.targetTemp');
                const next = C.stepTemperature(current, Number(button.dataset.delta), range);
                pendingTarget.set(unitId, next);
                updateCard(unitId);
                debouncer.run(unitId, () => {
                    const target = pendingTarget.get(unitId);
                    pendingTarget.delete(unitId);
                    if (typeof target === 'number') {
                        setValue(unitId, 'control.targetTemp', target);
                    }
                });
            });
        }

        setupTimer(ctx);
    }

    function setupTimer(ctx) {
        const { q, unitId } = ctx;
        const overlay = q('.timer-overlay');
        const wheel = q('.timer-wheel');
        const hub = q('.tw-hub');

        const renderWheel = () => {
            q('.tw-needle').style.transform = `rotate(${(ctx.timerMinutes % 60) * 6}deg)`;
            q('.tw-value').textContent = C.formatMinutes(lang, ctx.timerMinutes);
        };

        onActivate(q('.timer-btn'), () => {
            ctx.timerMinutes = 0;
            renderWheel();
            overlay.classList.add('show');
        });
        onActivate(q('.timer-close'), () => overlay.classList.remove('show'));
        onActivate(q('.countdown-badge'), () => setValue(unitId, 'control.offTimer', 0));

        let dragging = false;
        let lastAngle = 0;
        const angleOf = event => {
            const r = wheel.getBoundingClientRect();
            return C.angleDeg(r.left + r.width / 2, r.top + r.height / 2, event.clientX, event.clientY);
        };
        wheel.addEventListener('pointerdown', event => {
            if (hub.contains(event.target)) {
                return;
            }
            dragging = true;
            wheel.setPointerCapture(event.pointerId);
            lastAngle = angleOf(event);
        });
        wheel.addEventListener('pointermove', event => {
            if (!dragging) {
                return;
            }
            const angle = angleOf(event);
            ctx.timerMinutes = C.rotateTimer(ctx.timerMinutes, lastAngle, angle);
            lastAngle = angle;
            renderWheel();
        });
        const endDrag = () => {
            dragging = false;
        };
        wheel.addEventListener('pointerup', endDrag);
        wheel.addEventListener('pointercancel', endDrag);

        onActivate(hub, () => {
            const minutes = C.confirmedTimerMinutes(ctx.timerMinutes);
            overlay.classList.remove('show');
            if (minutes > 0) {
                if (value(unitId, 'control.power') !== true) {
                    setValue(unitId, 'control.power', true);
                }
                setValue(unitId, 'control.offTimer', minutes);
            }
        });
    }

    function capabilities(unitId) {
        const caps = {};
        for (const key of [
            'minTempHeat',
            'maxTempHeat',
            'minTempCoolDry',
            'maxTempCoolDry',
            'minTempAuto',
            'maxTempAuto',
            'tempStep',
        ]) {
            caps[key] = value(unitId, `capabilities.${key}`);
        }
        return caps;
    }

    function rangeOf(unitId) {
        return C.temperatureRange(capabilities(unitId), value(unitId, 'control.mode'));
    }

    function toggleActive(elements, current) {
        for (const element of elements) {
            element.classList.toggle('active', Number(element.dataset.code) === current);
        }
    }

    function updateCard(unitId) {
        const ctx = cards.get(unitId);
        if (!ctx) {
            return;
        }
        const { q, element } = ctx;
        const power = value(unitId, 'control.power') === true;
        const online = value(unitId, 'info.deviceOnline');
        const name = value(unitId, 'info.name');

        q('.room-icon').innerHTML = C.roomIconSvg(value(unitId, 'info.icon'), ctx.index);
        q('.room-name').textContent = typeof name === 'string' && name ? name : ctx.fallbackName;
        q('.power-toggle').classList.toggle('on', power);
        q('.power-toggle').setAttribute('aria-checked', String(power));
        q('.dot').classList.toggle('off', online === false);
        q('.err-badge').classList.toggle('show', value(unitId, 'info.hasError') === true);
        element.classList.toggle('offline', online === false);

        const range = rangeOf(unitId);
        const target = pendingTarget.has(unitId) ? pendingTarget.get(unitId) : value(unitId, 'control.targetTemp');
        q('.target-temp').textContent = C.formatTemperature(lang, target);
        q('.room-temp .val').textContent = C.formatTemperature(lang, value(unitId, 'info.roomTemp'));
        q('.dial .needle').style.transform = `rotate(${C.needleAngle(target, range)}deg)`;

        const allowedModes = C.codesOf(common(unitId, 'control.mode').states);
        for (const button of element.querySelectorAll('.mode-btn')) {
            button.classList.toggle(
                'disabled',
                allowedModes.length > 0 && !allowedModes.includes(Number(button.dataset.code)),
            );
        }
        toggleActive(element.querySelectorAll('.mode-btn'), value(unitId, 'control.mode'));
        toggleActive(element.querySelectorAll('.fan-dot'), value(unitId, 'control.fanSpeed'));
        toggleActive(q('.row-vane-h').querySelectorAll('.vane-btn'), value(unitId, 'control.vaneHorizontalDirection'));
        toggleActive(q('.row-vane-v').querySelectorAll('.vane-btn'), value(unitId, 'control.vaneVerticalDirection'));

        // rows of functions the unit lacks stay empty, so all cards keep the same height
        q('.row-vane-h').classList.toggle('row-hidden', value(unitId, 'capabilities.supportsWideVane') !== true);
        q('.row-vane-v').classList.toggle('row-hidden', value(unitId, 'capabilities.hasAirDirection') === false);

        updateCountdown(ctx);
    }

    function updateCountdown(ctx) {
        const end = value(ctx.unitId, 'control.offTimerEnd');
        const remaining = typeof end === 'number' && end > 0 ? end - Date.now() : 0;
        const badge = ctx.q('.countdown-badge');
        const running = remaining > 0;
        badge.style.display = running ? 'inline-block' : 'none';
        ctx.q('.timer-btn').style.display = running ? 'none' : 'flex';
        const countdown = C.formatCountdown(remaining);
        if (running) {
            badge.textContent = countdown;
        }
        const status = C.t(
            lang,
            C.statusKey({
                online: value(ctx.unitId, 'info.deviceOnline'),
                power: value(ctx.unitId, 'control.power') === true,
            }),
        );
        ctx.q('.status-text').textContent = running ? `${status} · ${C.t(lang, 'offIn')} ${countdown}` : status;
    }

    // ------------------------------------------------------------ start

    function start() {
        if (!window.io || typeof window.io.connect !== 'function') {
            showBanner('noSocket');
            return;
        }
        socket = window.io.connect('/', { name: 'melcloudhome-dashboard' });
        socket.on('connect', load);
        socket.on('reconnect', load);
        socket.on('disconnect', () => showBanner('disconnected'));
        socket.on('stateChange', onStateChange);
        setInterval(() => cards.forEach(updateCountdown), 1000);
    }

    start();
})();
