// SC6 Redirect Tracker Worker — v1.9.17
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

// Detect VPN/proxy/datacenter from ISP name or ASN org
function detectVpn(isp, asn) {
  if (!isp || isp === '?') return false;
  const s = isp.toLowerCase();
  const vpnKeywords = [
    'nordvpn','expressvpn','mullvad','surfshark','protonvpn','cyberghost',
    'ipvanish','hidemyass','purevpn','windscribe','pia ','private internet access',
    'torguard','vpn','proxy','tor exit','hosting','digitalocean','linode','vultr',
    'ovh','hetzner','leaseweb','choopa','psychz','quadranet','coresite','zenlayer',
    'amazon','google cloud','microsoft azure','cloudflare','fastly','akamai',
    'datacenter','data center','server','colocation','colo'
  ];
  return vpnKeywords.some(k => s.includes(k));
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

    // Gather visitor info from Cloudflare headers
    const ip        = request.headers.get('CF-Connecting-IP') || '?';
    const country   = request.headers.get('CF-IPCountry') || '?';
    const city      = request.headers.get('CF-IPCity') || '?';
    const region    = request.headers.get('CF-IPRegion') || '?';
    const timezone  = request.headers.get('CF-Timezone') || '?';
    const asn       = request.headers.get('CF-ASN') || '?';
    const isp       = request.headers.get('CF-ISP') || request.headers.get('CF-AS-Organization') || '?';
    const lat       = request.headers.get('CF-IPLatitude') || '?';
    const lon       = request.headers.get('CF-IPLongitude') || '?';
    const ua        = request.headers.get('User-Agent') || '?';
    const lang      = (request.headers.get('Accept-Language') || '?').split(',')[0];
    const referer   = request.headers.get('Referer') || '?';
    const isVpn     = detectVpn(isp, asn);
    const refSource = parseReferer(referer);

    // ── Geofencing check ──
    let geoBlocked = false;
    try {
      const geoRes = await fetch(`${FIREBASE}/_sc6/geofence/allowed.json`);
      const allowList = geoRes.ok ? await geoRes.json() : null;
      if (Array.isArray(allowList) && allowList.length > 0) {
        if (!allowList.includes(country) && country !== '?') geoBlocked = true;
      }
    } catch(e) {}

    if (geoBlocked) {
      const blockedEntry = {
        time: new Date().toISOString(),
        ip, country, city, region, ua,
        os: getOS(ua), browser: getBrowser(ua), device: getDeviceType(ua),
        model: getDeviceModel(ua) || undefined,
        lang, referer, refSource, linkId: resolvedId, param, geoBlocked: true,
        isVpn, lat, lon, isp, asn
      };
      ctx.waitUntil(writeLog(ws, resolvedId, blockedEntry));
      return new Response('Link expired', { status: 410 });
    }

    const entry = {
      time: new Date().toISOString(),
      ip, country, city, region, timezone, isp, asn,
      lat, lon, isVpn,
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

    // Serve an HTML bridge page that records dwell time then redirects
    const pingUrl = 'https://media.sharelink-1.workers.dev/ping';
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#000;display:flex;align-items:center;justify-content:center;height:100vh}</style>
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
// Redirect after a brief moment — ping with actual dwell on pagehide/beforeunload too
setTimeout(function(){
  window.location.replace(_target);
},80);
window.addEventListener('pagehide',function(){ping(Math.round((Date.now()-_t)/1000));},{capture:true});
window.addEventListener('beforeunload',function(){ping(Math.round((Date.now()-_t)/1000));});
</script>
</body></html>`;

    return new Response(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
};
