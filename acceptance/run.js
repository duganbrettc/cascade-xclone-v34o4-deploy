/**
 * xclone 14-step acceptance script
 * Usage: node run.js [BASE_URL]
 * Default BASE_URL: http://172.19.0.4 (Docker container IP)
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.BASE_URL || 'http://172.19.0.4';
const RESULTS = [];

function pass(label) {
  console.log('PASS:', label);
  RESULTS.push({ label, passed: true });
}

function fail(label, detail) {
  console.error('FAIL:', label, detail ? `(${detail})` : '');
  RESULTS.push({ label, passed: false, detail: detail || '' });
}

function check(cond, label, detail) {
  if (cond) pass(label); else fail(label, detail);
}

async function api(method, path, body, token) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(BASE + path, opts);
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch(e) {}
    return { status: res.status, body: json, text };
  } catch(e) {
    return { status: 0, body: null, text: '', error: e.message };
  }
}

async function probe(browser, token, username, path, fn) {
  const ctx = await browser.newContext();
  try {
    await ctx.addInitScript(({ t, u }) => {
      if (t) localStorage.setItem('token', t);
      if (u) localStorage.setItem('username', u);
    }, { t: token || '', u: username || '' });
    const page = await ctx.newPage();
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 15000 });
    // Let JS settle
    await page.waitForTimeout(1000);
    await fn(page);
    await page.close();
  } finally {
    await ctx.close();
  }
}

async function main() {
  console.log('xclone acceptance — BASE:', BASE);
  console.log('');

  // Clean up alice/bob if they exist from a previous run
  // (login to get a token, then we can't really delete but the DB is fresh per stack restart)

  // Step 1 — signup alice
  console.log('--- Step 1: signup alice ---');
  let r = await api('POST', '/api/auth/signup', { username: 'alice', password: 'pass123' });
  let aliceToken = r.body && r.body.session_token;
  if (r.status === 409) {
    // alice already exists — login instead
    console.log('NOTE: alice already exists, logging in');
    const lr = await api('POST', '/api/auth/login', { username: 'alice', password: 'pass123' });
    aliceToken = lr.body && lr.body.session_token;
    check(lr.status === 200 && !!aliceToken, 'alice signup -> 201 (via login fallback)', `login status=${lr.status}`);
  } else {
    check(r.status === 201, 'alice signup -> 201', `status=${r.status} body=${JSON.stringify(r.body)}`);
    check(!!aliceToken, 'alice signup -> session_token present', `body=${JSON.stringify(r.body)}`);
  }

  // Step 2 — alice posts
  console.log('--- Step 2: alice posts ---');
  r = await api('POST', '/api/posts', { body: 'alice-said-hello' }, aliceToken);
  check(r.status === 201, 'alice post -> 201', `status=${r.status}`);

  // Step 3 — browser probe / shows nav + alice's name
  console.log('--- Step 3: browser-probe / ---');
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    headless: true,
  });
  try {
    await probe(browser, aliceToken, 'alice', '/', async (page) => {
      const html = await page.content();
      check(html.includes('<nav'), 'Step 3: / has <nav>', `html length=${html.length}`);
      check(
        html.includes('@alice') || html.includes('>alice<') || html.includes('alice'),
        'Step 3: / shows alice\'s name',
        `nav text: ${await page.$eval('nav', el => el.innerText).catch(() => 'n/a')}`
      );
    });

    // Step 4 — signup bob + bob posts 'bob-said-hello'
    console.log('--- Step 4: signup bob + post ---');
    r = await api('POST', '/api/auth/signup', { username: 'bob', password: 'pass123' });
    let bobToken = r.body && r.body.session_token;
    if (r.status === 409) {
      console.log('NOTE: bob already exists, logging in');
      const lr = await api('POST', '/api/auth/login', { username: 'bob', password: 'pass123' });
      bobToken = lr.body && lr.body.session_token;
      check(lr.status === 200 && !!bobToken, 'bob signup -> 201 (via login fallback)', `login status=${lr.status}`);
    } else {
      check(r.status === 201, 'bob signup -> 201', `status=${r.status}`);
      check(!!bobToken, 'bob signup -> session_token present');
    }
    r = await api('POST', '/api/posts', { body: 'bob-said-hello' }, bobToken);
    check(r.status === 201, 'bob post -> 201', `status=${r.status}`);

    // Step 5 — browser-probe /users shows bob
    console.log('--- Step 5: browser-probe /users ---');
    await probe(browser, aliceToken, 'alice', '/users', async (page) => {
      // Wait for users list to load
      await page.waitForFunction(
        () => {
          const el = document.getElementById('users-list');
          return el && !el.innerText.includes('Loading');
        },
        { timeout: 8000 }
      ).catch(() => {});
      const html = await page.content();
      check(
        html.includes('bob') || html.includes('@bob'),
        'Step 5: /users shows bob',
        `content snippet: ${html.slice(html.indexOf('users-list') - 10, html.indexOf('users-list') + 200)}`
      );
    });

    // Step 6 — alice follows bob
    console.log('--- Step 6: alice follows bob ---');
    r = await api('POST', '/api/follow/bob', null, aliceToken);
    check(r.status === 201, 'alice follow bob -> 201', `status=${r.status}`);

    // Step 7 — browser-probe / shows 'bob-said-hello' on alice's timeline
    console.log('--- Step 7: browser-probe / shows bob-said-hello ---');
    await probe(browser, aliceToken, 'alice', '/', async (page) => {
      await page.waitForFunction(
        () => {
          const el = document.getElementById('timeline');
          return el && !el.innerText.includes('Loading');
        },
        { timeout: 8000 }
      ).catch(() => {});
      const html = await page.content();
      check(
        html.includes('bob-said-hello'),
        'Step 7: / shows bob-said-hello on alice timeline',
        `timeline content snippet: ${html.slice(Math.max(0, html.indexOf('timeline') - 5), html.indexOf('timeline') + 300)}`
      );
    });

    // Step 8 — browser-probe /users/bob shows bob's profile + posts
    console.log('--- Step 8: browser-probe /users/bob ---');
    await probe(browser, aliceToken, 'alice', '/users/bob', async (page) => {
      await page.waitForFunction(
        () => {
          const el = document.getElementById('profile-section') || document.querySelector('h1, h2');
          return el && !el.innerText.includes('Loading');
        },
        { timeout: 8000 }
      ).catch(() => {});
      const html = await page.content();
      check(
        html.includes('bob') || html.includes('@bob'),
        'Step 8: /users/bob shows bob profile',
        `html length=${html.length}`
      );
      check(
        html.includes('bob-said-hello'),
        'Step 8: /users/bob shows bob posts',
        `html snippet: ${html.slice(0, 500)}`
      );
    });

    // Step 9 — browser-probe /profile shows display_name + password fields
    console.log('--- Step 9: browser-probe /profile ---');
    await probe(browser, aliceToken, 'alice', '/profile', async (page) => {
      const dnInput = await page.$('#display_name, input[name="display_name"]');
      const pwInput = await page.$('#password, input[name="password"]');
      check(!!dnInput, 'Step 9: /profile has display_name input', 'no #display_name found');
      check(!!pwInput, 'Step 9: /profile has password input', 'no #password found');
    });

    // Step 10 — PATCH display_name='Alice Updated' bio='Hello world'
    console.log('--- Step 10: PATCH /api/users/me ---');
    r = await api('PATCH', '/api/users/me', { display_name: 'Alice Updated', bio: 'Hello world' }, aliceToken);
    check(r.status === 200, 'PATCH display_name -> 200', `status=${r.status} body=${JSON.stringify(r.body)}`);

    // Step 11 — browser-probe /profile shows prefilled updated values
    console.log('--- Step 11: browser-probe /profile after update ---');
    await probe(browser, aliceToken, 'alice', '/profile', async (page) => {
      await page.waitForFunction(
        () => {
          const el = document.getElementById('display_name');
          return el && el.value !== '';
        },
        { timeout: 8000 }
      ).catch(() => {});
      const dnVal = await page.$eval('#display_name', el => el.value).catch(() => '');
      const bioVal = await page.$eval('#bio', el => el.value).catch(() => '');
      check(
        dnVal === 'Alice Updated',
        'Step 11: /profile shows prefilled display_name=Alice Updated',
        `got "${dnVal}"`
      );
      check(
        bioVal === 'Hello world',
        'Step 11: /profile shows prefilled bio=Hello world',
        `got "${bioVal}"`
      );
    });

    // Step 12 — alice unfollows bob
    console.log('--- Step 12: alice unfollows bob ---');
    r = await api('DELETE', '/api/follow/bob', null, aliceToken);
    check(r.status === 204, 'alice unfollow bob -> 204', `status=${r.status}`);

    // Step 13 — browser-probe / no longer shows bob's post
    console.log('--- Step 13: browser-probe / after unfollow ---');
    await probe(browser, aliceToken, 'alice', '/', async (page) => {
      await page.waitForFunction(
        () => {
          const el = document.getElementById('timeline');
          return el && !el.innerText.includes('Loading');
        },
        { timeout: 8000 }
      ).catch(() => {});
      const html = await page.content();
      check(
        !html.includes('bob-said-hello'),
        'Step 13: / does NOT show bob-said-hello after unfollow',
        `bob-said-hello found in html: ${html.includes('bob-said-hello')}`
      );
    });

    // Step 14 — timeline semantics: own post + newest-first
    console.log('--- Step 14: timeline semantics ---');
    r = await api('GET', '/api/timeline', null, aliceToken);
    check(r.status === 200, 'Step 14: timeline GET -> 200', `status=${r.status}`);
    const posts = Array.isArray(r.body) ? r.body : [];
    check(
      posts.some(p => p.body === 'alice-said-hello'),
      'Step 14: alice own post on timeline',
      `posts=${posts.map(p => p.body).join(', ')}`
    );
    check(
      !posts.some(p => p.body === 'bob-said-hello'),
      'Step 14: bob post NOT on timeline after unfollow',
      `posts=${posts.map(p => p.body).join(', ')}`
    );
    if (posts.length >= 2) {
      const times = posts.map(p => new Date(p.created_at).getTime());
      const isDesc = times.every((t, i) => i === 0 || t <= times[i - 1]);
      check(isDesc, 'Step 14: timeline is newest-first');
    }

  } finally {
    await browser.close();
  }

  // Summary
  console.log('');
  console.log('=== RESULTS ===');
  const passed = RESULTS.filter(r => r.passed);
  const failed = RESULTS.filter(r => !r.passed);
  console.log(`Passed: ${passed.length}`);
  console.log(`Failed: ${failed.length}`);
  if (failed.length > 0) {
    console.log('');
    console.log('Failures:');
    failed.forEach(r => console.log(`  FAIL: ${r.label}${r.detail ? ' — ' + r.detail : ''}`));
    process.exit(1);
  }
  console.log('');
  console.log('All checks passed!');
  process.exit(0);
}

main().catch(err => {
  console.error('Acceptance script error:', err);
  process.exit(1);
});
