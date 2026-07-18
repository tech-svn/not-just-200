# Website Monitor

[![Website Monitor](https://github.com/tech-svn/not-just-200/actions/workflows/website-monitor.yml/badge.svg)](https://github.com/tech-svn/not-just-200/actions/workflows/website-monitor.yml)


Công cụ kiểm tra định kỳ website bằng **headless Chromium (Playwright)**.
Không chỉ check status code của trang chính — mà mô phỏng đúng trình duyệt thật:
mở trang, chạy JS, load ảnh/CSS/font/API call, rồi báo lỗi nếu **bất kỳ resource nào**
trả về lỗi hoặc load thất bại.

## 1. Cài đặt (trên Ubuntu/VPS/local PC)

```bash
# Cần Node.js >= 18
cd website-monitor
npm install
npx playwright install --with-deps chromium
```

## 2. Cấu hình

Sửa file `config.json`:

- `urls`: danh sách trang cần theo dõi (`name`, `url`, `timeoutMs`)
- `check.maxAllowedLoadTimeMs`: ngưỡng thời gian load tối đa, vượt quá coi như lỗi
- `telegram.botToken` / `telegram.chatId`: lấy từ [@BotFather](https://t.me/BotFather),
  và chat_id lấy bằng cách nhắn tin cho bot rồi gọi
  `https://api.telegram.org/bot<TOKEN>/getUpdates`

## 3. Chạy thử 1 lần

```bash
node monitor.js
```

Kết quả:
- In log ra console
- Ghi log chi tiết (JSON Lines) vào `logs/YYYY-MM-DD.jsonl`
- Nếu lỗi: chụp screenshot vào `screenshots/`, gửi cảnh báo Telegram
- Exit code: `0` nếu tất cả OK, `1` nếu có ít nhất 1 trang lỗi

## 4. Chạy định kỳ bằng cron (mỗi 5-15 phút)

```bash
crontab -e
```

Thêm dòng (chạy mỗi 10 phút):

```
*/10 * * * * cd /path/to/website-monitor && /usr/bin/node monitor.js >> cron.log 2>&1
```

## 5. Chạy bằng Docker (khuyến nghị — dễ deploy nhiều nơi)

Playwright cung cấp sẵn Docker image có Chromium cài sẵn, tránh phải cài
dependencies hệ thống thủ công:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.48.0-jammy
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["node", "monitor.js"]
```

Build và chạy định kỳ bằng cron trên host (gọi `docker run` mỗi 10 phút),
hoặc dùng `docker run` kèm cron bên trong container nếu muốn container tự chạy nền:

```bash
docker build -t website-monitor .
docker run --rm -v $(pwd)/config.json:/app/config.json \
           -v $(pwd)/logs:/app/logs \
           -v $(pwd)/screenshots:/app/screenshots \
           website-monitor
```

Chạy từ nhiều địa điểm (multi-region check): deploy cùng image này trên nhiều
VPS ở khu vực khác nhau (VD: Việt Nam, Singapore, US) — mỗi nơi chạy cron riêng,
gửi cảnh báo Telegram chung 1 bot, có thể thêm tên vùng vào `target.name` để phân biệt.

## 6. Về việc dùng Cloudflare Worker

**Không dùng Worker cho trang SPA/Next.js** vì Worker không chạy được JS runtime
của trình duyệt (không có DOM, không render). Worker chỉ `fetch()` HTML thô rồi
tự parse — sẽ bỏ sót mọi resource được load động bằng JavaScript (lazy load ảnh,
API call từ React/Next.js, dynamic import...). Với yêu cầu "trải nghiệm user thật",
Worker không đáp ứng được, bắt buộc phải dùng headless browser như trên.

## 7. Mở rộng thêm (nếu cần sau này)

- So sánh screenshot theo thời gian để phát hiện visual regression
- Kiểm tra Core Web Vitals (LCP, CLS) bằng Playwright's `page.evaluate()`
  lấy Performance API
- Chạy song song nhiều trang bằng `Promise.all` nếu danh sách URL dài
- Đẩy log vào Elasticsearch (mày đã có sẵn cluster) để dashboard hoá lịch sử uptime
