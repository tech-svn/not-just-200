#!/usr/bin/env node
/**
 * Website Monitor - Kiem tra dinh ky website bang headless Chromium (Playwright)
 *
 * Muc tieu: dam bao trang KHONG CHI tra ve status 200 cho document chinh,
 * ma toan bo resource (JS, CSS, image, font, XHR/fetch API) deu load thanh cong,
 * giong het trai nghiem cua mot nguoi dung that mo trinh duyet.
 *
 * Cach chay:
 *   node monitor.js                  -> chay 1 lan, dung config.json
 *   node monitor.js --config x.json  -> dung file config khac
 */

require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');

// ---------- Parse allowed domains ----------
function parseAllowedDomains() {
  const allowedDomainsStr = process.env.ALLOWED_DOMAINS || '';
  if (!allowedDomainsStr.trim()) {
    return null;
  }
  return allowedDomainsStr
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
}

// ---------- Check if URL matches allowed domain (including subdomains) ----------
function isAllowedDomain(urlString, allowedDomains) {
  if (!allowedDomains || allowedDomains.length === 0) {
    return true;
  }
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();
    return allowedDomains.some((domain) => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

// ---------- Doc config ----------
function loadConfig() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--config');
  const configPath = idx !== -1 && args[idx + 1] ? args[idx + 1] : path.join(__dirname, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`Khong tim thay file config: ${configPath}`);
    process.exit(1);
  }
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

  // Load URLs from environment variable (WEBSITE_URLS) if available
  // This allows storing URLs in GitHub Secrets or .env
  if (process.env.WEBSITE_URLS) {
    try {
      config.urls = JSON.parse(process.env.WEBSITE_URLS);
      console.log(`[Config] Loaded ${config.urls.length} URL(s) from WEBSITE_URLS environment variable`);
    } catch (err) {
      console.error(`[Config] Loi parse WEBSITE_URLS environment variable: ${err.message}`);
      process.exit(1);
    }
  }

  // Load allowed domains from environment variable
  config.allowedDomains = parseAllowedDomains();
  if (config.allowedDomains && config.allowedDomains.length > 0) {
    console.log(`[Config] Allowed domains: ${config.allowedDomains.join(', ')}`);
  }

  // Validate URLs are present
  if (!config.urls || config.urls.length === 0) {
    console.error('[Config] Khong co URL nao de kiem tra. Them WEBSITE_URLS trong .env hoac config.json');
    process.exit(1);
  }

  return config;
}

// ---------- Gui canh bao Telegram ----------
function sendTelegram(message) {
  return new Promise((resolve) => {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!botToken || !chatId) {
      console.warn('[Telegram] Chua cau hinh TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID trong .env, bo qua gui canh bao.');
      return resolve(false);
    }
    const payload = JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode === 200));
      }
    );
    req.on('error', (err) => {
      console.error('[Telegram] Loi khi gui:', err.message);
      resolve(false);
    });
    req.write(payload);
    req.end();
  });
}

function escapeHtml(str) {
  return String(str).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// ---------- Kiem tra 1 URL ----------
async function checkUrl(browser, target, checkCfg, screenshotDir, allowedDomains) {
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36 WebsiteMonitorBot/1.0',
  });
  const page = await context.newPage();

  const result = {
    name: target.name,
    url: target.url,
    startedAt: new Date().toISOString(),
    ok: true,
    loadTimeMs: null,
    mainStatus: null,
    failedRequests: [], // request bi loi (status >=400 hoac network fail)
    consoleErrors: [],
    pageErrors: [],
    totalRequests: 0,
    filteredRequestsCount: 0,
    screenshotPath: null,
    errorMessage: null,
  };

  const requests = [];

  page.on('response', (response) => {
    const req = response.request();
    const urlStr = req.url();
    if (isAllowedDomain(urlStr, allowedDomains)) {
      requests.push({
        url: urlStr,
        resourceType: req.resourceType(),
        status: response.status(),
        ok: response.ok(),
      });
    } else {
      result.filteredRequestsCount++;
    }
  });

  page.on('requestfailed', (req) => {
    const urlStr = req.url();
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
      waitUntil: checkCfg.waitUntil || 'networkidle',
      timeout: target.timeoutMs || 30000,
    });
    result.mainStatus = response ? response.status() : null;

    // Cho them mot chut de bat cac request tre (lazy load, API goi sau khi render)
    await page.waitForTimeout(checkCfg.networkIdleTimeoutMs || 2000);

    result.loadTimeMs = Date.now() - start;

    // Tong hop request loi
    result.totalRequests = requests.length;
    result.failedRequests = requests.filter((r) => !r.ok);

    // Kiem tra dieu kien fail
    if (!result.mainStatus || result.mainStatus >= 400) {
      result.ok = false;
      result.errorMessage = `Document chinh tra ve status ${result.mainStatus}`;
    } else if (result.failedRequests.length > 0) {
      result.ok = false;
      result.errorMessage = `${result.failedRequests.length} resource load that bai`;
    } else if (result.pageErrors.length > 0) {
      result.ok = false;
      result.errorMessage = `${result.pageErrors.length} loi JavaScript runtime (uncaught exception)`;
    } else if (checkCfg.maxAllowedLoadTimeMs && result.loadTimeMs > checkCfg.maxAllowedLoadTimeMs) {
      result.ok = false;
      result.errorMessage = `Thoi gian load ${result.loadTimeMs}ms vuot nguong ${checkCfg.maxAllowedLoadTimeMs}ms`;
    }
  } catch (err) {
    result.ok = false;
    result.loadTimeMs = Date.now() - start;
    result.errorMessage = `Loi khi mo trang: ${err.message}`;
  }

  // Chup screenshot khi loi
  if (!result.ok && checkCfg.screenshotOnError) {
    try {
      if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
      const filename = `${target.name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
      const filepath = path.join(screenshotDir, filename);
      await page.screenshot({ path: filepath, fullPage: true });
      result.screenshotPath = filepath;
    } catch (e) {
      console.warn('Khong chup duoc screenshot:', e.message);
    }
  }

  await context.close();
  return result;
}

// ---------- Ghi log ----------
function writeLog(logDir, result) {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.appendFileSync(logFile, JSON.stringify(result) + '\n');
}

// ---------- Format message canh bao ----------
function formatAlertMessage(result) {
  let msg = `❌ <b>LỖI: ${escapeHtml(result.name)}</b>\n`;
  msg += `URL: ${escapeHtml(result.url)}\n`;
  msg += `Thời gian: ${result.startedAt}\n`;
  msg += `Lý do: ${escapeHtml(result.errorMessage)}\n`;

  if (result.failedRequests.length > 0) {
    msg += `\n<b>Request lỗi (${result.failedRequests.length}):</b>\n`;
    result.failedRequests.slice(0, 10).forEach((r) => {
      msg += `- [${r.status || 'FAIL'}] ${r.resourceType}: ${escapeHtml(r.url).slice(0, 100)}\n`;
    });
    if (result.failedRequests.length > 10) {
      msg += `... và ${result.failedRequests.length - 10} request khác\n`;
    }
  }

  if (result.pageErrors.length > 0) {
    msg += `\n<b>JS runtime errors:</b>\n`;
    result.pageErrors.slice(0, 5).forEach((e) => {
      msg += `- ${escapeHtml(e)}\n`;
    });
  }

  if (result.loadTimeMs) {
    msg += `\nThời gian load: ${result.loadTimeMs}ms`;
  }

  return msg;
}

function formatOkMessage(result) {
  return (
    `✅ <b>${escapeHtml(result.name)}</b> - OK\n` +
    `Load ${result.loadTimeMs}ms, ${result.totalRequests} request, tất cả thành công.`
  );
}

// ---------- Main ----------
async function main() {
  const config = loadConfig();
  const logDir = path.resolve(__dirname, config.storage?.logDir || './logs');
  const screenshotDir = path.resolve(__dirname, config.storage?.screenshotDir || './screenshots');

  console.log(`[${new Date().toISOString()}] Bat dau kiem tra ${config.urls.length} URL...`);

  const browser = await chromium.launch({ headless: true });

  const results = [];
  for (const target of config.urls) {
    console.log(`  -> Dang kiem tra: ${target.name} (${target.url})`);
    const result = await checkUrl(browser, target, config.check || {}, screenshotDir, config.allowedDomains);
    results.push(result);
    writeLog(logDir, result);

    if (!result.ok) {
      console.error(`  [LOI] ${target.name}: ${result.errorMessage}`);
      await sendTelegram(formatAlertMessage(result));
    } else {
      let successMsg = `  [OK] ${target.name} - ${result.loadTimeMs}ms, ${result.totalRequests} requests`;
      if (result.filteredRequestsCount > 0) {
        successMsg += ` (${result.filteredRequestsCount} filtered by domain whitelist)`;
      }
      console.log(successMsg);
      if (config.telegram?.sendOkNotification) {
        await sendTelegram(formatOkMessage(result));
      }
    }
  }

  await browser.close();

  const failedCount = results.filter((r) => !r.ok).length;
  console.log(`[${new Date().toISOString()}] Hoan tat. ${results.length - failedCount}/${results.length} OK.`);

  process.exit(failedCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Loi khong luong truoc duoc:', err);
  process.exit(1);
});
