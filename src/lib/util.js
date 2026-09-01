import GLib from 'gi://GLib';

export const CLASS_OK = 'tw-ok';
export const CLASS_WARN = 'tw-warn';
export const CLASS_CRIT = 'tw-crit';

export function pctClass(pct) {
    if (pct === null || pct === undefined || isNaN(pct))
        return CLASS_OK;
    if (pct >= 90)
        return CLASS_CRIT;
    if (pct >= 70)
        return CLASS_WARN;
    return CLASS_OK;
}

function toDateTime(value) {
    if (value === null || value === undefined)
        return null;
    if (value instanceof GLib.DateTime)
        return value;
    if (typeof value === 'number')
        return GLib.DateTime.new_from_unix_utc(Math.floor(value));
    if (typeof value === 'string') {
        try {
            return GLib.DateTime.new_from_iso8601(value, GLib.TimeZone.new_utc());
        } catch {
            return null;
        }
    }
    return null;
}

export function formatCountdown(value, now = GLib.DateTime.new_now_utc()) {
    const dt = toDateTime(value);
    if (!dt)
        return null;
    let secs = Math.floor(dt.difference(now) / GLib.USEC_PER_SEC);
    if (secs <= 0)
        return null;
    const days = Math.floor(secs / 86400);
    secs %= 86400;
    const hours = Math.floor(secs / 3600);
    secs %= 3600;
    const minutes = Math.floor(secs / 60);
    if (days > 0)
        return `${days}d ${hours}h`;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    if (minutes > 0)
        return `${minutes}m`;
    return '<1m';
}

export function formatAgo(timestampMs, now = Date.now()) {
    if (!timestampMs)
        return null;
    const secs = Math.floor((now - timestampMs) / 1000);
    if (secs < 60)
        return 'just now';
    if (secs < 3600)
        return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
}
