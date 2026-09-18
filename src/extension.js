import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';
import St from 'gi://St';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Credentials from './lib/credentials.js';
import * as Providers from './lib/providers.js';
import * as Util from './lib/util.js';

const PROVIDER_DEFS = [
    {
        key: 'opencode',
        label: 'OpenCode',
        metrics: ['session', 'weekly', 'monthly'],
        showKey: 'show-opencode',
        pinKey: 'pin-opencode',
        pinLabel: 'OC',
        dashboardUrl: 'https://opencode.ai',
    },
    {
        key: 'claude',
        label: 'Claude',
        metrics: ['session', 'weekly'],
        showKey: 'show-claude',
        pinKey: 'pin-claude',
        pinLabel: 'CC',
        dashboardUrl: 'https://claude.ai/settings/usage',
    },
    {
        key: 'codex',
        label: 'Codex',
        metrics: ['session', 'weekly'],
        showKey: 'show-codex',
        pinKey: 'pin-codex',
        pinLabel: 'CX',
        dashboardUrl: 'https://chatgpt.com/codex',
    },
];

const METRIC_LABELS = {
    session: 'Session',
    weekly: 'Weekly',
    monthly: 'Monthly',
};

const STATUS_LABELS = {
    loading: 'Checking…',
    'not-logged-in': 'Not logged in',
    'invalid-key': 'Key rejected — sign in again via the CLI',
    'api-key-only': 'API key only — no plan limits',
    'inference-only': 'Limited token — sign in again with “claude”',
    http: 'Provider unreachable',
    error: 'Error',
};

function metricLabel(key) {
    return _(METRIC_LABELS[key] ?? key);
}

function statusLabel(status) {
    const fallback = STATUS_LABELS.error;
    return _(STATUS_LABELS[status] ?? fallback);
}

const POSITION_NICKS = ['left', 'center', 'right'];
const TRACK_WIDTH = 170;
const STALE_MS = 30_000;

const GaugeIcon = GObject.registerClass(
class GaugeIcon extends St.DrawingArea {
    _init(params = {}) {
        super._init({
            ...params,
            width: 18,
            height: 18,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._repaintId = St.ThemeContext.get_for_stage(global.stage).connect(
            'notify::theme', () => this.queue_repaint());
    }

    destroy() {
        if (this._repaintId) {
            try {
                St.ThemeContext.get_for_stage(global.stage).disconnect(this._repaintId);
            } catch {
                // stage already torn down
            }
            this._repaintId = 0;
        }
        super.destroy();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const themeNode = this.get_theme_node();
        const fg = themeNode.get_foreground_color();
        const rf = fg.red / 255;
        const gf = fg.green / 255;
        const bf = fg.blue / 255;

        cr.setSourceRGBA(rf, gf, bf, 1);
        cr.setLineWidth(1.6);
        cr.setLineCap(1);

        const cx = 8;
        const cy = 9;
        const radius = 5.8;
        const startAngle = 3 * Math.PI / 4;
        const endAngle = 9 * Math.PI / 4;
        cr.arc(cx, cy, radius, startAngle, endAngle);
        cr.stroke();

        const needleAngle = -Math.PI / 3;
        const needleLength = 3.4;
        cr.moveTo(cx, cy);
        cr.lineTo(cx + needleLength * Math.cos(needleAngle),
            cy + needleLength * Math.sin(needleAngle));
        cr.stroke();

        cr.arc(cx, cy, 1.5, 0, 2 * Math.PI);
        cr.fill();
    }
});

const MeterRow = GObject.registerClass(
class MeterRow extends PopupMenu.PopupBaseMenuItem {
    _init(label) {
        super._init({reactive: false, can_focus: false});
        this._nameLabel = new St.Label({
            text: label,
            style_class: 'tw-meter-name',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._nameLabel);

        this._track = new St.BoxLayout({style_class: 'tw-track'});
        this._fill = new St.Widget({style_class: 'tw-fill'});
        this._track.add_child(this._fill);
        this.add_child(this._track);

        this._valueLabel = new St.Label({
            text: '',
            style_class: 'tw-meter-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._valueLabel);
        this.visible = false;
    }

    update(metric) {
        const pct = metric?.pct ?? null;
        if (pct === null) {
            this.visible = false;
            return;
        }
        this.visible = true;
        const width = Math.max(pct > 0 ? 6 : 0, Math.round(TRACK_WIDTH * pct / 100));
        this._fill.set_style(`width: ${width}px;`);
        this._fill.remove_style_class_name(Util.CLASS_OK);
        this._fill.remove_style_class_name(Util.CLASS_WARN);
        this._fill.remove_style_class_name(Util.CLASS_CRIT);
        this._fill.add_style_class_name(Util.pctClass(pct));

        const countdown = Util.formatCountdown(metric?.resetsAt);
        this._valueLabel.text = countdown ? `${pct}% · ${countdown}` : `${pct}%`;
        this._valueLabel.set_style_class_name(`tw-meter-value ${Util.pctClass(pct)}`);
    }
});

const TokenWatchIndicator = GObject.registerClass(
class TokenWatchIndicator extends PanelMenu.Button {
    _init(ext) {
        super._init(0.0, 'TokenWatch', false);
        this._ext = ext;

        this._panelBox = new St.BoxLayout({style_class: 'tw-panel-box'});
        this._gauge = new GaugeIcon();
        this._panelBox.add_child(this._gauge);
        this._pinLabels = new Map();
        this.add_child(this._panelBox);

        this._sections = new Map();
        this._refreshItem = null;
        this._updatedLabel = null;
        this._emptyItem = null;
        this._buildMenu();

        this._menuOpenId = this.menu.connect('open-state-changed', (_, open) => {
            if (open)
                this._onMenuOpened();
        });
    }

    _buildMenu() {
        for (const def of PROVIDER_DEFS) {
            const separator = new PopupMenu.PopupSeparatorMenuItem();
            this.menu.addMenuItem(separator);

            const header = new PopupMenu.PopupMenuItem('', {reactive: false, can_focus: false});
            const headerLabel = new St.Label({
                text: def.label,
                style_class: 'tw-header',
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const statusLabel = new St.Label({
                text: '',
                style_class: 'tw-muted',
                y_align: Clutter.ActorAlign.CENTER,
            });
            header.add_child(headerLabel);
            header.add_child(statusLabel);
            this.menu.addMenuItem(header);

            const rows = new Map();
            for (const metricKey of def.metrics) {
                const row = new MeterRow(metricLabel(metricKey));
                this.menu.addMenuItem(row);
                rows.set(metricKey, row);
            }

            const dashboard = new PopupMenu.PopupMenuItem(_('Open dashboard'));
            dashboard.connect('activate', () => {
                try {
                    Gio.AppInfo.launch_default_for_uri(def.dashboardUrl, null);
                } catch (e) {
                    console.error(`TokenWatch: failed to open ${def.dashboardUrl}: ${e}`);
                }
            });
            this.menu.addMenuItem(dashboard);

            this._sections.set(def.key, {items: [separator, header, ...rows.values(), dashboard], rows, statusLabel});
        }

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._emptyItem = new PopupMenu.PopupMenuItem(
            _('No providers enabled — check TokenWatch preferences'),
            {reactive: false, can_focus: false});
        this._emptyItem.visible = false;
        this.menu.addMenuItem(this._emptyItem);

        this._refreshItem = new PopupMenu.PopupMenuItem(_('Refresh now'));
        this._refreshItem.connect('activate', () => this._ext.refreshAll());
        this._updatedLabel = new St.Label({
            text: '',
            style_class: 'tw-muted',
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._refreshItem.add_child(this._updatedLabel);
        this.menu.addMenuItem(this._refreshItem);
    }

    _onMenuOpened() {
        this.updateFooter();
        if (Date.now() - this._ext.lastRefreshAt > STALE_MS)
            this._ext.refreshAll();
    }

    updateProvider(key) {
        const section = this._sections.get(key);
        if (!section)
            return;
        const state = this._ext.state[key];
        const def = PROVIDER_DEFS.find(d => d.key === key);
        const enabled = this._ext.settings.get_boolean(def.showKey);

        for (const item of section.items)
            item.visible = enabled;
        if (!enabled)
            return;

        if (state.status === 'ok') {
            section.statusLabel.text = '';
            for (const [metricKey, row] of section.rows)
                row.update(state.metrics[metricKey] ?? null);
        } else {
            section.statusLabel.text = statusLabel(state.status);
            section.statusLabel.set_style_class_name(
                state.status === 'loading' ? 'tw-muted' : 'tw-status-warn');
            for (const row of section.rows.values())
                row.update(null);
        }
        this.updateEmptyState();
    }

    updatePanel() {
        const defs = PROVIDER_DEFS.filter(def => {
            const enabled = this._ext.settings.get_boolean(def.showKey);
            const metricIndex = this._ext.settings.get_enum(def.pinKey);
            const state = this._ext.state[def.key];
            return enabled && metricIndex > 0 && state?.status === 'ok' && state.metrics;
        });

        for (const [key, label] of this._pinLabels) {
            label.destroy();
            this._pinLabels.delete(key);
        }

        for (const def of defs) {
            const metricIndex = this._ext.settings.get_enum(def.pinKey);
            const metricNick = ['none', 'session', 'weekly', 'monthly'][metricIndex];
            const metric = this._ext.state[def.key].metrics[metricNick];
            if (!metric || metric.pct === null)
                continue;
            const label = new St.Label({
                text: `${def.pinLabel} ${metric.pct}%`,
                style_class: `tw-pct ${Util.pctClass(metric.pct)}`,
                y_align: Clutter.ActorAlign.CENTER,
                accessible_name: `${def.label} ${metricLabel(metricNick)}: ${metric.pct}%`,
            });
            this._pinLabels.set(def.key, label);
            this._panelBox.add_child(label);
        }
    }

    updateEmptyState() {
        const anyVisible = PROVIDER_DEFS.some(def =>
            this._ext.settings.get_boolean(def.showKey));
        this._emptyItem.visible = !anyVisible;
    }

    updateFooter() {
        const stamps = PROVIDER_DEFS
            .filter(def => this._ext.settings.get_boolean(def.showKey))
            .map(def => this._ext.state[def.key]?.lastUpdated)
            .filter(stamp => stamp > 0);
        const latest = stamps.length ? Math.max(...stamps) : 0;
        this._updatedLabel.text = latest ? Util.formatAgo(latest) : '';
    }

    destroy() {
        if (this._menuOpenId) {
            this.menu.disconnect(this._menuOpenId);
            this._menuOpenId = 0;
        }
        super.destroy();
    }
});

export default class TokenWatchExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._httpSession = Providers.createSession();
        this._cancellable = new Gio.Cancellable();
        this._timerId = 0;
        this._lastRefreshAt = 0;
        this._state = {};
        for (const def of PROVIDER_DEFS)
            this._state[def.key] = {status: 'loading', metrics: {}, lastUpdated: 0};

        this._loadStylesheet();

        this._addToPanel();

        this._settingIds = [
            this._settings.connect('changed::refresh-interval', () => this._armTimer()),
            this._settings.connect('changed::panel-position', () => this._addToPanel()),
            this._settings.connect('changed::show-opencode', () => this._onProvidersChanged()),
            this._settings.connect('changed::show-claude', () => this._onProvidersChanged()),
            this._settings.connect('changed::show-codex', () => this._onProvidersChanged()),
            this._settings.connect('changed::pin-opencode', () => this._indicator.updatePanel()),
            this._settings.connect('changed::pin-claude', () => this._indicator.updatePanel()),
            this._settings.connect('changed::pin-codex', () => this._indicator.updatePanel()),
        ];

        this.refreshAll();
        this._armTimer();
    }

    disable() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        for (const id of this._settingIds ?? [])
            this._settings.disconnect(id);
        this._settingIds = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._unloadStylesheet();
        this._httpSession?.abort();
        this._httpSession = null;
        this._settings = null;
        this._state = null;
    }

    get settings() {
        return this._settings;
    }

    get state() {
        return this._state;
    }

    get lastRefreshAt() {
        return this._lastRefreshAt;
    }

    _loadStylesheet() {
        try {
            const file = Gio.File.new_for_path(`${this.path}/stylesheet.css`);
            this._themeContext = St.ThemeContext.get_for_stage(global.stage);
            this._themeContext.get_theme().load_stylesheet(file);
            this._stylesheetFile = file;
        } catch (e) {
            console.error(`TokenWatch: failed to load stylesheet: ${e}`);
        }
    }

    _unloadStylesheet() {
        try {
            if (this._stylesheetFile && this._themeContext)
                this._themeContext.get_theme().unload_stylesheet(this._stylesheetFile);
        } catch (e) {
            console.error(`TokenWatch: failed to unload stylesheet: ${e}`);
        }
        this._stylesheetFile = null;
        this._themeContext = null;
    }

    _addToPanel() {
        if (this._indicator)
            this._indicator.destroy();
        this._indicator = new TokenWatchIndicator(this);
        const position = POSITION_NICKS[this._settings.get_enum('panel-position')];
        Main.panel.addToStatusArea('tokenwatch', this._indicator, 0, position);
    }

    _armTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
        const interval = Math.max(60, this._settings.get_uint('refresh-interval'));
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, interval, () => {
            this.refreshAll();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _onProvidersChanged() {
        for (const def of PROVIDER_DEFS)
            this._indicator.updateProvider(def.key);
        this._indicator.updatePanel();
        this.refreshAll();
    }

    refreshAll() {
        this._lastRefreshAt = Date.now();
        for (const def of PROVIDER_DEFS) {
            if (!this._settings.get_boolean(def.showKey))
                continue;
            this._refreshProvider(def);
        }
        this._indicator?.updateFooter();
    }

    async _refreshProvider(def) {
        const state = this._state[def.key];
        try {
            const credential = Credentials.getCredential(def.key);
            if (credential.error) {
                state.status = credential.error;
                state.metrics = {};
                return;
            }
            if (def.key === 'claude' && credential.hasProfileScope === false) {
                state.status = 'inference-only';
                state.metrics = {};
                return;
            }
            const metrics = await Providers.fetchUsage(
                this._httpSession, def.key, credential, this._cancellable);
            if (this._cancellable?.is_cancelled())
                return;
            state.metrics = metrics;
            state.status = Object.keys(metrics).length ? 'ok' : 'not-logged-in';
            state.lastUpdated = Date.now();
            console.debug(`TokenWatch: ${def.key} metrics: ${JSON.stringify(metrics)}`);
        } catch (e) {
            if (e instanceof GLib.Error &&
                e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            if (e instanceof Providers.ProviderError) {
                state.status = e.code;
                state.metrics = e.code === 'invalid-key' ? {} : state.metrics;
            } else {
                state.status = 'error';
                console.debug(`TokenWatch: ${def.key} refresh failed: ${e}`);
            }
        } finally {
            if (!this._cancellable?.is_cancelled()) {
                this._indicator?.updateProvider(def.key);
                this._indicator?.updatePanel();
                this._indicator?.updateFooter();
            }
        }
    }
}
