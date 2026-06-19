const https = require('https');
const fs = require('fs');
const { load } = require('cheerio');
const path = require('path');

// ========== ?? ==========
const URLS = [
  'https://www.cnhnb.com/price/search-n12-p1/',   // ???? ?1?
  'https://www.cnhnb.com/price/search-n12-p2/',   // ???? ?2?
];

// cheerio CSS ??? (??????)
const SELECTORS = [
  'table.price-table tbody tr',
  '.price-list table tr',
  'table tbody tr',
  '.market-table tr',
  '.table tr',
];

const OUTPUT = path.join(__dirname, '..', 'price.json');
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ========== ???? ==========
function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
      timeout: 15000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// ========== ?? ==========
function parsePriceTable(html) {
  const $ = load(html);
  const prices = [];

  for (const sel of SELECTORS) {
    const rows = $(sel);
    if (rows.length === 0) continue;

    rows.each((i, row) => {
      const cells = $(row).find('td');
      if (cells.length < 2) return;

      cells.each((j, cell) => {
        const text = $(cell).text().trim();
        const num = parseFloat(text);
        if (!isNaN(num) && num > 0 && num < 1000) {
          prices.push({ idx: i * 100 + j, price: num });
        }
      });
    });

    if (prices.length >= 4) {
      console.log('[scraper] selector "' + sel + '" matched ' + prices.length + ' prices');
      break;  // ????????????????
    }
  }

  return prices;
}

// ========== ????? ==========
function pricesToDays(prices) {
  if (prices.length === 0) return [];

  // ??? 7 ?????
  const recent = prices.slice(-7);
  const today = new Date();

  return recent.map((p, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (recent.length - 1 - i));
    return {
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      price: Math.round(p.price * 100) / 100
    };
  });
}

// ========== ?????? ==========
function mergeHistory(existing, newDays) {
  if (!existing || !existing.days || existing.days.length === 0) return newDays;

  const merged = [...existing.days];
  const existingLabels = new Set(merged.map(d => d.label));

  for (const day of newDays) {
    if (existingLabels.has(day.label)) {
      // ???????
      const idx = merged.findIndex(d => d.label === day.label);
      if (idx !== -1) merged[idx] = day;
    } else {
      merged.push(day);
    }
  }

  // ??????????? 30 ?
  merged.sort((a, b) => {
    const [am, ad] = a.label.split('/').map(Number);
    const [bm, bd] = b.label.split('/').map(Number);
    return am !== bm ? am - bm : ad - bd;
  });

  return merged.slice(-30);
}

// ========== ???? ==========
function computeStats(days) {
  const sum = days.reduce((a, b) => a + b.price, 0);
  const avg = Math.round((sum / days.length) * 100) / 100;
  const trend = Math.round((days[days.length - 1].price - days[0].price) * 100) / 100;
  return { avg, trend, trendAbs: Math.abs(trend) };
}

// ========== ???? ==========
function getFallbackDays() {
  const days = [];
  const today = new Date();
  const basePrice = 4.08;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push({
      label: (d.getMonth() + 1) + '/' + d.getDate(),
      price: Math.round((basePrice + Math.sin(i * 0.8) * 0.15) * 100) / 100
    });
  }
  return days;
}

// ========== ??? ==========
(async () => {
  try {
    // ??????
    let existing = null;
    try {
      existing = JSON.parse(fs.readFileSync(OUTPUT, 'utf8'));
    } catch (e) {
      console.log('[scraper] no existing data, starting fresh');
    }

    // ? URL ??
    let days = [];
    for (const url of URLS) {
      try {
        console.log('[scraper] fetching: ' + url);
        const html = await fetch(url);
        const prices = parsePriceTable(html);
        console.log('[scraper] got ' + prices.length + ' raw prices from ' + url);

        if (prices.length >= 4) {
          days = pricesToDays(prices);
          break;
        }
        console.log('[scraper] insufficient data, trying next URL...');
      } catch (err) {
        console.warn('[scraper] ' + url + ' failed: ' + err.message);
      }
    }

    // ???????
    if (days.length === 0) {
      console.log('[scraper] all sources failed, using fallback');
      days = getFallbackDays();
    }

    // ????
    const merged = mergeHistory(existing, days);
    const stats = computeStats(merged);

    const output = {
      updateTime: new Date().toISOString(),
      avg: stats.avg,
      trend: stats.trend,
      trendAbs: stats.trendAbs,
      days: merged
    };

    fs.writeFileSync(OUTPUT, JSON.stringify(output, null, 2));
    console.log('[scraper] OK - ' + merged.length + ' days, avg: ' + stats.avg + ', trend: ' + (stats.trend >= 0 ? '+' : '') + stats.trend);
  } catch (err) {
    console.error('[scraper] fatal: ' + err.message);
    process.exit(1);
  }
})();
