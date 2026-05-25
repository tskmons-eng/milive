// Edit-page floating menu, scrolling, defaults, and standard image upload.

function createEditPageUI() {
  const menu = document.createElement('div');
  menu.id = 'cs-floating-menu';

  // "Copy" Button
  const copyBtn = document.createElement('button');
  copyBtn.className = 'cs-float-btn cs-btn-copy';
  copyBtn.textContent = '情報コピー';
  copyBtn.onclick = (e) => copySource(e.target);
  menu.appendChild(copyBtn);

  // "Import" Button
  const importBtn = document.createElement('button');
  importBtn.className = 'cs-float-btn cs-btn-import';
  importBtn.textContent = '情報入力';
  importBtn.onclick = (e) => importFromClipboard(e.target);
  menu.appendChild(importBtn);

  // "Scroll to Images" Button
  const imgScrollBtn = document.createElement('button');
  imgScrollBtn.className = 'cs-float-btn cs-btn-scroll';
  imgScrollBtn.textContent = '画像へ移動';
  imgScrollBtn.onclick = scrollToImages;
  menu.appendChild(imgScrollBtn);

  // "Scroll to Top" Button
  const topScrollBtn = document.createElement('button');
  topScrollBtn.className = 'cs-float-btn cs-btn-scroll';
  topScrollBtn.textContent = '一番上へ';
  topScrollBtn.onclick = scrollToTop;
  menu.appendChild(topScrollBtn);

  // "Scroll to Bottom" Button
  const bottomScrollBtn = document.createElement('button');
  bottomScrollBtn.className = 'cs-float-btn cs-btn-scroll';
  bottomScrollBtn.textContent = '一番下へ';
  bottomScrollBtn.onclick = scrollToBottom;
  bottomScrollBtn.onclick = scrollToBottom;
  menu.appendChild(bottomScrollBtn);

  // "Set Defaults" Button (Publish + Standard Values)
  const defaultBtn = document.createElement('button');
  defaultBtn.className = 'cs-float-btn cs-btn-default';
  defaultBtn.textContent = '通常セット';
  defaultBtn.style.backgroundColor = '#17a2b8'; // Teal
  defaultBtn.onclick = setPublishDefaults;
  menu.appendChild(defaultBtn);

  // "Upload Teiki Images" Button (MotorGate Only)
  if (window.location.hostname.includes(HOST_MOTORGATE)) {
    const teikiBtn = document.createElement('button');
    teikiBtn.className = 'cs-float-btn cs-btn-teiki';
    teikiBtn.textContent = '定期画像';
    teikiBtn.style.backgroundColor = '#28a745'; // Green
    teikiBtn.onclick = uploadStandardImages;
    menu.appendChild(teikiBtn);
  }

  document.body.appendChild(menu);
}
// ... existing functions ...
async function uploadStandardImages() {
  console.log("Uploading Teiki Images...");
  const btn = document.querySelector('.cs-btn-teiki');
  if (btn) btn.textContent = '処理中...';

  const images = ['teiki_5.jpg', 'teiki_4.jpg', 'teiki_3.jpg', 'teiki_1.jpg', 'teiki_2.jpg'];

  try {
    // Strategy: Prefer the bulk upload input (#file_input) if it exists.
    const bulkInput = document.getElementById('file_input');

    if (bulkInput) {
      // Bulk Upload Logic
      const dataTransfer = new DataTransfer();

      for (const imageName of images) {
        const url = chrome.runtime.getURL(`images/${imageName}`);
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], imageName, { type: 'image/jpeg' });
        dataTransfer.items.add(file);
      }

      bulkInput.files = dataTransfer.files;
      bulkInput.dispatchEvent(new Event('change', { bubbles: true }));
      bulkInput.dispatchEvent(new Event('input', { bubbles: true }));

    } else {
      // Fallback: Sequential Upload
      const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (fileInputs.length === 0) {
        alert('画像アップロード用の入力欄が見つかりませんでした');
        if (btn) btn.textContent = '定期画像';
        return;
      }

      for (let i = 0; i < images.length; i++) {
        if (i >= fileInputs.length) break;

        const imageName = images[i];
        const url = chrome.runtime.getURL(`images/${imageName}`);
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], imageName, { type: 'image/jpeg' });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        const input = fileInputs[i];
        input.files = dataTransfer.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new Event('input', { bubbles: true }));

        await new Promise(r => setTimeout(r, 300));
      }
    }

    if (btn) {
      btn.textContent = '完了!';
      setTimeout(() => btn.textContent = '定期画像', 2000);
    }

  } catch (e) {
    console.error("Image upload failed:", e);
    alert('画像の読み込みまたは設定に失敗しました: ' + e.message);
    if (btn) btn.textContent = 'エラー';
  }
}



function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function scrollToBottom() {
  window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
}

function scrollToImages() {
  const host = window.location.hostname;
  let target = null;

  if (host.includes(HOST_MOTORGATE)) {
    // MotorGate: #Img01
    target = document.getElementById('Img01');
  } else if (host.includes(HOST_CARSENSOR)) {
    // Carsensor: H3 containing "4.画像"
    const h3s = document.querySelectorAll('h3');
    for (let h3 of h3s) {
      if (h3.textContent.includes('4.画像')) {
        // Scroll to the parent div or the h3 itself
        target = h3;
        break;
      }
    }
  }

  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } else {
    alert('画像エリアが見つかりませんでした');
  }
}

// --- Action Functions ---



function setPublishDefaults() {
  const host = window.location.hostname;

  if (host.includes(HOST_CARSENSOR)) {
    // 1. Publish (掲載)
    const pubParams = [
      { sel: 'input[name="keisaiShijiFlg"][value="1"]' },
      // 2. Repair: None (修復歴無: 0)
      { sel: 'input[name="ksaiShufukurekiHyojiCd"][value="0"]' },
      // 3. Recycle: Deposited Included (リ済込: 4)
      { sel: 'select[name="ksaiRecycleHouKbnCd"]', val: '4', type: 'select' },
    ];

    pubParams.forEach(p => {
      const el = document.querySelector(p.sel);
      if (el) {
        if (p.type === 'select') {
          el.value = p.val;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          el.click();
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });

    // 4. Shaken: Maint Included (車検整備付)
    const shakenRadio = document.querySelector('input[name="ksaiShakenZanHyojiCd"][value="1"]');
    if (shakenRadio) {
      shakenRadio.click();
      shakenRadio.checked = true;
      shakenRadio.dispatchEvent(new Event('change', { bubbles: true }));

      setTimeout(() => {
        const shakenSel = document.querySelector('#shakenPullDown'); // or input[name="ksaiShakenTukinashiCd"]
        if (shakenSel) {
          shakenSel.value = '1';
          shakenSel.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }, 300);
    }

    // 5. Legal Maint: Included (法定整備付: 1)
    const legalMaint = document.querySelector('select[name="seibiKbnCd"]');
    if (legalMaint) {
      legalMaint.value = '1';
      legalMaint.dispatchEvent(new Event('change', { bubbles: true }));
    }

  } else if (host.includes(HOST_MOTORGATE)) {
    // ... MotorGate Defaults ...
    console.log("Setting MotorGate Defaults...");
    // 1. Shaken: Yes (検有り: 00330001) + 2 Years
    const shakenYes = document.querySelector('input[name="SyakenFlg"][value="00330001"]');
    if (shakenYes) {
      shakenYes.click();
      shakenYes.checked = true;
      shakenYes.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Date Calculation (Today + 2 Years)
    const now = new Date();
    const targetYear = String(now.getFullYear() + 2);
    const targetMonth = String(now.getMonth() + 1).padStart(2, '0');

    setTimeout(() => {
      const ySel = document.getElementById('SyakenYY');
      const mSel = document.getElementById('SyakenMM');

      // Set Year
      if (ySel) {
        let found = false;
        for (let i = 0; i < ySel.options.length; i++) {
          if (ySel.options[i].value == targetYear || ySel.options[i].text.includes(targetYear)) {
            ySel.selectedIndex = i;
            found = true;
            break;
          }
        }
        if (!found) ySel.value = targetYear;
        ySel.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Set Month
      if (mSel) {
        mSel.value = targetMonth;
        mSel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 200);

    // 2. Repair: None (修復歴無: 00350001)
    const repairNone = document.querySelector('input[name="RepairHist"][value="00350001"]');
    if (repairNone) {
      repairNone.click();
      repairNone.checked = true;
      repairNone.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 3. Recycle: Deposited Included (リ済込: 00150002)
    const recycle = document.querySelector('#AdditionalRecyclingCharge');
    if (recycle) {
      recycle.value = '00150002';
      recycle.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // Feedback
  const btn = document.querySelector('.cs-btn-default');
  if (btn) {
    const originalText = btn.textContent;
    btn.textContent = '完了!';
    setTimeout(() => btn.textContent = originalText, 1000);
  }
}
