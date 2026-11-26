// CruMotion: единый парсер карточек брендов, режим «по открытой странице».
// Почему так: lululemon (Cloudflare) и UGG (CloudFront) отдают 403 на fetch/iframe и на запросы с сервера,
// пропускают только обычную навигацию вкладки. Поэтому вкладка открывает страницу, а парсер читает document.
//
// Установка (один раз на сайт, код сохраняется в localStorage этого сайта в твоём Chrome):
//   localStorage.cm_js = <текст этого файла>
// На каждой странице:
//   (0,eval)(localStorage.cm_js)
//   CM.links(20)   на странице категории: ссылки на первые 20 моделей (в память сайта)
//   CM.page()      на странице товара: разобрать и добавить в накопитель, ответ одной строкой
//   CM.save()      скачать накопленное файлом crumotion_<бренд>_<дата>.json в «Загрузки» и очистить
//   CM.status()    сколько уже собрано
// Единый формат: {brand, site, currency, parsed_at, items:[{model_id,name,color_code,color,price_full,price_now,sizes,images,description,url,type_hint}]}
(() => {
const CM = window.CM = {};
const clean = s => (s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const ldOf = () => [...document.querySelectorAll('script[type="application/ld+json"]')]
  .map(s => { try { return JSON.parse(s.textContent); } catch (e) { return null; } }).filter(Boolean).flatMap(x => x['@graph'] || (Array.isArray(x) ? x : [x]));
const H = () => document.documentElement.outerHTML;

function fromLD(brand) {
  const ld = ldOf(); const g = ld.find(x => x['@type'] === 'ProductGroup') || ld.find(x => x['@type'] === 'Product');
  if (!g) throw new Error('нет JSON-LD');
  const by = {};
  for (const v of (g.hasVariant || [g])) {
    const img = [].concat(v.image || g.image || [])[0] || ''; const o = [].concat(v.offers || [])[0] || {};
    const code = brand === 'lululemon' ? ((img.match(/lululemon\/([A-Z0-9]+_\d+)_/) || [])[1] || v.color) : ((v.sku || '').replace(/-[^-]+$/, '') || v.color);
    const k = code + '|' + v.color;
    const r = by[k] = by[k] || { model_id: String(g.productGroupID || g.sku || ''), color_code: code, color: v.color || '', name: g.name, url: location.href.split('?')[0],
      price_full: null, price_now: null, sizes: [], images: [], description: clean(g.description), type_hint: g.category || '' };
    const p = +(o.price || 0);
    if (p) { r.price_full = Math.max(r.price_full || 0, p); r.price_now = Math.min(r.price_now || 1e9, p); }
    if (v.size && /InStock|LimitedAvailability/.test(o.availability || '')) r.sizes.push(String(v.size));
    for (const i of [].concat(v.image || [])) { const u = String(i).split('?')[0]; if (u && !r.images.includes(u)) r.images.push(u); }
  }
  return Object.values(by);
}

const A = {
  'www.ugg.com.hk': {
    brand: 'UGG', currency: 'HKD',
    links: () => [...document.querySelectorAll('li.product-item a[href*=".html"]')].map(a => a.getAttribute('href').split('?')[0]),
    model: u => (u.match(/1ug(\d+[a-z]?)/) || [])[1],
    page() {
      const h = H(); const a = h.indexOf('"attributes":{"161"');
      const sizes = a > 0 ? [...new Set([...h.slice(a, a + 6000).matchAll(/"label":"(?:US\s*)?([MW\d][^"]{0,8})","products":\["\d/g)].map(m => m[1]))] : [];
      const fp = h.match(/"baseOldPrice":\{"amount":([\d.]+)\}[\s\S]{0,200}?"finalPrice":\{"amount":([\d.]+)/) || [];
      const main = (document.querySelector('.product-info-main')?.textContent || '').replace(/\s+/g, ' ');
      const m = location.pathname.match(/1ug(\d+[a-z]?)([a-z0-9]+)\.html/);
      const de = document.querySelector('.product.attribute.description .value') || document.querySelector('.product.attribute.description');
      return [{ model_id: m ? m[1] : '', color_code: m ? m[2].toUpperCase() : '', url: location.href.split('?')[0],
        name: (document.querySelector('.page-title, h1')?.textContent || '').replace(/\s+/g, ' ').replace(/^(Women's|Men's|Unisex's|Big Kids')\s*/, '').trim(),
        color: ((main.match(/SELECTED COLOR:\s*(.+?)\s+ADD TO/i) || [])[1] || '').replace(' Item Quantity:', '').trim(),
        price_full: +fp[1] || null, price_now: +fp[2] || null, sizes, description: de ? clean(de.innerHTML) : '',
        images: [...new Set(h.match(/\/media\/catalog\/product\/[0-9a-z]\/[0-9a-z]\/[^"'\s\\]+?\.(?:jpg|png)/gi) || [])].filter(x => !x.includes('/cache/')).map(x => location.origin + x).slice(0, 8),
        type_hint: (document.querySelector('.breadcrumbs')?.textContent || '').replace(/\s+/g, ' ').trim() }];
    }
  },
  'www.lululemon.com.hk': {
    brand: 'lululemon', currency: 'HKD',
    links: () => [...document.querySelectorAll('a[href*="/p/"]')].map(a => a.getAttribute('href').split('?')[0]),
    model: u => (u.match(/\/p\/[^/]+\/([^/.]+)/) || [])[1],
    page: () => fromLD('lululemon')
  },
  'www.on.com': {
    brand: 'On', currency: 'HKD',
    links: () => [...document.querySelectorAll('a[href*="/products/"]')].map(a => a.getAttribute('href').split('?')[0]),
    model: u => (u.match(/\/products\/([^/]+)/) || [])[1],
    page() {
      const rows = fromLD('on');
      const eu = [...document.querySelectorAll('[role=radio], button')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim())
        .filter(t => /^\d{2}(\.5)?/.test(t) && !/No items left/.test(t)).map(t => t.match(/^\d{2}(\.5)?/)[0]);
      const cur = location.pathname.split('-').pop().toUpperCase();
      for (const r of rows) if (!r.sizes.length && cur && r.color_code.toUpperCase().includes(cur)) r.sizes = [...new Set(eu)];
      return rows;
    }
  },
  'www.aloyoga.com': {
    brand: 'Alo Yoga', currency: 'USD',
    links: () => [...document.querySelectorAll('a[href*="/products/"]')].map(a => a.getAttribute('href').split('?')[0]),
    model: u => (u.match(/\/products\/([^/?]+)/) || [])[1],
    async page() { // Shopify: /products/<handle>.js с той же вкладки
      const p = await fetch(location.pathname.replace(/\/$/, '') + '.js').then(r => r.json());
      const ci = p.options.findIndex(o => /colou?r/i.test(o.name || o)), si = p.options.findIndex(o => /size/i.test(o.name || o)); const by = {};
      for (const v of p.variants) {
        const color = ci >= 0 ? v.options[ci] : 'default';
        const r = by[color] = by[color] || { model_id: String(p.id), color_code: color.toUpperCase().replace(/\W+/g, ''), color, name: p.title, url: location.origin + '/products/' + p.handle,
          price_full: null, price_now: null, sizes: [], images: [], description: clean(p.description), type_hint: p.type || '' };
        r.price_full = Math.max(r.price_full || 0, (v.compare_at_price || v.price) / 100); r.price_now = Math.min(r.price_now || 1e9, v.price / 100);
        if (v.available && si >= 0) r.sizes.push(v.options[si]);
        const img = v.featured_image?.src; if (img && !r.images.includes(img)) r.images.push(img.startsWith('//') ? 'https:' + img : img);
      }
      return Object.values(by);
    }
  }
};
A['www.zarahome.com'] = A['www.zarahome.cn'] = {
  brand: 'Zara Home', currency: 'CNY',
  links: () => [...document.querySelectorAll('a[href*="-p"]')].map(a => a.getAttribute('href').split('?')[0]).filter(h => /-p\d+\.html/.test(h)),
  model: u => (u.match(/-p(\d+)\.html/) || [])[1],
  page() {
    const r = fromLD('zarahome');
    const ref = (document.body.innerText.match(/(?:Ref|Артикул|参考)\.?\s*(\d{4}\/\d{3})/i) || [])[1];
    for (const x of r) { if (ref) x.model_id = ref; x.images = x.images.length ? x.images : [...document.querySelectorAll('img')].map(i => i.src).filter(s => /static\.zarahome/.test(s)).slice(0, 8); }
    return r;
  }
};

const S = A[location.host];
const acc = () => JSON.parse(localStorage.cm_acc || '[]');
CM.links = (top = 20) => {
  const all = [...new Set(S.links())].map(u => u.startsWith('http') ? u : location.origin + u);
  const seen = [], out = [];
  for (const u of all) { const m = S.model(u) || u; if (!seen.includes(m)) { if (seen.length >= top) continue; seen.push(m); } out.push(u); }
  localStorage.cm_links = JSON.stringify(out);
  return `${S.brand}: моделей ${seen.length}, ссылок ${out.length}`;
};
CM.next = () => { const l = JSON.parse(localStorage.cm_links || '[]'); const done = new Set(acc().map(x => x._src)); return l.filter(u => !done.has(u)); };
CM.page = async () => {
  try {
    const rows = await S.page(); const a = acc().filter(x => x._src !== location.href.split('?')[0]);
    for (const r of rows) { r._src = location.href.split('?')[0]; a.push(r); }
    localStorage.cm_acc = JSON.stringify(a);
    const r = rows[0] || {};
    return `ок ${rows.length} цв | ${r.name} / ${r.color} / ${r.price_full} / ${(r.sizes || []).join(',')} / фото ${(r.images || []).length} | всего ${a.length}`;
  } catch (e) { return 'ошибка ' + e; }
};
CM.status = () => { const a = acc(); return `${S.brand}: цветов ${a.length}, моделей ${new Set(a.map(x => x.model_id)).size}, осталось страниц ${CM.next().length}`; };
CM.save = (name) => {
  const items = acc().map(({ _src, ...x }) => x);
  const res = { brand: S.brand, site: location.host, currency: S.currency, parsed_at: new Date().toISOString(), items };
  const fn = name || `crumotion_${S.brand.toLowerCase().replace(/\W+/g, '')}_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const el = document.createElement('a'); el.href = URL.createObjectURL(new Blob([JSON.stringify(res)], { type: 'application/json' })); el.download = fn; el.click();
  localStorage.removeItem('cm_acc'); localStorage.removeItem('cm_links');
  return `сохранено ${items.length} цветов в «Загрузки»: ${fn}`;
};
return S ? `CM готов: ${S.brand}` : 'сайт не поддерживается: ' + location.host;
})();
