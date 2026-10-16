(() => {
  const statusChoices = ['E pranuar', 'E dërguar', 'E përfunduar', 'E refuzuar'];
  let sellerOrders = [];
  const originalRender = renderCustomerOrders;
  renderCustomerOrders = function () {
    originalRender();
    const user = currentUser();
    if (!user) return;
    const buyerList = document.getElementById('customer-orders-list');
    customerOrders.filter(order => order.buyerEmail === user.email).forEach((order, index) => {
      const card = buyerList.children[index];
      if (!card || order.status === 'E refuzuar') return;
      const steps = ['Në pritje', 'E pranuar', 'E dërguar', 'E përfunduar'];
      const statusIndex = order.status === 'E përfunduar' ? 3 : order.status === 'E dërguar' ? 2 : order.status === 'E pranuar' ? 1 : 0;
      const progress = document.createElement('div');
      progress.className = 'order-progress';
      progress.setAttribute('aria-label', `Përcjellja e porosisë: ${order.status || steps[0]}`);
      progress.innerHTML = steps.map((step, stepIndex) => `<span class="${stepIndex <= statusIndex ? 'is-complete' : ''}">${step}</span>`).join('');
      card.append(progress);
    });
    const wrap = document.getElementById('seller-incoming-wrap');
    if (!wrap) return;
    wrap.hidden = !sellerOrders.length;
    document.getElementById('seller-incoming-orders').innerHTML = sellerOrders.map(order => {
      const items = order.sellerItems || [];
      const total = items.reduce((sum, item) => sum + Number(item.price || 0) * (Number(item.quantity) || 1), 0);
      const status = order.sellerStatus || 'Në pritje të shitësit';
      return `<article class="customer-order-card seller-incoming-card"><div class="customer-order-top"><div><small>Kërkesë · ${new Date(order.created).toLocaleDateString(window.getSiteLocale(), { dateStyle: 'medium' })} · ${safe(order.buyerEmail)}</small><b>${safe(items.map(item => `${item.quantity || 1} × ${item.title}`).join(', '))}</b></div><span class="customer-order-status">${safe(status)}</span></div><div class="customer-order-bottom"><span>${items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0)} artikuj në porosinë tënde</span><strong>${fmt(total)}</strong></div>${status !== 'E përfunduar' && status !== 'E refuzuar' ? `<label class="seller-order-update">Përditëso statusin<select data-order-status="${safe(order.id)}"><option value="" selected disabled>Zgjidh statusin</option>${statusChoices.map(choice => `<option>${choice}</option>`).join('')}</select></label>` : ''}</article>`;
    }).join('');
  };

  async function refreshOrders() {
    try {
      const response = await fetch('/api/orders', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json(), user = currentUser();
      if (!user) return;
      sellerOrders = (result.orders || []).filter(order => order.sellerEmails?.includes(user.email));
      customerOrders = (result.orders || []).filter(order => order.buyerEmail === user.email);
      saveCustomerOrders();
      renderCustomerOrders();
    } catch {}
  }

  const originalOpen = openCustomerOrders;
  openCustomerOrders = function (tab = 'cart') {
    originalOpen(tab);
    refreshOrders();
  };

  placeCustomerOrders = async function () {
    const user = currentUser();
    if (!user) { openAuth('login'); return; }
    const items = cart.filter(item => item.buyerEmail === user.email);
    if (!items.length) return;
    const button = document.getElementById('place-orders-button');
    button.disabled = true;
    try {
      const response = await fetch('/api/orders', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ items: items.map(item => ({ listingId: item.listingId, quantity: item.quantity })) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Porosia nuk mund të ruhet.');
      const order = result.order;
      const previousOrders = customerOrders;
      customerOrders = [order, ...customerOrders.filter(entry => entry.id !== order.id)];
      cart = cart.filter(item => item.buyerEmail !== user.email);
      saveCustomerOrders(); saveCart();
      const grouped = new Map();
      order.items.forEach(item => {
        if (!grouped.has(item.sellerEmail)) grouped.set(item.sellerEmail, []);
        grouped.get(item.sellerEmail).push(item);
      });
      grouped.forEach((group, sellerEmail) => {
        const first = group[0], context = `order:${order.id}`;
        let thread = chats.find(entry => entry.buyerEmail === user.email && entry.sellerEmail === sellerEmail && entry.context === context);
        if (!thread) {
          thread = { id: crypto.randomUUID(), buyerEmail: user.email, sellerEmail, sellerName: first.seller, context, listingTitle: `Kërkesë porosie · ${group.map(item => item.title).join(', ')}`, messages: [], created: Date.now() };
          chats.unshift(thread);
        }
        thread.messages.push({ id: crypto.randomUUID(), senderEmail: user.email, text: `Përshëndetje, dëshiroj të porosis këto pjesë: ${group.map(item => `${item.quantity || 1} × ${item.title} (${fmt(Number(item.price) * (Number(item.quantity) || 1))})`).join('; ')}. Ju lutem më konfirmoni disponueshmërinë dhe mënyrën e dorëzimit.`, created: Date.now() });
      });
      if (grouped.size) persistChats();
      await refreshOrders();
      renderCustomerOrders();
      setCustomerTab('orders');
      toast('Kërkesa e porosisë u dërgua. Mund ta përcjellësh statusin këtu.');
    } catch (error) {
      toast(error.message || 'Porosia nuk u ruajt. Provo përsëri.');
    } finally {
      button.disabled = false;
    }
  };

  document.getElementById('seller-incoming-orders').addEventListener('change', async event => {
    const select = event.target.closest('[data-order-status]');
    if (!select || !select.value) return;
    select.disabled = true;
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(select.dataset.orderStatus)}`, {
        method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: select.value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Statusi nuk u ruajt.');
      await refreshOrders();
      toast('Statusi i porosisë u përditësua.');
    } catch (error) {
      toast(error.message || 'Statusi nuk u ruajt.');
      select.disabled = false;
      select.value = '';
    }
  });

  const styles = document.createElement('style');
  styles.textContent = '.seller-incoming-card{border-color:#f0c8b4}.seller-order-update{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:10px;border-top:1px solid #edf0f1;color:#65717e;font-size:11px;font-weight:700}.seller-order-update select{max-width:220px;padding:9px 11px;border:1px solid #dce2e5;border-radius:8px;background:#fff;color:#263449;font:inherit}.order-progress{display:flex;justify-content:space-between;gap:5px;padding-top:10px;border-top:1px solid #edf0f1}.order-progress span{position:relative;flex:1;color:#929ba5;font-size:9px;text-align:center}.order-progress span:before{content:"";display:block;width:8px;height:8px;margin:0 auto 5px;border-radius:50%;background:#dfe4e7}.order-progress span.is-complete{color:#a95728;font-weight:700}.order-progress span.is-complete:before{background:#e77648}html[data-theme="dark"] .seller-order-update,html[data-theme="dark"] .order-progress{border-color:#344151}html[data-theme="dark"] .seller-order-update{color:#c3ccd6}html[data-theme="dark"] .seller-order-update select{border-color:#445263;background:#1b2937;color:#edf2f7}html[data-theme="dark"] .order-progress span{color:#aab5c1}html[data-theme="dark"] .order-progress span.is-complete{color:#ffae8c}@media(max-width:540px){.seller-order-update{align-items:flex-start;flex-direction:column}.seller-order-update select{max-width:none;width:100%}.order-progress span{font-size:8px}}';
  document.head.append(styles);
})();
