let storesData = [];

async function loadStores() {
  if (storesData.length) return storesData;
  const res = await fetch('/api/stores');
  storesData = await res.json();
  return storesData;
}

function renderStores(stores) {
  const el = document.getElementById('stores-list');
  if (!stores.length) {
    el.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px">Скоро здесь появятся адреса магазинов</p>';
    return;
  }
  el.innerHTML = stores.map(s => `
    <div class="store-card">
      <div class="store-card__name">${s.name}</div>
    </div>`
  ).join('');
}

document.addEventListener('DOMContentLoaded', async () => {
  const stores = await loadStores();
  renderStores(stores);
});
