if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/duty-clock/app/duty-clock-sw.js', { scope: '/duty-clock/app/' });
  });
}
