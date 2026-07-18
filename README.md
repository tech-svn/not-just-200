# Website Monitor

[![Website Monitor](https://github.com/tech-svn/not-just-200/actions/workflows/website-monitor.yml/badge.svg)](https://github.com/tech-svn/not-just-200/actions/workflows/website-monitor.yml)

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
- ✅ GitHub Actions integration for automated monitoring
- ✅ JSON Lines logging for historical analysis

### Installation

```bash
# Requires Node.js >= 18
cd website-monitor
npm install
npm run install-browsers
```

### Configuration



#### Option 1: Environment Variables (GitHub Actions / .env)

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

#### Via GitHub Actions (Recommended)



1. Go to repo → **Settings** → **Secrets and variables** → **Actions**
2. Create environment `SVN-Prod` (or similar)
3. Add secrets:
   - `WEBSITE_URLS`: JSON array of URLs
   - `TELEGRAM_BOT_TOKEN`: From [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_CHAT_ID`: Your chat ID
   - `ALLOWED_DOMAINS`: Optional domain whitelist

4. Workflow runs automatically every 10 minutes
5. View runs in Actions tab

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

### Why Not Cloudflare Workers?

Workers cannot execute browser JavaScript runtime (no DOM, no rendering). They only fetch raw HTML — missing all dynamically loaded resources (lazy images, API calls from React/Next.js, etc.). For real user experience simulation, headless browser is required.

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
- ✅ Tích hợp GitHub Actions để giám sát tự động
- ✅ JSON Lines logging cho phân tích lịch sử

### Cài Đặt

```bash
# Cần Node.js >= 18
cd website-monitor
npm install
npm run install-browsers
```

### Cấu Hình

#### Cách 1: Biến Môi Trường (GitHub Actions / .env)

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

#### Qua GitHub Actions (Khuyến Nghị)



1. Vào repo → **Settings** → **Secrets and variables** → **Actions**
2. Tạo environment `SVN-Prod` (hoặc tên khác)
3. Thêm secrets:
   - `WEBSITE_URLS`: JSON array của URLs
   - `TELEGRAM_BOT_TOKEN`: Từ [@BotFather](https://t.me/BotFather)
   - `TELEGRAM_CHAT_ID`: Chat ID của bạn
   - `ALLOWED_DOMAINS`: Whitelist domain (tùy chọn)

4. Workflow tự chạy mỗi 10 phút
5. Xem runs trong tab Actions

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

### Tại Sao Không Dùng Cloudflare Workers?

Workers không thể thực thi JavaScript runtime của trình duyệt (không có DOM, không render). Chúng chỉ fetch HTML thô rồi tự parse — sẽ bỏ sót mọi resource được load động bằng JavaScript (lazy load ảnh, API call từ React/Next.js, v.v.). Để mô phỏng trải nghiệm user thật, cần phải dùng headless browser.

### Mở Rộng Thêm

- So sánh screenshot theo thời gian để phát hiện visual regression
- Kiểm tra Core Web Vitals (LCP, CLS)
- Chạy song song nhiều trang bằng `Promise.all()`
- Tích hợp Elasticsearch cho dashboard uptime
- Biểu đồ waterfall hiệu năng

---

## License

MIT
