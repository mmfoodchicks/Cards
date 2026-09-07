import { chromium } from 'playwright-core';
const OUT = '/tmp/claude-0/-home-user-Cards/98a00b39-a1ca-5ca5-9eb1-8162d29fee54/scratchpad';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 414, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto('http://localhost:8420/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/cl-home.png` });
for (const [name, file] of [['Buy','cl-buy'],['Stock','cl-stock'],['Record','cl-record'],['Taxes','cl-taxes'],['Setup','cl-setup'],['You','cl-you']]) {
  await page.locator('.tabbar button', { hasText: name }).first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${file}.png` });
}
console.log('page errors:', errors.length ? errors.slice(0,5) : 'none');
await browser.close();
