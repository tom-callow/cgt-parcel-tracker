interface QuoteResult {
  price: number;
  currency: string;
}

type QuoteMap = Record<string, QuoteResult | null>;

interface CrumbData {
  crumb: string;
  cookie: string;
  fetchedAt: number;
}

const CACHE_TTL = 600; // 10 minutes
const MAX_SYMBOLS = 20;
const CRUMB_TTL_MS = 50 * 60 * 1000; // 50 minutes — Yahoo crumbs last ~1 hour

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Cached within the isolate's lifetime (~50 min TTL is safe)
let crumbCache: CrumbData | null = null;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

async function getCrumb(): Promise<CrumbData> {
  const now = Date.now();
  if (crumbCache && now - crumbCache.fetchedAt < CRUMB_TTL_MS) {
    return crumbCache;
  }

  // Step 1: hit fc.yahoo.com to receive session cookies
  const fcResp = await fetch('https://fc.yahoo.com', {
    redirect: 'follow',
    headers: { 'User-Agent': UA, Accept: '*/*' },
  });

  // Collect all Set-Cookie values into a single Cookie header string
  const setCookies: string[] =
    typeof (fcResp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie ===
    'function'
      ? (fcResp.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
      : [fcResp.headers.get('set-cookie') ?? ''];

  const cookie = setCookies
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');

  // Step 2: exchange cookies for a crumb
  const crumbResp = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Accept: '*/*', Cookie: cookie },
  });

  if (!crumbResp.ok) throw new Error(`getcrumb returned HTTP ${crumbResp.status}`);
  const crumb = (await crumbResp.text()).trim();
  if (!crumb || crumb === 'null') throw new Error('Yahoo returned an empty crumb');

  crumbCache = { crumb, cookie, fetchedAt: now };
  return crumbCache;
}

async function fetchYahooQuotes(symbols: string[]): Promise<QuoteMap> {
  const { crumb, cookie } = await getCrumb();

  const url =
    `https://query2.finance.yahoo.com/v7/finance/quote` +
    `?symbols=${symbols.map(encodeURIComponent).join(',')}&crumb=${encodeURIComponent(crumb)}`;

  const resp = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      Cookie: cookie,
    },
  });

  if (!resp.ok) throw new Error(`Yahoo Finance returned HTTP ${resp.status}`);

  const data = (await resp.json()) as {
    quoteResponse?: { result?: Array<{ symbol: string; regularMarketPrice?: number; currency?: string }> };
  };

  const results = data?.quoteResponse?.result ?? [];
  const bySymbol = new Map(results.map((q) => [q.symbol, q]));

  const out: QuoteMap = {};
  for (const symbol of symbols) {
    const q = bySymbol.get(symbol);
    if (q?.regularMarketPrice != null && q.currency) {
      out[symbol] = { price: q.regularMarketPrice, currency: q.currency };
    } else {
      out[symbol] = null;
    }
  }
  return out;
}

export default {
  async fetch(request: Request, _env: unknown, ctx: ExecutionContext): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    const url = new URL(request.url);

    if (url.pathname !== '/quotes') {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    const symbolsParam = url.searchParams.get('symbols');
    if (!symbolsParam?.trim()) {
      return jsonResponse({ error: 'symbols parameter is required' }, 400);
    }

    const symbols = [
      ...new Set(
        symbolsParam
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];

    if (symbols.length === 0) return jsonResponse({ error: 'No valid symbols provided' }, 400);
    if (symbols.length > MAX_SYMBOLS) {
      return jsonResponse({ error: `Maximum ${MAX_SYMBOLS} symbols per request` }, 400);
    }

    // Stable cache key (sorted)
    const cacheUrl = `https://cache.proxy/quotes?symbols=${[...symbols].sort().join(',')}`;
    const cache = caches.default;
    const cached = await cache.match(new Request(cacheUrl));
    if (cached) {
      const headers = new Headers(cached.headers);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
      return new Response(cached.body, { status: cached.status, headers });
    }

    let result: QuoteMap;
    try {
      result = await fetchYahooQuotes(symbols);
    } catch (err) {
      console.error('fetchYahooQuotes failed:', err);
      result = Object.fromEntries(symbols.map((s) => [s, null]));
    }

    const response = new Response(JSON.stringify(result), {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL}`,
      },
    });

    ctx.waitUntil(cache.put(new Request(cacheUrl), response.clone()));
    return response;
  },
};
