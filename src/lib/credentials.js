import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

function readJsonFile(path) {
    try {
        const file = Gio.File.new_for_path(path);
        const [ok, bytes] = file.load_contents(null);
        if (!ok)
            return null;
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return null;
    }
}

function firstString(obj, keys) {
    for (const key of keys) {
        const value = obj?.[key];
        if (typeof value === 'string' && value.length > 0)
            return value;
    }
    return null;
}

export function getCredential(providerKey) {
    switch (providerKey) {
    case 'opencode':
        return getOpenCode();
    case 'claude':
        return getClaude();
    case 'codex':
        return getCodex();
    default:
        return {error: 'not-logged-in'};
    }
}

function getOpenCode() {
    const dataDir = GLib.getenv('OPENCODE_DATA_DIR') ??
        GLib.getenv('XDG_DATA_HOME') ??
        GLib.build_filenamev([GLib.get_home_dir(), '.local', 'share']);
    const base = GLib.getenv('OPENCODE_DATA_DIR') ?? GLib.build_filenamev([dataDir, 'opencode']);
    const data = readJsonFile(GLib.build_filenamev([base, 'auth.json']));
    if (!data || typeof data !== 'object')
        return {error: 'not-logged-in'};
    const entry = data['opencode-go'];
    if (!entry || typeof entry !== 'object')
        return {error: 'not-logged-in'};
    const key = firstString(entry, ['key', 'api_key', 'apiKey', 'token']);
    if (!key)
        return {error: 'not-logged-in'};
    return {key};
}

function getClaude() {
    const base = GLib.getenv('CLAUDE_CONFIG_DIR') ??
        GLib.build_filenamev([GLib.get_home_dir(), '.claude']);
    const data = readJsonFile(GLib.build_filenamev([base, '.credentials.json']));
    if (!data || typeof data !== 'object')
        return {error: 'not-logged-in'};
    const oauth = data.claudeAiOauth;
    if (!oauth || typeof oauth !== 'object')
        return {error: 'not-logged-in'};
    const token = firstString(oauth, ['accessToken', 'access_token']);
    if (!token)
        return {error: 'not-logged-in'};
    const scopes = Array.isArray(oauth.scopes) ? oauth.scopes : [];
    return {
        token,
        hasProfileScope: scopes.includes('user:profile'),
        expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
    };
}

function getCodex() {
    // CODEX_HOME can be set in a shell but not inherited by GNOME Shell. Try
    // the explicit location first, then the CLI's default location and the
    // XDG config location used by older installations.
    const candidates = [];
    const codexHome = GLib.getenv('CODEX_HOME');
    if (codexHome)
        candidates.push(GLib.build_filenamev([codexHome, 'auth.json']));
    candidates.push(GLib.build_filenamev([GLib.get_home_dir(), '.codex', 'auth.json']));
    const configHome = GLib.getenv('XDG_CONFIG_HOME');
    if (configHome)
        candidates.push(GLib.build_filenamev([configHome, 'codex', 'auth.json']));

    const data = candidates.map(readJsonFile).find(value => {
        if (!value || typeof value !== 'object')
            return false;
        return Boolean(firstString(value.tokens ?? {}, ['access_token', 'accessToken']) ??
            firstString(value, ['access_token', 'accessToken', 'OPENAI_API_KEY']));
    });
    if (!data || typeof data !== 'object')
        return {error: 'not-logged-in'};
    const token = firstString(data.tokens ?? {}, ['access_token', 'accessToken']) ??
        firstString(data, ['access_token', 'accessToken']);
    if (token)
        return {
            token,
            accountId: firstString(data.tokens ?? {}, ['account_id', 'accountId']) ??
                firstString(data, ['account_id', 'accountId']),
        };
    if (firstString(data, ['OPENAI_API_KEY']))
        return {error: 'api-key-only'};
    return {error: 'not-logged-in'};
}
