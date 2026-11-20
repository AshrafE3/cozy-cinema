const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const os = require('os');

// Keep process running stably across all network edge cases
process.on('uncaughtException', (err) => {
  console.error('[Process] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled Rejection:', reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 30000,
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Detect local network IP (Wi-Fi)
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

// In-memory room state storage
const rooms = {};

function getRoomState(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      source: {
        type: 'hls',
        url: '',
        embedUrl: '',
        title: 'No Media Loaded — Paste a link or select a file above'
      },
      currentTime: 0,
      isPlaying: false,
      lastUpdate: Date.now(),
      users: {}
    };
  }
  return rooms[roomId];
}

// Dean Edwards JavaScript Unpacker
function unpackDeanEdwards(p, a, c, k) {
  function e(c) {
    return (c < a ? '' : e(parseInt(c / a))) + ((c = c % a) > 35 ? String.fromCharCode(c + 29) : c.toString(36));
  }
  let count = parseInt(c);
  while (count--) {
    if (k[count]) {
      p = p.replace(new RegExp('\\b' + e(count) + '\\b', 'g'), k[count]);
    }
  }
  return p;
}

let cachedAttachmentStream = {
  url: '',
  expiresAt: 0
};

let cachedObsessionStream = {
  url: '',
  expiresAt: 0
};

async function getObsessionDirectStream() {
  const now = Date.now();
  if (cachedObsessionStream.url && cachedObsessionStream.expiresAt > now) {
    return cachedObsessionStream.url;
  }

  try {
    const playPageRes = await fetch('https://lookmovie2.to/movies/play/37287335-obsession-2026', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(8000)
    });
    const html = await playPageRes.text();
    const idMatch = html.match(/id_movie:\s*(\d+)/);
    const hashMatch = html.match(/hash:\s*["']([^"']+)["']/);
    const expMatch = html.match(/expires:\s*(\d+)/);

    if (idMatch && hashMatch && expMatch) {
      const id_movie = idMatch[1];
      const hash = hashMatch[1];
      const expires = expMatch[1];

      const accessUrl = `https://lookmovie2.to/api/v1/security/movie-access?id_movie=${id_movie}&hash=${hash}&expires=${expires}`;
      const accessRes = await fetch(accessUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://lookmovie2.to/movies/play/37287335-obsession-2026'
        },
        signal: AbortSignal.timeout(8000)
      });
      const data = await accessRes.json();
      if (data && data.streams) {
        const streamUrl = data.streams['1080p'] || data.streams['720p'] || data.streams['480p'];
        if (streamUrl) {
          console.log('[Resolver] Found direct clean English stream for Obsession:', streamUrl);
          cachedObsessionStream = {
            url: streamUrl,
            expiresAt: (parseInt(expires) * 1000) - 300000
          };
          return streamUrl;
        }
      }
    }
  } catch (err) {
    console.error('[Resolver] Failed to resolve Obsession stream:', err.message);
  }

  if (cachedObsessionStream.url) return cachedObsessionStream.url;
  return null;
}

async function getAttachmentDirectStream() {
  const now = Date.now();
  if (cachedAttachmentStream.url && cachedAttachmentStream.expiresAt > now) {
    return cachedAttachmentStream.url;
  }

  try {
    const playPageRes = await fetch('https://lookmovie2.to/movies/play/1704301500-attachment-2022', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: AbortSignal.timeout(8000)
    });
    const html = await playPageRes.text();
    const idMatch = html.match(/id_movie:\s*(\d+)/);
    const hashMatch = html.match(/hash:\s*["']([^"']+)["']/);
    const expMatch = html.match(/expires:\s*(\d+)/);

    if (idMatch && hashMatch && expMatch) {
      const id_movie = idMatch[1];
      const hash = hashMatch[1];
      const expires = expMatch[1];

      const accessUrl = `https://lookmovie2.to/api/v1/security/movie-access?id_movie=${id_movie}&hash=${hash}&expires=${expires}`;
      const accessRes = await fetch(accessUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://lookmovie2.to/movies/play/1704301500-attachment-2022'
        },
        signal: AbortSignal.timeout(8000)
      });
      const data = await accessRes.json();
      if (data && data.streams) {
        const streamUrl = data.streams['1080p'] || data.streams['720p'] || data.streams['480p'];
        if (streamUrl) {
          console.log('[Resolver] Found direct HLS stream for Attachment (2022):', streamUrl);
          cachedAttachmentStream = {
            url: streamUrl,
            expiresAt: (parseInt(expires) * 1000) - 300000
          };
          return streamUrl;
        }
      }
    }
  } catch (err) {
    console.error('[Resolver] Failed to resolve Attachment stream:', err.message);
  }

  if (cachedAttachmentStream.url) return cachedAttachmentStream.url;
  return null;
}

// Universal Smart Link Resolver (Handles Anime, Series, Movies from ANY site URL)
async function extractMovieStream(pageUrl) {
  const rawUrl = pageUrl.trim();
  let decoded = rawUrl;
  try { decoded = decodeURIComponent(rawUrl); } catch (e) {}

  console.log(`[Resolver] Processing URL: ${rawUrl}`);
  // 0. YouTube video link detection (Full Watch Together Sync)
  const ytMatch = rawUrl.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  if (ytMatch) {
    const videoId = ytMatch[1];
    console.log(`[Resolver] Detected YouTube video ID: ${videoId}`);
    return {
      success: true,
      type: 'youtube',
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}?enablejsapi=1&autoplay=1&playsinline=1&modestbranding=1&rel=0`,
      title: 'YouTube Video'
    };
  }


  // Special match: Attachment (2022) - Direct Clean HLS Stream, No Ads, Multi-Subtitles
  if (decoded.toLowerCase().includes('attachment') || decoded.includes('938600')) {
    const directUrl = await getAttachmentDirectStream();
    if (directUrl) {
      return {
        success: true,
        type: 'hls',
        url: '/api/proxy/hls/playlist.m3u8',
        rawUrl: directUrl,
        title: 'Attachment (2022)'
      };
    }
  }

  // Special match: Obsession (2025/2026) - Clean English Digital Stream (NO TopCinema, NO Ads, English Subs)
  if (decoded.toLowerCase().includes('obsession') || decoded.includes('37287335') || decoded.includes('هوس')) {
    const directUrl = await getObsessionDirectStream();
    if (directUrl) {
      return {
        success: true,
        type: 'hls',
        url: `/api/proxy/hls/playlist.m3u8?url=${encodeURIComponent(directUrl)}&ref=${encodeURIComponent('https://lookmovie2.to/')}`,
        rawUrl: directUrl,
        subtitles: { en: '/subtitles/obsession_en.vtt', ar: '/subtitles/obsession_ar.vtt' },
        title: 'Obsession (2025/2026) [Original English HD]'
      };
    }
  }

  // LookMovie General URL Match (e.g. https://lookmovie2.to/movies/view/...)
  if (rawUrl.includes('lookmovie')) {
    let playUrl = rawUrl.replace('/movies/view/', '/movies/play/');
    try {
      const playRes = await fetch(playUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' },
        signal: AbortSignal.timeout(8000)
      });
      const html = await playRes.text();
      const idMatch = html.match(/id_movie:\s*(\d+)/);
      const hashMatch = html.match(/hash:\s*["']([^"']+)["']/);
      const expMatch = html.match(/expires:\s*(\d+)/);
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const movieTitle = titleMatch ? titleMatch[1].replace(/-\s*Free Movies.*/i, '').trim() : 'Movie Stream';

      if (idMatch && hashMatch && expMatch) {
        const accessUrl = `https://lookmovie2.to/api/v1/security/movie-access?id_movie=${idMatch[1]}&hash=${hashMatch[1]}&expires=${expMatch[1]}`;
        const accessRes = await fetch(accessUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36',
            'Referer': playUrl
          },
          signal: AbortSignal.timeout(8000)
        });
        const data = await accessRes.json();
        if (data && data.streams) {
          const streamUrl = data.streams['1080p'] || data.streams['720p'] || data.streams['480p'];
          if (streamUrl) {
            return {
              success: true,
              type: 'hls',
              url: `/api/proxy/hls/playlist.m3u8?url=${encodeURIComponent(streamUrl)}&ref=${encodeURIComponent('https://lookmovie2.to/')}`,
              rawUrl: streamUrl,
              subtitles: { en: '/subtitles/obsession_en.vtt', ar: '/subtitles/obsession_ar.vtt' },
              title: `${movieTitle} [Original English Audio]`
            };
          }
        }
      }
    } catch (e) {
      console.log('[Resolver] LookMovie extraction error:', e.message);
    }
  }

  // 1. Direct media link check (.m3u8 or .mp4)
  if (rawUrl.match(/\.(m3u8|mp4)(\?.*)?$/i)) {
    const isM3u8 = rawUrl.toLowerCase().includes('.m3u8');
    return {
      success: true,
      type: 'hls',
      url: isM3u8 ? `/api/proxy/hls/playlist.m3u8?url=${encodeURIComponent(rawUrl)}` : rawUrl,
      rawUrl: rawUrl,
      title: 'Direct Stream'
    };
  }

  // 2. Direct IMDb ID inside URL
  const imdbMatchInUrl = decoded.match(/(tt\d{7,8})/i);
  if (imdbMatchInUrl) {
    const imdbId = imdbMatchInUrl[1];
    return {
      success: true,
      type: 'embed',
      embedUrl: `https://vidlink.pro/movie/${imdbId}?multiLang=true`,
      title: `Movie (${imdbId})`
    };
  }

  // 3. Fast direct page scraping (for TopCinema, Egy.bet, etc.)
  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8'
    };

    let fetchUrl = rawUrl;
    if (rawUrl.includes('topcinema') && !rawUrl.endsWith('/watch/') && !rawUrl.endsWith('/watch')) {
      fetchUrl = rawUrl.endsWith('/') ? rawUrl + 'watch/' : rawUrl + '/watch/';
    }

    const pageRes = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(8000) });
    if (pageRes.ok) {
      const html = await pageRes.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      let pageTitle = titleMatch ? titleMatch[1].replace(/-\s*توب\s*سينما.*/i, '').replace(/مترجم\s*اون\s*لاين/i, '').trim() : 'Movie Stream';

      // Check direct master streams (.m3u8, .mp4)
      const directMatches = html.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*/gi);
      if (directMatches && directMatches.length > 0) {
        return {
          success: true,
          type: 'hls',
          url: `/api/proxy/hls/playlist.m3u8?url=${encodeURIComponent(directMatches[0])}`,
          rawUrl: directMatches[0],
          title: pageTitle
        };
      }

      // Check iframes for packed Dean Edwards JS (like TopCinema -> VidTube)
      const iframeTags = html.match(/<iframe[^>]+src=["']([^"']+)["']/gi) || [];
      for (const tag of iframeTags) {
        const m = tag.match(/src=["']([^"']+)["']/i);
        if (m && m[1] && !m[1].includes('about:blank')) {
          try {
            const iframeUrl = m[1].startsWith('//') ? 'https:' + m[1] : m[1];
            console.log(`[Resolver] Inspecting player iframe: ${iframeUrl}`);
            const iframeRes = await fetch(iframeUrl, {
              headers: { ...headers, 'Referer': fetchUrl },
              signal: AbortSignal.timeout(7000)
            });
            const iframeHtml = await iframeRes.text();
            
            // 1. Packed Dean Edwards JS
            const packedMatch = iframeHtml.match(/eval\(function\(p,a,c,k,e,d\)[\s\S]*?return p\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)/);
            if (packedMatch) {
              const [_, p, a, c, kStr] = packedMatch;
              const unpacked = unpackDeanEdwards(p, a, c, kStr.split('|'));
              const unpackedStreams = unpacked.match(/https?:\/\/[^\s"'<>]+\.(?:m3u8|mp4)[^\s"'<>]*/gi);
              if (unpackedStreams && unpackedStreams.length > 0) {
                console.log(`[Resolver] Extracted direct master stream from TopCinema! ${unpackedStreams[0]}`);
                const isObsession = pageTitle.toLowerCase().includes('obsession') || rawUrl.toLowerCase().includes('obsession');
                return {
                  success: true,
                  type: 'hls',
                  url: `/api/proxy/hls/playlist.m3u8?url=${encodeURIComponent(unpackedStreams[0])}&ref=${encodeURIComponent(iframeUrl)}`,
                  rawUrl: unpackedStreams[0],
                  subtitles: isObsession ? { en: '/subtitles/obsession_en.vtt' } : null,
                  title: pageTitle
                };
              }
            }

            // 2. Direct m3u8 inside iframe
            const ifrM3u8 = iframeHtml.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i) || iframeHtml.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i);
            if (ifrM3u8) {
              const streamUrl = ifrM3u8[1] || ifrM3u8[0];
              return {
                success: true,
                type: 'hls',
                url: `/api/proxy/hls/playlist.m3u8?url=${encodeURIComponent(streamUrl)}&ref=${encodeURIComponent(iframeUrl)}`,
                rawUrl: streamUrl,
                title: pageTitle
              };
            }
          } catch (e) {
            console.warn('[Resolver] Error checking iframe:', e.message);
          }
        }
      }

      // Check for base64 encoded servers in onclick / data-url (like egy.bet watch-servers-list)
      const b64Urls = [];
      const onclickMatches = html.match(/loadIframe\([^,]+,\s*['"]([^'"]+)['"]\)/gi) || [];
      for (const m of onclickMatches) {
        const u = m.match(/loadIframe\([^,]+,\s*['"]([^'"]+)['"]\)/i)?.[1];
        if (u) {
          const urlParam = u.match(/[?&]url=([A-Za-z0-9%_\-=]+)/i);
          if (urlParam) {
            try {
              const decodedUrl = Buffer.from(decodeURIComponent(urlParam[1]), 'base64').toString('utf8');
              if (decodedUrl.startsWith('http')) {
                b64Urls.push(decodedUrl);
              }
            } catch (e) {}
          }
        }
      }

      if (b64Urls.length > 0) {
        console.log(`[Resolver] Found ${b64Urls.length} page embed servers`);
        for (const u of b64Urls) {
          if (u.includes('vidmoly')) {
            try {
              const vmRes = await fetch(u, {
                headers: { 'Referer': rawUrl, 'User-Agent': 'Mozilla/5.0' },
                signal: AbortSignal.timeout(4000)
              });
              const vmHtml = await vmRes.text();
              const m3u8Match = vmHtml.match(/file:\s*["']([^"']+\.m3u8[^"']*)["']/i);
              if (m3u8Match && m3u8Match[1]) {
                return {
                  success: true,
                  type: 'hls',
                  url: m3u8Match[1],
                  title: 'Direct Master Stream (1080p)'
                };
              }
            } catch (e) {}
          }
        }
        return {
          success: true,
          type: 'embed',
          embedUrl: b64Urls[0],
          title: 'Movie Stream'
        };
      }
    }
  } catch (err) {}

  // 4. Check for Anime episode URLs (e.g., witanime.site/watch/.../10, anime4up, etc.)
  const animeEpMatch = decoded.match(/\/watch\/([^\/]+)\/(\d+)/i) ||
                       decoded.match(/\/([a-zA-Z0-9-]+)-(?:episode|ep)-(\d+)/i) ||
                       decoded.match(/\/([a-zA-Z0-9-]+)\/ep-(\d+)/i);

  if (animeEpMatch) {
    const rawSlug = animeEpMatch[1];
    const episode = parseInt(animeEpMatch[2], 10);
    console.log(`[Resolver] Detected Anime/Series slug: '${rawSlug}', Episode: ${episode}`);

    let searchTitle = rawSlug;
    let season = 1;

    // Detect Bleach: Thousand-Year Blood War
    if (rawSlug.toLowerCase().includes('bleach')) {
      if (rawSlug.toLowerCase().includes('kashin') || rawSlug.toLowerCase().includes('part-3') || rawSlug.toLowerCase().includes('part 3')) {
        season = 3;
      } else if (rawSlug.toLowerCase().includes('ketsubetsu') || rawSlug.toLowerCase().includes('part-2') || rawSlug.toLowerCase().includes('part 2')) {
        season = 2;
      }
      searchTitle = 'Bleach Thousand Year Blood War';
    } else {
      const sMatch = rawSlug.match(/season-(\d+)|s(\d+)|part-(\d+)/i);
      if (sMatch) {
        season = parseInt(sMatch[1] || sMatch[2] || sMatch[3], 10);
      }
      searchTitle = rawSlug
        .replace(/season-\d+|s\d+|part-\d+|kashin|tan|sennen|kessen|hen/gi, '')
        .replace(/[-_]+/g, ' ')
        .trim();
    }

    try {
      const enc = encodeURIComponent(searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '_'));
      const firstChar = enc[0] || 'a';
      const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${enc}.json`;
      const res = await fetch(imdbUrl, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();

      if (data.d && data.d.length > 0) {
        let top = data.d.find(item => item.q === 'TV series' || item.qid === 'tvSeries');
        if (!top) top = data.d[0];

        return {
          success: true,
          type: 'embed',
          embedUrl: `https://vidlink.pro/tv/${top.id}/${season}/${episode}?multiLang=true`,
          title: `${top.l} - S${season} E${episode}`
        };
      }
    } catch (e) {
      console.log('[Resolver] Anime IMDb lookup error:', e.message);
    }
  }

  // 5. TMDB ID in URL fallback (e.g. Cimalight attachment-938600)
  const tmdbMatch = decoded.match(/[-_\/](\d{5,8})(?:[#\/\?]|$)/);
  if (tmdbMatch) {
    const tmdbId = tmdbMatch[1];
    console.log(`[Resolver] Extracted TMDB ID: ${tmdbId}`);
    return {
      success: true,
      type: 'embed',
      embedUrl: `https://vidlink.pro/movie/${tmdbId}?multiLang=true`,
      title: `Attachment (2022) [Arabic & English Subtitles]`
    };
  }

  // 6. Universal Movie title search via IMDb (EgyDead, WeCima, Cimalight, etc.)
  try {
    let path = decoded.replace(/https?:\/\/[^\/]+\//i, '');
    let clean = path
      .replace(/watch|\.html|\.php|movie|series|فيلم|مترجم/gi, '')
      .replace(/[^\w\s-]/g, ' ')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const yearMatch = clean.match(/\b(19\d\d|20\d\d)\b/);
    const year = yearMatch ? yearMatch[1] : null;
    const searchTitle = clean.replace(/\b(19\d\d|20\d\d)\b/g, '').replace(/\b\d+\b/g, '').trim();

    if (searchTitle && searchTitle.length >= 2) {
      console.log(`[Resolver] IMDb search title: '${searchTitle}', year: ${year}`);
      const enc = encodeURIComponent(searchTitle.toLowerCase().replace(/[^a-z0-9]/g, '_'));
      const firstChar = enc[0] || 'a';
      const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${enc}.json`;
      const res = await fetch(imdbUrl, { signal: AbortSignal.timeout(4000) });
      const data = await res.json();

      if (data.d && data.d.length > 0) {
        let match = data.d[0];
        if (year) {
          const yearMatchItem = data.d.find(item => item.y == year);
          if (yearMatchItem) match = yearMatchItem;
        }
        return {
          success: true,
          type: 'embed',
          embedUrl: `https://vidlink.pro/movie/${match.id}?multiLang=true`,
          title: `${match.l} (${match.y || ''})`
        };
      }
    }
  } catch (e) {
    console.log('[Resolver] IMDb search error:', e.message);
  }

  return {
    success: false,
    message: 'Could not resolve stream. Please check the URL.'
  };
}

// API: Automatic Stream Resolver
app.post('/api/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, message: 'URL is required' });

  const result = await extractMovieStream(url);
  res.json(result);
});


// ================= HLS STREAM PROXY (Bypasses ISP/CORS/iOS Blocks) =================
app.get('/api/proxy/hls/playlist.m3u8', async (req, res) => {
  try {
    let rawUrl = req.query.url;
    const referer = req.query.ref || '';
    if (!rawUrl) {
      rawUrl = await getAttachmentDirectStream();
    }
    if (!rawUrl) return res.status(500).send('Stream not available');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (referer) headers['Referer'] = referer;

    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });

    const upstreamRes = await fetch(rawUrl, {
      headers,
      agent,
      signal: AbortSignal.timeout(10000)
    });
    if (!upstreamRes.ok) return res.status(502).send('Upstream stream error');

    const text = await upstreamRes.text();
    const baseUrl = rawUrl.substring(0, rawUrl.lastIndexOf('/') + 1);

    // Reverse / sort variant streams in master playlist so 1080p is served first!
    let lines = text.split('\n');
    if (text.includes('#EXT-X-STREAM-INF')) {
      const variants = [];
      let header = [];
      let i = 0;
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith('#EXT-X-STREAM-INF')) {
          variants.push({ inf: l, url: lines[i+1] || '' });
          i += 2;
        } else {
          if (variants.length === 0) header.push(l);
          i++;
        }
      }
      if (variants.length > 0) {
        // Sort by BANDWIDTH descending so highest resolution (1080p) is first!
        variants.sort((a, b) => {
          const bwA = parseInt(a.inf.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10);
          const bwB = parseInt(b.inf.match(/BANDWIDTH=(\d+)/)?.[1] || '0', 10);
          return bwB - bwA;
        });
        const rebuilt = [...header];
        for (const v of variants) {
          rebuilt.push(v.inf);
          rebuilt.push(v.url);
        }
        lines = rebuilt;
      }
    }

    const rewritten = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const fullItemUrl = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
        if (trimmed.includes('.m3u8')) {
          return `/api/proxy/hls/playlist.m3u8?url=${encodeURIComponent(fullItemUrl)}&ref=${encodeURIComponent(referer)}`;
        }
        return `/api/proxy/hls/segment?u=${encodeURIComponent(fullItemUrl)}&ref=${encodeURIComponent(referer)}`;
      }
      return line;
    }).join('\n');

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(rewritten);
  } catch (err) {
    console.error('HLS Playlist proxy error:', err);
    res.status(500).send('Proxy error');
  }
});

app.get('/api/proxy/hls/segment', async (req, res) => {
  const segUrl = req.query.u;
  const referer = req.query.ref || '';
  if (!segUrl) return res.status(400).send('Missing url');

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    };
    if (referer) headers['Referer'] = referer;

    const https = require('https');
    const agent = new https.Agent({ rejectUnauthorized: false });

    const segRes = await fetch(segUrl, {
      headers,
      agent,
      signal: AbortSignal.timeout(18000)
    });

    if (!segRes.ok) {
      return res.status(segRes.status).send('Segment fetch error');
    }

    res.setHeader('Content-Type', segRes.headers.get('content-type') || 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    const arrayBuffer = await segRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error('Segment proxy error:', err.message);
    res.status(502).send('Segment fetch error');
  }
});

// API: Direct Attachment (2022) Stream (Now using /api/proxy/hls/playlist.m3u8)
app.get('/api/movie/attachment', async (req, res) => {
  const streamUrl = await getAttachmentDirectStream();
  if (streamUrl) {
    return res.json({
      success: true,
      type: 'hls',
      url: '/api/proxy/hls/playlist.m3u8',
      rawUrl: streamUrl,
      title: 'Attachment (2022)'
    });
  }
  res.status(500).json({ success: false, message: 'Could not fetch Attachment stream' });
});

// API: Active rooms
app.get('/api/rooms', (req, res) => {
  const activeRooms = [];
  for (const [id, r] of Object.entries(rooms)) {
    const userList = Object.values(r.users).map(u => u.name);
    if (userList.length > 0) {
      activeRooms.push({
        id,
        userCount: userList.length,
        users: userList,
        title: r.source.title || 'Movie'
      });
    }
  }
  res.json({ activeRooms });
});

// API: Server info
app.get('/api/info', (req, res) => {
  res.json({
    localIp: getLocalIp(),
    port: process.env.PORT || 3000
  });
});

// Curated trending movies by category with high-res posters and IMDb IDs
const CURATED_MOVIES = {
  trending: [
    { id: 'tt1375666', title: 'Inception', year: '2010', rating: '8.8', poster: 'https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_FMjpg_UX600_.jpg', actors: 'Leonardo DiCaprio, Joseph Gordon-Levitt' },
    { id: 'tt0816692', title: 'Interstellar', year: '2014', rating: '8.7', poster: 'https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Matthew McConaughey, Anne Hathaway' },
    { id: 'tt37287335', title: 'Obsession', year: '2026', rating: '7.8', poster: 'https://m.media-amazon.com/images/M/MV5BOTU3MTY0ZDYtNzA4OC00YzFiLWI1YjgtNzBhM2EzOGVmMDhjXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Jonah Hauer-King, Leo Woodall' },
    { id: 'tt15239678', title: 'Dune: Part Two', year: '2024', rating: '8.5', poster: 'https://m.media-amazon.com/images/M/MV5BN2QyZGUgkZDUtOWMzMy00NTc5LWI2MDEtNDVkOWFlOWEyNTNkXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Timothée Chalamet, Zendaya' },
    { id: 'tt15398776', title: 'Oppenheimer', year: '2023', rating: '8.9', poster: 'https://m.media-amazon.com/images/M/MV5BN2JkMDc5MGQtZjg3YS00NmFiLWIyZmQtZTGCZjNTZmZjODk0XkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Cillian Murphy, Emily Blunt' },
    { id: 'tt0468569', title: 'The Dark Knight', year: '2008', rating: '9.0', poster: 'https://m.media-amazon.com/images/M/MV5BMTMxNTMwODM0NF5BMl5BanBnXkFtZTcwODAyMTk2Mw@@._V1_FMjpg_UX600_.jpg', actors: 'Christian Bale, Heath Ledger' },
    { id: 'tt6263850', title: 'Deadpool & Wolverine', year: '2024', rating: '7.7', poster: 'https://m.media-amazon.com/images/M/MV5BNzRiMjg0MzUtNTQ1Eg00Y2Q5LWEwM2MtMzUwZDU5NmVjN2NkXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Ryan Reynolds, Hugh Jackman' },
    { id: 'tt0111161', title: 'The Shawshank Redemption', year: '1994', rating: '9.3', poster: 'https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2MmI0XkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Tim Robbins, Morgan Freeman' }
  ],
  romance: [
    { id: 'tt0120338', title: 'Titanic', year: '1997', rating: '7.9', poster: 'https://m.media-amazon.com/images/M/MV5BYzYyN2FiZmUtYWYzMy00MzViLWJkZTMtOGY1NDgzOTFlN2UwXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Leonardo DiCaprio, Kate Winslet' },
    { id: 'tt3783958', title: 'La La Land', year: '2016', rating: '8.0', poster: 'https://m.media-amazon.com/images/M/MV5BMzUzNDM2NzM2MV5BMl5BanBnXkFtZTgwNTM3NTg4OTE@._V1_FMjpg_UX600_.jpg', actors: 'Ryan Gosling, Emma Stone' },
    { id: 'tt0332280', title: 'The Notebook', year: '2004', rating: '7.8', poster: 'https://m.media-amazon.com/images/M/MV5BMTk3OTM5Njg5M15BMl5BanBnXkFtZTYwMzA0ODI3._V1_FMjpg_UX600_.jpg', actors: 'Ryan Gosling, Rachel McAdams' },
    { id: 'tt0112471', title: 'Before Sunrise', year: '1995', rating: '8.1', poster: 'https://m.media-amazon.com/images/M/MV5BOGZmZTAwYjEtNzE5MS00MmFiLTljNzktMDMzODI1NGU3ZmUzXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Ethan Hawke, Julie Delpy' },
    { id: 'tt1478839', title: 'About Time', year: '2013', rating: '7.8', poster: 'https://m.media-amazon.com/images/M/MV5BMTA1ODUzMDA3NzFeQTJeQWpwZ15BbWU3MDgxMTYxNTk@._V1_FMjpg_UX600_.jpg', actors: 'Domhnall Gleeson, Rachel McAdams' }
  ],
  action: [
    { id: 'tt1877830', title: 'The Batman', year: '2022', rating: '7.8', poster: 'https://m.media-amazon.com/images/M/MV5BMmU5NGJlMzAtMGNmOC00YjJjLTg3NDEtNzk0Mjc3ODVlMTMxXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Robert Pattinson, Zoë Kravitz' },
    { id: 'tt1630029', title: 'Avatar: The Way of Water', year: '2022', rating: '7.6', poster: 'https://m.media-amazon.com/images/M/MV5BYjhiNjBlODctY2ZiOC00YjVlLWFlNzAtNTVhNzM1YjI1NzMxXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Sam Worthington, Zoe Saldana' },
    { id: 'tt1087260', title: 'Spider-Man: No Way Home', year: '2021', rating: '8.2', poster: 'https://m.media-amazon.com/images/M/MV5BMmFiZGZjMmEtMTA0Ni00MzA2LTljMTUtZGI2YjI4ZTYzMDA3XkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Tom Holland, Zendaya' },
    { id: 'tt4154796', title: 'Avengers: Endgame', year: '2019', rating: '8.4', poster: 'https://m.media-amazon.com/images/M/MV5BMTc5MDE2ODcwNV5BMl5BanBnXkFtZTgwMzI2NzQ2NzM@._V1_FMjpg_UX600_.jpg', actors: 'Robert Downey Jr., Chris Evans' }
  ],
  scifi: [
    { id: 'tt0816692', title: 'Interstellar', year: '2014', rating: '8.7', poster: 'https://m.media-amazon.com/images/M/MV5BYzdjMDAxZGItMjI2My00ODA1LTlkNzItOWFjMDU5ZDJlYWY3XkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Matthew McConaughey, Anne Hathaway' },
    { id: 'tt1375666', title: 'Inception', year: '2010', rating: '8.8', poster: 'https://m.media-amazon.com/images/M/MV5BMjAxMzY3NjcxNF5BMl5BanBnXkFtZTcwNTI5OTM0Mw@@._V1_FMjpg_UX600_.jpg', actors: 'Leonardo DiCaprio, Joseph Gordon-Levitt' },
    { id: 'tt0062622', title: '2001: A Space Odyssey', year: '1968', rating: '8.3', poster: 'https://m.media-amazon.com/images/M/MV5BNjU0NDM2NzctNWYyNy00OTRiLWFjOWEtNmQ1Njk4Nzk2OWQxXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Keir Dullea, Gary Lockwood' },
    { id: 'tt1856101', title: 'Blade Runner 2049', year: '2017', rating: '8.0', poster: 'https://m.media-amazon.com/images/M/MV5BNzA1Njg4NzYxOV5BMl5BanBnXkFtZTgwODk5NjU3MzI@._V1_FMjpg_UX600_.jpg', actors: 'Ryan Gosling, Harrison Ford' }
  ],
  comedy: [
    { id: 'tt0118715', title: 'The Big Lebowski', year: '1998', rating: '8.1', poster: 'https://m.media-amazon.com/images/M/MV5BMTQ0NjUzMDMyOF5BMl5BanBnXkFtZTgwNTg4NTY0MDE@._V1_FMjpg_UX600_.jpg', actors: 'Jeff Bridges, John Goodman' },
    { id: 'tt0371724', title: 'The Hitchhiker\'s Guide to the Galaxy', year: '2005', rating: '6.7', poster: 'https://m.media-amazon.com/images/M/MV5BZmU5M2E5ODktMGFlNC00ZTliLWI5MjQtZjFlMjU1YTFhMjNkXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Martin Freeman, Mos Def' },
    { id: 'tt0405296', title: 'Superbad', year: '2007', rating: '7.6', poster: 'https://m.media-amazon.com/images/M/MV5BMTc0NjIyNDExMV5BMl5BanBnXkFtZTcwMDg1ODAzMQ@@._V1_FMjpg_UX600_.jpg', actors: 'Jonah Hill, Michael Cera' }
  ],
  horror: [
    { id: 'tt0081505', title: 'The Shining', year: '1980', rating: '8.4', poster: 'https://m.media-amazon.com/images/M/MV5BNmM5Zjg2ZjItYjA0Ni00YmY0LWIzZDYtOTI5MmFhZjQ3YjQ2XkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Jack Nicholson, Shelley Duvall' },
    { id: 'tt1457767', title: 'The Conjuring', year: '2013', rating: '7.5', poster: 'https://m.media-amazon.com/images/M/MV5BOTdlNGJjMzYtNWMzMi00ZjdmLThhYmYtYzZlNWY4NGM5MzFlXkEyXkFqcGc@._V1_FMjpg_UX600_.jpg', actors: 'Patrick Wilson, Vera Farmiga' },
    { id: 'tt1190597', title: 'A Quiet Place', year: '2018', rating: '7.5', poster: 'https://m.media-amazon.com/images/M/MV5BMjI0MDMzNTQ0M15BMl5BanBnXkFtZTgwMTM5NzGQ3MzI@._V1_FMjpg_UX600_.jpg', actors: 'Emily Blunt, John Krasinski' }
  ]
};

// API: Trending Movies Catalog
app.get('/api/movies/trending', (req, res) => {
  const genre = (req.query.genre || 'trending').toLowerCase();
  const list = CURATED_MOVIES[genre] || CURATED_MOVIES.trending;
  res.json({ success: true, movies: list });
});

// API: Search Movies (via IMDb Auto-suggest)
app.get('/api/movies/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ success: true, movies: [] });

  try {
    const cleanQ = q.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, '_');
    const firstChar = cleanQ.charAt(0) || 'a';
    const imdbUrl = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encodeURIComponent(cleanQ)}.json`;

    const upstreamRes = await fetch(imdbUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(6000)
    });

    if (!upstreamRes.ok) throw new Error('Upstream IMDb error');
    const data = await upstreamRes.json();
    const items = data.d || [];

    const movies = items
      .filter(item => item.id && (item.qid === 'movie' || item.qid === 'tvSeries' || item.q === 'feature'))
      .map(item => ({
        id: item.id,
        title: item.l,
        year: item.y || item.tl || '',
        actors: item.s || '',
        poster: item.i ? item.i.imageUrl : ''
      }));

    res.json({ success: true, movies });
  } catch (err) {
    console.error('[Movie Search Error]', err.message);
    res.json({ success: false, movies: [], error: err.message });
  }
});

// Room Route
app.get('/room/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

// Socket.io Real-time Synchronization
io.on('connection', (socket) => {
  let currentRoom = null;
  let userName = 'Viewer';

  socket.on('join-room', ({ roomId, name, isReconnect, clientId }) => {
    currentRoom = roomId;
    userName = name || 'Viewer';
    socket.join(roomId);

    const room = getRoomState(roomId);
    const cId = clientId || socket.id;

    // Check if user is already known in this room (by socket.id, clientId, or name on reconnect)
    let wasAlreadyThere = false;
    if (room.users[socket.id]) {
      wasAlreadyThere = true;
      if (room.users[socket.id].disconnectTimeout) {
        clearTimeout(room.users[socket.id].disconnectTimeout);
        delete room.users[socket.id].disconnectTimeout;
      }
    } else {
      for (const sid of Object.keys(room.users)) {
        const u = room.users[sid];
        if (u.clientId === cId || (u.name === userName && isReconnect)) {
          wasAlreadyThere = true;
          if (u.disconnectTimeout) {
            clearTimeout(u.disconnectTimeout);
          }
          delete room.users[sid]; // Replace with new socket connection
          break;
        }
      }
    }

    room.users[socket.id] = { id: socket.id, clientId: cId, name: userName, lastSeen: Date.now() };

    let accurateTime = room.currentTime;
    if (room.isPlaying) {
      accurateTime += (Date.now() - room.lastUpdate) / 1000;
    }

    socket.emit('init-state', {
      source: room.source,
      currentTime: accurateTime,
      isPlaying: room.isPlaying,
      userCount: Object.keys(room.users).length
    });

    if (!wasAlreadyThere && !isReconnect) {
      io.to(roomId).emit('user-joined', {
        name: userName,
        userCount: Object.keys(room.users).length
      });
    }
  });

  socket.on('heartbeat', ({ roomId, name, clientId }) => {
    if (!roomId) return;
    const rId = roomId;
    const rName = name || userName || 'Viewer';
    const cId = clientId || socket.id;
    const room = getRoomState(rId);

    if (room.users[socket.id]) {
      if (room.users[socket.id].disconnectTimeout) {
        clearTimeout(room.users[socket.id].disconnectTimeout);
        delete room.users[socket.id].disconnectTimeout;
      }
      room.users[socket.id].lastSeen = Date.now();
    } else {
      currentRoom = rId;
      userName = rName;
      socket.join(rId);
      let wasThere = false;
      for (const sid of Object.keys(room.users)) {
        const u = room.users[sid];
        if (u.clientId === cId || u.name === rName) {
          wasThere = true;
          if (u.disconnectTimeout) {
            clearTimeout(u.disconnectTimeout);
          }
          delete room.users[sid];
          break;
        }
      }
      room.users[socket.id] = { id: socket.id, clientId: cId, name: userName, lastSeen: Date.now() };
      if (!wasThere) {
        io.to(rId).emit('user-joined', {
          name: userName,
          userCount: Object.keys(room.users).length
        });
      }
    }
  });

  
  socket.on('change-name', ({ name }) => {
    if (!name || !name.trim()) return;
    const oldName = userName;
    userName = name.trim();
    if (currentRoom) {
      const room = getRoomState(currentRoom);
      if (room.users[socket.id]) {
        room.users[socket.id].name = userName;
      }
      io.to(currentRoom).emit('name-changed', {
        id: socket.id,
        oldName,
        newName: userName
      });
    }
  });

  socket.on('change-source', (sourceData) => {
    if (!currentRoom) return;
    const room = getRoomState(currentRoom);
    room.source = sourceData;
    room.currentTime = 0;
    room.isPlaying = true;
    room.lastUpdate = Date.now();

    io.to(currentRoom).emit('source-changed', {
      source: room.source,
      senderName: userName
    });
  });

  socket.on('media-play', ({ time }) => {
    if (!currentRoom) return;
    const room = getRoomState(currentRoom);
    room.isPlaying = true;
    room.currentTime = time;
    room.lastUpdate = Date.now();

    socket.to(currentRoom).emit('media-play', { time, senderName: userName });
  });

  socket.on('media-pause', ({ time }) => {
    if (!currentRoom) return;
    const room = getRoomState(currentRoom);
    room.isPlaying = false;
    room.currentTime = time;
    room.lastUpdate = Date.now();

    socket.to(currentRoom).emit('media-pause', { time, senderName: userName });
  });

  socket.on('media-seek', ({ time }) => {
    if (!currentRoom) return;
    const room = getRoomState(currentRoom);
    room.currentTime = time;
    room.lastUpdate = Date.now();

    socket.to(currentRoom).emit('media-seek', { time, senderName: userName });
  });

  socket.on('sync-heartbeat', () => {
    if (!currentRoom) return;
    const room = getRoomState(currentRoom);
    let accurateTime = room.currentTime;
    if (room.isPlaying) {
      accurateTime += (Date.now() - room.lastUpdate) / 1000;
    }
    socket.emit('sync-heartbeat-response', {
      time: accurateTime,
      isPlaying: room.isPlaying
    });
  });

  socket.on('chat-message', (data) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('chat-message', {
      sender: userName,
      text: data.text,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    });
  });

  socket.on('send-reaction', (data) => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('reaction', {
      emoji: data.emoji || '❤️',
      sender: userName
    });
  });

  socket.on('sync-embed-reload', () => {
    if (!currentRoom) return;
    socket.to(currentRoom).emit('sync-embed-reload');
  });

  // Embed mutual synchronization
  socket.on('embed-sync-countdown', () => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('embed-sync-countdown', { senderName: userName });
  });

  socket.on('embed-sync-pause', () => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('embed-sync-pause', { senderName: userName });
  });

  socket.on('embed-sync-resync', () => {
    if (!currentRoom) return;
    io.to(currentRoom).emit('embed-sync-resync', { senderName: userName });
  });

  // ================= 🎙️ WEBRTC VOICE CHAT SIGNALING =================
  socket.on('voice-join', ({ roomId, name }) => {
    const targetRoom = roomId || currentRoom;
    if (!targetRoom) return;
    console.log(`[VoiceChat] User ${userName} (${socket.id}) voice ready in room ${targetRoom}`);
    socket.to(targetRoom).emit('voice-peer-joined', { peerId: socket.id, name: name || userName });
  });

  socket.on('voice-signal', ({ to, signal }) => {
    const targetRoom = currentRoom;
    if (to) {
      io.to(to).emit('voice-signal', { from: socket.id, signal, name: userName });
    } else if (targetRoom) {
      socket.to(targetRoom).emit('voice-signal', { from: socket.id, signal, name: userName });
    }
  });

  socket.on('voice-leave', ({ roomId }) => {
    const targetRoom = roomId || currentRoom;
    if (!targetRoom) return;
    socket.to(targetRoom).emit('voice-peer-left', { peerId: socket.id, name: userName });
  });

  socket.on('voice-speaking', ({ roomId, isSpeaking }) => {
    const targetRoom = roomId || currentRoom;
    if (!targetRoom) return;
    socket.to(targetRoom).emit('voice-peer-speaking', { peerId: socket.id, isSpeaking });
  });

  // ================= 📂 CUSTOM SUBTITLE BROADCAST =================
  socket.on('custom-subtitle', ({ roomId, vttText, fileName }) => {
    const targetRoom = roomId || currentRoom;
    if (!targetRoom || !vttText) return;
    console.log(`[Subtitles] Custom subtitle broadcast in ${targetRoom}: ${fileName}`);
    io.to(targetRoom).emit('custom-subtitle-loaded', {
      vttText,
      fileName: fileName || 'Custom Subtitles',
      senderName: userName
    });
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom] && rooms[currentRoom].users[socket.id]) {
      const leavingUser = rooms[currentRoom].users[socket.id];
      const rId = currentRoom;
      const sId = socket.id;
      const uName = leavingUser.name || userName;

      // 25-second grace window: prevents noisy leave/join messages and screen drops
      // when users switch apps, press Alt+Tab, or lock their phone for a few seconds.
      leavingUser.disconnectTimeout = setTimeout(() => {
        if (rooms[rId] && rooms[rId].users[sId]) {
          delete rooms[rId].users[sId];
          const count = Object.keys(rooms[rId].users).length;
          io.to(rId).emit('user-left', {
            name: uName,
            userCount: count
          });
          if (count === 0) {
            setTimeout(() => {
              if (rooms[rId] && Object.keys(rooms[rId].users).length === 0) {
                delete rooms[rId];
              }
            }, 1000 * 60 * 120);
          }
        }
      }, 25000);
    }
  });
});

const PORT = process.env.PORT || 3000;
const localIp = getLocalIp();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`🎬 Cozy Cinema Server Started Successfully!`);
  console.log(`--------------------------------------------------`);
  console.log(`💻 Local (Your PC):   http://localhost:${PORT}`);
  console.log(`📱 Mobile (Wi-Fi):    http://${localIp}:${PORT}`);
  console.log(`==================================================`);
  console.log(`✨ Open http://localhost:${PORT} in your browser to begin!\n`);
});

module.exports = app;
