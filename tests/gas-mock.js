// 模擬 Google Apps Script 環境（記憶體中的試算表），只供 Node 測試使用。
// 用法：const env = loadGas(); env.ctx.setup(); env.api({action:'ping'})
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// 試算表自動轉出的 Date 需與 GAS 程式內的 Date 為同一個類別
let DateCtor = Date;
const toSigned = (buf) => [...buf].map((x) => (x > 127 ? x - 256 : x));

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined ? '' : v); }
      out.push(o);
    }
    return out;
  }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((r) => r.length !== this.nc)) throw new Error('setValues 尺寸不符');
    if (this.r - 1 + this.nr > this.sheet.maxRows) throw new Error('範圍超出試算表列數');
    vals.forEach((row, i) => {
      const target = (this.sheet.data[this.r - 1 + i] = this.sheet.data[this.r - 1 + i] || []);
      row.forEach((v, j) => {
        // 模擬試算表行為：非純文字欄的 'YYYY-MM-DD' 會被轉成 Date
        const col = this.c + j;
        if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !this.sheet.textCols.has(col)) v = new DateCtor(v + 'T00:00:00+08:00');
        target[this.c - 1 + j] = v;
      });
    });
    this.sheet.writes++;
    return this;
  }
  setNumberFormat(f) { if (f === '@') for (let j = 0; j < this.nc; j++) this.sheet.textCols.add(this.c + j); return this; }
  protect() {
    const p = { desc: '', getDescription() { return this.desc; }, setDescription(d) { this.desc = d; return this; }, setWarningOnly() { return this; } };
    this.sheet.protections.push(p);
    return p;
  }
}

class Sheet {
  constructor(name) { Object.assign(this, { name, data: [], maxRows: 1000, textCols: new Set(), protections: [], frozen: 0, writes: 0 }); }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some((v) => v !== '' && v !== undefined && v !== null)) return i + 1;
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => { let n = 0; (r || []).forEach((v, i) => { if (v !== '' && v !== undefined) n = i + 1; }); return n; })); }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  getRange(r, c, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('範圍不正確');
    if (r - 1 + nr > this.maxRows) throw new Error('範圍超出試算表列數');
    return new Range(this, r, c, nr, nc);
  }
  deleteRows(start, n) { this.data.splice(start - 1, n); }
  setFrozenRows(n) { this.frozen = n; }
  getProtections() { return this.protections; }
}

class Spreadsheet {
  constructor() { this.sheets = new Map(); }
  getId() { return 'TEST-SPREADSHEET'; }
  getSheetByName(n) { return this.sheets.get(n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.set(n, s); return s; }
}

function loadGas(opts = {}) {
  const root = path.join(__dirname, '..');
  const ss = new Spreadsheet();
  const props = {};
  let clock = opts.now || Date.parse('2026-11-14T02:00:00Z'); // 台灣時間 10:00
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(clock); }
    static now() { return clock; }
  }
  DateCtor = FakeDate;
  const logs = [];
  const ctx = {
    console: { log() {}, error(...a) { logs.push(['error', ...a]); } },
    JSON, Math, String, Number, Array, Object, RegExp, isNaN, parseInt, isFinite, Error,
    Date: FakeDate,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss, ProtectionType: { RANGE: 'RANGE' } },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
      deleteProperty: (k) => { delete props[k]; }, getProperties: () => ({ ...props }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) },
    Logger: { log: (m) => logs.push(['log', m]) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ t, setMimeType() { return this; } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (v, k) => toSigned(crypto.createHmac('sha256', k).update(v, 'utf8').digest()),
      computeDigest: (a, s) => toSigned(crypto.createHash('sha256').update(s, 'utf8').digest()),
      formatDate: (d, tz, fmt) => {
        const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
          .formatToParts(d).map((x) => [x.type, x.value]));
        return fmt.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute);
      },
      DigestAlgorithm: { SHA_256: 'SHA_256' }, Charset: { UTF_8: 'UTF_8' },
    },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200 }) },
  };
  vm.createContext(ctx);
  const files = opts.bundle ? ['../dist/Code.gs'] : require('../tools/build.js').ORDER;
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'gas', f), 'utf8'), ctx, { filename: f });

  const api = (body) => JSON.parse(ctx.doPost({ parameter: {}, postData: { contents: JSON.stringify(body) } }).t);
  const sheet = (name) => ss.getSheetByName(name);
  const rows = (name) => sheet(name).getRange(1, 1, sheet(name).getLastRow() || 1, 20).getValues().slice(1).filter((r) => r.some((v) => v !== ''));
  return {
    ctx, ss, props, logs, api, sheet, rows,
    advance: (ms) => { clock += ms; },
    setNow: (t) => { clock = t; },
  };
}

module.exports = { loadGas };
