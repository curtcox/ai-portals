// Renders a flight through the site into video files, offline: headless Chrome draws the site one frame at a time at a fixed
// step, so the video is smooth however long each frame takes to draw, and nothing waits on screen for a world to load (the
// script waits instead, between frames, while the next world builds). The sound is rendered offline too, after the pictures:
// the site's own sound engine (src/core/audio.js) runs in an OfflineAudioContext on a virtual clock, told about each world at
// the frame where the flight crossed into it.
//
// Three files come out, all from the one render:
//   <name>-full.mov      the master: H.265 10-bit at near-lossless quality (about 46 dB PSNR, 150 to 175 Mbit/s at 4K), at the
//                        rendered size and rate (4K 60 by default), 24-bit PCM sound; on a Mac the hardware encoder makes it
//   <name>-youtube.mp4   for upload to YouTube: H.264 High, closed GOPs of half a second, 4:2:0, BT.709, up to 68 Mbit/s (YouTube's
//                        figure for 4K 60), AAC-LC 384 kbit/s at 48 kHz, index at the front; chapters for each world
//   <name>-min.mp4       the smallest: AV1 at 720p 30, at most 1.5 Mbit/s, Opus 64 kbit/s (plays in browsers and VLC; QuickTime only on Macs with AV1 hardware)
// and <name>-chapters.txt, the time each world begins, ready to paste into a YouTube description.
//
// Needs Node 18+, ffmpeg (with libx265, libx264, libsvtav1, libopus) and Google Chrome; `npm install` adds playwright-core.
//
//   node tools/render-video.mjs                         the journey "Grand" in 4K 60
//   node tools/render-video.mjs --journey one-day
//   node tools/render-video.mjs --worlds orbit-dawn,storm-bands,the-umbra
//   node tools/render-video.mjs --count 8 --seed 42     eight worlds as the picker chooses them for visit 42
//   node tools/render-video.mjs --all                   every world, one after another (many hours of video, days of rendering)
//   node tools/render-video.mjs --size 1280x720 --seconds 20 --only min     a quick test
//   node tools/render-video.mjs --list                  the journeys and how to name worlds
// Run with --help for every option.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, QUANTUM = 512;            // audio: sample rate, and the step of its virtual clock (samples; a multiple of the 128 the Web Audio renderer works in)
const XFADE = 2.4;                          // the sound's crossing between worlds, s (audio.js)

// ---------- options ----------
const HELP = `Usage: node tools/render-video.mjs [what to fly] [options]

What to fly (one of):
  --journey <id>        a journey from the list (default: grand)
  --worlds <a,b,c>      these worlds, in this order
  --count <n>           n worlds as the site's picker would choose them
  --all                 every world, as the picker brings them round
  --list                print the journeys and exit

Options:
  --seed <n>            the visit's seed: which worlds the picker takes, and each world's own variations (default 1)
  --size <WxH>          rendered size (default 3840x2160)
  --fps <n>             frames per second (default 60)
  --quality <q>         the site's graphics level: low, medium, high, ultra (default ultra)
  --seconds <s>         stop after this many seconds (for tests)
  --no-ante             start in the first world, not in the small hall every visit opens in
  --fade-in <s>         fade from black at the start (default 1.5)
  --fade-out <s>        fade to black into the last portal (default 2)
  --only <list>         which files to make: full,youtube,min (default all three)
  --no-sound            silent video
  --param <k=v>         pass a setting to the page, as in its address (repeatable): ride=, companion=, style=, hour=, camera=steady, speed=, strange=
  --out <dir>           where the files go (default video/)
  --name <name>         the files' base name (default portals-<journey or seed>)
  --chrome <path>       the Chrome to use (default: Google Chrome as installed)
  --encoder <e>         auto (default): the master on the Mac's hardware HEVC encoder where there is one, the rest in software;
                        software: everything in software (x265 for the master: smaller, much slower);
                        hardware: the YouTube file on the hardware H.264 encoder too (fastest, a little softer)
  --keep                keep the intermediate files in <out>/.work
  --headed              show the browser window (it must fit the size)
`;
function parseArgs(argv) {
  const o = { seed: 1, size: '3840x2160', fps: 60, quality: 'ultra', fadeIn: 1.5, fadeOut: 2, only: 'full,youtube,min', out: 'video', params: [], sound: true, ante: true, encoder: 'auto' };
  const need = (i) => { if (i >= argv.length) throw new Error(argv[i - 1] + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help': case '-h': o.help = true; break;
      case '--list': o.list = true; break;
      case '--journey': o.journey = need(++i); break;
      case '--worlds': o.worlds = need(++i).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--count': o.count = Number(need(++i)); break;
      case '--all': o.all = true; break;
      case '--seed': o.seed = Number(need(++i)); break;
      case '--size': o.size = need(++i); break;
      case '--fps': o.fps = Number(need(++i)); break;
      case '--quality': o.quality = need(++i); break;
      case '--seconds': o.seconds = Number(need(++i)); break;
      case '--no-ante': o.ante = false; break;
      case '--fade-in': o.fadeIn = Number(need(++i)); break;
      case '--fade-out': o.fadeOut = Number(need(++i)); break;
      case '--only': o.only = need(++i); break;
      case '--no-sound': o.sound = false; break;
      case '--param': o.params.push(need(++i)); break;
      case '--out': o.out = need(++i); break;
      case '--name': o.name = need(++i); break;
      case '--chrome': o.chrome = need(++i); break;
      case '--keep': o.keep = true; break;
      case '--headed': o.headed = true; break;
      case '--encoder': o.encoder = need(++i); break;
      default: throw new Error('unknown option ' + a + ' (see --help)');
    }
  }
  const m = /^(\d+)x(\d+)$/.exec(o.size); if (!m) throw new Error('--size wants WIDTHxHEIGHT, e.g. 1920x1080');
  o.W = Number(m[1]); o.H = Number(m[2]);
  if (o.W % 2 || o.H % 2) throw new Error('--size wants even numbers');
  if (!(o.fps > 0 && o.fps <= 120)) throw new Error('--fps wants a number from 1 to 120');
  if (!['low', 'medium', 'high', 'ultra'].includes(o.quality)) throw new Error('--quality wants low, medium, high or ultra');
  if (!['auto', 'software', 'hardware'].includes(o.encoder)) throw new Error('--encoder wants auto, software or hardware');
  o.only = o.only.split(',').map((s) => s.trim()).filter(Boolean);
  for (const v of o.only) if (!VARIANTS[v]) throw new Error('--only knows full, youtube and min, not ' + v);
  if ([o.journey, o.worlds, o.count, o.all].filter((x) => x !== undefined).length > 1) throw new Error('give one of --journey, --worlds, --count, --all');
  if (o.count !== undefined && !(o.count >= 1)) throw new Error('--count wants a whole number of worlds');
  if (o.journey === undefined && o.worlds === undefined && o.count === undefined && !o.all) o.journey = 'grand';
  return o;
}

// ---------- the three files ----------
const bt709 = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];
// (setparams: the frames say what they are, so every encoder writes BT.709 into the stream; the options alone were dropped by some)
const toYuv = (fmt, size = '') => `scale=${size}${size ? ':flags=lanczos:' : ''}out_color_matrix=bt709:out_range=tv,format=${fmt},setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
const VARIANTS = {
  full: {
    file: 'full.mov', label: 'full quality',
    filter: (fps, H, hw) => hw.full ? toYuv('p010le') : toYuv('yuv420p10le'),
    // (the two are matched: about 46 dB PSNR against a CRF 12 master, 150 to 175 Mbit/s at 4K 60; the hardware one is five times faster)
    video: (fps, hw) => hw.full ? ['-c:v', 'hevc_videotoolbox', '-profile:v', 'main10', '-q:v', '65', '-tag:v', 'hvc1', ...bt709]
      : ['-c:v', 'libx265', '-preset', 'fast', '-crf', '14', '-x265-params', 'aq-mode=3:log-level=error', '-tag:v', 'hvc1', ...bt709],
    audio: ['-c:a', 'pcm_s24le'], chapters: true,
  },
  youtube: {
    file: 'youtube.mp4', label: 'YouTube',
    filter: () => toYuv('yuv420p'),
    // software by default: under YouTube's bitrate it is about 2.5 dB better than the hardware encoder
    video: (fps, hw) => hw.youtube ? ['-c:v', 'h264_videotoolbox', '-b:v', '60M', '-maxrate', '68M', '-bufsize', '100M', '-profile:v', 'high', '-g', String(Math.max(1, Math.round(fps / 2))), ...bt709]
      : ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-maxrate', '68M', '-bufsize', '100M', '-profile:v', 'high', '-level:v', '5.2',
      '-g', String(Math.max(1, Math.round(fps / 2))), '-bf', '2', '-x264-params', 'open-gop=0', ...bt709],
    audio: ['-c:a', 'aac', '-b:a', '384k', '-ar', String(SR), '-ac', '2'], faststart: true, chapters: true,
  },
  min: {
    file: 'min.mp4', label: 'minimal size',
    filter: (fps, H) => (fps > 30 ? 'fps=30,' : '') + toYuv('yuv420p10le', H > 720 ? '-2:720' : ''),
    // (capped at 1.5 Mbit/s: a world full of sparks or leaves otherwise takes three times what a calm one does)
    video: () => ['-c:v', 'libsvtav1', '-preset', '5', '-crf', '40', '-g', '300', '-svtav1-params', 'tune=0:mbr=1500', ...bt709],
    audio: ['-c:a', 'libopus', '-b:a', '64k'], faststart: true,
  },
};

// ---------- helpers ----------
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0'); };
const log = (...a) => console.log(...a);
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'], ...opts });
    p.on('error', reject); p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(cmd + ' exited with ' + code))));
  });
}
async function loadRegistry() {
  process.removeAllListeners('warning');   // the registry is an ES module in a package not marked as one: Node says so once, harmlessly
  return import(path.join(ROOT, 'src/worlds/index.js'));
}

// ---------- the local server: the site, plus the endpoints the pages hand their frames and sound to ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml' };
// the sound page: the site's sound engine with its timers on the audio clock and its randomness seeded
const AUDIO_PAGE = `<!doctype html><meta charset="utf-8"><title>sound</title><link rel="icon" href="data:,">
<script>
(() => {
  // timers on the virtual clock: the driver advances it as the offline render goes
  let id = 0; const timers = new Map(); window.__vnow = 0;
  window.setTimeout = (fn, ms) => { const k = ++id; timers.set(k, { due: window.__vnow + Math.max(0, Number(ms) || 0) / 1000, fn, k }); return k; };
  window.clearTimeout = (k) => { timers.delete(k); };
  window.setInterval = (fn, ms) => { const k = ++id, every = Math.max(0.01, (Number(ms) || 0) / 1000); const t = { due: window.__vnow + every, fn: () => { t.due += every; timers.set(k, t); fn(); }, k }; timers.set(k, t); return k; };
  window.clearInterval = window.clearTimeout;
  window.__runTimers = () => {
    for (let guard = 0; guard < 10000; guard++) {
      let next = null; for (const t of timers.values()) if (t.due <= window.__vnow + 1e-9 && (!next || t.due < next.due || (t.due === next.due && t.k < next.k))) next = t;
      if (!next) return; timers.delete(next.k); try { next.fn(); } catch (e) { console.error(e); }
    }
  };
  // seeded randomness (mulberry32), reseeded at each world so a world sounds the same in whichever chunk of the render it falls
  let s = 1; window.__seed = (n) => { s = (n >>> 0) || 1; };
  Math.random = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
})();
</script>
<script type="module">
import { createAudio } from '/src/core/audio.js';
window.__renderAudio = async ({ length, events, chunk }) => {
  const ctx = new OfflineAudioContext(2, length, ${SR});
  const resume = ctx.resume.bind(ctx); ctx.resume = () => Promise.resolve();   // the engine's own resume() is for a live context
  window.AudioContext = function () { return ctx; };
  window.__vnow = 0; window.__seed(0x5eed);
  const audio = createAudio();
  let ei = 0; const apply = (e) => { window.__seed(e.seed); audio.world(e.snap); };
  while (ei < events.length && events[ei].at <= 0) apply(events[ei++]);
  audio.toggle();
  const step = (t) => ctx.suspend(t / ${SR}).then(() => {
    window.__vnow = t / ${SR}; window.__runTimers();
    while (ei < events.length && events[ei].at <= t) apply(events[ei++]);
    if (t + ${QUANTUM} < length) step(t + ${QUANTUM});
    resume();
  });
  if (${QUANTUM} < length) step(${QUANTUM});
  const buf = await ctx.startRendering();
  const a = buf.getChannelData(0), b = buf.getChannelData(1), PART = 1 << 21;
  for (let p = 0, at = 0; at < buf.length; p++, at += PART) {
    const n = Math.min(PART, buf.length - at), out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { out[i * 2] = a[at + i]; out[i * 2 + 1] = b[at + i]; }
    const r = await fetch('/__render/audio?chunk=' + chunk + '&part=' + p, { method: 'POST', body: out });
    if (!r.ok) throw new Error('audio upload failed');
  }
  return buf.length;
};
window.__audioReady = true;
</script>`;

function startServer(handlers) {
  const server = http.createServer((req, res) => {
    let url; try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); return res.end(); }
    if (url.pathname.startsWith('/__render/')) {
      if (req.method === 'GET' && url.pathname === '/__render/favicon.ico') { res.writeHead(204); return res.end(); }
      if (req.method === 'GET' && url.pathname === '/__render/audio.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(AUDIO_PAGE); }
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      const parts = []; req.on('data', (c) => parts.push(c));
      req.on('end', () => {
        Promise.resolve(handlers[url.pathname]?.(Buffer.concat(parts), url.searchParams))
          .then(() => { res.writeHead(200); res.end(); }, (e) => { console.error(e); res.writeHead(500); res.end(String(e)); });
      });
      return;
    }
    let rel; try { rel = decodeURIComponent(url.pathname); } catch (e) { res.writeHead(400); return res.end(); }
    let file = path.join(ROOT, rel);
    if (rel.includes('\0') || (file !== ROOT && !file.startsWith(ROOT + path.sep))) { res.writeHead(403); return res.end(); }
    fs.stat(file, (err, st) => {
      if (!err && st.isDirectory()) file = path.join(file, 'index.html');
      fs.readFile(file, (e2, body) => {
        if (e2) { res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); res.end(body);
      });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- the pictures: runs in the site's page ----------
// Steps the engine at a fixed rate, hands each frame to the server, and returns the frame at which each world began (for
// the sound and the chapters). Stops at the crossing out of the last world asked for.
async function drivePage(cfg) {
  const E = window.__engine, gl = E.renderer.getContext();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  E.opts.hold = true;   // the engine draws only when asked to (its frames keep coming round, so the next world's build goes on)
  const plain = (o) => { try { return JSON.parse(JSON.stringify(o ?? null)); } catch (e) { return null; } };
  // what the sound engine reads of a world (audio.js config())
  const snap = (W) => { const d = W.def || {}; return { def: { id: d.id, category: d.category, placeKind: d.placeKind, antechamber: !!d.antechamber, media: d.media || [], weirdness: d.weirdness }, world: { audio: plain(W.world && W.world.audio) }, seed: W.seed }; };
  const nameOf = (W) => (W.def.antechamber ? '' : (W.world && W.world.title) || W.def.name || W.def.id);
  const events = [{ frame: 0, id: E.cur.def.id, name: nameOf(E.cur), snap: snap(E.cur) }];
  let shown = E.cur.def.antechamber ? 0 : 1, crossed = null;
  const own = E.events.world; E.events.world = (W, n) => { crossed = W; try { own && own(W, n); } catch (e) {} };
  const ids = cfg.ids ? new Set(cfg.ids) : null;
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * h * 4), one = new Uint8Array(4);
  if (w !== cfg.W || h !== cfg.H) throw new Error('the page drew at ' + w + 'x' + h + ', not ' + cfg.W + 'x' + cfg.H);
  const fadeIn = Math.round(cfg.fadeIn * cfg.fps), fadeOut = Math.max(1, cfg.fadeOut * cfg.fps), maxFrames = cfg.seconds ? Math.round(cfg.seconds * cfg.fps) : 0;
  let pending = null; const sent = async () => { if (!pending) return; const r = await pending; pending = null; if (!r.ok) throw new Error('frame upload failed: ' + (await r.text())); };
  let frame = 0, out = 1; const ms = { wait: 0, draw: 0, read: 0, send: 0 }; let tA = performance.now(), tB;
  for (;;) {
    // the next world builds between frames, in real time; no video time passes meanwhile, so nothing on screen waits for it
    while (E.next && !E.next.ready) { await sleep(20); if (E.lost) throw new Error('the browser lost its graphics context'); }
    tB = performance.now(); ms.wait += tB - tA; tA = tB;
    crossed = null;
    E.frame(1 / cfg.fps);
    if (E.lost) throw new Error('the browser lost its graphics context');
    if (crossed) {
      if (!crossed.def.antechamber) shown++;
      if (shown > cfg.count || (ids && !ids.has(crossed.def.id))) break;   // into the world after the last: the video ends at this portal
      events.push({ frame, id: crossed.def.id, name: nameOf(crossed), snap: snap(crossed) });
    }
    if (maxFrames && frame >= maxFrames) break;
    // the fade to black: by the clock for a timed test, else into the last portal (the frames left there, at the speed flown now)
    if (maxFrames) out = Math.min(out, (maxFrames - frame) / fadeOut);
    else if (E.next && (shown >= cfg.count || (ids && !ids.has(E.next.def.id)))) {
      const A = E.cur, left = (A.path.length - 0.45 - A.dist) / Math.max(1e-6, E.speed / cfg.fps);
      out = Math.min(out, Math.max(0, left / fadeOut));
    }
    const fade = Math.max(0, Math.min(1, out, fadeIn ? (frame + 1) / (fadeIn + 1) : 1));
    E.renderer.setRenderTarget(null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, one);   // (one pixel first: the wait for the GPU to finish the frame is counted as drawing)
    tB = performance.now(); ms.draw += tB - tA; tA = tB;
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    tB = performance.now(); ms.read += tB - tA; tA = tB;
    const cur = E.cur.def.antechamber ? '(the hall)' : nameOf(E.cur);
    // one frame on its way to the encoder while the next is drawn (a Blob: Chrome sends one many times faster than a typed array;
    // two uploads at once fail, so the last must be in before this one goes)
    const body = new Blob([px]);
    await sent();
    tB = performance.now(); ms.send += tB - tA; tA = tB;
    if (frame % 8 === 7 && window.gc) window.gc();   // a Blob's memory is let go only when it is collected, and the collector does not know how big they are
    pending = fetch('/__render/frame?i=' + frame + '&fade=' + fade.toFixed(4) + '&n=' + shown + '&w=' + encodeURIComponent(cur), { method: 'POST', body });
    frame++;
  }
  await sent();
  E.events.world = own;
  for (const k in ms) ms[k] = Math.round(ms[k] / Math.max(1, frame));
  return { frames: frame, events, ms };
}

// ---------- the sound: chunks of at most CHUNK seconds, spliced where only one world is sounding ----------
// An OfflineAudioContext holds its whole output in memory, so a long video is rendered in pieces. Each piece after the first
// starts a few seconds before a world's crossing with the world before it playing, and is joined to the piece before it once
// the crossing and the reverb's tail are over: from that world's crossing on, both pieces play the same notes (same seed,
// same clock), so a short crossfade hides the join.
const CHUNK = Number(process.env.PORTALS_AUDIO_CHUNK) || 600, PREROLL = 4, SPLICE_AFTER = XFADE + 3.6, JOIN = 0.25;
function planAudio(totalSamples, events) {
  const at = events.map((e) => e.at), sec = (s) => Math.round(s * SR / QUANTUM) * QUANTUM;
  const chunks = []; let origin = 0, initial = 0, keepFrom = 0, last = 0;   // last: the crossing the previous join was made after
  for (;;) {
    if (totalSamples - origin <= CHUNK * SR) { chunks.push({ origin, initial, end: totalSamples, keepFrom }); return chunks; }
    let k = -1;
    for (let i = last + 1; i < at.length; i++) if (at[i] + sec(SPLICE_AFTER + JOIN) <= origin + CHUNK * SR) k = i;
    if (k < 0) k = last + 1 < at.length ? last + 1 : -1;   // a world longer than a chunk: the join is made after its end anyway
    if (k < 0 || at[k] + sec(SPLICE_AFTER + JOIN) >= totalSamples) { chunks.push({ origin, initial, end: totalSamples, keepFrom }); return chunks; }
    const splice = at[k] + sec(SPLICE_AFTER);
    chunks.push({ origin, initial, end: splice + sec(JOIN), keepFrom, splice });
    origin = Math.max(at[k - 1], at[k] - sec(PREROLL)); initial = k - 1; keepFrom = splice; last = k;
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { log(HELP); return; }
  const REG = await loadRegistry(), WORLDS = REG.WORLDS, SUITES = REG.SUITES || [];
  if (o.list) {
    log('Journeys (--journey <id>):\n');
    for (const s of SUITES) log('  ' + s.id.padEnd(24) + s.title + ' (' + s.worlds.length + ' worlds)');
    log('\nWorlds (--worlds a,b,c) are named by their file in src/worlds, e.g. ' + WORLDS.slice(0, 3).map((w) => w.id).join(', ') + ' (' + WORLDS.length + ' in all).');
    return;
  }
  let ids = null, count, label, query = new URLSearchParams();
  if (o.journey) {
    const s = SUITES.find((x) => x.id === o.journey); if (!s) throw new Error('no journey called ' + o.journey + ' (see --list)');
    ids = s.worlds.filter((id) => WORLDS.some((w) => w.id === id)); count = ids.length; label = s.id; query.set('suite', s.id);
  } else if (o.worlds) {
    const bad = o.worlds.filter((id) => !WORLDS.some((w) => w.id === id)); if (bad.length) throw new Error('no world called ' + bad.join(', '));
    ids = o.worlds; count = ids.length; label = o.worlds.length === 1 ? o.worlds[0] : 'tour'; query.set('tour', ids.join(','));
  } else { count = o.all ? WORLDS.length : o.count; label = o.all ? 'all' : count + '-worlds'; }
  if (ids && new Set(ids).size !== ids.length) ids = null;   // a list that visits a world twice is followed by count alone
  query.set('session', String(o.seed)); query.set('hud', '0'); query.set('pr', '1'); query.set('quality', o.quality);
  if (!o.ante) query.set('ante', '0');
  for (const p of o.params) { const i = p.indexOf('='); if (i < 1) throw new Error('--param wants key=value'); query.set(p.slice(0, i), p.slice(i + 1)); }

  const name = o.name || 'portals-' + label + '-' + o.seed;
  const outDir = path.resolve(o.out), work = path.join(outDir, '.work', name);
  fs.mkdirSync(work, { recursive: true });
  const variants = o.only;
  const encoders = await new Promise((resolve) => { const p = spawn('ffmpeg', ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }); let t = ''; p.stdout.on('data', (d) => (t += d)); p.on('error', () => resolve(null)); p.on('exit', () => resolve(t)); });
  if (encoders === null) throw new Error('ffmpeg is not installed (or not on the PATH)');
  const hasVT = /hevc_videotoolbox/.test(encoders) && /h264_videotoolbox/.test(encoders);
  if (o.encoder === 'hardware' && !hasVT) throw new Error('--encoder hardware needs ffmpeg with VideoToolbox (a Mac)');
  const hw = { full: o.encoder !== 'software' && hasVT, youtube: o.encoder === 'hardware' };
  const want = { full: hw.full ? 'hevc_videotoolbox' : 'libx265', youtube: hw.youtube ? 'h264_videotoolbox' : 'libx264', min: 'libsvtav1' };
  for (const v of variants) if (!new RegExp('\\b' + want[v] + '\\b').test(encoders)) throw new Error('this ffmpeg has no ' + want[v] + ' encoder, which the ' + VARIANTS[v].label + ' file needs');
  if (o.sound && variants.includes('min') && !/\blibopus\b/.test(encoders)) throw new Error('this ffmpeg has no libopus encoder, which the minimal file needs');

  let chromium;
  try { ({ chromium } = await import('playwright-core')); } catch (e) { throw new Error('playwright-core is missing: run "npm install" first'); }

  // ---- the encoder: one ffmpeg, the raw frames split three ways ----
  const fc = ['[0:v]vflip' + (variants.length > 1 ? ',split=' + variants.length + variants.map((v) => '[s' + v + ']').join('') : '[s' + variants[0] + ']')];
  const encArgs = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', o.W + 'x' + o.H, '-framerate', String(o.fps), '-i', 'pipe:0'];
  for (const v of variants) fc.push('[s' + v + ']' + VARIANTS[v].filter(o.fps, o.H, hw) + '[v' + v + ']');
  encArgs.push('-filter_complex', fc.join(';'));
  for (const v of variants) encArgs.push('-map', '[v' + v + ']', ...VARIANTS[v].video(o.fps, hw), path.join(work, VARIANTS[v].file));
  const enc = spawn('ffmpeg', encArgs, { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, SVT_LOG: process.env.SVT_LOG || '1' } });   // (SVT_LOG 1: the AV1 encoder reports errors only)
  let encDone = new Promise((resolve, reject) => { enc.on('error', reject); enc.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('ffmpeg (video) exited with ' + c)))); });
  encDone.catch(() => {});
  const write = (buf) => new Promise((resolve, reject) => { if (enc.exitCode !== null) return reject(new Error('ffmpeg stopped')); enc.stdin.write(buf, (e) => (e ? reject(e) : resolve())); });

  // ---- frames in, with the fades laid on ----
  const t0 = Date.now(); let lastLog = 0, frames = 0;
  const audioParts = new Map();
  const handlers = {
    '/__render/frame': async (buf, q) => {
      const f = Number(q.get('fade'));
      if (f < 0.9999) { const k = Math.max(0, f); for (let i = 0; i < buf.length; i += 4) { buf[i] = buf[i] * k; buf[i + 1] = buf[i + 1] * k; buf[i + 2] = buf[i + 2] * k; } }
      await write(buf); frames = Number(q.get('i')) + 1;
      const now = Date.now();
      if (now - lastLog > 2000) {
        lastLog = now; const el = (now - t0) / 1000;
        process.stdout.write(`\r[pictures] ${fmtTime(frames / o.fps)} done, world ${q.get('n')}/${count} ${q.get('w').slice(0, 28).padEnd(28)} ${(frames / el).toFixed(1)} fps, ${fmtTime(el)} so far `);
      }
    },
    '/__render/audio': async (buf, q) => { const k = q.get('chunk'); if (!audioParts.has(k)) audioParts.set(k, []); audioParts.get(k)[Number(q.get('part'))] = buf; },
  };
  const server = await startServer(handlers), base = 'http://127.0.0.1:' + server.address().port;

  const args = ['--js-flags=--expose-gc', '--ignore-gpu-blocklist', '--enable-gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--force-color-profile=srgb'];
  if (process.platform === 'darwin') args.push('--use-angle=metal');
  const browser = await chromium.launch({ headless: !o.headed, args, ...(o.chrome ? { executablePath: o.chrome } : { channel: 'chrome' }) })
    .catch((e) => { throw new Error('could not start Chrome (' + e.message.split('\n')[0] + '): install Google Chrome, or pass --chrome <path>'); });
  const cleanup = async () => { try { await browser.close(); } catch (e) {} server.close(); if (enc.exitCode === null) enc.kill('SIGKILL'); };
  process.on('SIGINT', () => { log('\nstopped'); cleanup().then(() => process.exit(130)); });

  let result;
  try {
    const page = await browser.newPage({ viewport: { width: o.W, height: o.H }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => log('\n[page error]', String(e).slice(0, 300)));
    page.on('console', (m) => { if (m.type() === 'error') log('\n[page]', m.text().slice(0, 300)); });
    log(`Rendering ${name}: ${count} world${count === 1 ? '' : 's'}, ${o.W}x${o.H} at ${o.fps} fps, quality ${o.quality}, seed ${o.seed}`);
    await page.goto(base + '/?' + query.toString());
    await page.waitForFunction(() => window.__engine && window.__engine.cur, null, { timeout: 180000 });
    const gpu = await page.evaluate(() => { const gl = window.__engine.renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); return x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : '?'; });
    log('Graphics: ' + gpu + (/swiftshader|llvmpipe|software/i.test(gpu) ? '  (a software renderer: this will be very slow)' : ''));
    result = await page.evaluate(drivePage, { W: o.W, H: o.H, fps: o.fps, count, ids, fadeIn: o.fadeIn, fadeOut: o.fadeOut, seconds: o.seconds || 0 });
    await page.close();
    enc.stdin.end(); await encDone;
    const el = (Date.now() - t0) / 1000;
    const m = result.ms;
    log(`\n[pictures] done: ${result.frames} frames (${fmtTime(result.frames / o.fps)}) in ${fmtTime(el)}, ${(result.frames / el).toFixed(1)} fps; per frame ${m.draw} ms drawing, ${m.read} reading, ${m.send} encoding, ${m.wait} waiting for worlds to build`);
    if (!result.frames) throw new Error('no frames were drawn');

    // ---- the sound ----
    const duration = result.frames / o.fps, totalSamples = Math.round(duration * SR);
    const audioFile = path.join(work, 'audio.f32');
    if (o.sound) {
      const events = result.events.map((e, i) => ({ at: Math.round((e.frame / o.fps) * SR / QUANTUM) * QUANTUM, snap: e.snap, seed: (0x9e3779b1 * (i + 1)) >>> 0 }));
      const plan = planAudio(totalSamples, events);
      const page2 = await browser.newPage();
      page2.on('pageerror', (e) => log('\n[sound page error]', String(e).slice(0, 300)));
      page2.on('console', (m) => { if (m.type() === 'error') log('\n[sound]', m.text().slice(0, 300)); });
      await page2.goto(base + '/__render/audio.html');
      await page2.waitForFunction(() => window.__audioReady === true, null, { timeout: 60000 });
      const fd = fs.openSync(audioFile, 'w'); let tail = null, written = 0;
      for (let c = 0; c < plan.length; c++) {
        const ch = plan[c], ta = Date.now();
        process.stdout.write(`[sound] ${fmtTime(ch.keepFrom / SR)} to ${fmtTime((ch.splice ?? ch.end) / SR)} ... `);
        const evs = events.slice(ch.initial).map((e, i) => ({ ...e, at: i === 0 ? 0 : e.at - ch.origin })).filter((e) => e.at < ch.end - ch.origin);
        await page2.evaluate((a) => window.__renderAudio(a), { length: ch.end - ch.origin, events: evs, chunk: String(c) });
        const parts = audioParts.get(String(c)); audioParts.delete(String(c));
        const all = Buffer.concat(parts), pcm = new Float32Array(all.buffer, all.byteOffset, all.length / 4);
        let from = (ch.keepFrom - ch.origin) * 2;
        if (tail) {   // the join: an equal-power crossfade from the end of the last piece into this one
          const n = tail.length / 2;
          for (let i = 0; i < n; i++) { const x = (i / n) * Math.PI / 2, g0 = Math.cos(x), g1 = Math.sin(x); for (let k = 0; k < 2; k++) pcm[from + i * 2 + k] = tail[i * 2 + k] * g0 + pcm[from + i * 2 + k] * g1; }
        }
        const upto = (ch.splice != null ? ch.splice - ch.origin : ch.end - ch.origin) * 2;
        fs.writeSync(fd, Buffer.from(pcm.buffer, pcm.byteOffset + from * 4, (upto - from) * 4)); written += (upto - from) / 2;
        tail = ch.splice != null ? pcm.slice(upto) : null;
        log(`${((Date.now() - ta) / 1000).toFixed(0)} s`);
      }
      fs.closeSync(fd); await page2.close();
      if (written !== totalSamples) log(`[sound] note: ${written} samples for ${totalSamples} of video`);
    }
    await browser.close(); server.close();

    // ---- chapters: when each world begins ----
    // (the hall a visit opens in is a few seconds long: it is part of the first world's chapter, which starts at 0:00 as YouTube asks)
    const chapters = [];
    for (const e of result.events.filter((x) => x.name)) chapters.push({ t: chapters.length ? e.frame / o.fps : 0, title: e.name });
    if (!chapters.length) chapters.push({ t: 0, title: 'Portals' });
    fs.writeFileSync(path.join(outDir, name + '-chapters.txt'), chapters.map((c) => fmtTime(c.t) + ' ' + c.title).join('\n') + '\n');
    const meta = path.join(work, 'chapters.ffmeta');
    fs.writeFileSync(meta, ';FFMETADATA1\n' + chapters.map((c, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(c.t * 1000)}\nEND=${Math.round((i + 1 < chapters.length ? chapters[i + 1].t : duration) * 1000)}\ntitle=${c.title.replace(/([=;#\\\n])/g, '\\$1')}\n`).join(''));

    // ---- each file: its pictures and its sound ----
    const afade = [o.fadeIn > 0 ? `afade=t=in:d=${o.fadeIn}` : null, o.fadeOut > 0 ? `afade=t=out:st=${Math.max(0, duration - o.fadeOut).toFixed(3)}:d=${o.fadeOut}` : null].filter(Boolean).join(',');
    for (const v of variants) {
      const V = VARIANTS[v], dst = path.join(outDir, name + '-' + V.file);
      const a = ['-hide_banner', '-loglevel', 'error', '-y', '-i', path.join(work, V.file)];
      if (o.sound) a.push('-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', audioFile);
      if (V.chapters) a.push('-i', meta, '-map_chapters', String(o.sound ? 2 : 1));
      a.push('-map', '0:v'); if (o.sound) a.push('-map', '1:a', ...(afade ? ['-af', afade] : []), ...V.audio, '-t', duration.toFixed(3));
      a.push('-c:v', 'copy'); if (v === 'full') a.push('-tag:v', 'hvc1');
      if (V.faststart) a.push('-movflags', '+faststart');
      a.push(dst);
      await run('ffmpeg', a);
      log(`${V.label.padEnd(13)} ${path.relative(process.cwd(), dst)}  ${(fs.statSync(dst).size / 1e6).toFixed(1)} MB`);
    }
    log(`chapters      ${path.relative(process.cwd(), path.join(outDir, name + '-chapters.txt'))}`);
    if (!o.keep) fs.rmSync(work, { recursive: true, force: true });
  } catch (e) {
    await cleanup(); throw e;
  }
}

main().catch((e) => { console.error('\n' + (e && e.message ? e.message : e)); process.exit(1); });
