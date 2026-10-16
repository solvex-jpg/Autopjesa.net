(() => {
  const request = async (path, options = {}) => {
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.message || 'Lidhja me serverin dështoi.'), { status: response.status, code: result.error });
    return result;
  };
  const body = value => JSON.stringify(value);
  const privateKeys = ['autopjese-chats-v1', 'autopjese-appointments-v1', 'autopjese-cart-v1', 'autopjese-orders-v1', 'autopjese-business-promotion-requests'];
  const accountDataFor = email => Object.fromEntries(privateKeys.map(key => {
    let value;
    try { value = JSON.parse(localStorage.getItem(key) || '[]'); } catch { value = []; }
    if (Array.isArray(value)) value = value.filter(item => key === 'autopjese-chats-v1' ? item.buyerEmail === email || item.sellerEmail === email : key === 'autopjese-appointments-v1' ? item.sellerEmail === email || item.customerEmail === email : key === 'autopjese-cart-v1' || key === 'autopjese-orders-v1' ? item.buyerEmail === email : item.sellerEmail === email);
    return [key, value];
  }));
  const putAccountData = (email, data = accountDataFor(email)) => request('/api/account-data', { method: 'PUT', body: body({ data }) });
  let accountDataTimer;
  const scheduleAccountDataSync = () => {
    clearTimeout(accountDataTimer);
    accountDataTimer = setTimeout(() => {
      const user = currentUser();
      if (user) putAccountData(user.email).catch(() => {});
    }, 350);
  };
  const syncAccountData = async user => {
    const [remote, remoteListings] = await Promise.all([request('/api/account-data').catch(() => ({ data: {} })), request('/api/listings').catch(() => ({ listings: [] }))]);
    const localData = accountDataFor(user.email), hasRemoteData = Object.values(remote.data || {}).some(value => Array.isArray(value) && value.length);
    if (hasRemoteData) {
      for (const key of privateKeys) if (Object.hasOwn(remote.data, key)) {
        const value = remote.data[key];
        originalSetItem.call(localStorage, key, JSON.stringify(value));
        if (key === 'autopjese-chats-v1') chats = value;
        if (key === 'autopjese-appointments-v1') appointments = value;
        if (key === 'autopjese-cart-v1') cart = value;
        if (key === 'autopjese-orders-v1') customerOrders = value;
      }
    } else if (Object.values(localData).some(value => Array.isArray(value) && value.length)) {
      await putAccountData(user.email, localData).catch(() => {});
    }
    const localOwned = listings.filter(item => item.email === user.email), stored = Array.isArray(remoteListings.listings) ? remoteListings.listings : [];
    const merged = new Map([...localOwned, ...stored].map(item => [item.id, item]));
    listings = [...listings.filter(item => !item.email), ...Array.from(merged.values())];
    if (localOwned.length) await request('/api/listings', { method: 'PUT', body: body({ listings: Array.from(merged.values()) }) }).catch(() => {});
    try { localStorage.setItem(STORAGE.listings, JSON.stringify(listings)); } catch {}
    renderAccount(); renderListings(); renderCustomerOrders();
  };
  const originalSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage && privateKeys.includes(String(key))) scheduleAccountDataSync();
  };
  const previousPersist = persist;
  persist = function () {
    previousPersist();
    const user = currentUser();
    if (user) request('/api/listings', { method: 'PUT', body: body({ listings: listings.filter(item => item.email === user.email) }) }).catch(() => {});
  };
  const setSignedInUser = user => {
    users = users.filter(item => item.email !== user.email).concat(user);
    currentEmail = user.email;
    sessionStorage.setItem('autopjese-session', user.email);
    try { localStorage.setItem(STORAGE.users, JSON.stringify(users)); } catch {}
    renderAccount();
  };
  const finishLogin = user => {
    setSignedInUser(user);
    syncAccountData(user).catch(() => {});
    closeModals();
    toast('U lidhe me sukses. Llogaria ruhet në server.');
    if (!user.location) openLocationSetup(); else continueAfterLocation();
  };

  // The existing verification screen remains in use. Once its code is entered,
  // the account itself is created by the server and survives browser changes.
  document.getElementById('auth-form').addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const form = new FormData(event.currentTarget), email = String(form.get('email') || '').trim().toLowerCase(), password = String(form.get('password') || ''), error = document.getElementById('auth-error'), submit = document.getElementById('auth-submit');
    error.textContent = '';
    submit.disabled = true;
    try {
      if (authMode === 'register') {
        if (password.length < 8) throw new Error('Fjalëkalimi duhet t’i ketë së paku 8 karaktere.');
        const type = String(form.get('accountType') || 'private'), name = String(form.get('name') || '').trim(), businessName = String(form.get('businessName') || '').trim(), phone = String(form.get('phone') || '').trim();
        if (type === 'business' && !businessName) throw new Error('Shkruaj emrin e biznesit.');
        pendingRegistration = { name, email, password, phone, type, businessName };
        issueDemoVerificationCode();
        document.getElementById('verification-copy').textContent = `Shkruaj kodin për të vazhduar regjistrimin e ${email}.`;
        event.currentTarget.hidden = true;
        document.getElementById('verification-step').hidden = false;
        document.getElementById('auth-privacy-note').hidden = true;
        document.getElementById('verification-code').focus();
        return;
      }
      let user;
      try {
        ({ user } = await request('/api/auth/login', { method: 'POST', body: body({ email, password }) }));
      } catch (loginError) {
        // Bring forward accounts made by the previous browser-only demo.
        const legacy = users.find(item => item.email === email);
        if (!legacy?.salt || await hashPassword(password, legacy.salt) !== legacy.passwordHash) throw loginError;
        if (loginError.code === 'invalid_credentials') {
          const migrated = await request('/api/auth/register', { method: 'POST', body: body({ name: legacy.name, email, phone: legacy.phone || '', password, accountType: legacy.accountType, businessName: legacy.businessName || '' }) });
          user = { ...migrated.user, ...Object.fromEntries(Object.entries(legacy).filter(([key]) => !['salt', 'passwordHash'].includes(key))) };
        } else if (!loginError.status) user = legacy;
        else throw loginError;
      }
      if (user.twoFactor) {
        pendingLoginEmail = email;
        issueDemoVerificationCode();
        document.getElementById('verification-copy').textContent = `Fut kodin demonstrues për të përfunduar hyrjen në ${email}.`;
        event.currentTarget.hidden = true;
        document.getElementById('verification-step').hidden = false;
        document.getElementById('auth-privacy-note').hidden = true;
        document.getElementById('verification-code').focus();
        return;
      }
      finishLogin(user);
    } catch (error) { document.getElementById('auth-error').textContent = error.message || 'Hyrja nuk u krye.'; }
    finally { submit.disabled = false; }
  }, true);

  document.getElementById('verification-form').addEventListener('submit', async event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const error = document.getElementById('verification-error'), submit = event.currentTarget.querySelector('button[type="submit"]'), entered = String(new FormData(event.currentTarget).get('verificationCode') || '').trim();
    error.textContent = '';
    if (!pendingRegistration && !pendingLoginEmail) { error.textContent = 'Sesioni skadoi. Kthehu te të dhënat dhe provo përsëri.'; return; }
    if (Date.now() > verificationExpiresAt) { error.textContent = 'Kodi skadoi. Kërko një kod të ri.'; return; }
    if (verificationAttempts >= 5) { error.textContent = 'U tejkalua numri i provave. Kërko një kod të ri.'; return; }
    if (entered !== verificationCode) { verificationAttempts++; error.textContent = `Kodi nuk është i saktë. Prova ${verificationAttempts}/5.`; return; }
    submit.disabled = true;
    try {
      if (pendingLoginEmail) {
        const user = users.find(item => item.email === pendingLoginEmail) || (await request('/api/auth/me')).user;
        pendingLoginEmail = '';
        if (!user) throw new Error('Llogaria nuk u gjet. Provo të hysh përsëri.');
        finishLogin(user);
      } else {
        const data = pendingRegistration;
        let result;
        try { result = await request('/api/auth/register', { method: 'POST', body: body({ name: data.name, email: data.email, phone: data.phone, password: data.password, accountType: data.type, businessName: data.businessName }) }); }
        catch (error) {
          if (error.status) throw error;
          const salt = crypto.randomUUID(), passwordHash = await hashPassword(data.password, salt);
          result = { user: { name: data.name, email: data.email, phone: data.phone, accountType: data.type, businessName: data.businessName, salt, passwordHash, verified: true } };
          users.push(result.user);
          try { localStorage.setItem(STORAGE.users, JSON.stringify(users)); } catch {}
        }
        pendingRegistration = null;
        setSignedInUser(result.user);
        syncAccountData(result.user).catch(() => {});
        closeModals();
        toast('Llogaria u krijua dhe u ruajt në server.');
        openLocationSetup();
      }
      verificationCode = '';
      document.getElementById('auth-form').reset();
      event.currentTarget.reset();
    } catch (error) { document.getElementById('verification-error').textContent = error.message || 'Verifikimi nuk u krye.'; }
    finally { submit.disabled = false; }
  }, true);

  const previousSaveUsers = saveUsers;
  let profileSyncTimer;
  saveUsers = function () {
    previousSaveUsers();
    clearTimeout(profileSyncTimer);
    profileSyncTimer = setTimeout(() => {
      const user = currentUser();
      if (user) request('/api/auth/profile', { method: 'PATCH', body: body(user) }).then(result => {
        if (result.user && currentUser()?.email === result.user.email) {
          users = users.map(item => item.email === result.user.email ? result.user : item);
          try { localStorage.setItem(STORAGE.users, JSON.stringify(users)); } catch {}
        }
      }).catch(() => {});
    }, 250);
  };

  document.getElementById('account-menu-logout').addEventListener('click', () => { request('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {}); }, true);
  request('/api/auth/me').then(({ user }) => {
    if (!user) {
      if (currentEmail) { currentEmail = ''; sessionStorage.removeItem('autopjese-session'); renderAccount(); }
      return;
    }
    setSignedInUser(user);
    touchDevice(user);
    renderAccount();
    syncAccountData(user).catch(() => {});
  }).catch(() => {});
})();
