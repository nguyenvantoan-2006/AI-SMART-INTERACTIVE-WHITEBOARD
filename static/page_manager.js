// ============================================================
//  PAGE MANAGER + OCR DEDUPLICATION + i18n
//  Smart Chemistry Whiteboard — Samsung Innovation Campus
//  Req 1:  Responsive "+" button viewport clamping
//  Req 2:  Multi-page Whiteboard
//  Req 3:  Page Navigation Controls
//  Req 4:  Independent Page State Management
//  Req 5:  Toolbar without hand icon
//  Req 6:  AI Handwriting Recognition Object Specs
//  Req 7:  Draggable AI-Recognized Text
//  Req 8:  Prevent Duplicate OCR Text
//  Req 9:  Duplicate Detection Logic (Text + Pos + IoU + BBox)
//  Req 10: Normalize OCR Text (Subscripts & Formatting)
//  Req 11: Preserve Manually Moved Objects
//  Req 12: Distinguish New Text from Existing Text
//  Req 13: Vietnamese and English i18n Support
//  Req 14: Teacher-Friendly Overall UI
// ============================================================

// ── 1. i18n LOCALIZATION DICTIONARY ──────────────────────────
const TRANSLATIONS = {
  vi: {
    appTitle:               'Bảng Trắng Thông Minh',
    appBadge:               'Hóa Học & AI',
    page:                   'Trang',
    previous:               'Trang trước',
    next:                   'Trang sau',
    addPage:                'Thêm trang',
    deletePage:             'Xóa trang',
    save:                   'Lưu',
    aiRecognition:          'Nhận dạng AI',
    move:                   'Di chuyển',
    pen:                    'Bút vẽ',
    text:                   'Văn bản',
    formula:                'Công thức Hóa',
    erase:                  'Tẩy',
    clear:                  'Xóa tất cả',
    settings:               'Cài đặt',
    language:               'Ngôn ngữ',
    beautify:               'Chữ đẹp (OCR)',
    analyze:                'Phân tích AI',
    quiz:                   'Tạo Quiz',
    nlp:                    'Giải từ văn bản',
    undo:                   'Hoàn tác',
    redo:                   'Làm lại',
    fullscreen:             'Toàn màn hình',
    exitFullscreen:         'Thoát toàn màn hình',
    lasso:                  'Khoanh vùng',
    brushSize:              'Cỡ nét',
    pageOf:                 'Trang {cur} / {total}',
    pageDeleted:            'Đã xóa trang {num}',
    pageAdded:              'Đã thêm trang mới',
    confirmDelete:          'Bạn có chắc chắn muốn xóa trang này?',
    cannotDelete:           'Phải có ít nhất 1 trang',
    duplicateOCR:           'Văn bản đã tồn tại, đã tránh trùng lặp',
    ocrSuccess:             'Đã nhận dạng AI thành công',
    mic:                    'Giọng nói',
    tts:                    'Đọc văn bản',
    copiedText:             'Đã sao chép công thức',
    movedPreserved:         'Đã giữ nguyên vị trí công thức bạn đã di chuyển',
    quickMenu:              'Menu công cụ nhanh',
    emptyBoard:             'Bảng đang trống!',
    confirmClear:           'Xóa toàn bộ nội dung của trang này?',
    moveModeToast:          'Chế độ di chuyển: Chọn và kéo chữ/công thức trên bảng'
  },
  en: {
    appTitle:               'Smart Chemistry Whiteboard',
    appBadge:               'Chemistry & AI',
    page:                   'Page',
    previous:               'Previous',
    next:                   'Next',
    addPage:                'Add Page',
    deletePage:             'Delete Page',
    save:                   'Save',
    aiRecognition:          'AI Recognition',
    move:                   'Move',
    pen:                    'Pen',
    text:                   'Text',
    formula:                'Chemistry Formula',
    erase:                  'Eraser',
    clear:                  'Clear All',
    settings:               'Settings',
    language:               'Language',
    beautify:               'Beautify (OCR)',
    analyze:                'AI Analysis',
    quiz:                   'Create Quiz',
    nlp:                    'Solve from Text',
    undo:                   'Undo',
    redo:                   'Redo',
    fullscreen:             'Fullscreen',
    exitFullscreen:         'Exit Fullscreen',
    lasso:                  'Lasso',
    brushSize:              'Brush Size',
    pageOf:                 'Page {cur} of {total}',
    pageDeleted:            'Deleted Page {num}',
    pageAdded:              'New page added',
    confirmDelete:          'Are you sure you want to delete this page?',
    cannotDelete:           'At least 1 page required',
    duplicateOCR:           'Text already exists, duplicate skipped',
    ocrSuccess:             'AI recognition successful',
    mic:                    'Voice Input',
    tts:                    'Read Aloud',
    copiedText:             'Formula copied',
    movedPreserved:         'Preserved position of manually moved formula',
    quickMenu:              'Quick Tools Menu',
    emptyBoard:             'Whiteboard is empty!',
    confirmClear:           'Clear all content on this page?',
    moveModeToast:          'Move Mode: Tap or drag text/formulas to move'
  }
};

let currentLang = localStorage.getItem('wb_lang') || 'vi';

function t(key, vars) {
  let s = (TRANSLATIONS[currentLang] || TRANSLATIONS.vi)[key] || key;
  if (vars) {
    Object.keys(vars).forEach(k => {
      s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]);
    });
  }
  return s;
}

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    el.title = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });

  // Update top language selector indicator
  const langTextEl = document.getElementById('current-lang-text');
  const langFlagEl = document.getElementById('current-lang-flag');
  if (langTextEl) langTextEl.textContent = currentLang === 'vi' ? 'Tiếng Việt' : 'English';
  if (langFlagEl) langFlagEl.textContent = currentLang === 'vi' ? '🇻🇳' : '🇬🇧';

  document.querySelectorAll('.lang-dropdown-item').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-lang') === currentLang);
  });

  // Update page counter & tabs
  if (typeof updatePageUI === 'function') updatePageUI();
  document.documentElement.lang = currentLang;
}

function setLang(lang) {
  if (lang !== 'vi' && lang !== 'en') lang = 'vi';
  currentLang = lang;
  localStorage.setItem('wb_lang', lang);
  applyI18n();

  // Close dropdown if open
  const dropdownList = document.getElementById('lang-dropdown-list');
  if (dropdownList) dropdownList.classList.add('hidden');
}

// ── 2. MULTI-PAGE STATE MANAGEMENT ───────────────────────────
// Data structure according to Req #4:
// pages = [
//   { id: 1, elements: [], canvasJSON: null, ocrObjects: [], undoStack: [], redoStack: [] },
//   ...
// ]
const pageManager = {
  pages: [
    {
      id: 1,
      elements: [],
      canvasJSON: null,
      ocrObjects: [],
      undoStack: [],
      redoStack: []
    }
  ],
  currentPageId: 1,

  getCurrentPage() {
    return this.pages.find(p => p.id === this.currentPageId) || this.pages[0];
  },

  getPageIndex(id = this.currentPageId) {
    return this.pages.findIndex(p => p.id === id);
  },

  addPage() {
    const newId = this.pages.length === 0 ? 1 : Math.max(...this.pages.map(p => p.id)) + 1;
    this.pages.push({
      id: newId,
      elements: [],
      canvasJSON: null,
      ocrObjects: [],
      undoStack: [],
      redoStack: []
    });
    return newId;
  },

  deletePage(id) {
    if (this.pages.length <= 1) return false;
    const idx = this.pages.findIndex(p => p.id === id);
    if (idx === -1) return false;

    this.pages.splice(idx, 1);
    const newIdx = Math.min(idx, this.pages.length - 1);
    this.currentPageId = this.pages[newIdx].id;
    return true;
  }
};

function getPageNum(id) {
  const idx = pageManager.pages.findIndex(p => p.id === id);
  return idx !== -1 ? idx + 1 : 1;
}

// ── 3. INDEPENDENT PAGE CANVAS STATE (SAVE & LOAD) ────────────
function saveCurrentPageCanvas() {
  const page = pageManager.getCurrentPage();
  if (!page || typeof canvas === 'undefined' || !canvas) return;

  // Sync current positions of all active OCR objects before serializing
  if (page.ocrObjects && page.ocrObjects.length > 0) {
    page.ocrObjects.forEach(entry => {
      if (entry._fabricObj && entry._fabricObj.left !== undefined) {
        entry.x = Math.round(entry._fabricObj.left);
        entry.y = Math.round(entry._fabricObj.top);
        entry.width = Math.round(entry._fabricObj.getScaledWidth());
        entry.height = Math.round(entry._fabricObj.getScaledHeight());
      }
    });
  }

  // Save Fabric canvas state with custom OCR metadata properties
  page.canvasJSON = JSON.stringify(
    canvas.toJSON([
      'selectable', 'evented', 'data', 'id',
      'hasControls', 'hasBorders', 'lockScalingX', 'lockScalingY', 'lockRotation',
      'hoverCursor', 'moveCursor', 'fontFamily', 'fontSize', 'fill'
    ])
  );

  // Sync undo & redo stacks if available
  if (typeof undoStack !== 'undefined') page.undoStack = [...undoStack];
  if (typeof redoStack !== 'undefined') page.redoStack = [...redoStack];

  // Sync elements array (Req #4)
  page.elements = (canvas.getObjects() || []).map(obj => ({
    type: obj.type,
    left: Math.round(obj.left),
    top: Math.round(obj.top),
    isOCR: !!(obj.data && obj.data.isOCR),
    ocrId: obj.data ? obj.data.ocrId : null,
    text: obj.text || null
  }));
}

function loadPageCanvas(pageId) {
  return new Promise((resolve) => {
    const page = pageManager.pages.find(p => p.id === pageId);
    if (!page || typeof canvas === 'undefined' || !canvas) {
      resolve();
      return;
    }

    // Clean up DOM-based smart widgets from previous page
    if (typeof disposeAllRenderers === 'function') disposeAllRenderers();
    document.querySelectorAll('.smart-widget').forEach(w => w.remove());
    if (typeof clearLasso === 'function') clearLasso();

    if (!page.canvasJSON) {
      // Clean canvas for empty page
      canvas.clear();
      canvas.backgroundColor = '#0a1628';
      canvas.renderAll();
      if (typeof undoStack !== 'undefined') undoStack.length = 0;
      if (typeof redoStack !== 'undefined') redoStack.length = 0;
      resolve();
    } else {
      canvas.loadFromJSON(page.canvasJSON, () => {
        canvas.backgroundColor = '#0a1628';

        // Reconnect Fabric OCR objects with page's ocrObjects list and re-bind listeners
        const canvasObjs = canvas.getObjects();
        canvasObjs.forEach(obj => {
          if (obj.data && obj.data.isOCR) {
            const entry = (page.ocrObjects || []).find(o => o.id === obj.data.ocrId);
            makeOCRTextDraggable(obj, entry);
            if (entry) {
              entry._fabricObj = obj;
            }
          }
        });

        // Restore undo/redo stacks
        if (typeof undoStack !== 'undefined') {
          undoStack.length = 0;
          if (page.undoStack && page.undoStack.length > 0) {
            page.undoStack.forEach(s => undoStack.push(s));
          }
        }
        if (typeof redoStack !== 'undefined') {
          redoStack.length = 0;
          if (page.redoStack && page.redoStack.length > 0) {
            page.redoStack.forEach(s => redoStack.push(s));
          }
        }

        canvas.renderAll();
        resolve();
      });
    }
  });
}

async function switchToPage(newPageId) {
  if (newPageId === pageManager.currentPageId) return;
  saveCurrentPageCanvas();
  pageManager.currentPageId = newPageId;
  await loadPageCanvas(newPageId);
  updatePageUI();

  if (typeof showToast === 'function') {
    showToast(t('page') + ' ' + getPageNum(newPageId), 'info', 1200);
  }
}

// ── 4. PAGE NAVIGATION UI CONTROLS ────────────────────────────
function updatePageUI() {
  const pages = pageManager.pages;
  const curId = pageManager.currentPageId;
  const curNum = getPageNum(curId);
  const total = pages.length;

  // Counter text: e.g. "Trang 1 / 3" or "Page 1 of 3"
  const counter = document.getElementById('page-counter');
  if (counter) counter.textContent = t('pageOf', { cur: curNum, total });

  // Prev / Next button states
  const btnPrev = document.getElementById('btn-page-prev');
  const btnNext = document.getElementById('btn-page-next');
  if (btnPrev) btnPrev.disabled = curNum <= 1;
  if (btnNext) btnNext.disabled = curNum >= total;

  // Delete page button (disable when only 1 page remains)
  const btnDelete = document.getElementById('btn-page-delete');
  if (btnDelete) btnDelete.disabled = total <= 1;

  // Tab Strip: Page 1 | Page 2 | Page 3...
  const strip = document.getElementById('page-tabs-strip');
  if (!strip) return;
  strip.innerHTML = '';

  pages.forEach((pg) => {
    const num = getPageNum(pg.id);
    const tab = document.createElement('div');
    tab.className = 'page-tab' + (pg.id === curId ? ' active' : '');
    tab.setAttribute('data-page-id', pg.id);

    const label = document.createElement('span');
    label.className = 'page-tab-label';
    label.textContent = t('page') + ' ' + num;
    label.title = t('page') + ' ' + num;
    label.addEventListener('click', () => switchToPage(pg.id));
    tab.appendChild(label);

    // If more than 1 page, show close button on tab
    if (total > 1) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'page-tab-close';
      closeBtn.innerHTML = '&times;';
      closeBtn.title = t('deletePage') + ' ' + num;
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.deletePage(pg.id);
      });
      tab.appendChild(closeBtn);
    }

    strip.appendChild(tab);
  });

  // Ensure active tab is scrolled into view smoothly
  const activeTab = strip.querySelector('.page-tab.active');
  if (activeTab && strip.parentElement) {
    activeTab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }
}

/**
 * Public API to delete a page (either specified or current active page)
 */
window.deletePage = function(targetPageId) {
  if (pageManager.pages.length <= 1) {
    if (typeof showToast === 'function') showToast(t('cannotDelete'), 'warn');
    return false;
  }
  const idToDelete = targetPageId || pageManager.currentPageId;
  const num = getPageNum(idToDelete);
  const wasActive = (idToDelete === pageManager.currentPageId);

  const success = pageManager.deletePage(idToDelete);
  if (!success) return false;

  if (wasActive) {
    loadPageCanvas(pageManager.currentPageId).then(() => {
      updatePageUI();
      if (typeof showToast === 'function') {
        showToast(t('pageDeleted', { num }), 'info');
      }
    });
  } else {
    updatePageUI();
    if (typeof showToast === 'function') {
      showToast(t('pageDeleted', { num }), 'info');
    }
  }
  return true;
};

function initPageControls() {
  // Previous Page
  document.getElementById('btn-page-prev')?.addEventListener('click', () => {
    const idx = pageManager.getPageIndex();
    if (idx > 0) switchToPage(pageManager.pages[idx - 1].id);
  });

  // Next Page
  document.getElementById('btn-page-next')?.addEventListener('click', () => {
    const idx = pageManager.getPageIndex();
    if (idx < pageManager.pages.length - 1) switchToPage(pageManager.pages[idx + 1].id);
  });

  // Add Page
  document.getElementById('btn-page-add')?.addEventListener('click', () => {
    saveCurrentPageCanvas();
    const newId = pageManager.addPage();
    pageManager.currentPageId = newId;

    if (typeof canvas !== 'undefined' && canvas) {
      canvas.clear();
      canvas.backgroundColor = '#0a1628';
      canvas.renderAll();
    }
    if (typeof undoStack !== 'undefined') undoStack.length = 0;
    if (typeof redoStack !== 'undefined') redoStack.length = 0;

    updatePageUI();
    if (typeof showToast === 'function') {
      showToast(t('pageAdded') + ' — ' + t('page') + ' ' + getPageNum(newId), 'success');
    }
  });

  // Delete Page (Main Button)
  document.getElementById('btn-page-delete')?.addEventListener('click', () => {
    window.deletePage(pageManager.currentPageId);
  });

  // Language Dropdown Selector (Req #13 & #14)
  const langToggleBtn = document.getElementById('lang-dropdown-btn');
  const langDropdownList = document.getElementById('lang-dropdown-list');

  if (langToggleBtn && langDropdownList) {
    langToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      langDropdownList.classList.toggle('hidden');
    });

    document.querySelectorAll('.lang-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const selectedLang = item.getAttribute('data-lang');
        setLang(selectedLang);
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#lang-dropdown-wrap')) {
        langDropdownList.classList.add('hidden');
      }
    });
  }
}

// ── 5. OCR NORMALIZATION (Req #10) ────────────────────────────
// Maps Unicode subscripts & superscripts to ASCII
const SUBSCRIPT_TO_ASCII = {
  '₀':'0','₁':'1','₂':'2','₃':'3','₄':'4',
  '₅':'5','₆':'6','₇':'7','₈':'8','₉':'9',
  '⁰':'0','¹':'1','²':'2','³':'3','⁴':'4',
  '⁵':'5','⁶':'6','⁷':'7','⁸':'8','⁹':'9',
  '₊':'+','₋':'-','⁺':'+','⁻':'-'
};

const ASCII_TO_SUBSCRIPT = {
  '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄',
  '5':'₅','6':'₆','7':'₇','8':'₈','9':'₉'
};

/**
 * Normalizes chemical & handwritten text for strict comparison:
 * " H2SO4 " -> "h2so4"
 * "H₂SO₄"   -> "h2so4"
 * "2H2 + O2 -> 2H2O" -> "2h2+o22h2o"
 */
function normalizeOCRText(text) {
  if (!text) return '';
  let s = String(text);

  // Replace all subscripts/superscripts with regular ASCII
  for (const [sub, asc] of Object.entries(SUBSCRIPT_TO_ASCII)) {
    s = s.split(sub).join(asc);
  }

  // Convert to lower case, remove spaces, reaction arrows, gas/precipitate markers, punctuation
  return s.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/(<->|<=>|-->|->|=>)/g, '')
    .replace(/[→←⇌⇒⟶=]/g, '')
    .replace(/[↑↓]/g, '')
    .replace(/[.,!?;:()\[\]{}]/g, '');
}

/**
 * Formats numbers following chemical element symbols into Unicode subscripts:
 * e.g. "H2SO4" -> "H₂SO₄"
 */
function formatChemicalSubscripts(text) {
  if (!text) return '';
  // Convert digits immediately after Latin letters or closing parens into subscripts
  return text.replace(/([A-Za-z\)])([0-9]+)/g, (match, letter, digits) => {
    const subDigits = digits.split('').map(d => ASCII_TO_SUBSCRIPT[d] || d).join('');
    return letter + subDigits;
  });
}

// ── 6. BOUNDING BOX & IoU UTILITIES (Req #9) ───────────────────
function bboxOverlap(b1, b2) {
  return !(
    b1.x + b1.w < b2.x ||
    b2.x + b2.w < b1.x ||
    b1.y + b1.h < b2.y ||
    b2.y + b2.h < b1.y
  );
}

function bboxIoU(a, b) {
  const ix1 = Math.max(a.x, b.x);
  const iy1 = Math.max(a.y, b.y);
  const ix2 = Math.min(a.x + a.w, b.x + b.w);
  const iy2 = Math.min(a.y + a.h, b.y + b.h);
  const iw = Math.max(0, ix2 - ix1);
  const ih = Math.max(0, iy2 - iy1);
  const inter = iw * ih;
  if (inter === 0) return 0;

  const union = (a.w * a.h) + (b.w * b.h) - inter;
  return union > 0 ? inter / union : 0;
}

function centerDist(a, b) {
  const cax = a.x + a.w / 2;
  const cay = a.y + a.h / 2;
  const cbx = b.x + b.w / 2;
  const cby = b.y + b.h / 2;
  return Math.sqrt((cax - cbx) ** 2 + (cay - cby) ** 2);
}

// ── 7. DUPLICATE DETECTION LOGIC (Req #8, #9, #11, #12) ────────
/**
 * Compares new OCR candidate with existing OCR objects on the current page:
 * 1. Checks normalized text match
 * 2. Checks current position (IoU / distance / overlap)
 * 3. Checks original creation position before manual move (Req #11)
 * 4. Allows separate objects if distance is sufficiently large (Req #12)
 *
 * Returns: { match: existingEntry, reason: 'current_position' | 'original_position_preserved' } or null
 */
function findDuplicateOCR(newItem) {
  const page = pageManager.getCurrentPage();
  if (!page || !page.ocrObjects || page.ocrObjects.length === 0) return null;

  const normNew = normalizeOCRText(newItem.text);
  if (!normNew) return null;

  const DIST_THRESHOLD = 150; // px threshold for nearby detection
  const IOU_THRESHOLD  = 0.15; // IoU threshold

  const newBBox = {
    x: newItem.x,
    y: newItem.y,
    w: newItem.width || newItem.w || 80,
    h: newItem.height || newItem.h || 40
  };

  for (const existing of page.ocrObjects) {
    const normExist = normalizeOCRText(existing.text);
    if (normNew !== normExist) {
      // Distinct chemical formula or words (e.g. HCl vs H2SO4) -> Not duplicate (Req #12)
      continue;
    }

    // A. Check CURRENT position of the existing object
    const curBBox = {
      x: existing.x,
      y: existing.y,
      w: existing.width || 80,
      h: existing.height || 40
    };
    const curDist = centerDist(newBBox, curBBox);
    const curIoU  = bboxIoU(newBBox, curBBox);
    const curOver = bboxOverlap(newBBox, curBBox);

    if (curDist < DIST_THRESHOLD || curIoU > IOU_THRESHOLD || curOver) {
      return { match: existing, reason: 'current_position' };
    }

    // B. Check ORIGINAL creation position before manual move (Req #11)
    if (existing.origX !== undefined && existing.origY !== undefined) {
      const origBBox = {
        x: existing.origX,
        y: existing.origY,
        w: existing.origW || existing.width || 80,
        h: existing.origH || existing.height || 40
      };
      const origDist = centerDist(newBBox, origBBox);
      const origIoU  = bboxIoU(newBBox, origBBox);
      const origOver = bboxOverlap(newBBox, origBBox);

      if (origDist < DIST_THRESHOLD || origIoU > IOU_THRESHOLD || origOver) {
        return { match: existing, reason: 'original_position_preserved' };
      }
    }
  }

  // Not a duplicate: either different text or intentionally rewritten far away
  return null;
}

// ── 8. DRAGGABLE OCR OBJECT REGISTRY & FACTORY (Req #6, #7) ────
function makeOCRTextDraggable(textObj, ocrItem) {
  textObj.set({
    selectable:   true,
    evented:      true,
    hasControls:  true,
    hasBorders:   true,
    padding:      14,
    borderColor:  '#3b82f6',
    borderScaleFactor: 2,
    lockScalingX: false,
    lockScalingY: false,
    lockRotation: true,
    hoverCursor:  'move',
    moveCursor:   'move',
    cornerColor:  '#3b82f6',
    cornerSize:   10,
    cornerStyle:  'circle',
    transparentCorners: false,
    data: {
      isOCR: true,
      ocrId: ocrItem ? ocrItem.id : (textObj.data ? textObj.data.ocrId : null)
    }
  });

  // Track position when dragged / moved (Req #7, #11)
  textObj.on('moved', () => {
    const page = pageManager.getCurrentPage();
    if (!page) return;
    const entry = (page.ocrObjects || []).find(o => o._fabricObj === textObj || (o.id && textObj.data && o.id === textObj.data.ocrId));
    if (entry) {
      entry.x = Math.round(textObj.left);
      entry.y = Math.round(textObj.top);
      // Notice: entry.origX and entry.origY are kept intact!
    }
  });

  // Track dimensions if resized
  textObj.on('scaling', () => {
    const page = pageManager.getCurrentPage();
    if (!page) return;
    const entry = (page.ocrObjects || []).find(o => o._fabricObj === textObj || (o.id && textObj.data && o.id === textObj.data.ocrId));
    if (entry) {
      entry.width = Math.round(textObj.getScaledWidth());
      entry.height = Math.round(textObj.getScaledHeight());
    }
  });

  // Track text if edited
  textObj.on('changed', () => {
    const page = pageManager.getCurrentPage();
    if (!page) return;
    const entry = (page.ocrObjects || []).find(o => o._fabricObj === textObj || (o.id && textObj.data && o.id === textObj.data.ocrId));
    if (entry) {
      entry.text = textObj.text;
    }
  });

  // Clean up if deleted
  textObj.on('removed', () => {
    const page = pageManager.getCurrentPage();
    if (!page || !page.ocrObjects) return;
    page.ocrObjects = page.ocrObjects.filter(o => o._fabricObj !== textObj);
  });
}

/**
 * Public API: Creates an AI-Recognized Text Object on the Whiteboard
 * Complies with Req #6 data structure:
 * { id, text, x, y, width, height, pageId, confidence, timestamp }
 */
window.addOCRTextObject = function(rawText, x, y, w, h, confidence = 0.96, toRemoveStrokes = []) {
  if (typeof canvas === 'undefined' || !canvas) return null;

  // Format chemical subscripts e.g. H2SO4 -> H₂SO₄
  const formattedText = formatChemicalSubscripts(rawText.trim());

  const strokeW = Math.max(60, Math.round(w));
  const strokeH = Math.max(30, Math.round(h));
  const posX = Math.round(x);
  const posY = Math.round(y);

  const candidateItem = {
    id: 'ocr-' + String(Date.now()).slice(-6) + '-' + Math.floor(Math.random() * 1000),
    text: formattedText,
    x: posX,
    y: posY,
    width: strokeW,
    height: strokeH,
    origX: posX,
    origY: posY,
    origW: strokeW,
    origH: strokeH,
    pageId: pageManager.currentPageId,
    confidence: confidence || 0.96,
    timestamp: Date.now()
  };

  // Run Duplicate Detection (Req #8, #9, #11, #12)
  const dupCheck = findDuplicateOCR(candidateItem);

  if (dupCheck) {
    // Duplicate detected!
    // 1. Remove handwritten strokes so they don't linger under the recognized text
    if (Array.isArray(toRemoveStrokes) && toRemoveStrokes.length > 0) {
      toRemoveStrokes.forEach(s => {
        try { canvas.remove(s); } catch(e){}
      });
      canvas.renderAll();
    }

    const existing = dupCheck.match;

    // 2. If object was manually moved, preserve its current position! (Req #11)
    if (dupCheck.reason === 'original_position_preserved') {
      if (typeof showToast === 'function') {
        showToast(t('movedPreserved') + ': ' + existing.text, 'info', 2800);
      }
    } else {
      if (typeof showToast === 'function') {
        showToast(t('duplicateOCR') + ': ' + existing.text, 'warn', 2400);
      }
    }

    // 3. Highlight existing object briefly so the teacher sees where it is
    if (existing._fabricObj) {
      const origStroke = existing._fabricObj.stroke;
      const origStrokeW = existing._fabricObj.strokeWidth;
      existing._fabricObj.set({
        stroke: '#3b82f6',
        strokeWidth: 2
      });
      canvas.renderAll();
      setTimeout(() => {
        if (existing._fabricObj) {
          existing._fabricObj.set({
            stroke: origStroke || null,
            strokeWidth: origStrokeW || 0
          });
          canvas.renderAll();
        }
      }, 1000);
      return existing._fabricObj;
    }
    return null;
  }

  // NO Duplicate: Create brand new editable and draggable Fabric Textbox
  if (Array.isArray(toRemoveStrokes) && toRemoveStrokes.length > 0) {
    toRemoveStrokes.forEach(s => {
      try { canvas.remove(s); } catch(e){}
    });
  }

  // Calculate proportional font size
  const textLen = Math.max(1, formattedText.length);
  let computedFontSize = Math.sqrt((strokeW * strokeH) / (0.5 * textLen)) * 0.85;
  computedFontSize = Math.max(20, Math.min(computedFontSize, strokeH * 0.9, 48));

  const textFill = (typeof currentColor !== 'undefined' && currentColor && currentColor !== '#0a1628')
    ? currentColor
    : '#ffffff';

  const textObj = new fabric.Textbox(formattedText, {
    left: posX,
    top: posY,
    width: strokeW,
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
    fontSize: computedFontSize,
    fill: textFill,
    selectable: true,
    evented: true,
    data: {
      isOCR: true,
      ocrId: candidateItem.id
    }
  });

  candidateItem._fabricObj = textObj;
  makeOCRTextDraggable(textObj, candidateItem);

  canvas.add(textObj);
  canvas.setActiveObject(textObj);
  canvas.renderAll();

  // Register in current page
  const curPage = pageManager.getCurrentPage();
  if (curPage) {
    if (!curPage.ocrObjects) curPage.ocrObjects = [];
    curPage.ocrObjects.push(candidateItem);
    if (!curPage.elements) curPage.elements = [];
    curPage.elements.push({
      type: 'textbox',
      left: posX,
      top: posY,
      isOCR: true,
      ocrId: candidateItem.id,
      text: formattedText
    });
  }

  if (typeof saveState === 'function') saveState();

  if (typeof showToast === 'function') {
    showToast(t('ocrSuccess') + ': ' + formattedText, 'success', 2200);
  }

  return textObj;
};

// ── 9. FAB VIEWPORT CLAMPING & DRAG FIX (Req #1) ───────────────
/**
 * Clamps floating "+" menu strictly inside the viewport:
 * - Never overflows right/bottom edges
 * - Respects top app bar, page nav bar, and bottom toolbar
 * - Remains responsive upon browser resize
 */
function clampFabPosition(rawLeft, rawTop) {
  const margin = 16;
  const fabW = 44;
  const fabH = 44;
  const petalReach = 74; // Bán kính vươn ra của các cánh hoa (72px + lề an toàn)

  const bottomBar = document.getElementById('bottom-toolbar') || document.querySelector('.sidebar');
  const botH = bottomBar ? bottomBar.offsetHeight : 48;

  // Cho phép khoảng thở để khi menu "+" bung hoa 7 cánh tròn đều 360 độ không bao giờ chạm mép màn hình
  const minX = margin + petalReach;
  const maxX = window.innerWidth - fabW - margin - petalReach;
  const minY = margin + petalReach;
  const maxY = window.innerHeight - botH - fabH - margin - petalReach;

  return {
    left: Math.max(minX, Math.min(rawLeft, maxX)),
    top:  Math.max(minY, Math.min(rawTop,  maxY))
  };
}

function initFabOverflowProtection() {
  const floatingMenu = document.getElementById('floating-menu');
  const floatingMainBtn = document.getElementById('floating-main-btn');
  if (!floatingMenu || !floatingMainBtn) return;

  let isDraggingFab = false;
  let fabStartX = 0, fabStartY = 0;
  let initLeft = 0, initTop = 0;
  let dragMoved = false;

  floatingMainBtn.addEventListener('mousedown', (e) => {
    isDraggingFab = true;
    dragMoved = false;
    fabStartX = e.clientX;
    fabStartY = e.clientY;

    const rect = floatingMenu.getBoundingClientRect();
    initLeft = rect.left;
    initTop = rect.top;

    floatingMenu.style.left = rect.left + 'px';
    floatingMenu.style.top = rect.top + 'px';
    floatingMenu.style.right = 'auto';
    floatingMenu.style.bottom = 'auto';

    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingFab) return;
    const dx = e.clientX - fabStartX;
    const dy = e.clientY - fabStartY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragMoved = true;
    }

    if (dragMoved) {
      const clamped = clampFabPosition(initLeft + dx, initTop + dy);
      floatingMenu.style.left = clamped.left + 'px';
      floatingMenu.style.top = clamped.top + 'px';
    }
  });

  document.addEventListener('mouseup', () => {
    isDraggingFab = false;
  });

  floatingMainBtn.addEventListener('click', () => {
    if (!dragMoved) {
      floatingMenu.classList.toggle('active');
    }
  });

  // Clamp on window resize
  window.addEventListener('resize', () => {
    if (floatingMenu.style.left && floatingMenu.style.left !== 'auto') {
      const currentL = parseInt(floatingMenu.style.left) || 0;
      const currentT = parseInt(floatingMenu.style.top) || 0;
      const clamped = clampFabPosition(currentL, currentT);
      floatingMenu.style.left = clamped.left + 'px';
      floatingMenu.style.top = clamped.top + 'px';
    }
  });
}

// ── 10. CANVAS CLICK-TO-MOVE INTERACTION ───────────────────────
function initCanvasTextInteraction() {
  if (typeof canvas === 'undefined' || !canvas) return;

  // Tăng vùng nhận diện click/touch để giáo viên dễ chạm trúng chữ
  canvas.targetFindTolerance = 16;
  canvas.perPixelTargetFind = false;

  const upperCanvas = canvas.upperCanvasEl;
  if (!upperCanvas) return;

  let directDraggingObj = null;
  let origModeWasDraw = false;

  const handlePointerStart = (e) => {
    const clientEvt = (e.touches && e.touches.length > 0) ? e.touches[0] : e;
    const pointer = canvas.getPointer(clientEvt);
    const textObjs = canvas.getObjects().filter(o => 
      o.type === 'textbox' || o.type === 'text' || o.type === 'i-text' || (o.data && o.data.isOCR)
    );

    for (let i = textObjs.length - 1; i >= 0; i--) {
      const obj = textObjs[i];
      if (obj.containsPoint(pointer)) {
        // Chạm trúng chữ hoặc công thức!
        if (canvas.isDrawingMode) {
          origModeWasDraw = true;
          canvas.isDrawingMode = false;
        }
        obj.set({
          selectable: true,
          evented: true,
          hoverCursor: 'move',
          moveCursor: 'move',
          padding: 14,
          borderColor: '#3b82f6',
          borderScaleFactor: 2,
          cornerColor: '#3b82f6',
          cornerSize: 10,
          cornerStyle: 'circle',
          transparentCorners: false
        });
        obj.setCoords();
        canvas.setActiveObject(obj);
        directDraggingObj = obj;
        canvas.renderAll();
        break;
      }
    }
  };

  upperCanvas.addEventListener('mousedown', handlePointerStart, true);
  upperCanvas.addEventListener('touchstart', handlePointerStart, { capture: true, passive: true });

  const handlePointerEnd = () => {
    if (directDraggingObj) {
      directDraggingObj.setCoords();
      const page = pageManager.getCurrentPage();
      if (page) {
        const entry = (page.ocrObjects || []).find(o => o._fabricObj === directDraggingObj || (o.id && directDraggingObj.data && o.id === directDraggingObj.data.ocrId));
        if (entry) {
          entry.x = Math.round(directDraggingObj.left);
          entry.y = Math.round(directDraggingObj.top);
        }
      }
      if (typeof saveState === 'function') saveState();

      directDraggingObj = null;
      if (origModeWasDraw && typeof currentMode !== 'undefined' && currentMode === 'draw') {
        canvas.isDrawingMode = true;
        origModeWasDraw = false;
      }
    }
  };

  window.addEventListener('mouseup', handlePointerEnd);
  window.addEventListener('touchend', handlePointerEnd);

  // Normal Fabric events
  canvas.on('mouse:down', (opt) => {
    if (opt.target && (opt.target.type === 'textbox' || opt.target.type === 'text' || (opt.target.data && opt.target.data.isOCR))) {
      if (canvas.isDrawingMode) {
        origModeWasDraw = true;
        canvas.isDrawingMode = false;
      }
      canvas.setActiveObject(opt.target);
    }
  });

  canvas.on('mouse:up', () => {
    if (origModeWasDraw && typeof currentMode !== 'undefined' && currentMode === 'draw') {
      canvas.isDrawingMode = true;
      origModeWasDraw = false;
    }
  });
}

// ── 11. INITIALIZATION ─────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    initPageControls();
    initFabOverflowProtection();
    initCanvasTextInteraction();
    applyI18n();
    updatePageUI();
  }, 250);
});

// Expose utilities globally for testing and script.js integration
window.pageManager = pageManager;
window.normalizeOCRText = normalizeOCRText;
window.findDuplicateOCR = findDuplicateOCR;
window.setLang = setLang;
window.t = t;
window.switchToPage = switchToPage;
