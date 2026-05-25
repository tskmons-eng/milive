(() => {
    "use strict";


    Main();

    async function Main() {
        // 認証チェック
        const { lastAuth } = await chrome.storage.local.get("lastAuth");
        const LIMIT_DAYS = 30;
        const isAuthorized = lastAuth && (Date.now() - lastAuth <= LIMIT_DAYS * 86400000);

        if (!isAuthorized) {
            console.log("⛔ 未認証のため機能を停止します");
            return; // ここで処理終了
        }

        // === ここから下に既存のコードが続きます ===


        // onclick="location.href='...'" からURL文字列を抜き出す（単純なパターンのみ対象）
        function extractUrlFromOnclick(onclickText) {
            if (!onclickText) return null;

            // location.href='/path?...' または location.href="..."
            const m = onclickText.match(/location\.href\s*=\s*['"]([^'"]+)['"]/);
            if (m && m[1]) return m[1];

            return null;
        }

        // 相対URLを絶対URLへ
        function toAbsoluteUrl(url) {
            try {
                return new URL(url, location.href).toString();
            } catch {
                return null;
            }
        }

        function linkifyTd(td, absUrl) {
            if (!td || !absUrl) return;
            if (td.dataset.linkified === "1") return; // 二重処理防止
            if (td.querySelector("a[href]")) return;  // すでにリンクなら何もしない

            // tdの子要素を <a> で包む
            const a = document.createElement("a");
            a.href = absUrl;
            a.style.display = "block";
            a.style.width = "100%";
            a.style.height = "100%";
            a.style.textDecoration = "none";
            a.style.color = "inherit";

            // 親要素(tr/td)のonclick暴発を防ぐ
            a.addEventListener("click", (e) => e.stopPropagation());
            // 右クリック時の暴発も防ぐ（コンテキストメニュー用）
            a.addEventListener("contextmenu", (e) => e.stopPropagation());

            // 中身を移動
            while (td.firstChild) a.appendChild(td.firstChild);
            td.appendChild(a);

            // 既存 onclick を無効化（リンクと二重遷移するのを防ぐ）
            td.removeAttribute("onclick");
            td.dataset.linkified = "1";
        }

        function processOnce() {
            // 「画像が入っている td.link-td[onclick]」だけを対象にする（誤爆しにくい）
            const candidates = document.querySelectorAll("td.link-td[onclick]");

            for (const td of candidates) {
                // imgが無いセルは対象外（画像付近だけリンク化したい要件）
                if (!td.querySelector("img")) continue;

                const onclickText = td.getAttribute("onclick") || "";
                if (!onclickText.includes("location.href")) continue;

                const rawUrl = extractUrlFromOnclick(onclickText);
                if (!rawUrl) continue;

                const absUrl = toAbsoluteUrl(rawUrl);
                if (!absUrl) continue;

                linkifyTd(td, absUrl);
            }
        }

        // ===== 画像保存機能 (追加) =====

        // 画像URL収集
        function collectGalleryImageUrls() {
            // fancyboxのギャラリーリンクを全部拾う
            // PC: data-fancybox="gallery"
            // SP: data-fancybox="gallery-smaho"
            const anchors = Array.from(document.querySelectorAll('a[data-fancybox^="gallery"][href]'));
            const urls = anchors
                .map(a => a.getAttribute("href"))
                .filter(Boolean)
                .map(u => {
                    try { return new URL(u, location.href).toString(); } catch { return null; }
                })
                .filter(Boolean);

            // 重複排除
            return Array.from(new Set(urls));
        }

        // ===== 共通ユーティリティ =====

        // ファイル名生成
        function filenameFromUrl(url, fallback = "image.jpg") {
            try {
                const u = new URL(url);
                const path = u.pathname;
                const base = path.split("/").pop() || fallback;
                return base;
            } catch {
                return fallback;
            }
        }

        // ダウンロード (Backgroundへ依頼)
        // ダウンロード (Backgroundへ依頼)
        async function downloadOne(url, folderCode = "misc", explicitFilename = null) {
            const filename = explicitFilename ? `${folderCode}/${explicitFilename}` : `${folderCode}/${filenameFromUrl(url)}`;
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    type: "download",
                    url: url,
                    filename: filename
                }, resolve);
            });
        }

        async function downloadAll(urls, folderCode = "all") {
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                const base = filenameFromUrl(url, `image_${i + 1}.jpg`);
                const num = String(i + 1).padStart(2, "0");
                const filename = `${folderCode}/${num}_${base}`;

                chrome.runtime.sendMessage({
                    type: "download",
                    url: url,
                    filename: filename
                });

                await new Promise(r => setTimeout(r, 200));
            }
        }

        // ★ UIユーティリティ
        function createButton(text, onClick) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.textContent = text;
            btn.style.padding = "10px 12px";
            btn.style.borderRadius = "10px";
            btn.style.border = "1px solid rgba(0,0,0,0.2)";
            btn.style.background = "white";
            btn.style.boxShadow = "0 2px 10px rgba(0,0,0,0.15)";
            btn.style.cursor = "pointer";
            btn.style.fontSize = "13px";
            btn.style.lineHeight = "1";
            btn.style.userSelect = "none";
            btn.style.color = "black";
            btn.style.fontFamily = "sans-serif";
            btn.style.marginRight = "8px"; // ボタン間の隙間

            btn.addEventListener("click", async () => {
                btn.disabled = true;
                const originalText = btn.textContent;
                btn.textContent = "処理中…";
                try {
                    await onClick(btn);
                } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            });

            return btn;
        }

        function createFloatingContainer(id) {
            if (document.getElementById(id)) return null;
            const wrap = document.createElement("div");
            wrap.id = id;
            wrap.style.position = "fixed";
            wrap.style.top = "12px";
            wrap.style.right = "12px";
            wrap.style.zIndex = "999999";
            wrap.style.display = "flex";
            wrap.style.gap = "0"; // marginで制御
            document.body.appendChild(wrap);
            return wrap;
        }


        // ===== サイト別実装: MLive =====

        function processMLive() {
            // リンク化
            processOnce();

            processMLiveAutoSelect();

            // ボタン表示
            const boxId = "mlive-save-ui";
            if (document.getElementById(boxId)) return;

            // 画像URL収集
            function collect() {
                const anchors = Array.from(document.querySelectorAll('a[data-fancybox^="gallery"][href]'));
                const urls = anchors
                    .map(a => a.getAttribute("href"))
                    .filter(Boolean)
                    .map(u => {
                        try { return new URL(u, location.href).toString(); } catch { return null; }
                    })
                    .filter(Boolean);
                return Array.from(new Set(urls));
            }

            const initialUrls = collect();
            if (initialUrls.length === 0) return;

            const wrap = createFloatingContainer(boxId);
            if (!wrap) return;

            // ①枚目
            wrap.appendChild(createButton("出品票保存", async () => {
                const current = collect();
                if (current.length === 0) return;
                await downloadOne(current[0], "mlive");
            }));

            // 全画像
            wrap.appendChild(createButton(`全画像保存(${initialUrls.length})`, async () => {
                const current = collect();
                if (current.length === 0) return;
                await downloadAll(current, "mlive/all");
            }));
        }

        // MLive用 自動選択ロジック
        let mliveAutoSelectDone = false;

        function processMLiveAutoSelect() {
            if (mliveAutoSelectDone) return;
            if (!location.pathname.includes("/MyCar")) return; // MyCarページのみ対象

            // ユーザーが手動で選択済み（URLパラメータに cond.AucNoFrom がある）場合は自動選択しない
            if (location.search.includes("cond.AucNoFrom")) return;

            const select = document.getElementById("cond_AucNoFrom");
            if (!select) return;

            // まだ読み込まれていない、もしくは既に操作されている可能性などを考慮
            // ここでは初期状態(selectedIndex === 0)かつ要素数が十分ある場合のみ実行
            if (select.selectedIndex === 0 && select.options.length >= 3) {
                console.log("MLive: Auto-selecting 3rd option (2 auctions before)...");
                select.selectedIndex = 2;
                // onchange="this.form.submit()" があるため change イベント発火で遷移するはず
                select.dispatchEvent(new Event("change"));
            }
            // 実行済みフラグを立てる（一度だけ実行）
            mliveAutoSelectDone = true;
        }

        // ===== サイト別実装: MotorGate =====

        function processMotorGate() {
            const boxId = "motorgate-save-ui";
            if (document.getElementById(boxId)) return;

            // Add delay to ensure page init is done
            setTimeout(() => {
                if (document.getElementById(boxId)) return;
                runMotorGateLogic();
            }, 1000);
        }

        function runMotorGateLogic() {
            const boxId = "motorgate-save-ui";
            function collectGallery() {
                const anchors = Array.from(document.querySelectorAll('div[id^="tabContents"] .thumb a[href]'));
                const urls = anchors
                    .map(a => a.getAttribute("href"))
                    .filter(Boolean)
                    .map(u => {
                        try { return new URL(u, location.href).toString(); } catch { return null; }
                    })
                    .filter(Boolean);
                return Array.from(new Set(urls));
            }

            // Simplified Collector: Grab strictly valid images from Img00 to Img99
            function collectRegisterImages(mode = "all") {
                if (!location.pathname.includes("/car/newregist/register")) return [];

                const targets = [];

                // "standard" means skip the first 3 (Main, Front, Rear? Img00-02)
                const startIdx = (mode === "standard") ? 3 : 0;

                // Iterate all potential IDs
                for (let i = startIdx; i <= 99; i++) {
                    const id = "Img" + String(i).padStart(2, '0'); // Img00..Img99
                    const img = document.getElementById(id);

                    if (!img || !img.src) continue;

                    // STRICT Valid Check
                    // 1. Must not be in common assets path
                    if (img.src.includes("/assets/img/common/")) continue;

                    // 2. Must not be tiny (icon/spacer)
                    if (img.complete && img.naturalWidth > 0 && img.naturalWidth < 30) continue;

                    // Try to find high-res parent anchor (oriImgXX)
                    const anchorId = "oriImg" + String(i).padStart(2, '0');
                    const anchor = document.getElementById(anchorId);
                    const targetUrl = (anchor && anchor.href) ? anchor.href : img.src;

                    targets.push(targetUrl);
                }

                return targets
                    .map(u => {
                        try { return new URL(u, location.href).toString(); } catch { return null; }
                    })
                    .filter(Boolean);
            }

            const galleryUrls = collectGallery();
            const regAll = collectRegisterImages("all");
            const regStandard = collectRegisterImages("standard");

            // UI Creation
            if (galleryUrls.length === 0 && regAll.length === 0) return;

            const wrap = createFloatingContainer(boxId);
            if (!wrap) return;

            if (galleryUrls.length > 0) {
                wrap.appendChild(createButton(`全画像保存(${galleryUrls.length})`, async () => {
                    const current = collectGallery();
                    await downloadAll(current, "motorgate");
                }));
            }

            // Button 1: All Images
            if (regAll.length > 0) {
                wrap.appendChild(createButton(`全登録画像保存(${regAll.length})`, async () => {
                    const current = collectRegisterImages("all");
                    await downloadAll(current, "motorgate/register_all");
                }));

                // Button 2: Standard Images (Img03 ~)
                // Always show if we show the All button
                wrap.appendChild(createButton(`登録画像保存(Img03~)(${regStandard.length})`, async () => {
                    const current = collectRegisterImages("standard");
                    await downloadAll(current, "motorgate/register");
                }));
            }
        }


        // ===== サイト別実装: Arai AA =====

        function processAraiAA() {
            // window.open override is handled in the entry point at document_start


            // 2. 画像保存ボタンの追加
            const boxId = "araiaa-save-ui";
            if (document.getElementById(boxId)) return;

            // 画像URL収集
            function collect() {
                // パターン1: 詳細ページの「拡大画像」リンクから一括取得 (最も高画質・確実)
                // <div class="zoom_area" id="mainGazou"><a href="./form_...html?0=URL1=URL2=...">
                const zoomLink = document.querySelector("#mainGazou a");
                if (zoomLink) {
                    const href = zoomLink.getAttribute("href");
                    if (href && href.includes("?")) {
                        // ?以降を取得し、= で分割
                        // 例: ?0=http://...=http://...
                        const query = href.split("?")[1];
                        if (query) {
                            const candidates = query.split("=");
                            // URLっぽいものだけ抽出
                            const urls = candidates
                                .filter(s => s.startsWith("http"))
                                .map(u => {
                                    try { return new URL(u, location.href).toString(); } catch { return null; }
                                })
                                .filter(Boolean);

                            if (urls.length > 0) return Array.from(new Set(urls));
                        }
                    }
                }

                // パターン2: 詳細ページのサムネイルリスト (ul#gazou)
                const detailImgs = Array.from(document.querySelectorAll("ul#gazou img"));
                if (detailImgs.length > 0) {
                    const urls = detailImgs
                        .map(img => img.src) // srcをそのまま使う (クエリ付きでもOK、保存時にファイル名生成で除去されるはず)
                        .filter(Boolean)
                        .map(u => {
                            // クエリパラメータ(?0.123...)が付いていることが多いので、念のためそのまま渡すが、
                            // 重復除外のためにURLオブジェクト化
                            try { return new URL(u, location.href).toString(); } catch { return null; }
                        })
                        .filter(Boolean);
                    return Array.from(new Set(urls));
                }

                // パターン3: 検索結果一覧 (#spList)
                // <td class="thumbnail"> ... <img ... data-large="...">
                const listImgs = Array.from(document.querySelectorAll("#spList td.thumbnail img[data-large]"));
                if (listImgs.length > 0) {
                    const urls = listImgs
                        .map(img => img.getAttribute("data-large"))
                        .filter(Boolean)
                        .map(u => {
                            try { return new URL(u, location.href).toString(); } catch { return null; }
                        })
                        .filter(Boolean);
                    return Array.from(new Set(urls));
                }

                return [];
            }

            const initialUrls = collect();
            if (initialUrls.length === 0) return;

            const wrap = createFloatingContainer(boxId);
            if (!wrap) return;

            // 全画像保存
            // ①枚目保存
            wrap.appendChild(createButton("出品票保存", async () => {
                const current = collect();
                if (current.length === 0) return;
                await downloadOne(current[current.length - 1], "araiaa");
            }));

            // 数枚保存 (最初から6枚 + 最後の画像)
            wrap.appendChild(createButton("Pickup(7枚)", async () => {
                const current = collect();
                if (current.length === 0) return;

                const indices = new Set([0, 1, 2, 3, 4, 5, current.length - 1]);
                const targetUrls = current.filter((_, i) => indices.has(i));

                await downloadAll(targetUrls, "araiaa");
            }));

            wrap.appendChild(createButton(`全画像保存(${initialUrls.length})`, async () => {
                const current = collect();
                if (current.length === 0) return;
                await downloadAll(current, "araiaa");
            }));
        }


        // ===== サイト別実装: JU Navi =====

        // 状態管理用
        let juNaviLastUrl = "";
        let juNaviAutomationDone = false;

        function processJuNavi() {
            const currentUrl = location.href;
            if (currentUrl !== juNaviLastUrl) {
                juNaviLastUrl = currentUrl;
                juNaviAutomationDone = false; // URL変わったらリセット
            }

            processJuNaviGlobal();
            processJuNaviDetail();
            processJuNaviListAutomation();
        }

        function processJuNaviGlobal() {
            // 全ページ共通: 自社落札ボタン
            const globalBoxId = "junavi-global-nav";
            if (document.getElementById(globalBoxId)) return;

            const wrap = document.createElement("div");
            wrap.id = globalBoxId;
            wrap.style.position = "fixed";
            wrap.style.bottom = "12px";
            wrap.style.right = "12px";
            wrap.style.zIndex = "999999";
            wrap.style.display = "flex";
            wrap.style.flexDirection = "column";
            wrap.style.gap = "8px";
            document.body.appendChild(wrap);

            const btn = document.createElement("button");
            btn.textContent = "自社落札へ移動";
            btn.style.padding = "10px 14px";
            btn.style.borderRadius = "20px";
            btn.style.border = "none";
            btn.style.background = "#ff9800"; // オレンジ系で目立たせる
            btn.style.color = "white";
            btn.style.boxShadow = "0 4px 6px rgba(0,0,0,0.2)";
            btn.style.cursor = "pointer";
            btn.style.fontWeight = "bold";

            btn.onclick = () => {
                location.href = "https://www2.junavi.jp/JUNaviWEB/SuccessfulbidList";
            };

            wrap.appendChild(btn);
        }

        async function processJuNaviListAutomation() {
            if (!location.href.includes("/SuccessfulbidList")) return;

            // ユーザーが自分で条件を変えた(URLパラメータがある)場合は自動化しない
            if (location.search && location.search.length > 1) return;

            if (juNaviAutomationDone) return;

            // 1. 「絞り込み・表示」ボタンを探す
            // クラス: junaviweb-commonfilterpopup-filterbutton
            const filterBtn = document.querySelector(".junaviweb-commonfilterpopup-filterbutton");

            // ボタンが無い、あるいは既にポップアップが開いているなら待機？
            // ポップアップが開いているかチェック
            const popup = document.querySelector(".junaviweb-search-list-filter-popup");

            if (!filterBtn && !popup) return; // まだロードされてない

            // 処理開始
            juNaviAutomationDone = true; // 二重実行防止

            // ポップアップが開いてなければ開く
            if (!popup) {
                console.log("Filters: Opening popup...");
                filterBtn.click();
                await new Promise(r => setTimeout(r, 500)); // アニメーション待ち
            }

            // ポップアップ内の要素を探す
            // 日付: input[type=date] id*=Input_YMDFrom / Input_YMDTo
            // 日時計算
            const now = new Date();
            const oneMonthAgo = new Date();
            oneMonthAgo.setMonth(now.getMonth() - 1);

            const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const todayStr = fmt(now);
            const pastStr = fmt(oneMonthAgo);

            const inputFrom = document.querySelector('input[type="date"][id*="Input_YMDFrom"]');
            const inputTo = document.querySelector('input[type="date"][id*="Input_YMDTo"]');

            if (inputFrom) {
                inputFrom.value = pastStr;
                inputFrom.dispatchEvent(new Event('change', { bubbles: true }));
            }
            if (inputTo) {
                inputTo.value = todayStr;
                inputTo.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // 件数: select id*=DropdownPageDaisu (50件に変更)
            const selectCount = document.querySelector('select[id*="DropdownPageDaisu"]');
            if (selectCount) {
                const opt50 = Array.from(selectCount.options).find(opt => opt.text.includes("50"));
                if (opt50) {
                    selectCount.value = opt50.value;
                } else {
                    selectCount.value = "3"; // fallback
                }
                selectCount.dispatchEvent(new Event('change', { bubbles: true }));
            }

            // 会場の設定 (JU群馬)
            // 日付や件数の変更で通信が走り、選択肢が後から生成される可能性があるため、待機しながら探す
            let gunmaSet = false;
            for (let retry = 0; retry < 10; retry++) {
                await new Promise(r => setTimeout(r, 500)); // 500ms間隔で最大5秒待機
                const selects = Array.from(document.querySelectorAll(".junaviweb-search-list-filter-popup select"));
                for (const select of selects) {
                    const gunmaOpt = Array.from(select.options).find(opt => opt.text && opt.text.includes("JU群馬"));
                    if (gunmaOpt) {
                        select.value = gunmaOpt.value;
                        select.dispatchEvent(new Event('change', { bubbles: true }));
                        gunmaSet = true;
                        console.log("Filters: Set venue to JU群馬");
                        break;
                    }
                }
                if (gunmaSet) break;
            }

            if (!gunmaSet) {
                console.log("Filters: Could not find JU群馬 option after wait");
            }

            // 適用ボタン: .junaviweb-btn--primary (この条件で表示) inside the popup form
            // フォームID b7-Form1 とかだが動的かも。クラスで探す。
            const popupForm = document.querySelector(".junaviweb-search-list-filter-popup form");
            if (popupForm) {
                const applyBtn = popupForm.querySelector(".junaviweb-btn--primary");
                if (applyBtn) {
                    console.log("Filters: Applying...");
                    await new Promise(r => setTimeout(r, 500)); // 入力・選択反映待ち
                    applyBtn.click();
                }
            }
        }

        function processJuNaviDetail() {
            // SPA対応: .active-screen ごとに処理を行う
            // 複数の .active-screen がある場合(遷移中など)を考慮し、全てに対してチェック
            const screens = document.querySelectorAll(".active-screen");
            if (screens.length === 0) return;

            screens.forEach(root => {
                // すでにUIがあるかチェック (クラスで判定)
                if (root.querySelector(".junavi-save-ui-container")) return;

                // 画像収集 (このスクリーン内限定)
                function collect() {
                    const imgs = Array.from(root.querySelectorAll("img.junaviweb-etc-gallery"));
                    const urls = imgs
                        .map(img => img.src)
                        .filter(src => src && src.startsWith("blob:"))
                    return Array.from(new Set(urls));
                }

                // 車名取得 (このスクリーン内限定)
                function getCarName() {
                    let el = root.querySelector(".junaviweb-detail-car-list-row-carname-grede-text");
                    if (!el) {
                        el = root.querySelector(".junaviweb-detail-carname-grade");
                    }
                    if (!el) return "unknown";
                    return el.textContent.trim().replace(/[\\/:*?"<>|]/g, "_");
                }

                const initialUrls = collect();
                if (initialUrls.length === 0) return;

                // コンテナ作成 (IDではなくクラスで管理)
                const wrap = document.createElement("div");
                wrap.className = "junavi-save-ui-container";
                wrap.style.position = "fixed";
                wrap.style.top = "12px";
                wrap.style.right = "12px";
                wrap.style.zIndex = "999999";
                wrap.style.display = "flex";
                wrap.style.gap = "0";

                // rootにappendするが、rootが overflow:hidden だと隠れる可能性がある
                // しかし、bodyにappendすると古いボタンが残る問題がある
                // ここは root.appendChild にして、ポシションは fixed を維持 (親のtransform影響受けるかもだがSPAなら通常大丈夫)
                root.appendChild(wrap);


                // Blob URL -> Data URL 変換 (共通)
                async function blobToDataUrl(blobUrl) {
                    try {
                        const response = await fetch(blobUrl);
                        const blob = await response.blob();
                        return new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                    } catch (e) {
                        console.error("Blob convert failed:", blobUrl, e);
                        return null;
                    }
                }

                // ボタン: 出品票保存
                wrap.appendChild(createButton("出品票保存", async () => {
                    const current = collect();
                    if (current.length === 0) return;

                    const carName = getCarName();
                    const folderPath = `junavi/${carName}`;

                    const targetBlobUrl = current[0];
                    const dataUrl = await blobToDataUrl(targetBlobUrl);
                    if (dataUrl) {
                        await downloadOne(dataUrl, folderPath, `${carName}_出品票.jpg`);
                    }
                }));

                // ボタン: 全画像保存
                wrap.appendChild(createButton(`全画像保存(${initialUrls.length})`, async () => {
                    const current = collect();
                    if (current.length === 0) return;

                    const carName = getCarName();
                    const folderPath = `junavi/${carName}`;

                    for (let i = 0; i < current.length; i++) {
                        const blobUrl = current[i];
                        const dataUrl = await blobToDataUrl(blobUrl);
                        if (dataUrl) {
                            const num = String(i + 1).padStart(2, "0");
                            const name = `${carName}_${num}.jpg`;
                            await downloadOne(dataUrl, folderPath, name);
                        }
                        await new Promise(r => setTimeout(r, 200));
                    }
                }));
            });
        }


        // ===== エントリーポイント =====

        const host = location.hostname;

        if (host.includes("member.mirive.co.jp")) {
            // MLive
            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", () => {
                    processMLive();
                    const mo = new MutationObserver(processMLive);
                    mo.observe(document.documentElement, { childList: true, subtree: true });
                });
            } else {
                processMLive();
                const mo = new MutationObserver(processMLive);
                mo.observe(document.documentElement, { childList: true, subtree: true });
            }

        } else if (host.includes("motorgate.jp")) {
            // MotorGate
            const initMotorGate = () => {
                processMotorGate();
                const mo = new MutationObserver(processMotorGate);
                mo.observe(document.body, { childList: true, subtree: true });
            };

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", initMotorGate);
            } else {
                initMotorGate();
            }

        } else if (host.includes("araiaa-net.jp")) {
            // Arai AA

            // 1. window.open Override is handled by override.js (MAIN world)

            // 2. UI Logic (Deferred)

            // 2. UI Logic (Deferred)
            const initAraiUI = () => {
                processAraiAA();
                const mo = new MutationObserver(processAraiAA);
                mo.observe(document.body, { childList: true, subtree: true });
            };

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", initAraiUI);
            } else {
                initAraiUI();
            }

        } else if (host.includes("junavi.jp")) {
            // JU Navi
            const initJuNavi = () => {
                processJuNavi();
                const mo = new MutationObserver(processJuNavi);
                mo.observe(document.body, { childList: true, subtree: true });
            };

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", initJuNavi);
            } else {
                initJuNavi();
            }
        }
    }
})();
