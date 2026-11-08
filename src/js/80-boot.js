/* ═══════════════════════════ BOOT ═══════════════════════════ */
DS.boot = async function () {
  const t0 = performance.now(); await Store.init();
  let safe = false; try { if (localStorage.getItem('ds-forge:safe')) { safe = true; localStorage.removeItem('ds-forge:safe'); } } catch (_) {} if (window.name === 'ds-forge:safe') { safe = true; window.name = ''; }
  if (Store.state.meta.booting) { safe = true; DS.kernel.log('warn', 'boot', 'previous boot did not finish — starting in safe mode (user plugins skipped)'); }
  Store.state.meta.booting = true; await Store.flush(); DS.safeMode = safe;
  const q = DS._queue.splice(0); DS.booted = true;
  for (const def of q) { try { const rec = await DS.kernel.register(def, { origin: 'builtin' }); if (Store.state.disabled.includes(def.name) && !rec.locked) await DS.kernel.disable(def.name); } catch (e) { DS.kernel.log('error', 'boot', 'builtin ' + (def && def.name) + ' failed: ' + e.message); } }
  (window.__pluginLoadErrors || []).forEach(e => DS.kernel.log('error', 'boot', 'plugin file ' + e.file + ': ' + e.error));
  await DS.plugins.loadUser(safe);
  await DS.shell.init();
  if (!Store.activeThread() && Store.threads().length) Store.state.activeThread[Store.state.activeWorkspace] = Store.threads()[0].id;
  Store.state.meta.booting = false; Store.state.meta.first = false; await Store.flush();
  window.addEventListener('beforeunload', () => Store.flushSync()); document.addEventListener('visibilitychange', () => { if (document.hidden) Store.flush(); });
  const b = document.getElementById('boot'); if (b) b.remove();
  if (safe) ui.toast('Safe mode: user plugins were not loaded. Fix or remove them in Plugins.', 'warn', 6000);
  if (Store.settings().autoBridge && Store.settings().bridgeUrl) DS.bridge.connect().catch(() => {});
  DS.kernel.log('info', 'boot', 'ready in ' + Math.round(performance.now() - t0) + 'ms · ' + DS.kernel.activeCount() + ' plugins');
  DS.ready = true; DS.bus.emit('ready');
};


