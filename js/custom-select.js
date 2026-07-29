// ==================== CUSTOM SELECT ====================
// Menggantikan native <select> dengan dropdown yang bisa di-style
// Dipakai untuk: pilih buku (header), kategori pengeluaran, kategori pemasukan

(function() {

// ── Warna per kategori pengeluaran ──
const EXPENSE_COLORS = {
  'Jajan':             '#A13A3A',
  'Tagihan Bulanan':   '#8B5E3C',
  'Belanja Harian':    '#9C6B9E',
  'Kesehatan':         '#2E6B4F',
  'Hiburan':           '#8C6B78',
  'Pendidikan':        '#2E5C82',
  'Transport':         '#5C6E8C',
  'Investasi':         '#6E8B3D',
  'Perawatan Tubuh':   '#A9637A',
  'Bumbu Dapur':       '#B5651D',
  'Kebersihan Rumah':  '#2E6B67',
  'Iuran Warga':       '#5C4E72',
  'Pertanian':         '#4E6E5C',
  'Sedekah':           '#9C7A2E',
  'Sumbangan':         '#9C7A2E',
  'Pulsa':             '#9E5B3E',
  'Pakan Peliharaan':  '#7D8C6B',
  'Kosmetik':          '#B05C8F',
  'Token Listrik':     '#3D6E9C',
  'Gas Melon':         '#C97A2E',
};

const INCOME_COLORS = {
  'Gaji':                  '#2E6B4F',
  'Freelance':             '#2E5C82',
  'Bonus':                 '#9C7A2E',
  'THR':                   '#A13A3A',
  'Hasil Investasi':       '#6E8B3D',
  'Jual Aset':             '#9C6B9E',
  'Hadiah':                '#8C6B78',
  'Penjualan':             '#2E6B67',
  'Jasa':                  '#B5651D',
  'Uang Muka':             '#5C4E72',
  'Pelunasan Piutang':     '#5C6E8C',
  'Komisi':                '#4E6E5C',
  'Pinjaman Diterima':     '#9E5B3E',
  'Pengembalian Dana':     '#7D8C6B',
  'Subsidi & Bantuan':     '#1B2A4A',
  'Lainnya':               '#9AA2AC',
};

// ── Close semua dropdown saat klik di luar ──
document.addEventListener('click', function(e) {
  document.querySelectorAll('.cs-wrapper.open').forEach(function(w) {
    var dd = w._csDropdown;
    var insideDropdown = dd && dd.contains(e.target);
    if (!w.contains(e.target) && !insideDropdown) closeCustomSelect(w);
  });
});

function closeCustomSelect(wrapper) {
  wrapper.classList.remove('open');
  var dropdown = wrapper._csDropdown;
  if (dropdown && dropdown.parentNode === document.body) {
    // Kembalikan dropdown ke dalam wrapper & bersihkan posisi fixed
    wrapper.appendChild(dropdown);
    dropdown.style.position = '';
    dropdown.style.display = '';
    dropdown.style.left = '';
    dropdown.style.top = '';
    dropdown.style.bottom = '';
    dropdown.style.width = '';
    dropdown.style.minWidth = '';
  }
  if (wrapper._csRepositionHandler) {
    window.removeEventListener('scroll', wrapper._csRepositionHandler, true);
    window.removeEventListener('resize', wrapper._csRepositionHandler);
    wrapper._csRepositionHandler = null;
  }
  var search = wrapper.querySelector('.cs-search');
  if (search) {
    search.value = '';
    filterOptions(wrapper, '');
  }
}

function filterOptions(wrapper, q) {
  var opts = wrapper.querySelectorAll('.cs-option');
  var found = 0;
  opts.forEach(function(o) {
    if (o.classList.contains('empty')) return;
    var match = q === '' || o.textContent.toLowerCase().includes(q.toLowerCase());
    o.style.display = match ? '' : 'none';
    if (match) found++;
  });
  var empty = wrapper.querySelector('.cs-option.empty');
  if (empty) empty.style.display = found === 0 ? '' : 'none';
}

// ── Buat wrapper custom select dari sebuah <select> ──
window.initCustomSelect = function(selectEl, opts) {
  opts = opts || {};
  var compact   = opts.compact   || false;
  var formStyle = opts.formStyle || false;
  var colorMap  = opts.colorMap  || null;
  var showDot   = opts.showDot   || false;
  var searchable = opts.searchable !== false; // default true

  // Wrap
  var wrapper = document.createElement('div');
  wrapper.className = 'cs-wrapper' + (compact ? ' compact' : '') + (formStyle ? ' form-style' : '');
  wrapper.setAttribute('data-cs-for', selectEl.id);
  selectEl.parentNode.insertBefore(wrapper, selectEl);
  wrapper.appendChild(selectEl);
  selectEl.style.display = 'none';

  // Trigger
  var trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'cs-trigger';
  trigger.innerHTML = '<span class="cs-trigger-text placeholder">Pilih...</span><span class="cs-trigger-icon">▾</span>';
  wrapper.appendChild(trigger);

  // Dropdown panel
  var dropdown = document.createElement('div');
  dropdown.className = 'cs-dropdown';

  if (searchable) {
    var searchWrap = document.createElement('div');
    searchWrap.className = 'cs-search-wrap';
    var searchEl = document.createElement('input');
    searchEl.type = 'text';
    searchEl.className = 'cs-search';
    searchEl.placeholder = 'Cari...';
    searchEl.addEventListener('input', function() {
      filterOptions(wrapper, this.value);
    });
    searchEl.addEventListener('click', function(e) { e.stopPropagation(); });
    searchWrap.appendChild(searchEl);
    dropdown.appendChild(searchWrap);
  }

  var optList = document.createElement('div');
  optList.className = 'cs-options';
  dropdown.appendChild(optList);
  wrapper.appendChild(dropdown);
  wrapper._csDropdown = dropdown;
  wrapper._csTrigger = trigger;

  // Render options dari <select>
  function buildOptions() {
    optList.innerHTML = '';
    var nativeOpts = selectEl.querySelectorAll('option');
    nativeOpts.forEach(function(no) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cs-option' + (no.value === '' ? ' empty' : '');
      if (no.getAttribute('data-child') === '1') btn.classList.add('child');
      btn.setAttribute('data-value', no.value);

      if (colorMap && colorMap[no.text] && no.value !== '') {
        var strip = document.createElement('span');
        strip.className = 'cs-opt-strip';
        strip.style.background = colorMap[no.text];
        btn.appendChild(strip);
      } else if (showDot && no.value !== '') {
        var dot = document.createElement('span');
        dot.className = 'cs-opt-dot';
        btn.appendChild(dot);
      }

      var labelWrap = document.createElement('span');
      labelWrap.className = 'cs-option-label';
      var nameSpan = document.createElement('span');
      nameSpan.className = 'cs-opt-name';
      nameSpan.textContent = no.text;
      labelWrap.appendChild(nameSpan);
      var optBalance = no.getAttribute('data-balance');
      if (optBalance) {
        var balSpan = document.createElement('span');
        balSpan.className = 'cs-opt-balance';
        balSpan.textContent = optBalance;
        labelWrap.appendChild(balSpan);
      }
      btn.appendChild(labelWrap);

      if (no.value !== '') {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          selectEl.value = no.value;
          selectEl.dispatchEvent(new Event('change', { bubbles: true }));
          updateTrigger();
          closeCustomSelect(wrapper);
        });
      }
      optList.appendChild(btn);

      if (no.selected && no.value !== '') {
        btn.classList.add('selected');
      }
    });
    // Empty notice jika tidak ada option
    var emptyNotice = document.createElement('button');
    emptyNotice.type = 'button';
    emptyNotice.className = 'cs-option empty';
    emptyNotice.style.display = 'none';
    emptyNotice.textContent = 'Tidak ada hasil';
    optList.appendChild(emptyNotice);
  }

  function updateTrigger() {
    var val = selectEl.value;
    var text = wrapper.querySelector('.cs-trigger-text');
    var selOpt = selectEl.querySelector('option[value="' + val + '"]');
    if (val && selOpt) {
      var optBalance = selOpt.getAttribute('data-balance');
      text.innerHTML = '<span class="cs-trigger-name"></span>' + (optBalance ? '<span class="cs-trigger-balance"></span>' : '');
      text.querySelector('.cs-trigger-name').textContent = selOpt.text;
      if (optBalance) text.querySelector('.cs-trigger-balance').textContent = optBalance;
      text.classList.remove('placeholder');
    } else {
      text.textContent = 'Pilih...';
      text.classList.add('placeholder');
    }
    // update selected state
    optList.querySelectorAll('.cs-option').forEach(function(o) {
      o.classList.toggle('selected', o.getAttribute('data-value') === val);
    });
  }

  trigger.addEventListener('click', function(e) {
    e.stopPropagation();
    var isOpen = wrapper.classList.contains('open');
    // Tutup semua lain
    document.querySelectorAll('.cs-wrapper.open').forEach(function(w) {
      if (w !== wrapper) closeCustomSelect(w);
    });
    if (isOpen) {
      closeCustomSelect(wrapper);
    } else {
      wrapper.classList.add('open');

      // Pindahkan dropdown ke <body> dengan position:fixed supaya tidak
      // pernah kepotong oleh ancestor yang punya overflow:hidden/auto
      // (mis. .book-selector yang di hape overflow-y:hidden untuk
      // scroll horizontal top bar).
      document.body.appendChild(dropdown);
      dropdown.style.position = 'fixed';
      dropdown.style.display = 'flex';

      function positionDropdown() {
        var rect = trigger.getBoundingClientRect();
        var dropH = dropdown.offsetHeight || 260;
        var spaceBelow = window.innerHeight - rect.bottom;
        var left = rect.left;
        var width = Math.max(rect.width, 180);
        // Jangan sampai keluar dari tepi kanan layar
        if (left + width > window.innerWidth - 8) {
          left = Math.max(8, window.innerWidth - width - 8);
        }
        dropdown.style.left = left + 'px';
        dropdown.style.width = width + 'px';
        dropdown.style.minWidth = width + 'px';
        if (spaceBelow < dropH + 10 && rect.top > dropH) {
          dropdown.style.top = 'auto';
          dropdown.style.bottom = (window.innerHeight - rect.top + 2) + 'px';
        } else {
          dropdown.style.bottom = 'auto';
          dropdown.style.top = (rect.bottom + 2) + 'px';
        }
      }
      positionDropdown();
      wrapper._csRepositionHandler = positionDropdown;
      window.addEventListener('scroll', positionDropdown, true);
      window.addEventListener('resize', positionDropdown);

      setTimeout(function() {
        var search = wrapper.querySelector('.cs-search');
        if (search) search.focus();
      }, 50);
    }
  });

  // Rebuild saat select berubah dari luar (mis. switchBook)
  var observer = new MutationObserver(function() {
    buildOptions();
    updateTrigger();
  });
  observer.observe(selectEl, { childList: true });

  // Juga saat value berubah dari luar
  selectEl.addEventListener('change', updateTrigger);

  buildOptions();
  updateTrigger();

  return wrapper;
};

// ── Init semua custom select saat DOM ready ──
function initAllCustomSelects() {
  // 1. Pilih Buku (header)
  var bookSel = document.getElementById('currentBookSelect');
  if (bookSel && !bookSel.closest('.cs-wrapper')) {
    window.initCustomSelect(bookSel, { compact: true, showDot: true, searchable: false });
  }

  // 2. Kategori Pengeluaran — tambah transaksi
  var expCat = document.getElementById('txCategory');
  if (expCat && !expCat.closest('.cs-wrapper')) {
    window.initCustomSelect(expCat, { formStyle: true, colorMap: EXPENSE_COLORS });
  }

  // 3. Kategori Pemasukan — tambah transaksi
  var incCat = document.getElementById('txIncomeCategory');
  if (incCat && !incCat.closest('.cs-wrapper')) {
    window.initCustomSelect(incCat, { formStyle: true, colorMap: INCOME_COLORS });
  }

  // 4. Kategori Pengeluaran — edit transaksi
  var editExpCat = document.getElementById('editTxCategory');
  if (editExpCat && !editExpCat.closest('.cs-wrapper')) {
    window.initCustomSelect(editExpCat, { formStyle: true, colorMap: EXPENSE_COLORS });
  }

  // 5. Kategori Pemasukan — edit transaksi
  var editIncCat = document.getElementById('editTxIncomeCategory');
  if (editIncCat && !editIncCat.closest('.cs-wrapper')) {
    window.initCustomSelect(editIncCat, { formStyle: true, colorMap: INCOME_COLORS });
  }

  // 6. Kategori barang — Belanja Bulanan (opsi diisi belakangan saat modal
  // dibuka pertama kali, lihat window._populateShoppingListCategorySelect
  // di js/shopping-list.js -- MutationObserver di initCustomSelect otomatis
  // membangun ulang daftar opsi begitu innerHTML select-nya berubah).
  var slistCat = document.getElementById('slistNewCategory');
  if (slistCat && !slistCat.closest('.cs-wrapper')) {
    window.initCustomSelect(slistCat, { formStyle: true, colorMap: EXPENSE_COLORS });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAllCustomSelects);
} else {
  initAllCustomSelects();
}

})();
