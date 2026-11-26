// CruMotion: единый парсер сайтов брендов. Запускается в Chrome на вкладке сайта бренда.
// Сайты закрыты от запросов с сервера (403), поэтому парсим из браузера, а результат
// сохраняется файлом в «Загрузки»: crumotion_<brand>_<дата>.json. В чат возвращается только сводка.
//
// Использование (вставить файл в консоль или выполнить через Claude в Chrome, потом):
//   await CM.run({ list: '/en/women/footwear.html', top: 20 })            // UGG
//   await CM.run({ list: '/en-hk/c/women/leggings', top: 10 })            // lululemon HK
//   await CM.run({ urls: ['/en-hk/products/cloudmonster-2-...'] })        // On (ссылки на модели)
//   await CM.run({ list: '/collections/womens-leggings', top: 10 })       // ALO (Shopify)
//   await CM.run({ urls: [...] , dry: true })                             // без сохранения файла
// Единый формат на выходе: { brand, site, currency, parsed_at, items: [ {model_id, name, color_code, color,
//   price_full, price_now, sizes:[...], images:[...], description, url, type_hint} ] }
(() => {
const CM = window.CM = {};
const txt = h => new DOMParser().parseFromString(h, 'text/html');
const get = u => fetch(u, { credentials: 'include' }).then(r => { if (!r.ok) throw new Error(r.status + ' ' + u); return r.text(); });
const clean = s => (s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const ldOf = h => [...h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g)]
  .map(m => { try { return JSON.parse(m[1]); } catch (e) { return null; } }).filter(Boolean).flatMap(x => x['@graph'] || (Array.isArray(x) ? x : [x]));
async function pool(list, fn, n = 4) {
  const q = [...list], out = [];
  await Promise.all(Array.from({ length: n }, async () => { while (q.length) { const x = q.shift(); try { out.push(...[].concat(await fn(x))); } catch (e) { out.push({ err: String(e), src: x }); } } }));
  return out;
}

// ---------- UGG HK (Magento 2) ----------
const ugg = {
  brand: 'UGG', currency: 'HKD',
  async list(path, top) {
    const slugs = [];
    for (let p = 1; p <= 5 && slugs.length < top * 6; p++) {
      const d = txt(await get(`${path}?product_list_order=position&product_list_limit=60&p=${p}`));
      const a = [...d.querySelectorAll('li.product-item a[href*=".html"]')].map(x => x.getAttribute('href').split('/').pop().replace('.html', ''));
      if (!a.length) break; slugs.push(...a);
    }
    // все цвета модели: 1ug<модель><цвет>; берём первые top моделей, у каждой все цвета со страницы списка
    const uniq = [...new Set(slugs)], models = [];
    for (const s of uniq) { const m = s.match(/^1ug(\d+[a-z]?)/); if (m && !models.includes(m[1])) models.push(m[1]); }
    const keep = new Set(models.slice(0, top));
    return uniq.filter(s => keep.has((s.match(/^1ug(\d+[a-z]?)/) || [])[1])).map(s => `/en/${s}.html`);
  },
  parse(h, url) {
    const d = txt(h);
    const a = h.indexOf('"attributes":{"161"');
    const sizes = a > 0 ? [...new Set([...h.slice(a, a + 6000).matchAll(/"label":"(?:US\s*)?([MW\d][^"]{0,8})","products":\["\d/g)].map(m => m[1]))] : [];
    const fp = h.match(/"baseOldPrice":\{"amount":([\d.]+)\}[\s\S]{0,200}?"finalPrice":\{"amount":([\d.]+)/) || [];
    const main = (d.querySelector('.product-info-main')?.textContent || '').replace(/\s+/g, ' ');
    const slug = url.split('/').pop().replace('.html', ''); const m = slug.match(/^1ug(\d+[a-z]?)([a-z0-9]+)$/);
    const de = d.querySelector('.product.attribute.description .value') || d.querySelector('.product.attribute.description');
    return [{
      model_id: m ? m[1] : slug, color_code: m ? m[2].toUpperCase() : '', url: location.origin + url,
      name: (d.querySelector('.page-title, h1')?.textContent || '').replace(/\s+/g, ' ').replace(/^(Women's|Men's|Unisex's|Big Kids')\s*/, '').trim(),
      color: ((main.match(/SELECTED COLOR:\s*(.+?)\s+ADD TO/i) || [])[1] || '').replace(' Item Quantity:', '').trim(),
      price_full: +fp[1] || null, price_now: +fp[2] || null, sizes,
      description: de ? clean(de.innerHTML) : '',
      images: [...new Set(h.match(/\/media\/catalog\/product\/[0-9a-z]\/[0-9a-z]\/[^"'\s\\]+?\.(?:jpg|png)/gi) || [])].filter(x => !x.includes('/cache/')).map(x => location.origin + x).slice(0, 8),
      type_hint: (d.querySelector('.breadcrumbs')?.textContent || '').replace(/\s+/g, ' ').trim()
    }];
  }
};

// ---------- JSON-LD ProductGroup (lululemon HK, On) ----------
function fromLD(h, url, brand) {
  const ld = ldOf(h); const g = ld.find(x => x['@type'] === 'ProductGroup') || ld.find(x => x['@type'] === 'Product');
  if (!g) throw new Error('нет JSON-LD ' + url);
  const vs = g.hasVariant || [g]; const by = {};
  for (const v of vs) {
    const img = [].concat(v.image || g.image || [])[0] || '';
    const code = brand === 'lululemon' ? ((img.match(/lululemon\/([A-Z0-9]+_\d+)_/) || [])[1] || v.color) : (v.sku || '').replace(/-\w+$/, '') || v.color;
    const k = code + '|' + v.color; const o = [].concat(v.offers || [])[0] || {};
    by[k] = by[k] || { model_id: g.productGroupID || g.sku, color_code: code, color: v.color || '', name: g.name, url: o.url || url,
      price_full: +(o.price || 0) || null, price_now: +(o.price || 0) || null, sizes: [], images: [], description: clean(g.description), type_hint: g.category || '' };
    const r = by[k]; const p = +(o.price || 0);
    if (p && p > (r.price_full || 0)) r.price_full = p; if (p && p < (r.price_now || 1e9)) r.price_now = p;
    if (v.size && /InStock|LimitedAvailability/.test(o.availability || '')) r.sizes.push(String(v.size));
    for (const i of [].concat(v.image || [])) if (i && !r.images.includes(i.split('?')[0])) r.images.push(i.split('?')[0]);
  }
  return Object.values(by);
}
const lulu = {
  brand: 'lululemon', currency: 'HKD',
  async list(path, top) {
    const d = txt(await get(path)); const a = [...new Set([...d.querySelectorAll('a[href*="/p/"]')].map(x => x.getAttribute('href').split('?')[0]))];
    return a.slice(0, top);
  },
  parse: (h, url) => fromLD(h, url, 'lululemon')
};
const on = {
  brand: 'On', currency: 'HKD',
  async list(path, top) {
    const d = txt(await get(path)); const a = [...new Set([...d.querySelectorAll('a[href*="/products/"]')].map(x => x.getAttribute('href').split('?')[0]))];
    return a.slice(0, top);
  },
  parse(h, url) {
    const rows = fromLD(h, url, 'on');
    // размеры в JSON-LD у On не всегда есть: тогда берём кнопки размеров со страницы этого цвета (EU 36 ... 45)
    const eu = [...new Set([...h.matchAll(/aria-label="(\d{2}(?:\.5)?)(?![^"]*No items left)[^"]*"/g)].map(m => m[1]))];
    for (const r of rows) if (!r.sizes.length && eu.length && url.includes(r.color_code.toLowerCase())) r.sizes = eu;
    return rows;
  }
};

// ---------- ALO (Shopify) ----------
const alo = {
  brand: 'Alo Yoga', currency: 'USD',
  async list(path, top) {
    const j = JSON.parse(await get(`${path.replace(/\/$/, '')}/products.json?limit=250`));
    return j.products.slice(0, top).map(p => `/products/${p.handle}.js`);
  },
  parse(h, url) {
    const p = JSON.parse(h); const ci = p.options.findIndex(o => /colou?r/i.test(o.name || o)); const si = p.options.findIndex(o => /size/i.test(o.name || o));
    const by = {};
    for (const v of p.variants) {
      const color = ci >= 0 ? v.options[ci] : 'default'; const r = by[color] = by[color] || { model_id: String(p.id), color_code: color.toUpperCase().replace(/\W+/g, ''), color, name: p.title,
        url: location.origin + '/products/' + p.handle, price_full: null, price_now: null, sizes: [], images: [], description: clean(p.description), type_hint: p.type || '' };
      const full = (v.compare_at_price || v.price) / 100, now = v.price / 100;
      r.price_full = Math.max(r.price_full || 0, full); r.price_now = Math.min(r.price_now || 1e9, now);
      if (v.available && si >= 0) r.sizes.push(v.options[si]);
      const img = v.featured_image?.src; if (img && !r.images.includes(img)) r.images.push(img.startsWith('//') ? 'https:' + img : img);
    }
    for (const r of Object.values(by)) if (!r.images.length) r.images = p.images.slice(0, 6).map(i => i.startsWith('//') ? 'https:' + i : i);
    return Object.values(by);
  }
};

// ---------- Zara Home (Inditex itxrest API) ----------
const zarahome = {
  brand: 'Zara Home', currency: 'CNY',
  async list(path, top) { // path = URL категории; id категории ищем в разметке
    const h = await get(path); const cat = (h.match(/"categoryId":\s*"?(\d+)/) || h.match(/-l(\d+)\.html/) || path.match(/-l(\d+)/) || [])[1];
    const store = (h.match(/"storeId":\s*"?(\d+)/) || [])[1]; const cat2 = (h.match(/"catalogId":\s*"?(\d+)/) || [])[1];
    if (!cat || !store) throw new Error('Zara Home: не нашёл storeId/categoryId на странице ' + path);
    const ids = JSON.parse(await get(`/itxrest/3/catalog/store/${store}/${cat2}/category/${cat}/product?languageId=-1&appId=1`));
    CM._zh = { store, cat2 };
    return (ids.products || []).slice(0, top).map(p => `/itxrest/2/catalog/store/${store}/${cat2}/category/0/product/${p.id}/detail?languageId=-1&appId=1`);
  },
  parse(h, url) {
    const p = JSON.parse(h); const d = p.detail || p; const out = [];
    for (const c of (d.colors || [])) {
      const imgs = (c.xmedia || d.xmedia || []).flatMap(x => x.xmediaItems || []).flatMap(x => x.medias || []).map(m => `https://static.zarahome.net/8/photos4${m.extraInfo?.url || ''}`).filter(u => !u.endsWith('photos4'));
      out.push({ model_id: d.reference || String(p.id), color_code: String(c.id), color: c.name, name: p.name || d.name, url: location.origin + '/' + (p.productUrl || ''),
        price_full: Math.max(...(c.sizes || []).map(s => +(s.oldPrice || s.price) / 100)), price_now: Math.min(...(c.sizes || []).map(s => +s.price / 100)),
        sizes: (c.sizes || []).filter(s => s.visibilityValue === 'SHOW' || s.isBuyable).map(s => s.name), images: imgs.slice(0, 8),
        description: clean(d.longDescription || d.description || ''), type_hint: p.familyName || p.subfamilyName || '' });
    }
    return out;
  }
};

const SITES = { 'www.ugg.com.hk': ugg, 'www.lululemon.com.hk': lulu, 'www.on.com': on, 'www.aloyoga.com': alo, 'www.zarahome.com': zarahome, 'www.zarahome.cn': zarahome };
CM.run = async ({ list, urls, top = 20, dry = false, threads = 4, name } = {}) => {
  const A = SITES[location.host]; if (!A) return 'Сайт не поддерживается: ' + location.host;
  const pages = urls || await A.list(list, top);
  const rows = await pool(pages, async u => A.parse(await get(u), u), threads);
  const items = rows.filter(r => !r.err), errs = rows.filter(r => r.err);
  const res = { brand: A.brand, site: location.host, currency: A.currency, parsed_at: new Date().toISOString(), source: list || 'urls', items, errors: errs };
  CM.last = res;
  if (!dry) {
    const fn = name || `crumotion_${A.brand.toLowerCase().replace(/\W+/g, '')}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(res)], { type: 'application/json' })); a.download = fn; a.click();
    res.file = fn;
  }
  const models = new Set(items.map(i => i.model_id)).size, skus = items.reduce((s, i) => s + (i.sizes.length || 1), 0);
  return `${A.brand}: моделей ${models}, цветов ${items.length}, SKU ${skus}, ошибок ${errs.length}` + (res.file ? `, файл ${res.file}` : '') +
    (errs.length ? ' | ' + errs.slice(0, 3).map(e => e.err).join('; ') : '') +
    (items.length ? ` | пример: ${items[0].name} / ${items[0].color} / ${items[0].price_full} ${A.currency} / ${items[0].sizes.join(',')} / фото ${items[0].images.length}` : '');
};
return 'CM ready: ' + Object.keys(SITES).join(', ');
})();
