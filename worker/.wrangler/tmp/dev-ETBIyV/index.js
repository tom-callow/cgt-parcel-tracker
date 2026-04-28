var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var CACHE_TTL = 600;
var MAX_SYMBOLS = 20;
var CRUMB_TTL_MS = 50 * 60 * 1e3;
var UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};
var crumbCache = null;
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}
__name(jsonResponse, "jsonResponse");
async function getCrumb() {
  const now = Date.now();
  if (crumbCache && now - crumbCache.fetchedAt < CRUMB_TTL_MS) {
    return crumbCache;
  }
  const fcResp = await fetch("https://fc.yahoo.com", {
    redirect: "follow",
    headers: { "User-Agent": UA, Accept: "*/*" }
  });
  const setCookies = typeof fcResp.headers.getSetCookie === "function" ? fcResp.headers.getSetCookie() : [fcResp.headers.get("set-cookie") ?? ""];
  const cookie = setCookies.map((c) => c.split(";")[0].trim()).filter(Boolean).join("; ");
  const crumbResp = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": UA, Accept: "*/*", Cookie: cookie }
  });
  if (!crumbResp.ok) throw new Error(`getcrumb returned HTTP ${crumbResp.status}`);
  const crumb = (await crumbResp.text()).trim();
  if (!crumb || crumb === "null") throw new Error("Yahoo returned an empty crumb");
  crumbCache = { crumb, cookie, fetchedAt: now };
  return crumbCache;
}
__name(getCrumb, "getCrumb");
async function fetchYahooQuotes(symbols) {
  const { crumb, cookie } = await getCrumb();
  const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols.map(encodeURIComponent).join(",")}&crumb=${encodeURIComponent(crumb)}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/json, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: cookie
    }
  });
  if (!resp.ok) throw new Error(`Yahoo Finance returned HTTP ${resp.status}`);
  const data = await resp.json();
  const results = data?.quoteResponse?.result ?? [];
  const bySymbol = new Map(results.map((q) => [q.symbol, q]));
  const out = {};
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
__name(fetchYahooQuotes, "fetchYahooQuotes");
var src_default = {
  async fetch(request, _env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }
    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }
    const url = new URL(request.url);
    if (url.pathname !== "/quotes") {
      return jsonResponse({ error: "Not found" }, 404);
    }
    const symbolsParam = url.searchParams.get("symbols");
    if (!symbolsParam?.trim()) {
      return jsonResponse({ error: "symbols parameter is required" }, 400);
    }
    const symbols = [
      ...new Set(
        symbolsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
      )
    ];
    if (symbols.length === 0) return jsonResponse({ error: "No valid symbols provided" }, 400);
    if (symbols.length > MAX_SYMBOLS) {
      return jsonResponse({ error: `Maximum ${MAX_SYMBOLS} symbols per request` }, 400);
    }
    const cacheUrl = `https://cache.proxy/quotes?symbols=${[...symbols].sort().join(",")}`;
    const cache = caches.default;
    const cached = await cache.match(new Request(cacheUrl));
    if (cached) {
      const headers = new Headers(cached.headers);
      Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
      return new Response(cached.body, { status: cached.status, headers });
    }
    let result;
    try {
      result = await fetchYahooQuotes(symbols);
    } catch (err) {
      console.error("fetchYahooQuotes failed:", err);
      result = Object.fromEntries(symbols.map((s) => [s, null]));
    }
    const response = new Response(JSON.stringify(result), {
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
        "Cache-Control": `public, max-age=${CACHE_TTL}`
      }
    });
    ctx.waitUntil(cache.put(new Request(cacheUrl), response.clone()));
    return response;
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-d0ycaA/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-d0ycaA/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
