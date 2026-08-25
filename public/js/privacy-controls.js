(function () {
  function clearGuestProgress() {
    try {
      Object.keys(localStorage)
        .filter((key) => /^(ck_|cg_|cd_)/.test(key))
        .forEach((key) => localStorage.removeItem(key));
    } catch (_) {}
  }

  async function deleteProfile() {
    const authed = !!(window.App && App.isAuthed && App.isAuthed());
    const message = authed
      ? 'Удалить игровой профиль, прогресс, коллекции и игровую аналитику? Аккаунт Telegram и клубный аккаунт «Марии» останутся.'
      : 'Удалить гостевой прогресс с этого устройства?';
    if (!confirm(message) || !confirm('Это действие нельзя отменить. Продолжить?')) return;

    if (authed) {
      const response = await fetch('/api/clicker/account', {
        method: 'DELETE',
        headers: { ...(App.authHeader ? App.authHeader() : {}) }
      }).catch(() => null);
      if (!response || !response.ok) {
        alert('Не удалось удалить профиль. Проверь соединение и попробуй снова.');
        return;
      }
    }
    clearGuestProgress();
    alert('Игровой профиль удалён.');
    location.reload();
  }

  const panel = document.createElement('div');
  panel.setAttribute('aria-label', 'Конфиденциальность и данные');
  panel.style.cssText = 'position:fixed;right:10px;bottom:max(10px,env(safe-area-inset-bottom));z-index:9000;display:flex;gap:8px;align-items:center;padding:6px 9px;border-radius:12px;background:rgba(11,8,20,.82);font:600 11px/1.2 system-ui,sans-serif';
  panel.innerHTML = '<a href="/privacy" target="_blank" rel="noopener noreferrer" style="color:#f0c24e">Конфиденциальность</a><button type="button" style="border:0;background:transparent;color:#d7d0df;text-decoration:underline;padding:0;font:inherit;cursor:pointer">Удалить профиль</button>';
  panel.querySelector('button').addEventListener('click', deleteProfile);
  document.body.appendChild(panel);
})();
