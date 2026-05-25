// Clipboard copy/import and cross-site form mapping.

function copySource(btnElement) {
  // Deep clone the document to avoid modifying the live page
  const clone = document.documentElement.cloneNode(true);

  // Get live elements and cloned elements
  const liveInputs = document.querySelectorAll('input');
  const cloneInputs = clone.querySelectorAll('input');

  const liveSelects = document.querySelectorAll('select');
  const cloneSelects = clone.querySelectorAll('select');

  const liveTextareas = document.querySelectorAll('textarea');
  const cloneTextareas = clone.querySelectorAll('textarea');

  // Sync state to clone
  // Inputs
  for (let i = 0; i < liveInputs.length; i++) {
    const live = liveInputs[i];
    const cloned = cloneInputs[i];
    if (!cloned) continue;

    if (live.type === 'checkbox' || live.type === 'radio') {
      if (live.checked) cloned.setAttribute('checked', 'checked');
      else cloned.removeAttribute('checked'); // specific to clone
    } else {
      cloned.setAttribute('value', live.value);
    }
  }

  // Selects
  for (let i = 0; i < liveSelects.length; i++) {
    const live = liveSelects[i];
    const cloned = cloneSelects[i];
    if (!cloned) continue;

    const options = cloned.querySelectorAll('option');
    options.forEach(opt => opt.removeAttribute('selected'));

    if (live.selectedIndex !== -1 && options[live.selectedIndex]) {
      options[live.selectedIndex].setAttribute('selected', 'selected');
    }
  }

  // Textareas
  for (let i = 0; i < liveTextareas.length; i++) {
    const live = liveTextareas[i];
    const cloned = cloneTextareas[i];
    if (cloned) {
      cloned.innerHTML = live.value;
    }
  }

  const html = clone.outerHTML;
  navigator.clipboard.writeText(html).then(() => {
    // Visual feedback on button instead of alert
    if (btnElement && btnElement.style) {
      const originalText = btnElement.textContent;
      const originalBg = btnElement.style.backgroundColor;

      btnElement.textContent = 'コピー完了!';
      btnElement.style.backgroundColor = '#28a745'; // Green

      setTimeout(() => {
        btnElement.textContent = originalText;
        btnElement.style.backgroundColor = originalBg;
      }, 1000);
    } else {
      console.log("Source copied");
    }
  }).catch(err => {
    console.error(err);
    alert('コピー失敗: ' + err.message);
  });
}

async function importFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) { alert('クリップボードが空です'); return; }

    let data = null;
    const currentHost = window.location.hostname;

    // Detect Source Type by signature
    const isMotorGateSource = text.includes('motorgate.jp') || text.includes('AdY');
    const isCarsensorSource = text.includes('carsensor.net') || text.includes('nenshikiPulldown');

    if (isMotorGateSource) {
      console.log("Detected MotorGate Source");
      data = parseMotorGateHtml(text);
    } else if (isCarsensorSource) {
      console.log("Detected Carsensor Source");
      data = parseCarsensorHtml(text);
    } else {
      // Fallback: assume opposite
      if (currentHost.includes(HOST_CARSENSOR)) {
        data = parseMotorGateHtml(text);
      } else {
        data = parseCarsensorHtml(text);
      }
    }

    console.log("Parsed Data:", data);

    // Fill based on Current Host
    if (currentHost.includes(HOST_CARSENSOR)) {
      fillCarsensorForm(data);
    } else if (currentHost.includes(HOST_MOTORGATE)) {
      fillMotorGateForm(data);
    } else {
      alert('対応していないサイトです');
    }

  } catch (err) {
    console.error(err);
    alert('読み取りエラー: ' + err.message);
  }
}

// --- Parsers ---

function parseMotorGateHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const data = {};

  // Helper
  const getVal = (id) => doc.getElementById(id)?.value;
  const getText = (id) => {
    const el = doc.getElementById(id);
    if (el && el.tagName === 'SELECT') return el.querySelector('option[selected]')?.textContent.trim() || el.value;
    return el?.value;
  };
  const getRadio = (name) => doc.querySelector(`input[name="${name}"][checked]`)?.value;

  data.year = getVal('AdY') || doc.querySelector('#AdY option[selected]')?.value;

  // Month: trim leading zero
  let m = getVal('AdM') || doc.querySelector('#AdM option[selected]')?.value;
  if (m && m.startsWith('0')) m = m.substring(1);
  data.month = m;

  data.maker = getText('BrandName');
  data.model = getText('ModelName');
  data.grade = getVal('GradeName');
  data.chassisNo = doc.querySelector('input[name="temp_syadai_num"]')?.value;

  // Mileage: "70999" -> "7.1"
  const dist = parseInt(getVal('Soukou'), 10);
  if (!isNaN(dist)) data.mileage = (dist / 10000).toFixed(1);

  // Color
  const colorSel = doc.querySelector('select[name^="Color"]') || doc.getElementById('ColorName');
  if (colorSel && colorSel.tagName === 'SELECT') data.color = colorSel.querySelector('option[selected]')?.textContent.trim();
  else if (colorSel) data.color = colorSel.value;

  // Price
  data.price = getVal('Kakaku'); // "19.8"
  data.totalPrice = getVal('TotalPrice'); // "24.8"

  // Recycle
  const recEl = doc.getElementById('AdditionalRecyclingCharge');
  if (recEl) {
    const opt = recEl.querySelector('option[selected]');
    data.recycleCode = opt?.value;
    data.recycleText = opt?.textContent;
  }

  // Repair
  data.repairCode = getRadio('RepairHist');

  data.modelCode = getVal('KataName');
  data.mission = getText('MissionDtl');
  data.modelCode = getVal('KataName');
  data.mission = getText('MissionDtl');
  data.note = getVal('GradeFukabun');

  // Shaken
  // 00330001=Yes, 00330002=Maint, 00330003=New, 00330004=None
  const sFlg = getRadio('SyakenFlg');
  if (sFlg === '00330001') {
    data.shakenFlg = 'YES';
    data.shakenYear = getVal('SyakenYY'); // "2026"
    data.shakenMonth = getVal('SyakenMM'); // "06"
  } else if (sFlg === '00330002') data.shakenFlg = 'MAINT';
  else if (sFlg === '00330003') data.shakenFlg = 'NEW';
  else if (sFlg === '00330004') data.shakenFlg = 'NONE';

  return data;
}

function parseCarsensorHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const data = {};

  const getVal = (sel) => doc.querySelector(sel)?.value;
  const getText = (sel) => {
    const el = doc.querySelector(sel);
    if (el && el.tagName === 'SELECT') {
      // Carsensor selected options usually have 'selected' attr in source?
      // Or we just take value? 
      // Often source copy takes static state. Assuming 'selected' attribute exists or value is key.
      const opt = el.querySelector('option[selected]');
      return opt ? opt.textContent.trim() : el.value;
    }
    return el?.value;
  };

  // Year/Month
  data.year = getText(CS_SEL.year); // e.g. "2011(H23)"
  data.month = getText(CS_SEL.month); // e.g. "2月" or "2"

  data.maker = getText(CS_SEL.maker);
  data.model = getText(CS_SEL.model);
  data.grade = getText(CS_SEL.grade) || getVal('#ksaiHaikiryoGradeKj'); // fallback to input
  data.chassisNo = getVal(CS_SEL.chassisNo) || getVal('#syataiNo') || getVal('input[name="syataiNo"]');
  data.modelCode = getVal(CS_SEL.modelCodeInput) || getText(CS_SEL.modelCode);

  data.mileage = getVal(CS_SEL.mileage); // "71000" or "7.1" ? Carsensor usually uses input for number.

  data.color = getVal(CS_SEL.color); // Input text

  // Price (Man / Sen)
  const pMan = getVal(CS_SEL.priceMain);
  const pSen = getVal(CS_SEL.priceSub);
  if (pMan) {
    let s = parseFloat(pSen || 0);
    // Heuristic: If sen is small (<100), assume it's 1000-yen units (e.g. 8 -> 8000).
    if (s < 100) s *= 1000;
    data.price = parseFloat(pMan) + (s / 10000);
  }

  const tMan = getVal(CS_SEL.totalMain);
  const tSen = getVal(CS_SEL.totalSub);
  if (tMan) {
    let s = parseFloat(tSen || 0);
    if (s < 100) s *= 1000;
    data.totalPrice = parseFloat(tMan) + (s / 10000);
  }

  // Repair
  const repairVal = doc.querySelector('input[name="ksaiShufukurekiHyojiCd"][checked]')?.value;
  data.repair = (repairVal === '1'); // 1 = Yes

  // Recycle
  const recVal = doc.querySelector('select[name="ksaiRecycleHouKbnCd"] option[selected]')?.value;
  data.recycleVal = recVal; // 1 or 4

  data.note = getVal(CS_SEL.note);

  // Shaken
  // Radio: 2=Yes (Remaining), 1=Other
  const shakenRadio = doc.querySelector(`${CS_SEL.shakenRadio}[checked]`)?.value;
  if (shakenRadio === '2') {
    data.shakenFlg = 'YES';
    // Year "R08|2026"
    const rawY = getVal(CS_SEL.shakenYear);
    if (rawY && rawY.includes('|')) data.shakenYear = rawY.split('|')[1];
    else data.shakenYear = rawY;

    data.shakenMonth = getVal(CS_SEL.shakenMonth); // "6"
  } else if (shakenRadio === '1') {
    // Check Type
    const type = getVal(CS_SEL.shakenType); // 1=Maint, 5=None, 3=New, 4=DomesticUnreg
    if (type === '1') data.shakenFlg = 'MAINT';
    else if (type === '3') data.shakenFlg = 'NEW';
    else data.shakenFlg = 'NONE'; // 5 or 4 or others
  }

  return data;
}

// --- Fillers ---

function fillCarsensorForm(data) {
  if (!data) return;

  const setVal = (sel, val) => {
    const el = document.querySelector(sel);
    if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); }
  };
  const selTextOrVal = (sel, txt) => {
    const el = document.querySelector(sel);
    if (!el || !txt) return;
    const str = String(txt).trim();

    // First Pass: Exact Match
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].text === str || el.options[i].value === str) {
        el.selectedIndex = i;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return;
      }
    }

    // Second Pass: Partial Match
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].text.includes(str) || el.options[i].value.includes(str)) {
        el.selectedIndex = i;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return;
      }
    }
  };

  if (data.year) selTextOrVal(CS_SEL.year, data.year);
  if (data.month) selTextOrVal(CS_SEL.month, data.month);
  if (data.maker) selTextOrVal(CS_SEL.maker, data.maker);

  if (data.model) setTimeout(() => selTextOrVal(CS_SEL.model, data.model), 1000);

  if (data.grade) setTimeout(() => {
    selTextOrVal(CS_SEL.grade, data.grade);
    setVal('#ksaiHaikiryoGradeKj', data.grade);
  }, 2000);

  if (data.chassisNo) setVal(CS_SEL.chassisNo, data.chassisNo);
  if (data.modelCode) {
    setVal(CS_SEL.modelCodeInput, data.modelCode);
    selTextOrVal(CS_SEL.modelCode, data.modelCode);
  }

  if (data.mileage) setVal(CS_SEL.mileage, data.mileage);
  if (data.mileage) setVal(CS_SEL.mileage, data.mileage);

  if (data.color) {
    // Try #bodyColor1 (Select) first - User specific request
    const bodyColorEl = document.getElementById('bodyColor1');
    if (bodyColorEl) {
      selTextOrVal('#bodyColor1', data.color);
    } else {
      // Fallback to #simpleColorKana (Input)
      setVal(CS_SEL.color, data.color);
    }
  }

  if (data.price) { // 19.8
    const man = Math.floor(parseFloat(data.price));
    const sen = Math.round((parseFloat(data.price) - man) * 10) * 1000; // .8 -> 8000
    setVal(CS_SEL.priceMain, man);
    setVal(CS_SEL.priceSub, Math.round((parseFloat(data.price) - man) * 10)); // 8
  }

  if (data.totalPrice) {
    const man = Math.floor(parseFloat(data.totalPrice));
    const sen = Math.round((parseFloat(data.totalPrice) - man) * 10);
    setVal(CS_SEL.totalMain, man);
    setVal(CS_SEL.totalSub, sen);
  }

  // Recycle
  let recTarget = '';
  if (data.recycleCode === '00150002' || (data.recycleText && data.recycleText.includes('済込'))) recTarget = '4';
  else if (data.recycleCode === '00150001' || (data.recycleText && data.recycleText.includes('未'))) recTarget = '1';

  if (recTarget) {
    const el = document.querySelector('select[name="ksaiRecycleHouKbnCd"]');
    if (el) { el.value = recTarget; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  // Repair
  if (data.repairCode) {
    const val = (data.repairCode === '00350002') ? '1' : '0';
    const r = document.querySelector(`input[name="ksaiShufukurekiHyojiCd"][value="${val}"]`);
    if (r) { r.click(); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
  }
  if (data.note) {
    // Filter NG words for Carsensor
    let note = data.note;
    ['車検', '衝撃', 'OK', '2年', '二年', '二年付', '一年付'].forEach(word => {
      note = note.split(word).join('');
    });
    setVal(CS_SEL.note, note);
  }

  // Shaken
  if (data.shakenFlg) {
    if (data.shakenFlg === 'YES') {
      // Logic Check: Is the date > 23 months away?
      // If so, user wants "Standard Set" logic (Radio=1, Type=1 => Maint Included)
      let isTwoYears = false;
      if (data.shakenYear && data.shakenMonth) {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1;

        const targetYear = parseInt(data.shakenYear, 10);
        const targetMonth = parseInt(data.shakenMonth, 10);

        if (!isNaN(targetYear) && !isNaN(targetMonth)) {
          const diffMonths = (targetYear - currentYear) * 12 + (targetMonth - currentMonth);
          if (diffMonths >= 22) {
            isTwoYears = true;
          }
        }
      }

      if (isTwoYears) {
        console.log("Shaken > 23 months: Using Standard Set Logic (Radio=1, Type=1)");
        // Standard Set Logic: Radio "1" (Other), Type "1" (Maint Included)
        const r = document.querySelector(`${CS_SEL.shakenRadio}[value="1"]`);
        if (r) { r.click(); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }

        setTimeout(() => {
          const el = document.querySelector(CS_SEL.shakenType);
          if (el) { el.value = '1'; el.dispatchEvent(new Event('change', { bubbles: true })); }
        }, 500);

      } else {
        // Normal "Remaining" Logic
        // Radio "2"
        const r = document.querySelector(`${CS_SEL.shakenRadio}[value="2"]`);
        if (r) { r.click(); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }

        // Delay slightly for inputs to enable?
        setTimeout(() => {
          if (data.shakenYear) selTextOrVal(CS_SEL.shakenYear, data.shakenYear); // "2026" matches "R08|2026"
          if (data.shakenMonth) {
            let m = data.shakenMonth;
            if (m.startsWith('0')) m = m.substring(1); // "06" -> "6"
            selTextOrVal(CS_SEL.shakenMonth, m);
            selTextOrVal(CS_SEL.shakenMonth, m);
          }
        }, 500);
      }

      // Rule: If Shaken exists (YES), Legal Maint = Included (1)
      setTimeout(() => {
        const lm = document.querySelector(CS_SEL.legalMaint);
        if (lm) {
          lm.value = '1';
          lm.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 600);

    } else {
      // Radio "1"
      const r = document.querySelector(`${CS_SEL.shakenRadio}[value="1"]`);
      if (r) { r.click(); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }

      setTimeout(() => {
        let typeVal = '5'; // None
        if (data.shakenFlg === 'MAINT') typeVal = '1';
        else if (data.shakenFlg === 'NEW') typeVal = '3';
        // None stays 5

        const el = document.querySelector(CS_SEL.shakenType);
        if (el) { el.value = typeVal; el.dispatchEvent(new Event('change', { bubbles: true })); }
      }, 500);
    }
  }
}





function fillMotorGateForm(data) {
  if (!data) return;

  const setVal = (sel, val) => {
    const el = document.querySelector(sel);
    if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); el.dispatchEvent(new Event('blur', { bubbles: true })); }
  };
  const selTextOrVal = (sel, txt) => {
    const el = document.querySelector(sel);
    if (!el || !txt) return;
    const str = String(txt).trim();

    // First Pass: Exact Match
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].text === str || el.options[i].value === str) {
        el.selectedIndex = i;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return;
      }
    }

    // Second Pass: Partial Match
    for (let i = 0; i < el.options.length; i++) {
      if (el.options[i].text.includes(str) || el.options[i].value.includes(str)) {
        el.selectedIndex = i;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        return;
      }
    }
  };

  if (data.year) {
    const yearMatch = data.year.match(/^(\d{4})/);
    const yStr = yearMatch ? yearMatch[1] : data.year;
    selTextOrVal(MG_SEL.year, yStr);
  }
  if (data.month) {
    // Carsensor might give "2月", MotorGate needs "02"
    let m = data.month.replace('月', '');
    if (m.length === 1) m = "0" + m;
    selTextOrVal(MG_SEL.month, m);
  }

  if (data.maker) selTextOrVal(MG_SEL.maker, data.maker);

  // MotorGate Model
  if (data.model) {
    setTimeout(() => selTextOrVal(MG_SEL.model, data.model), 1000);
  }

  if (data.grade) setVal(MG_SEL.grade, data.grade);

  if (data.chassisNo) {
    setVal(MG_SEL.chassisNo, data.chassisNo);
    setVal('input[name="syadai_num"]', data.chassisNo);
    setVal('input[name="frame_no"]', data.chassisNo);
  }

  if (data.modelCode) setVal('#KataName', data.modelCode);

  // Mileage
  if (data.mileage) {
    // Carsensor 7.1 -> MotorGate 71000 ?
    // MotorGate expects km.
    // If data.mileage is 7.1 (Man), *10000
    let km = parseFloat(data.mileage) * 10000;
    setVal(MG_SEL.mileage, km);
  }

  if (data.color) setVal(MG_SEL.colorInput, data.color);

  if (data.price) {
    let val = parseFloat(data.price);
    if (!isNaN(val)) setVal(MG_SEL.price, (Math.round(val * 10) / 10));
  }
  if (data.totalPrice) {
    let val = parseFloat(data.totalPrice);
    if (!isNaN(val)) setVal(MG_SEL.totalPrice, (Math.round(val * 10) / 10));
  }

  // Repair
  if (data.repair !== undefined) {
    const val = data.repair ? '00350002' : '00350001';
    const r = document.querySelector(`input[name="RepairHist"][value="${val}"]`);
    if (r) { r.click(); r.checked = true; }
  }

  // Recycle
  if (data.recycleVal) {
    // 4->00150002, 1->00150001
    let mgCode = '';
    if (data.recycleVal == '4') mgCode = '00150002';
    else if (data.recycleVal == '1') mgCode = '00150001';

    if (mgCode) {
      const el = document.querySelector(MG_SEL.recycle);
      if (el) { el.value = mgCode; el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
  }

  if (data.note) setVal(MG_SEL.note, data.note);

  // Shaken
  if (data.shakenFlg) {
    let mgVal = '00330004'; // Default None
    if (data.shakenFlg === 'YES') mgVal = '00330001';
    else if (data.shakenFlg === 'MAINT') mgVal = '00330002';
    else if (data.shakenFlg === 'NEW') mgVal = '00330003';

    const r = document.querySelector(`${MG_SEL.shakenFlg}[value="${mgVal}"]`);
    if (r) { r.click(); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }

    if (data.shakenFlg === 'YES') {
      if (data.shakenYear) selTextOrVal(MG_SEL.shakenYear, data.shakenYear);
      if (data.shakenMonth) {
        let m = data.shakenMonth;
        if (m.length === 1) m = "0" + m; // "6" -> "06"
        selTextOrVal(MG_SEL.shakenMonth, m);
      }
    }
  }
}
