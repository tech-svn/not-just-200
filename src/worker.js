/**
 * Website Monitor - Cloudflare Worker
 *
 * Two schedules run out of the same scheduled() handler:
 *   - Fast tier  (every 5 minutes): fetch() + HTMLRewriter, checks main document status plus
 *     the page's core <script src> / <link rel="stylesheet"> tags. No Browser Rendering
 *     session, so it costs nothing beyond ordinary Worker subrequests.
 *   - Deep tier  (hourly, on the hour): full headless-browser render via Browser Rendering
 *     (@cloudflare/playwright), matching monitor.js's checkUrl() - JS execution, console
 *     errors, every sub-resource, real load timing, screenshot on failure.
 *
 * Manual testing: GET /run/static or /run/browser with ?token=<MONITOR_TRIGGER_TOKEN>.
 * Screenshots captured by the deep tier are served back from GET /screenshot/<key>.
 */

import { launch } from '@cloudflare/playwright';
import config from '../config.json';

const IGNORED_STATUS_CODES = [401, 403];
const FAST_CRON = '*/5 * * * *';
const DEEP_CRON = '0 * * * *';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 WebsiteMonitorBot/1.0';

// ---------- Config / env helpers ----------

function parseUrls(env) {
  if (!env.WEBSITE_URLS) {
    throw new Error('WEBSITE_URLS is not configured (wrangler secret put WEBSITE_URLS)');
  }
  return JSON.parse(env.WEBSITE_URLS);
}

function parseAllowedDomains(env) {
  const raw = env.ALLOWED_DOMAINS || '';
  if (!raw.trim()) return null;
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

function isAllowedDomain(urlString, allowedDomains) {
  if (!allowedDomains || allowedDomains.length === 0) return true;
  try {
    const hostname = new URL(urlString).hostname.toLowerCase();
    return allowedDomains.some((domain) => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

function resolveUrl(relative, base) {
  try {
    return new URL(relative, base).toString();
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- Telegram ----------

async function sendTelegram(env, message) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not configured, skipping alert.');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('[Telegram] Send failed:', err.message);
    return false;
  }
}

function formatAlertMessage(result) {
  const tierLabel = result.mode === 'browser' ? 'Deep check (browser)' : 'Fast check (static)';
  let msg = `❌ <b>FAILED: ${escapeHtml(result.name)}</b> [${tierLabel}]\n`;
  msg += `URL: ${escapeHtml(result.url)}\n`;
  msg += `Time: ${result.startedAt}\n`;
  msg += `Reason: ${escapeHtml(result.errorMessage)}\n`;

  if (result.failedRequests?.length > 0) {
    msg += `\n<b>Failed requests (${result.failedRequests.length}):</b>\n`;
    result.failedRequests.slice(0, 10).forEach((r) => {
      msg += `- [${r.status || 'FAIL'}] ${r.resourceType || 'resource'}: ${escapeHtml(r.url).slice(0, 100)}\n`;
    });
    if (result.failedRequests.length > 10) {
      msg += `... and ${result.failedRequests.length - 10} more\n`;
    }
  }

  if (result.pageErrors?.length > 0) {
    msg += `\n<b>JS runtime errors:</b>\n`;
    result.pageErrors.slice(0, 5).forEach((e) => {
      msg += `- ${escapeHtml(e)}\n`;
    });
  }

  if (result.screenshotUrl) {
    msg += `\nScreenshot: ${escapeHtml(result.screenshotUrl)}`;
  } else if (result.screenshotKey) {
    msg += `\nScreenshot key: ${escapeHtml(result.screenshotKey)}`;
  }

  if (result.loadTimeMs) {
    msg += `\nLoad time: ${result.loadTimeMs}ms`;
  }

  return msg;
}

function formatOkMessage(result) {
  return (
    `✅ <b>${escapeHtml(result.name)}</b> - OK [${result.mode}]\n` +
    `Load ${result.loadTimeMs}ms, ${result.totalRequests} request(s), all succeeded.`
  );
}

// ---------- KV logging ----------

async function writeLog(env, result) {
  if (!env.MONITOR_LOGS) return;
  const date = result.startedAt.slice(0, 10);
  const key = `log:${date}:${result.mode}:${result.name}:${result.startedAt}`;
  const keepDays = config.storage?.keepLogsForDays || 14;
  try {
    await env.MONITOR_LOGS.put(key, JSON.stringify(result), { expirationTtl: keepDays * 86400 });
  } catch (err) {
    console.error('[KV] Failed to write log:', err.message);
  }
}

// ---------- Fast tier: fetch() + HTMLRewriter ----------

async function extractCriticalResources(response, baseUrl) {
  const found = [];
  const rewriter = new HTMLRewriter()
    .on('script[src]', {
      element(el) {
        const resolved = resolveUrl(el.getAttribute('src'), baseUrl);
        if (resolved) found.push(resolved);
      },
    })
    .on('link[href]', {
      element(el) {
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        if (rel !== 'stylesheet') return;
        const resolved = resolveUrl(el.getAttribute('href'), baseUrl);
        if (resolved) found.push(resolved);
      },
    });
  const transformed = rewriter.transform(response);
  await transformed.text(); // drain the stream so the handlers above actually run
  return [...new Set(found)];
}

async function checkResource(url) {
  try {
    let res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
    if (res.status === 405 || res.status === 501) {
      res = await fetch(url, {
        method: 'GET',
        headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-0' },
      });
    }
    return { url, status: res.status, ok: res.ok || IGNORED_STATUS_CODES.includes(res.status) };
  } catch (err) {
    return { url, status: 0, ok: false, failure: err.message };
  }
}

async function runStaticCheckForTarget(target, allowedDomains, maxResourcesPerUrl) {
  const result = {
    mode: 'static',
    name: target.name,
    url: target.url,
    startedAt: new Date().toISOString(),
    ok: true,
    loadTimeMs: null,
    mainStatus: null,
    failedRequests: [],
    totalRequests: 0,
    filteredRequestsCount: 0,
    errorMessage: null,
  };

  const start = Date.now();
  try {
    const mainRes = await fetch(target.url, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    result.mainStatus = mainRes.status;

    if (result.mainStatus >= 400 && !IGNORED_STATUS_CODES.includes(result.mainStatus)) {
      result.ok = false;
      result.errorMessage = `Main document returned status ${result.mainStatus}`;
      result.loadTimeMs = Date.now() - start;
      return result;
    }

    const allResources = await extractCriticalResources(mainRes, mainRes.url);
    const filtered = allResources.filter((u) => {
      const allowed = isAllowedDomain(u, allowedDomains);
      if (!allowed) result.filteredRequestsCount++;
      return allowed;
    });
    const capped = filtered.slice(0, maxResourcesPerUrl);

    const checked = await Promise.all(capped.map(checkResource));
    result.totalRequests = checked.length;
    result.failedRequests = checked.filter((r) => !r.ok);

    if (result.failedRequests.length > 0) {
      result.ok = false;
      result.errorMessage = `${result.failedRequests.length} critical resource(s) failed to load`;
    }
    result.loadTimeMs = Date.now() - start;
  } catch (err) {
    result.ok = false;
    result.loadTimeMs = Date.now() - start;
    result.errorMessage = `Error fetching page: ${err.message}`;
  }

  return result;
}

async function runFastTier(env) {
  const urls = parseUrls(env);
  const allowedDomains = parseAllowedDomains(env);
  // Free plan allows 50 external subrequests/invocation (1 doc fetch + N resource fetches per URL).
  const maxResourcesPerUrl = Math.max(1, Math.floor(45 / urls.length));

  for (const target of urls) {
    const result = await runStaticCheckForTarget(target, allowedDomains, maxResourcesPerUrl);
    await writeLog(env, result);

    if (!result.ok) {
      console.error(`[static] ${target.name}: ${result.errorMessage}`);
      await sendTelegram(env, formatAlertMessage(result));
    } else {
      console.log(`[static] ${target.name} OK - ${result.loadTimeMs}ms, ${result.totalRequests} resource(s)`);
      if (config.telegram?.sendOkNotification) {
        await sendTelegram(env, formatOkMessage(result));
      }
    }
  }
}

// ---------- Deep tier: @cloudflare/playwright (Browser Rendering) ----------

async function runDeepCheckForTarget(browser, env, target, allowedDomains) {
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();

  const result = {
    mode: 'browser',
    name: target.name,
    url: target.url,
    startedAt: new Date().toISOString(),
    ok: true,
    loadTimeMs: null,
    mainStatus: null,
    failedRequests: [],
    consoleErrors: [],
    pageErrors: [],
    totalRequests: 0,
    filteredRequestsCount: 0,
    screenshotKey: null,
    screenshotUrl: null,
    errorMessage: null,
  };

  const requests = [];

  page.on('response', (response) => {
    const req = response.request();
    const urlStr = req.url();
    if (req.resourceType() === 'fetch') return;
    if (isAllowedDomain(urlStr, allowedDomains)) {
      requests.push({
        url: urlStr,
        resourceType: req.resourceType(),
        status: response.status(),
        ok: response.ok() || IGNORED_STATUS_CODES.includes(response.status()),
      });
    } else {
      result.filteredRequestsCount++;
    }
  });

  page.on('requestfailed', (req) => {
    const urlStr = req.url();
    if (req.resourceType() === 'fetch') return;
    if (isAllowedDomain(urlStr, allowedDomains)) {
      requests.push({
        url: urlStr,
        resourceType: req.resourceType(),
        status: 0,
        ok: false,
        failure: req.failure()?.errorText || 'unknown network error',
      });
    } else {
      result.filteredRequestsCount++;
    }
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      result.consoleErrors.push(msg.text().slice(0, 300));
    }
  });

  page.on('pageerror', (err) => {
    result.pageErrors.push(String(err.message || err).slice(0, 300));
  });

  const start = Date.now();
  try {
    const response = await page.goto(target.url, {
      waitUntil: config.check?.waitUntil || 'networkidle',
      timeout: target.timeoutMs || 30000,
    });
    result.mainStatus = response ? response.status() : null;

    await page.waitForTimeout(config.check?.networkIdleTimeoutMs || 2000);

    result.loadTimeMs = Date.now() - start;
    result.totalRequests = requests.length;
    result.failedRequests = requests.filter((r) => !r.ok);

    if (!result.mainStatus || (result.mainStatus >= 400 && !IGNORED_STATUS_CODES.includes(result.mainStatus))) {
      result.ok = false;
      result.errorMessage = `Main document returned status ${result.mainStatus}`;
    } else if (result.failedRequests.length > 0) {
      result.ok = false;
      result.errorMessage = `${result.failedRequests.length} resource(s) failed to load`;
    } else if (result.pageErrors.length > 0) {
      result.ok = false;
      result.errorMessage = `${result.pageErrors.length} JavaScript runtime error(s) (uncaught exception)`;
    } else if (config.check?.maxAllowedLoadTimeMs && result.loadTimeMs > config.check.maxAllowedLoadTimeMs) {
      result.ok = false;
      result.errorMessage = `Load time ${result.loadTimeMs}ms exceeded threshold ${config.check.maxAllowedLoadTimeMs}ms`;
    }
  } catch (err) {
    result.ok = false;
    result.loadTimeMs = Date.now() - start;
    result.errorMessage = `Error loading page: ${err.message}`;
  }

  if (!result.ok && config.check?.screenshotOnError) {
    try {
      const buffer = await page.screenshot({ fullPage: true });
      const key = `${target.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
      await env.SCREENSHOTS.put(key, buffer, { httpMetadata: { contentType: 'image/png' } });
      result.screenshotKey = key;
    } catch (e) {
      console.warn('Screenshot capture failed:', e.message);
    }
  }

  await context.close();
  return result;
}

async function runDeepTier(env, baseUrl) {
  const urls = parseUrls(env);
  const allowedDomains = parseAllowedDomains(env);
  const browser = await launch(env.MYBROWSER);

  try {
    for (const target of urls) {
      const result = await runDeepCheckForTarget(browser, env, target, allowedDomains);
      if (result.screenshotKey && baseUrl) {
        result.screenshotUrl = `${baseUrl.replace(/\/$/, '')}/screenshot/${encodeURIComponent(result.screenshotKey)}`;
      }
      await writeLog(env, result);

      if (!result.ok) {
        console.error(`[browser] ${target.name}: ${result.errorMessage}`);
        await sendTelegram(env, formatAlertMessage(result));
      } else {
        console.log(`[browser] ${target.name} OK - ${result.loadTimeMs}ms, ${result.totalRequests} request(s)`);
        if (config.telegram?.sendOkNotification) {
          await sendTelegram(env, formatOkMessage(result));
        }
      }
    }
  } finally {
    await browser.close();
  }
}

// ---------- Worker entry points ----------

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === FAST_CRON) {
      await runFastTier(env);
    } else if (event.cron === DEEP_CRON) {
      await runDeepTier(env, env.PUBLIC_BASE_URL);
    } else {
      console.warn(`[scheduled] Unrecognized cron: ${event.cron}`);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/screenshot/')) {
      const key = decodeURIComponent(url.pathname.slice('/screenshot/'.length));
      const obj = await env.SCREENSHOTS.get(key);
      if (!obj) return new Response('Not found', { status: 404 });
      return new Response(obj.body, {
        headers: { 'Content-Type': obj.httpMetadata?.contentType || 'image/png' },
      });
    }

    if (url.pathname === '/run/static' || url.pathname === '/run/browser') {
      const token = url.searchParams.get('token');
      if (!env.MONITOR_TRIGGER_TOKEN || token !== env.MONITOR_TRIGGER_TOKEN) {
        return new Response('Unauthorized', { status: 401 });
      }
      if (url.pathname === '/run/static') {
        await runFastTier(env);
        return new Response('Static check completed. Check Telegram / KV logs for results.');
      }
      await runDeepTier(env, env.PUBLIC_BASE_URL || url.origin);
      return new Response('Browser check completed. Check Telegram / KV logs for results.');
    }

    return new Response('not-just-200 monitor worker is running.');
  },
};
