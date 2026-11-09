// SC6 Redirect Tracker Worker — v1.9.6
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
