let storesData = [];

async function loadStores() {
  if (storesData.length) return storesData;
  const res = await fetch('/api/stores');
  storesData = await res.json();
  return storesData;
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function renderStores(stores, userLat, userLng) {
  const el = document.getElementById('stores-list');
  el.innerHTML = stores.map(s => {
    const dist = (userLat && userLng)
      ? `<span class="store-dist">${distanceKm(userLat, userLng, s.lat, s.lng).toFixed(1)} км</span>`
      : '';
    return `
      <div class="store-card" onclick="window.Telegram.WebApp.openLink('${s.maps}')">
        <div class="store-card__top">
          <div class="store-card__name">${s.name}</div>
          ${dist}
        </div>
        <div class="store-card__addr">📍 ${s.address}</div>
        <div class="store-card__link">Открыть на карте →</div>
      </div>`;
  }).join('');
}

async function findNearestStores() {
  const btn = document.getElementById('stores-geo-btn');
  const stores = await loadStores();

  if (!navigator.geolocation) {
    renderStores(stores, null, null);
    return;
  }

  btn.textContent = '⏳ Определяю местоположение…';
  btn.disabled = true;

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      const sorted = [...stores].sort((a, b) =>
        distanceKm(latitude, longitude, a.lat, a.lng) - distanceKm(latitude, longitude, b.lat, b.lng)
      );
      btn.textContent = '✅ Магазины рядом с вами';
      btn.disabled = false;
      renderStores(sorted, latitude, longitude);
    },
    () => {
      btn.textContent = '🗺 Все магазины';
      btn.disabled = false;
      renderStores(stores, null, null);
    },
    { timeout: 8000 }
  );
}

// Загружаем все магазины при открытии вкладки
document.addEventListener('DOMContentLoaded', async () => {
  const stores = await loadStores();
  renderStores(stores, null, null);
});
