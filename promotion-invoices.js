(() => {
  const finance = document.getElementById('finance-page');
  const columns = finance?.querySelector('.finance-columns');
  if (!finance || !columns) return;

  document.head.insertAdjacentHTML('beforeend', `<style>
    .promotion-invoices{margin:18px 0 26px;padding:20px;border:1px solid #e4e9ed;border-radius:13px;background:#fff}
    .promotion-invoices h2{margin:0;color:#203146;font-size:16px}
    .promotion-invoices>p{margin:5px 0 14px;color:#778492;font-size:11px}
    .promotion-invoices-list{display:grid;gap:8px}
    .promotion-invoice-row{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid #e7ebee;border-radius:9px}
    .promotion-invoice-row>span{display:flex;min-width:0;flex:1;flex-direction:column;gap:4px}
    .promotion-invoice-row b{color:#24364a;font-size:11px}
    .promotion-invoice-row small{color:#778492;font-size:9px}
    .promotion-invoice-row strong{color:#d95e32;font-size:12px}
    .promotion-invoice-empty{margin:0;padding:15px;border-radius:8px;background:#f5f7f8;color:#758291;font-size:11px}
    html[data-theme="dark"] .promotion-invoices{background:#172331;border-color:#354353}
    html[data-theme="dark"] .promotion-invoices h2,.dark .promotion-invoices h2{color:#e7edf4}
    html[data-theme="dark"] .promotion-invoices>p,html[data-theme="dark"] .promotion-invoice-row small{color:#b5c0ca}
    html[data-theme="dark"] .promotion-invoice-row{border-color:#344151;background:#1b2937}
    html[data-theme="dark"] .promotion-invoice-row b{color:#e7edf4}
    html[data-theme="dark"] .promotion-invoice-empty{background:#202e3c;color:#b5c0ca}
    @media(max-width:600px){.promotion-invoices{padding:15px}.promotion-invoice-row{flex-wrap:wrap}}
  </style>`);
  columns.insertAdjacentHTML('afterend', '<section class="promotion-invoices" aria-labelledby="promotion-invoices-title"><h2 id="promotion-invoices-title">Faturat e pakove promovuese</h2><p>Fatura krijohet pas konfirmimit të pagesës me kartelë.</p><div class="promotion-invoices-list" id="promotion-invoices-list"></div></section>');

  const key = 'autopjese-business-promotion-requests';
  const list = document.getElementById('promotion-invoices-list');
  const invoiceModal = document.getElementById('invoice-modal');
  const money = amount => new Intl.NumberFormat(window.getSiteLocale(), { style: 'currency', currency: 'EUR' }).format(Number(amount) || 0);
  const paidPackages = () => {
    const user = currentUser();
    if (!user) return [];
    try {
      const rows = JSON.parse(localStorage.getItem(key) || '[]');
      return (Array.isArray(rows) ? rows : []).filter(row => row.sellerEmail === user.email && row.status === 'active' && row.paymentMethod === 'card' && row.serverOrderId && row.paymentReference);
    } catch { return []; }
  };
  const invoiceNumber = row => row.invoiceNumber || `AP-PROMO-${String(row.paymentReference).replace(/[^a-z\d]/gi, '').slice(-12).toUpperCase()}`;
  const render = () => {
    const rows = paidPackages();
    list.innerHTML = rows.length ? rows.slice().sort((a,b) => Number(b.activatedAt||0)-Number(a.activatedAt||0)).map((row,index) => {
      const id = String(row.serverOrderId).replace(/[^a-z\d_-]/gi, '');
      return `<article class="promotion-invoice-row"><span><b>${safe(String(row.plan||'').toUpperCase())} · Pako promovuese</b><small>${safe(invoiceNumber(row))} · ${new Date(row.activatedAt||row.created).toLocaleDateString(window.getSiteLocale())}</small></span><strong>${money(row.priceEUR)}</strong><button class="invoice-open-button" type="button" data-promotion-invoice="${safe(id)}" data-promotion-index="${index}">Shiko faturën</button></article>`;
    }).join('') : '<p class="promotion-invoice-empty">Nuk ka pako të paguara të konfirmuara për faturim.</p>';
  };
  const open = row => {
    if (!row) return;
    const user = currentUser();
    const buyer = user?.accountType === 'business' && user.businessName ? user.businessName : user?.name || row.sellerName || 'Klient';
    const date = new Date(row.activatedAt || row.created);
    const planName = ({plus:'Plus',premium:'Premium',elite:'Elite'})[row.plan] || 'Promovuese';
    const description = `Shërbim promovimi ${planName} · ${Number(row.durationDays)||0} ditë · deri në ${Number(row.postLimit)||0} postime`;
    const reference = String(row.paymentReference || '');
    const number = invoiceNumber(row);
    const amount = money(row.priceEUR);
    document.getElementById('simple-invoice-content').innerHTML = `<div class="invoice-brand"><img src="assets/logo-autopjese.png" alt="AUTOPJESA.NET"><span><b>AUTOPJESA.NET</b><small>Shërbim promovimi në platformë</small></span></div><div class="invoice-title-row"><div><span class="invoice-kicker">FATURË E SHËRBIMIT</span><h2 id="invoice-modal-title">Faturë për promovim</h2></div><div class="invoice-number"><small>Numri i faturës</small><b>${safe(number)}</b></div></div><div class="invoice-parties"><div class="invoice-seller-panel"><small>Ofruesi i shërbimit</small><div class="invoice-seller-identity"><span class="invoice-seller-logo">AP</span><b>AUTOPJESA.NET</b></div><span>Shërbime promovimi në platformë</span></div><div class="invoice-buyer-panel"><small>Klienti</small><b>${safe(buyer)}</b><span>${safe(user?.email || row.sellerEmail)}</span></div></div><table class="invoice-lines"><thead><tr><th>Përshkrimi</th><th>Sasia</th><th>Çmimi</th><th>Shuma</th></tr></thead><tbody><tr><td><b>${safe(description)}</b><small>Referenca e pagesës: ${safe(reference)}</small></td><td>1</td><td>${amount}</td><td>${amount}</td></tr></tbody><tfoot><tr><td colspan="3">Totali i paguar</td><td>${amount}</td></tr></tfoot></table><div class="invoice-meta"><span><small>Data e faturës</small><b>${date.toLocaleDateString(window.getSiteLocale(), {dateStyle:'long'})}</b></span><span><small>Statusi</small><b>Paguar me kartelë</b></span></div><p class="invoice-disclaimer">Kjo është faturë e thjeshtë për shërbimin promovues të AUTOPJESA.NET. <b>Nuk është kupon fiskal.</b></p>`;
    invoiceModal.dataset.invoiceId = '';
    invoiceModal.dataset.invoiceType = 'promotion';
    document.getElementById('invoice-email-form').hidden = true;
    document.getElementById('invoice-recipient-email').value = '';
    showModal('invoice-modal');
  };
  finance.addEventListener('click', event => {
    const button = event.target.closest('[data-promotion-invoice]');
    if (!button) return;
    const row = paidPackages().find(item => String(item.serverOrderId).replace(/[^a-z\d_-]/gi, '') === button.dataset.promotionInvoice);
    open(row);
  });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-invoice]')) document.getElementById('invoice-email-form').hidden = false;
  }, true);
  render();
  document.addEventListener('click', event => { if (event.target.closest('[data-finance-period], [data-sale-toggle]')) render(); });
})();
