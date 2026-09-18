import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const USER_AGENT = 'TokenWatch/1.0 (+https://github.com/EfeDogan/tokenwatch)';

export class ProviderError extends Error {
    constructor(code, detail = null) {
        super(detail ?? code);
        this.name = 'ProviderError';
        this.code = code;
        this.detail = detail;
    }
}

export function createSession() {
    return new Soup.Session({
        'user-agent': USER_AGENT,
        timeout: 20,
        'idle-timeout': 30,
    });
}

async function fetchJson(session, url, headers, cancellable) {
    const msg = Soup.Message.new('GET', url);
    for (const [name, value] of Object.entries(headers ?? {}))
        msg.get_request_headers().append(name, value);
    const bytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
    const body = new TextDecoder().decode(bytes.get_data());
    let json = null;
    try {
        json = JSON.parse(body);
    } catch {
        json = null;
    }
    return {status: msg.status_code, json};
}

function rejectHttp(status) {
    if (status === 401 || status === 403)
        throw new ProviderError('invalid-key', `HTTP ${status}`);
    throw new ProviderError('http', `HTTP ${status}`);
}

function clampPercent(value) {
    if (typeof value !== 'number' || !isFinite(value))
        return null;
    return Math.max(0, Math.min(100, Math.round(value)));
}

function fromFraction(value) {
    if (typeof value !== 'number' || !isFinite(value) || value < 0)
        return null;
    return clampPercent(value <= 1 ? value * 100 : value);
}

export async function fetchUsage(session, providerKey, credential, cancellable) {
    switch (providerKey) {
    case 'opencode':
        return fetchOpenCode(session, credential.key, cancellable);
    case 'claude':
        return fetchClaude(session, credential.token, cancellable);
    case 'codex':
        return fetchCodex(session, credential, cancellable);
    default:
        throw new ProviderError('not-logged-in');
    }
}

async function fetchOpenCode(session, key, cancellable) {
    const {status, json} = await fetchJson(session,
        'https://opencode.ai/zen/go/v1/usage', {Authorization: `Bearer ${key}`}, cancellable);
    if (status !== 200)
        rejectHttp(status);
    const usage = json?.usage ?? {};
    const metrics = {};
    const windows = [['rolling', 'session'], ['weekly', 'weekly'], ['monthly', 'monthly']];
    for (const [windowKey, metricKey] of windows) {
        const window = usage[windowKey];
        if (!window || typeof window !== 'object')
            continue;
        metrics[metricKey] = {
            pct: clampPercent(window.percent),
            resetsAt: window.resetsAt ?? null,
        };
    }
    return metrics;
}

async function fetchClaude(session, token, cancellable) {
    const {status, json} = await fetchJson(session,
        'https://api.anthropic.com/api/oauth/usage',
        {Authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20'},
        cancellable);
    if (status !== 200)
        rejectHttp(status);
    const metrics = {};
    const windows = [['five_hour', 'session'], ['seven_day', 'weekly']];
    for (const [windowKey, metricKey] of windows) {
        const window = json?.[windowKey];
        if (!window || typeof window !== 'object')
            continue;
        const pct = window.utilization !== undefined
            ? fromFraction(window.utilization)
            : clampPercent(window.percent);
        metrics[metricKey] = {
            pct,
            resetsAt: window.resets_at ?? window.resetsAt ?? null,
        };
    }
    return metrics;
}

async function fetchCodex(session, credential, cancellable) {
    const headers = {Authorization: `Bearer ${credential.token}`};
    if (credential.accountId)
        headers['ChatGPT-Account-Id'] = credential.accountId;
    const {status, json} = await fetchJson(session,
        'https://chatgpt.com/backend-api/wham/usage',
        headers, cancellable);
    if (status !== 200)
        rejectHttp(status);
    // The Codex API currently returns `rate_limit`; keep `rate_limits` for
    // compatibility with older responses.
    const limits = json?.rate_limit ?? json?.rate_limits ?? json ?? {};
    const metrics = {};
    const windows = [limits.primary_window, limits.secondary_window];
    for (const window of windows) {
        if (!window || typeof window !== 'object')
            continue;
        const pct = clampPercent(window.used_percent ?? window.usedPercent ?? window.percent);
        const minutes = window.window_minutes ?? window.windowMinutes ??
            (typeof window.limit_window_seconds === 'number'
                ? window.limit_window_seconds / 60
                : null);
        const resetsAt = window.reset_at ?? window.resets_at ?? window.resetsAt ?? null;
        if (pct === null && resetsAt === null)
            continue;
        const metricKey = (typeof minutes === 'number' && minutes >= 10080) ? 'weekly' : 'session';
        if (metrics[metricKey])
            continue;
        metrics[metricKey] = {pct, resetsAt};
    }
    return metrics;
}
