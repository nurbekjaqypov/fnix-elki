/**
 * FNIX Ёлки — бэкенд на Google Apps Script.
 * Хранит все данные сайта в этой Google Таблице.
 *
 * Установка (один раз):
 * 1. Расширения → Apps Script → вставить этот код целиком → Сохранить.
 * 2. Выбрать функцию setup → Выполнить → разрешить доступ.
 *    В журнале появится ПИН-код — запишите его, он нужен для входа на сайт.
 * 3. Развернуть → Новое развертывание → Тип: Веб-приложение,
 *    Выполнять как: Я, Доступ: Все → Развернуть → скопировать URL.
 *
 * Обновление кода: вставить новый код → Сохранить →
 * Развернуть → Управление развертываниями → ✎ → Версия: «Новая версия» → Развернуть.
 * (Так URL остаётся прежним.)
 *
 * Новые поля и листы, которые присылает сайт, добавляются в таблицу автоматически,
 * поэтому для большинства будущих доработок сайта этот код менять не нужно.
 */

var SCHEMA = {
  'ДДС': [['id','ID'],['date','Дата'],['channel','Канал'],['kind','Вид расхода'],['item','Статья'],
          ['counterparty','Контрагент'],['payment','Способ оплаты'],['amount','Сумма'],['purpose','Назначение'],
          ['created','Создано'],['updated','Изменено'],['deleted','Удалено'],
          ['trees','Связано с ёлками']],
  'ДДС_История': [['ts','Время'],['action','Действие'],['id','ID записи'],['data','Данные']],
  'Себестоимость': [['id','ID'],['name','Наименование'],['cost','Себестоимость'],['updated','Изменено']],
  'Сопоставление': [['id','ID'],['kaspi','Название в Kaspi'],['name','Наше наименование'],['type','Тип карточки']],
  'Kaspi': [['id','ID'],['order','№ заказа'],['date','Дата'],['kaspi','Название в Kaspi'],['sku','Артикул'],
            ['sum','Сумма'],['qty','Кол-во'],['status','Статус'],['logistics','Логистика'],['city','Город'],
            ['store','Магазин']],
  'Магазины': [['id','ID'],['mid','ID магазина в Kaspi'],['name','Название']],
  'Опт': [['id','ID'],['date','Дата'],['buyer','Покупатель'],['model','Модель'],['qty','Кол-во'],['sum','Сумма'],
          ['note','Примечание'],['created','Создано']],
  'Фуры': [['id','ID'],['date','Дата'],['truck','Фура'],['contract','№ контракта'],['goods','Товары'],
           ['goodsSum','Оплата за товар'],['payStatus','Статус оплаты'],['driver','Оплата водителю'],
           ['border','Китайцам на границе'],['extra','Доп. расходы'],['note','Примечание'],
           ['customs','Растаможка']]
};

var HISTORY = 'ДДС_История';
var PROTECTED = { 'ДДС': true };     // листы, где записи не удаляются физически
var BACKUP_FOLDER = 'FNIX Ёлки — бэкапы';
var BACKUP_KEEP = 30;
var TZ = 'Asia/Almaty';

function setup() {
  Object.keys(SCHEMA).forEach(function (name) { sheet_(name); });
  var props = PropertiesService.getScriptProperties();
  var pin = props.getProperty('PIN');
  if (!pin) {
    pin = String(Math.floor(100000 + Math.random() * 900000));
    props.setProperty('PIN', pin);
  }
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Готово. ПИН для входа на сайт: ' + pin);
}

function now_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss"); }

function validName_(name) {
  return typeof name === 'string' && name !== HISTORY && /^[\wА-Яа-яЁё _-]{1,40}$/.test(name);
}

// Лист с гарантированными заголовками схемы
function sheet_(name) {
  var ss = SpreadsheetApp.getActive();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var base = SCHEMA[name] || [['id', 'ID']];
  var titles = base.map(function (c) { return c[1]; });
  var cur = sh.getRange(1, 1, 1, titles.length).getValues()[0];
  if (cur.join('|') !== titles.join('|')) {
    sh.getRange(1, 1, 1, titles.length).setValues([titles]);
    sh.getRange(1, 1, 1, sh.getMaxColumns()).setFontWeight('bold').setBackground('#0f3d2e').setFontColor('#ffffff');
    sh.setFrozenRows(1);
  }
  return sh;
}

// Колонки листа: ключи по заголовкам; недостающие ключи из extra добавляются в конец
function cols_(name, extra) {
  var sh = sheet_(name);
  var titleToKey = {}, keyToTitle = {};
  (SCHEMA[name] || []).forEach(function (c) { titleToKey[c[1]] = c[0]; keyToTitle[c[0]] = c[1]; });
  var lc = sh.getLastColumn();
  var hdr = sh.getRange(1, 1, 1, lc).getValues()[0];
  while (hdr.length && hdr[hdr.length - 1] === '') hdr.pop();
  var keys = hdr.map(function (t) { return titleToKey[t] || String(t); });
  var add = [];
  (extra || []).forEach(function (k) { if (keys.indexOf(k) < 0 && add.indexOf(k) < 0) add.push(k); });
  if (add.length) {
    sh.getRange(1, keys.length + 1, 1, add.length)
      .setValues([add.map(function (k) { return keyToTitle[k] || k; })])
      .setFontWeight('bold').setBackground('#0f3d2e').setFontColor('#ffffff');
    keys = keys.concat(add);
  }
  return { sh: sh, keys: keys };
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function checkPin_(pin) {
  return String(pin) === PropertiesService.getScriptProperties().getProperty('PIN');
}

function rows_(name) {
  var c = cols_(name), sh = c.sh, keys = c.keys;
  var n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, keys.length).getValues().map(function (r) {
    var o = {};
    keys.forEach(function (k, i) {
      var v = r[i];
      if (v instanceof Date) v = Utilities.formatDate(v, TZ, k === 'ts' || k === 'created' || k === 'updated' ? "yyyy-MM-dd'T'HH:mm:ss" : 'yyyy-MM-dd');
      o[k] = v;
    });
    return o;
  }).filter(function (o) { return o.id !== '' && o.id !== undefined; });
}

function toRow_(keys, o) {
  return keys.map(function (k) {
    var v = o[k];
    if (v === undefined || v === null) return '';
    return typeof v === 'object' ? JSON.stringify(v) : v;
  });
}

function doGet(e) {
  if (!checkPin_(e.parameter.pin)) return json_({ ok: false, error: 'pin' });
  var out = {};
  var names = Object.keys(SCHEMA);
  SpreadsheetApp.getActive().getSheets().forEach(function (s) {
    var nm = s.getName();
    if (names.indexOf(nm) < 0 && validName_(nm) && s.getRange(1, 1).getValue() === 'ID') names.push(nm);
  });
  names.forEach(function (name) {
    if (name !== HISTORY) out[name] = rows_(name);
  });
  return json_({ ok: true, data: out });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var req = JSON.parse(e.postData.contents);
    if (!checkPin_(req.pin)) return json_({ ok: false, error: 'pin' });
    var name = req.sheet;
    if (!validName_(name)) return json_({ ok: false, error: 'sheet' });
    if (req.action === 'upsert') return json_(upsert_(name, req.rows || []));
    if (req.action === 'delete') return json_(remove_(name, req.ids || []));
    return json_({ ok: false, error: 'action' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function upsert_(name, list) {
  var now = now_();
  if (name === 'ДДС') list.forEach(function (o) { o.updated = now; if (!o.created) o.created = now; });
  var extra = [];
  list.forEach(function (o) { Object.keys(o).forEach(function (k) { if (extra.indexOf(k) < 0) extra.push(k); }); });
  var c = cols_(name, extra), sh = c.sh, keys = c.keys, width = keys.length;
  var n = sh.getLastRow() - 1;
  var data = n > 0 ? sh.getRange(2, 1, n, width).getValues() : [];
  var index = {};
  data.forEach(function (r, i) { index[String(r[0])] = i; });
  var append = [], hist = [], changed = false;
  list.forEach(function (o) {
    var id = String(o.id);
    var row = toRow_(keys, o);
    if (index[id] !== undefined && index[id] >= 0) {
      data[index[id]] = row;
      changed = true;
      if (name === 'ДДС') hist.push([now, 'изменение', id, JSON.stringify(o)]);
    } else if (index[id] === undefined) {
      append.push(row);
      index[id] = -1;
      if (name === 'ДДС') hist.push([now, 'создание', id, JSON.stringify(o)]);
    }
  });
  if (changed) sh.getRange(2, 1, data.length, width).setValues(data);
  if (append.length) sh.getRange(n + 2, 1, append.length, width).setValues(append);
  if (hist.length) log_(hist);
  return { ok: true, count: list.length };
}

function remove_(name, ids) {
  var c = cols_(name), sh = c.sh, keys = c.keys, width = keys.length;
  var n = sh.getLastRow() - 1;
  if (n < 1) return { ok: true, count: 0 };
  var want = {};
  ids.forEach(function (id) { want[String(id)] = true; });
  var now = now_();
  if (PROTECTED[name]) {
    // ДДС: мягкое удаление — запись остаётся в таблице с отметкой
    var delCol = keys.indexOf('deleted') + 1;
    var col = sh.getRange(2, 1, n, 1).getValues();
    var hist = [];
    col.forEach(function (r, i) {
      if (want[String(r[0])]) {
        sh.getRange(i + 2, delCol).setValue(now);
        hist.push([now, 'удаление', String(r[0]), '']);
      }
    });
    if (hist.length) log_(hist);
    return { ok: true, count: hist.length };
  }
  var data = sh.getRange(2, 1, n, width).getValues();
  var keep = data.filter(function (r) { return !want[String(r[0])]; });
  var count = data.length - keep.length;
  if (count) {
    sh.getRange(2, 1, n, width).clearContent();
    if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
  }
  return { ok: true, count: count };
}

function log_(rows) {
  var sh = sheet_(HISTORY);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 4).setValues(rows);
}

function dailyBackup() {
  var file = DriveApp.getFileById(SpreadsheetApp.getActive().getId());
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  file.makeCopy(file.getName() + ' — бэкап ' + stamp, folder);
  var all = [], it = folder.getFiles();
  while (it.hasNext()) all.push(it.next());
  all.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  all.slice(BACKUP_KEEP).forEach(function (f) { f.setTrashed(true); });
}
