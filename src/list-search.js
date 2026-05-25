// Registration-list quick search UI.

function createListPageUI() {
  const menu = document.createElement('div');
  menu.id = 'cs-search-menu';

  const wrapper = document.createElement('div');
  wrapper.className = 'cs-search-wrapper';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = '車台番号検索...';
  input.className = 'cs-search-input';

  // Restore last search
  const lastVal = sessionStorage.getItem('cs_last_search');
  if (lastVal) input.value = lastVal;

  input.onkeypress = (e) => {
    if (e.key === 'Enter') runQuickSearch();
  };

  const btn = document.createElement('button');
  btn.textContent = '検索';
  btn.className = 'cs-search-btn';
  btn.onclick = runQuickSearch;

  const resetBtn = document.createElement('button');
  resetBtn.textContent = 'リセット';
  resetBtn.className = 'cs-search-reset';
  resetBtn.onclick = resetQuickSearch;

  wrapper.appendChild(input);
  wrapper.appendChild(btn);
  wrapper.appendChild(resetBtn); // Add Reset Button
  menu.appendChild(wrapper);

  document.body.appendChild(menu);

  // --- Optimization: Conflict Resolution ---
  // If user types in the *native* search box (frame_no), 
  // clear our extension's search box and storage to prevent interference.
  const nativeInput = document.querySelector('input[name="frame_no"]');
  if (nativeInput) {
    const clearExtensionSearch = () => {
      const extInput = document.querySelector('.cs-search-input');
      if (extInput && extInput.value) {
        extInput.value = '';
        console.log("Native input detected: Cleared extension search box.");
      }
      if (sessionStorage.getItem('cs_last_search')) {
        sessionStorage.removeItem('cs_last_search');
        console.log("Native input detected: Cleared session storage.");
      }
    };

    nativeInput.addEventListener('focus', clearExtensionSearch);
    nativeInput.addEventListener('input', clearExtensionSearch);
  }
}

function runQuickSearch() {
  const input = document.querySelector('.cs-search-input');
  if (!input) return;
  const val = input.value.trim();
  if (!val) {
    alert('車台番号を入力してください');
    return;
  }

  // Persist search value
  sessionStorage.setItem('cs_last_search', val);

  const host = window.location.hostname;

  // Carsensor Logic
  if (host.includes(HOST_CARSENSOR)) {
    const target = document.getElementById('syataiNo');
    if (target) {
      target.value = val;
      const form = document.getElementById('searchForm');
      if (form) {
        const submit = form.querySelector('input[name="doSearch"]');
        if (submit) submit.click();
        else form.submit();
      } else {
        alert('検索フォームが見つかりませんでした');
      }
    } else {
      alert('車台番号入力欄が見つかりませんでした');
    }
  }
  // MotorGate Logic
  // MotorGate Logic
  else if (host.includes(HOST_MOTORGATE)) {
    console.log("MotorGate Search Initiated (Script Injection Only)");
    const target = document.querySelector('input[name="frame_no"]');
    if (target) {
      // 1. Set Value
      target.value = val;

      // 2. Dispatch Events (Important for React/Frameworks)
      target.dispatchEvent(new Event('input', { bubbles: true }));
      target.dispatchEvent(new Event('change', { bubbles: true }));
      target.dispatchEvent(new Event('blur', { bubbles: true }));
      console.log("Value set to frame_no:", val);

      // 3. Trigger Search via Script Injection (Avoid CSP violation)
      // We skip clicking because it violates CSP on this site.
      console.log("Injecting execute_search.js to trigger stock_search()...");
      try {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
          throw new Error('Extension context invalidated. Please reload the page.');
        }
        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('execute_search.js');
        script.onload = function () {
          this.remove();
        };
        (document.head || document.documentElement).appendChild(script);
        console.log("Script execution injected.");
      } catch (e) {
        console.error("Injection failed:", e);
        if (e.message.includes('Extension context invalidated')) {
          alert('拡張機能が更新されました。検索機能を使用するには、このページ(MotorGate)を再読み込み(F5)してください。');
        } else {
          alert('検索を実行できませんでした。ブラウザのセキュリティ設定によりブロックされました。');
        }
      }

    } else {
      console.error("frame_no input not found");
      alert('車台番号入力欄(frame_no)が見つかりませんでした');
    }
  }
}

function resetQuickSearch() {
  const input = document.querySelector('.cs-search-input');
  if (input) {
    input.value = '';
    sessionStorage.removeItem('cs_last_search');
    input.focus();
  }
}


// --- Action Functions ---
