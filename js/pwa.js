/* =========================================================================
 * pwa.js — Instalación como app y modo sin conexión (service worker).
 * Solo actúa cuando se sirve por http(s); con file:// no hace nada.
 * ========================================================================= */
(function (F) {
  'use strict';
  const KEY = 'finanzas-install-dismissed';
  let deferred = null;

  const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWeb = () => /^https?:$/.test(location.protocol);
  const get = () => { try { return localStorage.getItem(KEY); } catch (_) { return null; } };
  const set = () => { try { localStorage.setItem(KEY, '1'); } catch (_) {} };

  const pwa = {
    isStandalone,
    /** 'prompt' (Android/Chrome), 'ios' (Safari), o null */
    mode() {
      if (!isWeb() || isStandalone()) return null;
      if (deferred) return 'prompt';
      if (isIOS()) return 'ios';
      return null;
    },
    dismissed: () => !!get(),
    dismiss() { set(); },
    async install() {
      if (!deferred) return false;
      deferred.prompt();
      const r = await deferred.userChoice.catch(() => ({}));
      deferred = null;
      return r.outcome === 'accepted';
    },
    init(onChange) {
      window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; onChange && onChange(); });
      window.addEventListener('appinstalled', () => { deferred = null; onChange && onChange(); F.ui && F.ui.toast('App instalada. Ábrela desde tu pantalla de inicio.'); });
      if (!isWeb() || !('serviceWorker' in navigator)) return;
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.register('sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) w.postMessage('skipWaiting'); });
        });
      }).catch((e) => console.warn('Service worker no disponible', e));
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController && F.ui) F.ui.toast('Hay una versión nueva. Cierra y vuelve a abrir la app para usarla.', { timeout: 7000 });
      });
    }
  };
  F.pwa = pwa;
})(window.FIN);
