// SC6 Redirect Tracker Worker — v1.8.0
// Deploy at: media.sharelink-1.workers.dev

const FIREBASE = 'https://device-scan-8898e-default-rtdb.firebaseio.com';
const PARAMS = ['yt','ig','tt','tw','sc','fb','dc','tv','sp','sl','rd','wa','tg','r'];

function getOS(ua) {
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Android/.test(ua)) { const m=ua.match(/Android ([\d.]+)/); return 'Android'+(m?' '+m[1]:''); }
  if (/iPhone/.test(ua)) { const m=ua.match(/OS ([\d_]+)/); return 'iOS'+(m?' '+m[1].replace(/_/g,'.'):''); }
  if (/iPad/.test(ua)) { const m=ua.match(/OS ([\d_]+)/); return 'iPadOS'+(m?' '+m[1].replace(/_/g,'.'):''); }
  if (/Mac/.test(ua)) return 'macOS';
  if (/CrOS/.test(ua)) return 'ChromeOS';
  if (/Linux/.test(ua)) return 'Linux';
  return '?';
}

function getBrowser(ua) {
  let m;
  if (m = ua.match(/Edg\/([\d.]+)/)) return 'Edge ' + m[1].split('.')[0];
  if (m = ua.match(/OPR\/([\d.]+)/)) return 'Opera ' + m[1].split('.')[0];
  if (m = ua.match(/SamsungBrowser\/([\d.]+)/)) return 'Samsung ' + m[1].split('.')[0];
  if (m = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/)) return 'Firefox ' + m[1].split('.')[0];
  if (m = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/)) return 'Chrome ' + m[1].split('.')[0];
  if (m = ua.match(/Version\/([\d.]+).*Safari/)) return 'Safari ' + m[1].split('.')[0];
  return '?';
}

function getDeviceType(ua) {
  if (/iPad/.test(ua)) return 'Tablet';
  if (/iPhone|Android.*Mobile|Mobile/.test(ua)) return 'Mobile';
  return 'Desktop';
}

async function writeLog(ws, linkId, entry) {
  // POST to Firebase for atomic push key — race-free
  const logUrl = `${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectLogs/${encodeURIComponent(linkId)}.json`;
  try {
    await fetch(logUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
  } catch(e) {}
}

async function writeExecLog(entry) {
  const execUrl = `${FIREBASE}/_sc6/execLog.json`;
  try {
    await fetch(execUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
  } catch(e) {}
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname !== '/r') {
      return new Response('Not found', { status: 404 });
    }

    // Find link ID or alias from param
    let linkId = null, param = null;
    for (const p of PARAMS) {
      const v = url.searchParams.get(p);
      if (v) { linkId = v; param = p; break; }
    }
    const ws = url.searchParams.get('ws') || 'void-alpha';

    if (!linkId) return new Response('Not found', { status: 404 });

    // ── Alias resolution: if linkId doesn't match a direct link, try alias lookup ──
    let resolvedId = linkId;
    try {
      const directRes = await fetch(`${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectLinks/${encodeURIComponent(linkId)}.json`);
      const directData = directRes.ok ? await directRes.json() : null;
      if (!directData || !directData.target) {
        // Not a direct ID — try alias
        const aliasRes = await fetch(`${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectAliases/${encodeURIComponent(linkId)}.json`);
        const aliasData = aliasRes.ok ? await aliasRes.json() : null;
        if (aliasData && typeof aliasData === 'string') {
          resolvedId = aliasData;
        }
      }
    } catch(e) {}

    // Fetch redirect target using resolved ID
    let target = null;
    try {
      const res = await fetch(`${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectLinks/${encodeURIComponent(resolvedId)}.json`);
      const data = res.ok ? await res.json() : null;
      target = data && data.target ? data.target : null;
    } catch(e) {}

    if (!target) return new Response('Link expired', { status: 410 });

    // Gather ALL available visitor info from Cloudflare headers
    const ip        = request.headers.get('CF-Connecting-IP') || '?';
    const country   = request.headers.get('CF-IPCountry') || '?';
    const city      = request.headers.get('CF-IPCity') || '?';
    const region    = request.headers.get('CF-IPRegion') || '?';
    const timezone  = request.headers.get('CF-Timezone') || '?';
    const asn       = request.headers.get('CF-ASN') || '?';
    const isp       = request.headers.get('CF-ISP') || request.headers.get('CF-AS-Organization') || '?';
    const ua        = request.headers.get('User-Agent') || '?';
    const lang      = (request.headers.get('Accept-Language') || '?').split(',')[0];
    const referer   = request.headers.get('Referer') || '?';

    // ── Geofencing check ──
    let geoBlocked = false;
    try {
      const geoRes = await fetch(`${FIREBASE}/_sc6/geofence/allowed.json`);
      const allowList = geoRes.ok ? await geoRes.json() : null;
      if (Array.isArray(allowList) && allowList.length > 0) {
        if (!allowList.includes(country) && country !== '?') {
          geoBlocked = true;
        }
      }
    } catch(e) {}

    if (geoBlocked) {
      // Log the blocked attempt then return expired
      const blockedEntry = {
        time: new Date().toISOString(),
        ip, country, city, region, ua,
        os: getOS(ua), browser: getBrowser(ua), device: getDeviceType(ua),
        lang, referer, linkId: resolvedId, param, geoBlocked: true
      };
      ctx.waitUntil(writeLog(ws, resolvedId, blockedEntry));
      return new Response('Link expired', { status: 410 });
    }

    const entry = {
      time: new Date().toISOString(),
      ip, country, city, region, timezone, isp, asn,
      os: getOS(ua), browser: getBrowser(ua), device: getDeviceType(ua),
      lang, referer, ua, linkId: resolvedId, param,
      originalParam: linkId !== resolvedId ? linkId : undefined
    };

    const execEntry = {
      time: entry.time,
      t: entry.time,
      action: 'Visitor hit redirect link',
      detail: 'Link: ' + resolvedId + ' → ' + target.slice(0, 50)
        + (city !== '?' ? ' | ' + city : '')
        + (country !== '?' ? ', ' + country : '')
        + (ip !== '?' ? ' | ' + ip : '')
        + (referer && referer !== '?' ? ' | ref: ' + referer.slice(0, 40) : '')
        + ' WS:' + ws,
      who: 'visitor',
      tag: '?',
      ip, country, city, region,
      os: entry.os, browser: entry.browser, device: entry.device,
      br: entry.browser
    };

    ctx.waitUntil(Promise.all([
      writeLog(ws, resolvedId, entry),
      writeExecLog(execEntry)
    ]));

    return Response.redirect(target, 302);
  }
};
