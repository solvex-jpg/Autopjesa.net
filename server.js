'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, 'data', 'payments.json');
const ACCOUNT_FILE = path.join(ROOT, 'data', 'accounts.json');
const APP_STATE_FILE = path.join(ROOT, 'data', 'app-state.json');
const SESSION_FILE = path.join(ROOT, 'data', 'sessions.json');
const sessions = new Map();
const ACCOUNT_DATA_KEYS = new Set(['autopjese-chats-v1', 'autopjese-appointments-v1', 'autopjese-cart-v1', 'autopjese-orders-v1', 'autopjese-business-promotion-requests', 'autopjese-promotion-requests']);
loadEnvFile();
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const PRICE_EUR = {
  plus: { 7: 6.99, 14: 10.99, 21: 15.49, 30: 19.99 },
  premium: { 7: 17.99, 14: 29.99, 21: 39.99, 30: 49.99 },
  elite: { 7: 34.99, 14: 59.99, 21: 79.99, 30: 99.99 },
};
const POST_LIMIT = { plus: 30, premium: 50, elite: 100 };

function loadEnvFile() {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !Object.hasOwn(process.env, match[1])) {
        process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

function readOrders() {
  try {
    const value = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeOrders(orders) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const temporary = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(orders, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, DATA_FILE);
}

function readAccounts() {
  try {
    const value = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function writeAccounts(accounts) {
  fs.mkdirSync(path.dirname(ACCOUNT_FILE), { recursive: true });
  const temporary = `${ACCOUNT_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(accounts, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, ACCOUNT_FILE);
}

function publicAccount(account) {
  const { passwordSalt, passwordHash, ...safeAccount } = account;
  return safeAccount;
}

function sessionCookie(request) {
  const token = String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('autopjese_session='))?.slice('autopjese_session='.length);
  if (!token) return null;
  const key = crypto.createHash('sha256').update(token).digest('hex'), session = sessions.get(key);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) { sessions.delete(key); writeSessions(); return null; }
  return session.email;
}

function startSession(response, account) {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(crypto.createHash('sha256').update(token).digest('hex'), { email: account.email, expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 });
  writeSessions();
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('set-cookie', `autopjese_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${secure}`);
}

function writeSessions() {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  const temporary = `${SESSION_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
  fs.renameSync(temporary, SESSION_FILE);
}

try {
  const savedSessions = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
  for (const [key, value] of Object.entries(savedSessions)) if (value?.email && Number(value.expiresAt) > Date.now()) sessions.set(key, value);
  if (Object.keys(savedSessions).length !== sessions.size) writeSessions();
} catch (error) {
  if (error.code !== 'ENOENT') console.error('Could not load persisted sessions:', error.message);
}

function passwordHash(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 210000, 32, 'sha256').toString('hex');
}

function readAppState() {
  try { return JSON.parse(fs.readFileSync(APP_STATE_FILE, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return { listings: [], accounts: {} }; throw error; }
}

function writeAppState(state) {
  fs.mkdirSync(path.dirname(APP_STATE_FILE), { recursive: true });
  const temporary = `${APP_STATE_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temporary, APP_STATE_FILE);
}

function json(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function readBody(request, maxBytes = 8192) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error('Request too large'), { statusCode: 413 }));
      }
    });
    request.on('end', () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { statusCode: 400 })); }
    });
    request.on('error', reject);
  });
}

function payseraConfigured() {
  return Boolean(process.env.PAYSERA_PROJECT_ID && process.env.PAYSERA_PROJECT_PASSWORD && process.env.PAYMENT_PUBLIC_URL);
}

function paymentSetupStatus() {
  const missing = [];
  if (!process.env.PAYSERA_PROJECT_ID) missing.push('PAYSERA_PROJECT_ID');
  if (!process.env.PAYSERA_PROJECT_PASSWORD) missing.push('PAYSERA_PROJECT_PASSWORD');
  if (!process.env.PAYMENT_PUBLIC_URL) missing.push('PAYMENT_PUBLIC_URL');
  return { configured: missing.length === 0, mode: process.env.PAYMENT_TEST === '1' ? 'test' : 'live', missing };
}

function publicBaseUrl() {
  const base = new URL(process.env.PAYMENT_PUBLIC_URL);
  if (base.protocol !== 'https:' && !(process.env.PAYMENT_TEST === '1' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
    throw new Error('PAYMENT_PUBLIC_URL must use HTTPS.');
  }
  return base.origin;
}

function createPayseraUrl(order, baseUrl) {
  const parameters = {
    projectid: process.env.PAYSERA_PROJECT_ID,
    orderid: order.id,
    accepturl: `${baseUrl}/?paymentResult=success&orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.clientToken)}`,
    cancelurl: `${baseUrl}/?paymentResult=cancel&orderId=${encodeURIComponent(order.id)}&token=${encodeURIComponent(order.clientToken)}`,
    callbackurl: `${baseUrl}/api/paysera/callback`,
    version: '1.8',
    amount: String(order.amountCents),
    currency: 'EUR',
    payment: 'card',
    country: 'XK',
    lang: 'ALB',
    paytext: `AUTOPJESA ${order.plan.toUpperCase()} promotion [order_nr]`,
    p_email: order.sellerEmail,
  };
  if (process.env.PAYMENT_TEST === '1') parameters.test = '1';
  const encoded = Buffer.from(new URLSearchParams(parameters).toString(), 'utf8').toString('base64').replace(/\//g, '_').replace(/\+/g, '-');
  const sign = crypto.createHash('md5').update(encoded + process.env.PAYSERA_PROJECT_PASSWORD).digest('hex');
  return `https://www.paysera.com/pay/?${new URLSearchParams({ data: encoded, sign })}`;
}

function safeEqual(a, b) {
  const first = Buffer.from(String(a || ''), 'utf8');
  const second = Buffer.from(String(b || ''), 'utf8');
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function decodePayseraData(encoded) {
  const normalized = String(encoded).replace(/_/g, '/').replace(/-/g, '+');
  return new URLSearchParams(Buffer.from(normalized, 'base64').toString('utf8'));
}

async function handleCallback(request, response, url) {
  if (!payseraConfigured()) return json(response, 503, { error: 'payment_not_configured' });
  let params = url.searchParams;
  if (request.method === 'POST') {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      if (size > 8192) return json(response, 413, { error: 'request_too_large' });
      chunks.push(chunk);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    if (String(request.headers['content-type'] || '').includes('application/json')) {
      try { params = new URLSearchParams(JSON.parse(raw)); }
      catch { return json(response, 400, { error: 'invalid_callback' }); }
    } else {
      params = new URLSearchParams(raw);
    }
  }
  const data = params.get('data'), signature = params.get('ss1') || params.get('sign');
  if (!data || !signature) return json(response, 400, { error: 'missing_signature' });
  const expected = crypto.createHash('md5').update(data + process.env.PAYSERA_PROJECT_PASSWORD).digest('hex');
  if (!safeEqual(signature.toLowerCase(), expected.toLowerCase())) return json(response, 400, { error: 'invalid_signature' });

  let callback;
  try { callback = decodePayseraData(data); }
  catch { return json(response, 400, { error: 'invalid_callback_data' }); }
  if (callback.get('projectid') !== String(process.env.PAYSERA_PROJECT_ID)) return json(response, 400, { error: 'wrong_project' });
  const orders = readOrders();
  const order = orders.find(item => item.id === callback.get('orderid'));
  if (!order) return json(response, 404, { error: 'order_not_found' });
  const paidAmount = callback.get('payamount') || callback.get('amount');
  const paidCurrency = callback.get('paycurrency') || callback.get('currency');
  if (paidAmount !== String(order.amountCents) || paidCurrency !== 'EUR') return json(response, 400, { error: 'amount_mismatch' });
  const status = callback.get('status');
  order.gatewayStatus = status;
  order.callbackReceivedAt = Date.now();
  if (status === '1' || status === '3') {
    order.status = 'paid';
    order.paidAt ||= Date.now();
  } else if (order.status !== 'paid') {
    order.status = status === '0' ? 'not_paid' : 'pending';
  }
  writeOrders(orders);
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  response.end('OK');
}

async function handleApi(request, response, url) {
  if (url.pathname === '/api/health' && request.method === 'GET') {
    return json(response, 200, { ok: true, payments: paymentSetupStatus() });
  }

  if (url.pathname === '/api/listings' && request.method === 'GET') {
    const state = readAppState(), email = sessionCookie(request);
    return json(response, 200, { listings: state.listings.filter(item => item.email === email || item.status !== 'sold') });
  }

  if (url.pathname === '/api/listings' && request.method === 'PUT') {
    const email = sessionCookie(request);
    if (!email) return json(response, 401, { error: 'not_signed_in' });
    let body;
    try { body = await readBody(request, 20 * 1024 * 1024); }
    catch (error) { return json(response, error.statusCode || 400, { error: 'invalid_request' }); }
    if (!Array.isArray(body.listings) || body.listings.length > 1000) return json(response, 400, { error: 'invalid_listings' });
    const own = body.listings.filter(item => item && item.email === email && typeof item.id === 'string' && typeof item.title === 'string').map(item => ({ ...item, title: item.title.slice(0, 120) }));
    const state = readAppState();
    state.listings = [...state.listings.filter(item => item.email !== email), ...own];
    writeAppState(state);
    return json(response, 200, { saved: own.length });
  }

  if (url.pathname === '/api/orders' && request.method === 'GET') {
    const email = sessionCookie(request);
    if (!email) return json(response, 401, { error: 'not_signed_in' });
    const state = readAppState(), orders = Array.isArray(state.orders) ? state.orders : [];
    const visible = orders.filter(order => order.buyerEmail === email || order.sellerEmails?.includes(email)).map(order => {
      if (order.buyerEmail === email) return { ...order, sellerItems: order.items };
      const sellerItems = order.items.filter(item => item.sellerEmail === email);
      return { ...order, items: sellerItems, sellerItems, sellers: [...new Set(sellerItems.map(item => item.seller))], sellerEmails: [email], total: sellerItems.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.quantity) || 1), 0), sellerStatus: order.sellerStatuses?.[email] || 'Në pritje të shitësit' };
    });
    return json(response, 200, { orders: visible });
  }

  if (url.pathname === '/api/orders' && request.method === 'POST') {
    const email = sessionCookie(request);
    if (!email) return json(response, 401, { error: 'not_signed_in' });
    let body;
    try { body = await readBody(request, 256 * 1024); }
    catch (error) { return json(response, error.statusCode || 400, { error: 'invalid_request' }); }
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 50) return json(response, 400, { error: 'invalid_order' });
    const state = readAppState(), canonical = new Map(state.listings.map(item => [item.id, item]));
    const items = [];
    for (const requested of body.items) {
      const listing = canonical.get(String(requested.listingId || ''));
      const quantity = Math.floor(Number(requested.quantity));
      if (!listing || listing.status === 'sold' || !listing.email || listing.email === email || quantity < 1 || quantity > 100 || quantity > (Number(listing.quantity) || 1)) return json(response, 400, { error: 'unavailable_item', message: 'Një pjesë nuk është më në dispozicion. Rifresko shportën.' });
      items.push({ listingId: listing.id, title: listing.title, seller: listing.seller, sellerEmail: listing.email, price: Number(listing.price) || 0, photo: listing.photo || '', city: listing.city || '', quantity });
    }
    const sellerEmails = [...new Set(items.map(item => item.sellerEmail))];
    const order = { id: crypto.randomUUID(), buyerEmail: email, items, sellerEmails, sellers: [...new Set(items.map(item => item.seller))], total: items.reduce((sum, item) => sum + item.price * item.quantity, 0), status: 'Në pritje të shitësit', sellerStatuses: {}, created: Date.now() };
    state.orders = Array.isArray(state.orders) ? state.orders : [];
    state.orders.unshift(order); writeAppState(state);
    return json(response, 201, { order });
  }

  if (url.pathname.startsWith('/api/orders/') && request.method === 'PATCH') {
    const email = sessionCookie(request);
    if (!email) return json(response, 401, { error: 'not_signed_in' });
    let body;
    try { body = await readBody(request, 4096); }
    catch (error) { return json(response, error.statusCode || 400, { error: 'invalid_request' }); }
    const allowed = new Set(['E pranuar', 'E dërguar', 'E përfunduar', 'E refuzuar']);
    if (!allowed.has(body.status)) return json(response, 400, { error: 'invalid_status' });
    const state = readAppState(), id = decodeURIComponent(url.pathname.slice('/api/orders/'.length)), order = (state.orders || []).find(item => item.id === id);
    if (!order || !order.sellerEmails?.includes(email)) return json(response, 404, { error: 'order_not_found' });
    order.sellerStatuses = order.sellerStatuses || {}; order.sellerStatuses[email] = body.status;
    const statuses = order.sellerEmails.map(seller => order.sellerStatuses[seller] || 'Në pritje të shitësit');
    order.status = statuses.every(status => status === 'E përfunduar') ? 'E përfunduar' : statuses.some(status => status === 'E refuzuar') ? 'E refuzuar' : statuses.some(status => status === 'E dërguar') ? 'E dërguar' : statuses.some(status => status === 'E pranuar') ? 'E pranuar' : 'Në pritje të shitësit';
    writeAppState(state);
    return json(response, 200, { order: { ...order, sellerItems: order.items.filter(item => item.sellerEmail === email), sellerStatus: order.sellerStatuses[email] } });
  }

  if (url.pathname === '/api/account-data' && request.method === 'GET') {
    const email = sessionCookie(request);
    if (!email) return json(response, 401, { error: 'not_signed_in' });
    const state = readAppState();
    return json(response, 200, { data: state.accounts[email] || {} });
  }

  if (url.pathname === '/api/account-data' && request.method === 'PUT') {
    const email = sessionCookie(request);
    if (!email) return json(response, 401, { error: 'not_signed_in' });
    let body;
    try { body = await readBody(request, 5 * 1024 * 1024); }
    catch (error) { return json(response, error.statusCode || 400, { error: 'invalid_request' }); }
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return json(response, 400, { error: 'invalid_account_data' });
    const safeData = {};
    for (const [key, value] of Object.entries(body.data)) if (ACCOUNT_DATA_KEYS.has(key)) safeData[key] = value;
    const state = readAppState();
    state.accounts[email] = { ...(state.accounts[email] || {}), ...safeData };
    writeAppState(state);
    return json(response, 200, { saved: Object.keys(safeData).length });
  }

  if (url.pathname === '/api/auth/register' && request.method === 'POST') {
    let body;
    try { body = await readBody(request, 16384); }
    catch (error) { return json(response, error.statusCode || 400, { error: 'invalid_request' }); }
    const name = String(body.name || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase();
    const phone = String(body.phone || '').trim().slice(0, 40);
    const password = String(body.password || '');
    const accountType = body.accountType === 'business' ? 'business' : 'private';
    const businessName = accountType === 'business' ? String(body.businessName || '').trim().slice(0, 120) : '';
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || phone.length < 5 || accountType === 'business' && !businessName) {
      return json(response, 400, { error: 'invalid_registration', message: 'Kontrollo emrin, email-in, telefonin dhe fjalëkalimin.' });
    }
    const accounts = readAccounts();
    if (accounts.some(account => account.email === email)) return json(response, 409, { error: 'email_exists', message: 'Ky email ka një llogari. Hyr në llogari.' });
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const account = { id: crypto.randomUUID(), name, email, phone, accountType, businessName, passwordSalt, passwordHash: passwordHash(password, passwordSalt), createdAt: Date.now(), devices: [] };
    accounts.push(account);
    writeAccounts(accounts);
    startSession(response, account);
    return json(response, 201, { user: publicAccount(account) });
  }

  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    let body;
    try { body = await readBody(request, 8192); }
    catch (error) { return json(response, error.statusCode || 400, { error: 'invalid_request' }); }
    const email = String(body.email || '').trim().toLowerCase(), password = String(body.password || '');
    const account = readAccounts().find(item => item.email === email);
    if (!account || !safeEqual(passwordHash(password, account.passwordSalt), account.passwordHash)) return json(response, 401, { error: 'invalid_credentials', message: 'Email-i ose fjalëkalimi nuk është i saktë.' });
    startSession(response, account);
    return json(response, 200, { user: publicAccount(account) });
  }

  if (url.pathname === '/api/auth/me' && request.method === 'GET') {
    const email = sessionCookie(request);
    const account = email && readAccounts().find(item => item.email === email);
    if (!account) return json(response, 200, { user: null });
    return json(response, 200, { user: publicAccount(account) });
  }

  if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
    const token = String(request.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('autopjese_session='))?.slice('autopjese_session='.length);
    if (token) { sessions.delete(crypto.createHash('sha256').update(token).digest('hex')); writeSessions(); }
    response.setHeader('set-cookie', 'autopjese_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
    return json(response, 200, { ok: true });
  }

  if (url.pathname === '/api/auth/profile' && request.method === 'PATCH') {
    const email = sessionCookie(request);
    if (!email) return json(response, 401, { error: 'not_signed_in' });
    let body;
    try { body = await readBody(request, 5 * 1024 * 1024); }
    catch (error) { return json(response, error.statusCode || 400, { error: 'invalid_request' }); }
    const accounts = readAccounts(), account = accounts.find(item => item.email === email);
    if (!account) return json(response, 401, { error: 'not_signed_in' });
    const name = String(body.name || '').trim().slice(0, 100), phone = String(body.phone || '').trim().slice(0, 40), businessName = account.accountType === 'business' ? String(body.businessName || '').trim().slice(0, 120) : account.businessName;
    const newEmail = String(body.email || '').trim().toLowerCase();
    if (name.length < 2 || phone.length < 5 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || account.accountType === 'business' && !businessName) return json(response, 400, { error: 'invalid_profile' });
    if (accounts.some(item => item !== account && item.email === newEmail)) return json(response, 409, { error: 'email_exists' });
    account.name = name; account.phone = phone; account.email = newEmail; account.businessName = businessName;
    for (const key of ['location', 'profilePhoto', 'businessLogo', 'socials', 'workHours', 'twoFactor', 'devices', 'profanityStrikes', 'profanityBlockedUntil']) {
      if (Object.hasOwn(body, key)) account[key] = body[key];
    }
    if (newEmail !== email) {
      for (const [token, session] of sessions) if (session.email === email) sessions.set(token, { ...session, email: newEmail });
      writeSessions();
      const state = readAppState();
      state.listings = state.listings.map(item => item.email === email ? { ...item, email: newEmail, seller: name } : item);
      state.orders = (state.orders || []).map(order => ({ ...order,
        buyerEmail: order.buyerEmail === email ? newEmail : order.buyerEmail,
        sellerEmails: (order.sellerEmails || []).map(value => value === email ? newEmail : value),
        items: (order.items || []).map(item => ({ ...item, sellerEmail: item.sellerEmail === email ? newEmail : item.sellerEmail })),
        sellerStatuses: Object.fromEntries(Object.entries(order.sellerStatuses || {}).map(([key, value]) => [key === email ? newEmail : key, value])),
      }));
      if (state.accounts[email]) {
        const oldData = state.accounts[email];
        for (const rows of Object.values(oldData)) if (Array.isArray(rows)) for (const row of rows) {
          for (const key of ['buyerEmail', 'sellerEmail', 'customerEmail', 'senderEmail', 'email']) if (row[key] === email) row[key] = newEmail;
        }
        state.accounts[newEmail] = { ...(state.accounts[newEmail] || {}), ...oldData };
        delete state.accounts[email];
      }
      writeAppState(state);
    }
    writeAccounts(accounts);
    return json(response, 200, { user: publicAccount(account) });
  }

  if (url.pathname === '/api/payments/config' && request.method === 'GET') {
    const setup = paymentSetupStatus();
    return json(response, setup.configured ? 200 : 503, setup);
  }

  if (url.pathname === '/api/payments/create' && request.method === 'POST') {
    if (!payseraConfigured()) return json(response, 503, { error: 'payment_not_configured', message: 'Pagesat me kartelë nuk janë aktivizuar ende. Duhet të konfigurohen kredencialet Paysera dhe adresa publike HTTPS.' });
    const sessionEmail = sessionCookie(request);
    if (!sessionEmail) return json(response, 401, { error: 'not_signed_in', message: 'Hyr në llogari para se të blesh promovimin.' });
    let body;
    try { body = await readBody(request); }
    catch (error) { return json(response, error.statusCode || 400, { error: error.message }); }
    const plan = String(body.plan || ''), durationDays = Number(body.durationDays), account = readAccounts().find(item => item.email === sessionEmail), sellerEmail = sessionEmail;
    if (!account) return json(response, 401, { error: 'not_signed_in' });
    if (!PRICE_EUR[plan] || !PRICE_EUR[plan][durationDays]) {
      return json(response, 400, { error: 'invalid_package' });
    }
    let baseUrl;
    try { baseUrl = publicBaseUrl(); }
    catch (error) { return json(response, 503, { error: 'invalid_payment_url', message: error.message }); }
    const id = crypto.randomUUID().replace(/-/g, '');
    const order = {
      id,
      reference: `AP-${id.slice(0, 10).toUpperCase()}`,
      clientToken: crypto.randomBytes(24).toString('base64url'),
      sellerEmail,
      sellerName: String(account.businessName || account.name).slice(0, 120),
      plan,
      durationDays,
      postLimit: POST_LIMIT[plan],
      amountCents: Math.round(PRICE_EUR[plan][durationDays] * 100),
      currency: 'EUR',
      status: 'pending',
      createdAt: Date.now(),
    };
    const orders = readOrders();
    orders.push(order);
    writeOrders(orders);
    return json(response, 200, {
      paymentUrl: createPayseraUrl(order, baseUrl),
      orderId: order.id,
      clientToken: order.clientToken,
      reference: order.reference,
    });
  }

  if (url.pathname === '/api/paysera/callback' && ['GET', 'POST'].includes(request.method)) {
    try { return await handleCallback(request, response, url); }
    catch (error) { return json(response, 500, { error: 'callback_processing_error' }); }
  }

  if (url.pathname === '/api/payments/status' && request.method === 'GET') {
    const order = readOrders().find(item => item.id === url.searchParams.get('orderId'));
    if (!order || !safeEqual(order.clientToken, url.searchParams.get('token'))) return json(response, 404, { error: 'order_not_found' });
    return json(response, 200, {
      orderId: order.id,
      reference: order.reference,
      sellerEmail: order.sellerEmail,
      plan: order.plan,
      durationDays: order.durationDays,
      postLimit: order.postLimit,
      amountCents: order.amountCents,
      currency: order.currency,
      status: order.status,
      paidAt: order.paidAt || null,
    });
  }
  return json(response, 404, { error: 'not_found' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(request, response, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname); }
  catch { response.writeHead(400); return response.end('Bad request'); }
  const publicFiles = new Set(['/index.html', '/app.js', '/auth-backend.js', '/style.css', '/language.js', '/payment-ui.js', '/promotion-invoices.js', '/order-tracking.js']);
  const isAsset = pathname.startsWith('/assets/') && !pathname.split('/').includes('..');
  if (!publicFiles.has(pathname) && !isAsset) { response.writeHead(404); return response.end('Not found'); }
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) { response.writeHead(404); return response.end('Not found'); }
  fs.readFile(filePath, (error, contents) => {
    if (error) { response.writeHead(404); return response.end('Not found'); }
    response.writeHead(200, { 'content-type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' });
    response.end(contents);
  });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await handleApi(request, response, url);
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405); return response.end('Method not allowed'); }
    if (request.method === 'HEAD') { response.writeHead(200); return response.end(); }
    return serveStatic(request, response, url);
  } catch (error) {
    console.error('Request failed:', error);
    if (!response.headersSent) json(response, 500, { error: 'internal_server_error', message: 'Ndodhi një gabim në server.' });
    else response.destroy();
  }
});
server.listen(PORT, HOST, () => console.log(`AUTOPJESA running at http://${HOST}:${PORT}`));
