// SC6 Redirect Tracker Worker — v2.0.18
// Deploy at: media.sharelink-1.workers.dev

const SC6_VERSION = '2.0.18';
const FIREBASE = 'https://device-scan-8898e-default-rtdb.firebaseio.com';
const PARAMS = ['yt','ig','tt','tw','sc','fb','dc','tv','sp','sl','rd','wa','tg','r'];

// In-memory cache for vpnapi.io results — avoids burning quota on the same IP
// within a single worker instance lifetime (a few minutes at most)
const VPN_CACHE = new Map();
const VPN_CACHE_MAX = 500;

// Query vpnapi.io for VPN/proxy/tor/relay detection.
// Returns {vpn, proxy, tor, relay, source} or null on failure.
async function queryVpnApi(ip, apiKey) {
  if (!apiKey || !ip || ip === '?') return null;
  if (VPN_CACHE.has(ip)) return VPN_CACHE.get(ip);
  try {
    const r = await fetch(`https://vpnapi.io/api/${encodeURIComponent(ip)}?key=${encodeURIComponent(apiKey)}`, {
      headers: { 'User-Agent': 'SC6-Worker/1.0' },
      signal: AbortSignal.timeout(2500)  // 2.5s timeout — don't delay the visitor
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j.message) return null;  // quota exceeded or bad key
    const result = {
      vpn:   !!(j.security && j.security.vpn),
      proxy: !!(j.security && j.security.proxy),
      tor:   !!(j.security && j.security.tor),
      relay: !!(j.security && j.security.relay),
      source: 'vpnapi'
    };
    // Keep cache small
    if (VPN_CACHE.size >= VPN_CACHE_MAX) {
      VPN_CACHE.delete(VPN_CACHE.keys().next().value);
    }
    VPN_CACHE.set(ip, result);
    return result;
  } catch(e) {
    return null;
  }
}

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

// Map Android model codes → marketing names (common devices)
const ANDROID_MODELS = {
  // Samsung Galaxy S
  'SM-S928':'Samsung Galaxy S24 Ultra','SM-S926':'Samsung Galaxy S24+','SM-S921':'Samsung Galaxy S24',
  'SM-S918':'Samsung Galaxy S23 Ultra','SM-S916':'Samsung Galaxy S23+','SM-S911':'Samsung Galaxy S23',
  'SM-S908':'Samsung Galaxy S22 Ultra','SM-S906':'Samsung Galaxy S22+','SM-S901':'Samsung Galaxy S22',
  'SM-G998':'Samsung Galaxy S21 Ultra','SM-G996':'Samsung Galaxy S21+','SM-G991':'Samsung Galaxy S21',
  'SM-G988':'Samsung Galaxy S20 Ultra','SM-G986':'Samsung Galaxy S20+','SM-G981':'Samsung Galaxy S20',
  // Samsung Galaxy A
  'SM-A556':'Samsung Galaxy A55','SM-A546':'Samsung Galaxy A54','SM-A536':'Samsung Galaxy A53',
  'SM-A526':'Samsung Galaxy A52','SM-A346':'Samsung Galaxy A34','SM-A336':'Samsung Galaxy A33',
  'SM-A156':'Samsung Galaxy A15','SM-A146':'Samsung Galaxy A14','SM-A136':'Samsung Galaxy A13',
  'SM-A057':'Samsung Galaxy A05s','SM-A047':'Samsung Galaxy A04s',
  // Samsung Galaxy Z
  'SM-F956':'Samsung Galaxy Z Fold 6','SM-F731':'Samsung Galaxy Z Flip 5',
  'SM-F946':'Samsung Galaxy Z Fold 5','SM-F721':'Samsung Galaxy Z Flip 4',
  // Google Pixel
  'Pixel 9 Pro XL':'Google Pixel 9 Pro XL','Pixel 9 Pro':'Google Pixel 9 Pro','Pixel 9':'Google Pixel 9',
  'Pixel 8 Pro':'Google Pixel 8 Pro','Pixel 8a':'Google Pixel 8a','Pixel 8':'Google Pixel 8',
  'Pixel 7 Pro':'Google Pixel 7 Pro','Pixel 7a':'Google Pixel 7a','Pixel 7':'Google Pixel 7',
  'Pixel 6 Pro':'Google Pixel 6 Pro','Pixel 6a':'Google Pixel 6a','Pixel 6':'Google Pixel 6',
  // OnePlus
  'CPH2581':'OnePlus 12','CPH2423':'OnePlus 11','CPH2409':'OnePlus 10 Pro',
  'LE2125':'OnePlus 9 Pro','LE2115':'OnePlus 9',
  // Xiaomi
  '23116PN5BC':'Xiaomi 14 Ultra','2312DRAABL':'Xiaomi 14','2210132C':'Xiaomi 13 Pro','2211133C':'Xiaomi 13',
  '22071212AG':'Xiaomi 12 Pro','2201122G':'Xiaomi 12',
  'M2101K7BG':'Xiaomi Redmi Note 10 Pro','M2101K7BNY':'Xiaomi Redmi Note 10',
  '2203129G':'Xiaomi Redmi Note 12 Pro','22111317I':'Xiaomi Redmi Note 12',
  'M2010J19SG':'Xiaomi Redmi Note 9 Pro',
  // Realme
  'RMX3686':'Realme GT 5','RMX3741':'Realme 11 Pro+','RMX3561':'Realme GT Neo 3',
  // Oppo
  'CPH2525':'OPPO Find X6 Pro','CPH2219':'OPPO A74','CPH2179':'OPPO A54',
  // Huawei (UA may still appear)
  'VOG-L29':'Huawei P30 Pro','ELS-NX9':'Huawei P40 Pro','NOH-NX9':'Huawei P40',
  // Sony
  'XQ-EC54':'Sony Xperia 1 V','XQ-DQ54':'Sony Xperia 1 IV',
  // Motorola
  'XT2341':'Motorola Edge 40 Pro','XT2251':'Motorola Edge 30 Pro',
};

function getDeviceModel(ua) {
  if (!ua || ua === '?') return null;
  // iPhone / iPad — iOS doesn't expose model
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  // Android — try to extract model token
  // UA format: (Linux; Android X.Y; MODEL Build/...) or (Linux; Android X.Y; MODEL)
  const m = ua.match(/Android[\d. ]+;([^)]+)/);
  if (!m) return null;
  const raw = m[1].trim().replace(/\s+Build.*$/, '').replace(/\s+\d+$/, '').trim();
  if (!raw) return null;
  // Check full token first, then prefix (model codes like SM-S928B → SM-S928)
  if (ANDROID_MODELS[raw]) return ANDROID_MODELS[raw];
  const prefix = raw.replace(/-[A-Z0-9]{1,3}$/, ''); // strip suffix like -B, -DS, -BN
  if (ANDROID_MODELS[prefix]) return ANDROID_MODELS[prefix];
  // Check if it starts with a known prefix key (Pixel models are stored as full name)
  for (const [k, v] of Object.entries(ANDROID_MODELS)) {
    if (raw.startsWith(k) || raw.includes(k)) return v;
  }
  // Unknown model — return the raw code so it's still informative
  return raw;
}

// Keyword-based VPN/datacenter fallback — used when vpnapi.io is unavailable.
function detectVpnByKeyword(isp) {
  if (!isp || isp === '?') return false;
  const s = isp.toLowerCase();
  const vpnNames = [
    'nordvpn','expressvpn','mullvad','surfshark','protonvpn','cyberghost',
    'ipvanish','hidemyass','purevpn','windscribe','private internet access',
    'torguard','vyprvpn','strongvpn','tunnelbear','hotspot shield'
  ];
  if (vpnNames.some(k => s.includes(k))) return true;
  const dcKeywords = [
    'hosting','hosted','datacenter','data center','colocation','colo',
    'cloud','server','dedicated','vps','virtual private',
    'digitalocean','linode','vultr','ovh','hetzner','leaseweb','choopa',
    'psychz','quadranet','coresite','zenlayer','datacamp','datapacket',
    'm247','heficed','tzulo','sharktech','frantech','buyvm','terrahost',
    'amazon','google llc','microsoft azure','cloudflare','fastly','akamai',
    'pvsl','incapsula','imperva','sucuri'
  ];
  if (dcKeywords.some(k => s.includes(k))) return true;
  if (/\b(vpn|proxy|tor|relay|tunnel|exit node|anon)\b/.test(s)) return true;
  return false;
}

// Parse referer into a human-readable source
function parseReferer(ref) {
  if (!ref || ref === '?') return null;
  try {
    const u = new URL(ref);
    const host = u.hostname.replace(/^www\./, '');
    const sources = {
      'instagram.com': 'Instagram', 't.co': 'Twitter/X', 'twitter.com': 'Twitter/X',
      'x.com': 'Twitter/X', 'facebook.com': 'Facebook', 'fb.com': 'Facebook',
      'wa.me': 'WhatsApp', 'web.whatsapp.com': 'WhatsApp', 't.me': 'Telegram',
      'discord.com': 'Discord', 'discordapp.com': 'Discord',
      'reddit.com': 'Reddit', 'tiktok.com': 'TikTok', 'youtube.com': 'YouTube',
      'youtu.be': 'YouTube', 'snapchat.com': 'Snapchat', 'linkedin.com': 'LinkedIn',
      'google.com': 'Google', 'bing.com': 'Bing', 'yahoo.com': 'Yahoo',
      'mail.google.com': 'Gmail', 'outlook.live.com': 'Outlook', 'mail.yahoo.com': 'Yahoo Mail',
      'telegram.org': 'Telegram', 'signal.org': 'Signal',
      'spotify.com': 'Spotify', 'twitch.tv': 'Twitch'
    };
    return sources[host] || host;
  } catch(e) {
    return ref.slice(0, 60);
  }
}

async function writeLog(ws, linkId, entry) {
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

    // ── Version endpoint ──
    if (url.pathname === '/version') {
      return new Response(JSON.stringify({ v: SC6_VERSION }), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        }
      });
    }

    // ── Dwell ping endpoint: POST /ping with JSON body ──
    if (url.pathname === '/ping' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { ws, linkId, logKey, dwell } = body;
        if (ws && linkId && logKey && typeof dwell === 'number') {
          // Update the specific log entry with dwell time
          const patchUrl = `${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectLogs/${encodeURIComponent(linkId)}/${encodeURIComponent(logKey)}/dwell.json`;
          ctx.waitUntil(fetch(patchUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dwell)
          }));
          // Also write a dwell exec log entry so it appears in the live stream / exec log
          if (dwell > 0) {
            const dwellStr = dwell < 60 ? dwell + 's' : Math.floor(dwell / 60) + 'm ' + (dwell % 60) + 's';
            const dwellEntry = {
              time: new Date().toISOString(),
              t: new Date().toISOString(),
              action: '⏱ Dwell time recorded',
              detail: 'Link: ' + linkId + ' | Dwell: ' + dwellStr + ' WS:' + ws,
              who: 'visitor',
              tag: '?'
            };
            ctx.waitUntil(writeExecLog(dwellEntry));
          }
        }
      } catch(e) {}
      return new Response('ok', { status: 200, headers: { 'Access-Control-Allow-Origin': '*' } });
    }

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

    // ── Alias resolution ──
    let resolvedId = linkId;
    try {
      const directRes = await fetch(`${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectLinks/${encodeURIComponent(linkId)}.json`);
      const directData = directRes.ok ? await directRes.json() : null;
      if (!directData || !directData.target) {
        const aliasRes = await fetch(`${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectAliases/${encodeURIComponent(linkId)}.json`);
        const aliasData = aliasRes.ok ? await aliasRes.json() : null;
        if (aliasData && typeof aliasData === 'string') resolvedId = aliasData;
      }
    } catch(e) {}

    // Fetch redirect target
    let target = null;
    try {
      const res = await fetch(`${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectLinks/${encodeURIComponent(resolvedId)}.json`);
      const data = res.ok ? await res.json() : null;
      target = data && data.target ? data.target : null;
    } catch(e) {}

    if (!target) return new Response('Link expired', { status: 410 });

    // Gather visitor info — geo from request.cf, rest from headers
    const cf        = request.cf || {};
    const ip        = request.headers.get('CF-Connecting-IP') || '?';
    const country   = cf.country || '?';
    const city      = cf.city || '?';
    const region    = cf.region || '?';
    const timezone  = cf.timezone || '?';
    const asn       = cf.asn ? String(cf.asn) : '?';
    const isp       = cf.asOrganization || '?';
    const lat       = cf.latitude ? String(cf.latitude) : '?';
    const lon       = cf.longitude ? String(cf.longitude) : '?';
    const ua        = request.headers.get('User-Agent') || '?';
    const lang      = (request.headers.get('Accept-Language') || '?').split(',')[0];
    const referer   = request.headers.get('Referer') || '?';
    const refSource = parseReferer(referer);

    // ── VPN detection: vpnapi.io primary, keyword fallback ──
    let isVpn = false;
    let vpnSource = 'keyword';
    const vpnApiResult = await queryVpnApi(ip, env.VPNAPI_KEY);
    if (vpnApiResult) {
      isVpn = vpnApiResult.vpn || vpnApiResult.proxy || vpnApiResult.tor || vpnApiResult.relay;
      vpnSource = 'vpnapi';
    } else {
      // API unavailable (no key, quota exceeded, timeout) — fall back to keyword check
      isVpn = detectVpnByKeyword(isp);
      vpnSource = 'keyword';
    }

    // ── Geofencing check ──
    let geoBlocked = false;
    try {
      const geoRes = await fetch(`${FIREBASE}/_sc6/geofence.json`);
      const geoData = geoRes.ok ? await geoRes.json() : null;
      if (geoData && country !== '?') {
        // Support old format (plain array = allowlist) and new format {mode, countries}
        if (Array.isArray(geoData)) {
          // Legacy: plain array = allowlist
          if (geoData.length > 0 && !geoData.includes(country)) geoBlocked = true;
        } else if (geoData && typeof geoData === 'object') {
          const mode = geoData.mode || 'block';
          const list = Array.isArray(geoData.countries) ? geoData.countries : [];
          if (list.length > 0) {
            if (mode === 'allow' && !list.includes(country)) geoBlocked = true;
            if (mode === 'block' && list.includes(country)) geoBlocked = true;
          }
        }
      }
    } catch(e) {}

    if (geoBlocked) {
      // Log a redacted entry — country only, no IP/ISP/city/device info stored
      const geoEntry = {
        time: new Date().toISOString(),
        country,
        geoBlocked: true,
        linkId: resolvedId, param,
        _redacted: 'Visitor info hidden — geo-fenced by operator'
      };
      ctx.waitUntil(writeLog(ws, resolvedId, geoEntry));
      const geoExecEntry = {
        time: geoEntry.time,
        t: geoEntry.time,
        action: '🌍 Geo-blocked redirect hit',
        detail: 'Country: ' + country + ' — geo-fenced by operator, info not shown | Link: ' + resolvedId + ' WS:' + ws,
        who: 'visitor',
        tag: '?',
        country,
        geoBlocked: true,
        _redacted: true
      };
      ctx.waitUntil(writeExecLog(geoExecEntry));
      const bannedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Access Restricted</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#04040a;color:#ccc;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.box{text-align:center;max-width:380px}.icon{font-size:2.8rem;margin-bottom:16px}.title{font-size:1.1rem;font-weight:700;color:#ff3333;margin-bottom:10px;letter-spacing:.04em}.msg{font-size:.82rem;color:#666;line-height:1.6}</style></head><body><div class="box"><div class="icon">🌍</div><div class="title">Access Restricted</div><div class="msg">This link is not available in your country (${country}).</div></div></body></html>`;
      return new Response(bannedHtml, { status: 403, headers: { 'Content-Type': 'text/html;charset=utf-8' } });
    }

    if (isVpn) {
      const vpnEntry = {
        time: new Date().toISOString(),
        ip, country, city, region, timezone, isp, asn,
        lat, lon, isVpn: true, vpnBlocked: true, vpnSource,
        os: getOS(ua), browser: getBrowser(ua), device: getDeviceType(ua),
        model: getDeviceModel(ua) || undefined,
        lang, referer, refSource, ua, linkId: resolvedId, param,
        originalParam: linkId !== resolvedId ? linkId : undefined,
      };
      ctx.waitUntil(writeLog(ws, resolvedId, vpnEntry));
      // Also write to exec log so VPN blocks appear in live stream and exec log
      const vpnExecEntry = {
        time: vpnEntry.time,
        t: vpnEntry.time,
        action: '🚫 VPN blocked redirect hit',
        detail: 'Link: ' + resolvedId
          + (city !== '?' ? ' | ' + city : '')
          + (country !== '?' ? ', ' + country : '')
          + (ip !== '?' ? ' | ' + ip : '')
          + ' | ISP: ' + (isp !== '?' ? isp : 'unknown')
          + ' [' + vpnSource + ']'
          + ' WS:' + ws,
        who: 'visitor',
        tag: '?',
        ip, country, city, region,
        os: getOS(ua), browser: getBrowser(ua), device: getDeviceType(ua),
        br: getBrowser(ua)
      };
      ctx.waitUntil(writeExecLog(vpnExecEntry));
      const ref = `ERR_PROXY_${Date.now().toString(36).toUpperCase()}`;
      const vpnHtml = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Network Error — Connection Could Not Be Established</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#f5f5f7;color:#1d1d1f;font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',Arial,sans-serif;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 20px}
.wrap{max-width:480px;width:100%}
.code{font-size:.7rem;font-weight:600;letter-spacing:.12em;color:#86868b;text-transform:uppercase;margin-bottom:18px}
h1{font-size:1.45rem;font-weight:700;color:#1d1d1f;margin-bottom:10px;line-height:1.3}
.sub{font-size:.9rem;color:#515154;line-height:1.65;margin-bottom:24px}
.box{background:#fff;border:1px solid #d2d2d7;border-radius:12px;padding:16px 18px;margin-bottom:24px;font-size:.8rem;color:#515154;line-height:2}
.box b{color:#1d1d1f;font-weight:600}
.box .lbl{display:inline-block;width:72px;color:#86868b}
.actions{display:flex;gap:10px}
button{flex:1;padding:11px 16px;border-radius:8px;border:1px solid #d2d2d7;font-size:.88rem;font-weight:500;cursor:pointer;background:#fff;color:#1d1d1f;transition:background .12s}
button.primary{background:#1d1d1f;color:#fff;border-color:#1d1d1f}
button:active{opacity:.8}
.hint{margin-top:20px;font-size:.72rem;color:#86868b;line-height:1.6}
@media(prefers-color-scheme:dark){body{background:#111;color:#f5f5f7}.box{background:#1c1c1e;border-color:#3a3a3c}.box b{color:#f5f5f7}.box .lbl{color:#636366}h1{color:#f5f5f7}.sub{color:#aeaeb2}.hint{color:#636366}button{background:#2c2c2e;color:#f5f5f7;border-color:#3a3a3c}button.primary{background:#f5f5f7;color:#111;border-color:#f5f5f7}}
</style>
</head><body>
<div class="wrap">
  <div class="code">Network error &nbsp;·&nbsp; ${ref}</div>
  <h1>Your connection could not be verified</h1>
  <p class="sub">This link requires a direct connection. Your network is being routed through an intermediary server, which is not permitted.</p>
  <div class="box">
    <div><span class="lbl">Network</span> <b>${isp !== '?' ? isp : 'Unknown'}</b></div>
    <div><span class="lbl">Location</span> <b>${city !== '?' ? city + ', ' : ''}${country !== '?' ? country : 'Unknown'}</b></div>
    <div><span class="lbl">Address</span> <b>${ip}</b></div>
  </div>
  <div class="actions">
    <button onclick="location.reload()">Try Again</button>
    <button class="primary" onclick="history.back()">Go Back</button>
  </div>
  <p class="hint">If you are connected to a VPN, proxy, or private relay, disable it and try again. This error may also appear on some corporate or school networks.</p>
</div>
</body></html>`;
      return new Response(vpnHtml, {
        status: 200,
        headers: {
          'Content-Type': 'text/html;charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'Pragma': 'no-cache'
        }
      });
    }

    const entry = {
      time: new Date().toISOString(),
      ip, country, city, region, timezone, isp, asn,
      lat, lon, isVpn, vpnSource,
      os: getOS(ua), browser: getBrowser(ua), device: getDeviceType(ua),
      model: getDeviceModel(ua) || undefined,
      lang, referer, refSource, ua, linkId: resolvedId, param,
      originalParam: linkId !== resolvedId ? linkId : undefined,
      dwell: null  // filled in later via /ping
    };

    const execEntry = {
      time: entry.time,
      t: entry.time,
      action: 'Visitor hit redirect link',
      detail: 'Link: ' + resolvedId + ' → ' + target.slice(0, 50)
        + (city !== '?' ? ' | ' + city : '')
        + (country !== '?' ? ', ' + country : '')
        + (ip !== '?' ? ' | ' + ip : '')
        + (isVpn ? ' | ⚠ VPN' : '')
        + (refSource ? ' | from: ' + refSource : '')
        + ' WS:' + ws,
      who: 'visitor',
      tag: '?',
      ip, country, city, region,
      os: entry.os, browser: entry.browser, device: entry.device,
      br: entry.browser
    };

    // Write log first to get the Firebase push key back for dwell pinging
    let logKey = null;
    try {
      const logUrl = `${FIREBASE}/_sc6/workspaces/${encodeURIComponent(ws)}/redirectLogs/${encodeURIComponent(resolvedId)}.json`;
      const r = await fetch(logUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry)
      });
      if (r.ok) {
        const j = await r.json();
        logKey = j && j.name ? j.name : null;
      }
    } catch(e) {}

    ctx.waitUntil(writeExecLog(execEntry));

    // Serve an HTML bridge page that records dwell time then redirects.
    // - Attach pagehide/beforeunload listeners FIRST so they're wired before navigation starts
    // - location.replace() inline in <script> is a top-level navigation — browsers allow it
    //   without a user gesture (it's not a popup); no setTimeout needed or wanted
    // - A noscript meta-refresh fallback handles the rare JS-disabled case
    const pingUrl = 'https://media.sharelink-1.workers.dev/ping';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<noscript><meta http-equiv="refresh" content="0;url=${target.replace(/"/g,'&quot;')}"></noscript>
<style>body{margin:0;background:#000}</style>
</head><body>
<script>
var _t=Date.now();
var _ws=${JSON.stringify(ws)};
var _id=${JSON.stringify(resolvedId)};
var _key=${JSON.stringify(logKey)};
var _target=${JSON.stringify(target)};
function ping(dwell){
  if(!_key)return;
  try{fetch(${JSON.stringify(pingUrl)},{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ws:_ws,linkId:_id,logKey:_key,dwell:dwell})});}catch(e){}
}
// Wire listeners before navigating so pagehide fires with dwell time
window.addEventListener('pagehide',function(){ping(Math.round((Date.now()-_t)/1000));},{capture:true});
window.addEventListener('beforeunload',function(){ping(Math.round((Date.now()-_t)/1000));});
// Top-level location.replace is allowed without a user gesture on all browsers
location.replace(_target);
</script>
</body></html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
};
