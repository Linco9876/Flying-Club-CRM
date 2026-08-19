if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/duty-clock/app/duty-clock-sw.js', {
        scope: '/duty-clock/app/',
        updateViaCache: 'none',
      })
      .then(registration => registration.update())
      .catch(error => console.error('Duty Clock service worker registration failed:', error));
  });
}
