import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PIN_NICKS = ['none', 'session', 'weekly', 'monthly'];
const PIN_TITLES = ['None', 'Session (5h)', 'Weekly', 'Monthly'];

export default class TokenWatchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();

        const generalGroup = new Adw.PreferencesGroup({title: _('General')});

        const intervalRow = new Adw.SpinRow({
            title: _('Refresh interval'),
            subtitle: _('How often usage data is refreshed, in seconds'),
            adjustment: new Gtk.Adjustment({
                lower: 60,
                upper: 1800,
                step_increment: 60,
                page_increment: 300,
                value: settings.get_uint('refresh-interval'),
            }),
        });
        intervalRow.connect('changed', () =>
            settings.set_uint('refresh-interval', Math.round(intervalRow.value)));
        generalGroup.add(intervalRow);

        const positionRow = new Adw.ComboRow({title: _('Panel position')});
        const positionModel = new Gtk.StringList();
        for (const title of [_('Left'), _('Center'), _('Right')])
            positionModel.append(title);
        positionRow.model = positionModel;
        positionRow.selected = settings.get_enum('panel-position');
        positionRow.connect('notify::selected', () =>
            settings.set_enum('panel-position', positionRow.selected));
        generalGroup.add(positionRow);

        page.add(generalGroup);

        const providerGroup = new Adw.PreferencesGroup({
            title: _('Providers'),
            description: _('Sign in from each provider CLI; TokenWatch picks up the login automatically.'),
        });
        this._addProvider(providerGroup, settings, {
            showKey: 'show-opencode',
            pinKey: 'pin-opencode',
            label: _('OpenCode'),
            hasMonthly: true,
        });
        this._addProvider(providerGroup, settings, {
            showKey: 'show-claude',
            pinKey: 'pin-claude',
            label: _('Claude'),
            hasMonthly: false,
        });
        this._addProvider(providerGroup, settings, {
            showKey: 'show-codex',
            pinKey: 'pin-codex',
            label: _('Codex'),
            hasMonthly: false,
        });
        page.add(providerGroup);

        window.add(page);
    }

    _addProvider(group, settings, {showKey, pinKey, label, hasMonthly}) {
        const showRow = new Adw.SwitchRow({title: label});
        showRow.active = settings.get_boolean(showKey);
        showRow.connect('notify::active', () =>
            settings.set_boolean(showKey, showRow.active));
        group.add(showRow);

        const nickOptions = PIN_NICKS
            .map((nick, index) => ({nick, title: _(PIN_TITLES[index])}))
            .filter(option => hasMonthly || option.nick !== 'monthly');

        const pinRow = new Adw.ComboRow({
            title: _('Pinned panel metric'),
            subtitle: _('Metric shown next to the panel icon'),
        });
        const pinModel = new Gtk.StringList();
        for (const option of nickOptions)
            pinModel.append(option.title);
        pinRow.model = pinModel;
        const currentNick = PIN_NICKS[settings.get_enum(pinKey)];
        pinRow.selected = Math.max(0, nickOptions.findIndex(o => o.nick === currentNick));
        pinRow.connect('notify::selected', () =>
            settings.set_enum(pinKey, PIN_NICKS.indexOf(nickOptions[pinRow.selected].nick)));
        group.add(pinRow);
    }
}
