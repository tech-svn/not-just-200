# Website Monitor

---

## 🌍 English

### Overview

Periodic website monitoring tool using **headless Chromium (Playwright)**. Unlike simple HTTP status checks, this tool **simulates real browser behavior**: opens pages, executes JavaScript, loads images/CSS/fonts/API calls, and reports failures if **any resource** fails to load or returns an error.

**Key Features:**

- ✅ Real browser simulation with JavaScript execution
- ✅ Tracks all sub-resources (JS, CSS, images, fonts, API calls)
- ✅ Detects console errors and runtime exceptions
- ✅ Captures full-page screenshots on failure
- ✅ Telegram alerts with detailed error reports
- ✅ Domain whitelist filtering (check only specific domains)
- ✅ Cloudflare Workers cron scheduling: fast static check every 5 min + deep browser check every hour
- ✅ JSON Lines logging for historical analysis (local) / KV logging (Workers)

### Installation

```bash
# Requires Node.js >= 18
cd website-monitor
npm install
npm run install-browsers
```

### Configuration



#### Option 1: Environment Variables (Cloudflare Workers secrets / .env)

Create `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Website URLs to monitor (JSON array format)
WEBSITE_URLS=[{"name":"Saramin","url":"https://example.com","timeoutMs":30000}]

# Domain whitelist (optional, comma-separated)
# Only requests from these domains will be checked
ALLOWED_DOMAINS=example.com,example.com

# Telegram credentials
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

#### Option 2: config.json

Edit `config.json`:

```json
{
  "urls": [
    {"name":"Saramin","url":"https://example.com","timeoutMs":30000}
  ],
  "check": {
    "waitUntil": "networkidle",
    "networkIdleTimeoutMs": 2000,
    "maxAllowedLoadTimeMs": 8000,
    "screenshotOnError": true
  },
  "storage": {
    "logDir": "./logs",
    "screenshotDir": "./screenshots"
  }
}
```

### Running

**Single check:**
```bash
npm start
# or
node monitor.js
```

**With custom config:**
```bash
node monitor.js --config staging-config.json
```

**Output:**

- Console logs
- Detailed JSON Lines logs: `logs/YYYY-MM-DD.jsonl`
- Screenshots on error: `screenshots/`
- Telegram alerts (if configured)
- Exit code: `0` (success) or `1` (failure)

### Scheduled Monitoring



#### Via Cron (Linux/Mac)

```bash
crontab -e
```

Add (runs every 10 minutes):

```bash
*/10 * * * * cd /path/to/website-monitor && /usr/bin/node monitor.js >> cron.log 2>&1
```

#### Via Cloudflare Workers (Recommended)

`src/worker.js` runs on Cloudflare Workers using two cron triggers defined in `wrangler.toml`:

- **Fast tier** (`*/5 * * * *`): plain `fetch()` + the built-in `HTMLRewriter` — checks the main document's status code plus the page's core `<script src>` / `<link rel="stylesheet">` tags. No headless browser involved, so it costs nothing beyond ordinary Worker subrequests.
- **Deep tier** (`0 * * * *`): a full headless-browser render via [Browser Rendering](https://developers.cloudflare.com/browser-rendering/) using [`@cloudflare/playwright`](https://www.npmjs.com/package/@cloudflare/playwright) — same checks as `monitor.js`'s `checkUrl()` (JS execution, console errors, every sub-resource, real load timing, screenshot on failure).

**Why two tiers:** Browser Rendering is billed by session time (the Free plan includes 10 browser-minutes/day). Running a full browser check every 5 minutes for every configured URL would blow that budget fast, especially on pages with 100+ requests. The fast tier gives near-real-time uptime signal for free; the hourly deep tier is the source of truth for full resource/JS coverage and stays comfortably inside the free budget (~5-6 browser-minutes/day for a couple of URLs).

**Setup:**

```bash
npm install
npx wrangler login

# Create the KV namespace for logs, then paste the id it prints into wrangler.toml
npx wrangler kv namespace create MONITOR_LOGS

# Create the R2 bucket for failure screenshots
npx wrangler r2 bucket create not-just-200-screenshots

# Configure secrets (same values as the old GitHub Secrets)
npx wrangler secret put WEBSITE_URLS
npx wrangler secret put ALLOWED_DOMAINS
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put MONITOR_TRIGGER_TOKEN   # any random string; gates the manual /run/* routes

npm run worker:deploy
```

After the first deploy, optionally set `PUBLIC_BASE_URL` in `wrangler.toml` to the Worker's `*.workers.dev` URL (or a custom domain) so failure alerts can link straight to `/screenshot/<key>`.

**Manual testing** (skip waiting for the cron to fire):

```bash
curl "https://<your-worker>.workers.dev/run/static?token=<MONITOR_TRIGGER_TOKEN>"
curl "https://<your-worker>.workers.dev/run/browser?token=<MONITOR_TRIGGER_TOKEN>"
```

**Logs:** each check writes one entry to the `MONITOR_LOGS` KV namespace (`log:<date>:<static|browser>:<name>:<timestamp>`), expiring automatically after `storage.keepLogsForDays` (from `config.json`). Tail live execution with `npm run worker:tail`.

**Tuning the schedule:** the free-tier budget assumes a small number of URLs. With more sites (or if you upgrade to the Workers Paid plan), adjust the cron expressions in `wrangler.toml` — e.g. drop the deep tier to every 15-20 minutes if you have Paid-plan browser-hours to spare.

#### Via Docker

```bash
docker build -t website-monitor .
docker run --rm \
  -e WEBSITE_URLS='[{"name":"Site","url":"https://example.com"}]' \
  -e TELEGRAM_BOT_TOKEN=your_token \
  -e TELEGRAM_CHAT_ID=your_id \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/screenshots:/app/screenshots \
  website-monitor
```

For multi-region monitoring, deploy identical containers on different VPS in various regions.

### Domain Whitelist Filtering

Optionally filter which domains to monitor using `ALLOWED_DOMAINS`:

```env
ALLOWED_DOMAINS=example.com,example.com
```

This will **only check requests** from:

- `example.com`, `www.example.com`, `api.example.com`, etc.
- `example.com`, `platform.example.com`, etc.

Third-party tracking (Google Analytics, DoubleClick, etc.) will be automatically filtered out.

### Fast Tier Limitations

The 5-minute static tier can only see what's declared in the raw HTML (`<script src>`, `<link rel="stylesheet">`). It cannot execute JavaScript, so it will miss anything a page loads dynamically — JS-triggered API calls, lazily-swapped images, uncaught runtime exceptions, `console.error()` calls. Those are only caught by the hourly deep-browser tier, which means worst-case detection latency for a JS-only failure is up to an hour. If that's not acceptable for a given site, consider running the deep tier more frequently (see "Tuning the schedule" above) or moving that site to the local/VPS cron path running `monitor.js` directly.

### Future Enhancements

- Visual regression detection via screenshot comparison
- Core Web Vitals monitoring (LCP, CLS)
- Parallel URL checking with `Promise.all()`
- Elasticsearch integration for uptime dashboards
- Performance waterfall charts


---

## 🇻🇳 Tiếng Việt

### Tổng Quan

Công cụ kiểm tra định kỳ website bằng **headless Chromium (Playwright)**. Không chỉ check status code của trang chính — mà **mô phỏng đúng trình duyệt thật**: mở trang, chạy JS, load ảnh/CSS/font/API call, rồi báo lỗi nếu **bất kỳ resource nào** trả về lỗi hoặc load thất bại.

**Tính Năng:**

- ✅ Mô phỏng trình duyệt thực với thực thi JavaScript
- ✅ Theo dõi tất cả tài nguyên (JS, CSS, ảnh, font, API)
- ✅ Phát hiện console errors và runtime exceptions
- ✅ Chụp ảnh toàn trang khi lỗi
- ✅ Cảnh báo Telegram với báo cáo chi tiết
- ✅ Bộ lọc domain (chỉ kiểm tra các domain cụ thể)
- ✅ Lập lịch bằng Cloudflare Workers: kiểm tra nhanh mỗi 5 phút + kiểm tra sâu bằng browser mỗi giờ
- ✅ JSON Lines logging cho phân tích lịch sử (local) / KV logging (Workers)

### Cài Đặt

```bash
# Cần Node.js >= 18
cd website-monitor
npm install
npm run install-browsers
```

### Cấu Hình

#### Cách 1: Biến Môi Trường (Cloudflare Workers secrets / .env)

Tạo file `.env` từ `.env.example`:

```bash
cp .env.example .env
```

Sửa `.env`:

```env
# URLs cần giám sát (định dạng JSON array)
WEBSITE_URLS=[{"name":"Saramin","url":"https://example.com","timeoutMs":30000}]

# Whitelist domain (tùy chọn, cách nhau bằng dấu phẩy)
# Chỉ requests từ những domain này mới được kiểm tra
ALLOWED_DOMAINS=example.com,example.com

# Thông tin Telegram
TELEGRAM_BOT_TOKEN=token_của_bạn
TELEGRAM_CHAT_ID=chat_id_của_bạn
```

#### Cách 2: config.json

Sửa `config.json`:

```json
{
  "urls": [
    {"name":"Saramin","url":"https://example.com","timeoutMs":30000}
  ],
  "check": {
    "waitUntil": "networkidle",
    "networkIdleTimeoutMs": 2000,
    "maxAllowedLoadTimeMs": 8000,
    "screenshotOnError": true
  },
  "storage": {
    "logDir": "./logs",
    "screenshotDir": "./screenshots"
  }
}
```

### Chạy Thử

**Kiểm tra 1 lần:**
```bash
npm start
# hoặc
node monitor.js
```

**Với config tuỳ chỉnh:**
```bash
node monitor.js --config staging-config.json
```

**Kết Quả:**

- In log ra console
- Ghi log chi tiết JSON Lines: `logs/YYYY-MM-DD.jsonl`
- Chụp ảnh nếu lỗi: `screenshots/`
- Cảnh báo Telegram (nếu cấu hình)
- Exit code: `0` (thành công) hoặc `1` (lỗi)

### Giám Sát Định Kỳ



#### Qua Cron (Linux/Mac)

```bash
crontab -e
```

Thêm (chạy mỗi 10 phút):

```bash
*/10 * * * * cd /path/to/website-monitor && /usr/bin/node monitor.js >> cron.log 2>&1
```

#### Qua Cloudflare Workers (Khuyến Nghị)

`src/worker.js` chạy trên Cloudflare Workers với hai cron trigger khai báo trong `wrangler.toml`:

- **Tầng nhanh** (`*/5 * * * *`): dùng `fetch()` thuần + `HTMLRewriter` có sẵn — kiểm tra status code trang chính và các thẻ `<script src>` / `<link rel="stylesheet">` cốt lõi. Không dùng headless browser nên gần như miễn phí (chỉ tốn subrequest thông thường).
- **Tầng sâu** (`0 * * * *`): render đầy đủ bằng headless browser qua [Browser Rendering](https://developers.cloudflare.com/browser-rendering/) với [`@cloudflare/playwright`](https://www.npmjs.com/package/@cloudflare/playwright) — giống hệt `checkUrl()` trong `monitor.js` (chạy JS, bắt console error, kiểm tra mọi resource, đo thời gian load thật, chụp ảnh khi lỗi).

**Vì sao chia 2 tầng:** Browser Rendering tính phí theo thời gian phiên (gói Free có 10 phút browser/ngày). Nếu chạy browser thật mỗi 5 phút cho mọi URL sẽ vượt ngân sách rất nhanh, nhất là với trang có 100+ request. Tầng nhanh cho tín hiệu uptime gần thời gian thực miễn phí; tầng sâu chạy mỗi giờ là nguồn kiểm tra đầy đủ resource/JS, vẫn nằm trong ngân sách free (~5-6 phút browser/ngày với vài URL).

**Thiết lập:**

```bash
npm install
npx wrangler login

# Tạo KV namespace để ghi log, sau đó dán id in ra vào wrangler.toml
npx wrangler kv namespace create MONITOR_LOGS

# Tạo R2 bucket để lưu screenshot khi lỗi
npx wrangler r2 bucket create not-just-200-screenshots

# Cấu hình secrets (giống các giá trị GitHub Secrets cũ)
npx wrangler secret put WEBSITE_URLS
npx wrangler secret put ALLOWED_DOMAINS
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put MONITOR_TRIGGER_TOKEN   # chuỗi ngẫu nhiên bất kỳ; bảo vệ route /run/*

npm run worker:deploy
```

Sau lần deploy đầu tiên, có thể set `PUBLIC_BASE_URL` trong `wrangler.toml` thành URL `*.workers.dev` của Worker (hoặc custom domain) để cảnh báo lỗi có thể link thẳng tới `/screenshot/<key>`.

**Kiểm tra thủ công** (không cần chờ cron):

```bash
curl "https://<your-worker>.workers.dev/run/static?token=<MONITOR_TRIGGER_TOKEN>"
curl "https://<your-worker>.workers.dev/run/browser?token=<MONITOR_TRIGGER_TOKEN>"
```

**Log:** mỗi lần kiểm tra ghi một entry vào KV namespace `MONITOR_LOGS` (`log:<ngày>:<static|browser>:<tên>:<timestamp>`), tự hết hạn sau `storage.keepLogsForDays` (trong `config.json`). Xem log real-time bằng `npm run worker:tail`.

**Tinh chỉnh lịch chạy:** ngân sách free tier ở trên tính cho số lượng URL nhỏ. Nếu có nhiều site hơn (hoặc nâng cấp gói Paid), điều chỉnh biểu thức cron trong `wrangler.toml` — ví dụ giảm tầng sâu xuống mỗi 15-20 phút nếu gói Paid còn dư browser-hours.

#### Qua Docker

```bash
docker build -t website-monitor .
docker run --rm \
  -e WEBSITE_URLS='[{"name":"Site","url":"https://example.com"}]' \
  -e TELEGRAM_BOT_TOKEN=token_của_bạn \
  -e TELEGRAM_CHAT_ID=chat_id_của_bạn \
  -v $(pwd)/logs:/app/logs \
  -v $(pwd)/screenshots:/app/screenshots \
  website-monitor
```

Cho giám sát đa khu vực, deploy container trên nhiều VPS ở các nơi khác nhau.

### Bộ Lọc Domain

Tùy chọn lọc domain nào cần giám sát bằng `ALLOWED_DOMAINS`:

```env
ALLOWED_DOMAINS=example.com,example.com
```

Điều này sẽ **chỉ kiểm tra requests** từ:

- `example.com`, `www.example.com`, `api.example.com`, v.v.
- `example.com`, `platform.example.com`, v.v.

Tracking của bên thứ ba (Google Analytics, DoubleClick, v.v.) sẽ bị tự động lọc ra.

### Giới Hạn Của Tầng Nhanh

Tầng static 5 phút chỉ thấy được những gì khai báo sẵn trong HTML thô (`<script src>`, `<link rel="stylesheet">`). Nó không thực thi JavaScript nên sẽ bỏ sót mọi thứ trang load động — API call do JS gọi, ảnh lazy-swap, uncaught exception, `console.error()`. Những lỗi này chỉ được tầng browser (chạy mỗi giờ) phát hiện, nghĩa là độ trễ phát hiện tối đa cho lỗi thuần JS có thể lên tới 1 giờ. Nếu điều này không chấp nhận được với một site cụ thể, cân nhắc chạy tầng sâu thường xuyên hơn (xem "Tinh chỉnh lịch chạy" ở trên) hoặc chuyển site đó sang chạy `monitor.js` trực tiếp qua cron local/VPS.

### Mở Rộng Thêm

- So sánh screenshot theo thời gian để phát hiện visual regression
- Kiểm tra Core Web Vitals (LCP, CLS)
- Chạy song song nhiều trang bằng `Promise.all()`
- Tích hợp Elasticsearch cho dashboard uptime
- Biểu đồ waterfall hiệu năng

---

## License

MIT
