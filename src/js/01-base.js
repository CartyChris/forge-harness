'use strict';
/* ═══════════════════════════════════════════════════════════════════════════
   DS FORGE: a plugin-first agent workspace.
   Architecture: a Cordis-style kernel + typed "contribution points".
   Everything (tools, views, themes, commands, renderers, model providers,
   guard rules, status widgets, even the built-in UI) is a plugin that
   contributes to a point, and is disposed cleanly when disabled.
   ═══════════════════════════════════════════════════════════════════════════ */
const DS = window.DS = { version: '1.0.0', build: '2026-10-26 10:18' };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const now = () => Date.now();
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
DS.isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
DS.isNarrow = () => matchMedia('(max-width: 899px)').matches;
DS.fmtBytes = n => { if (n == null || isNaN(n)) return '—'; n = Math.max(0, +n); return n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B'; };
DS.fmtDur = ms => { const s = Math.round(ms / 1000); if (s < 1) return ms + 'ms'; if (s < 60) return s + 's'; const m = Math.floor(s / 60); return m + 'm ' + (s % 60) + 's'; };
DS.fmtTime = t => new Date(t).toLocaleTimeString([], { hour12: false });
DS.hash = s => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
DS.estTokens = s => Math.ceil(String(s || '').length / 3.8);
