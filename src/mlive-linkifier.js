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
        function sanitizeDownloadName(name, fallback = "image.jpg") {
            const cleaned = (name || fallback)
                .normalize("NFKC")
                .replace(/[\u0000-\u001f\u007f]/g, "")
                .replace(/[\\/:*?"<>|]/g, "_")
                .replace(/\s+/g, "_")
                .replace(/^\.+/, "")
                .slice(0, 160);

            return cleaned || fallback;
        }

        function filenameFromUrl(url, fallback = "image.jpg", forceImageExtension = false) {
            try {
                const u = new URL(url);
                const path = u.pathname;
                let base = decodeURIComponent(path.split("/").pop() || fallback);

                if (forceImageExtension && /\.(?:html?|php|cgi|asp)$/i.test(base)) {
                    base = base.replace(/\.[^.]+$/, ".jpg");
                }

                if (forceImageExtension && !/\.(?:jpe?g|png|webp|gif|bmp)$/i.test(base)) {
                    base = `${base}.jpg`;
                }

                return sanitizeDownloadName(base, fallback);
            } catch {
                return fallback;
            }
        }

        function imageExtensionFromUrl(url) {
            const base = filenameFromUrl(url, "image.jpg", true);
            const match = base.match(/\.(jpe?g|png|webp|gif|bmp)$/i);
            if (!match) return ".jpg";

            return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
        }

        function imageDownloadHeaders() {
            return [
                { name: "Accept", value: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" }
            ];
        }

        function sendDownload(url, filename) {
            return new Promise((resolve) => {
                chrome.runtime.sendMessage({
                    type: "download",
                    url: url,
                    filename: filename,
                    headers: imageDownloadHeaders()
                }, response => {
                    if (chrome.runtime.lastError) {
                        resolve({ success: false, error: chrome.runtime.lastError.message });
                        return;
                    }

                    resolve(response || { success: false, error: "No response from background script" });
                });
            });
        }

        // ダウンロード (Backgroundへ依頼)
        // ダウンロード (Backgroundへ依頼)
        async function downloadOne(url, folderCode = "misc", explicitFilename = null) {
            const base = explicitFilename
                ? sanitizeDownloadName(explicitFilename)
                : filenameFromUrl(url, "image.jpg", true);
            const filename = `${folderCode}/${base}`;
            const response = await sendDownload(url, filename);

            if (!response?.success) {
                console.warn("MLive Linkifier: download failed", JSON.stringify({ url, filename, response }));
            }

            return response;
        }

        async function downloadAll(urls, folderCode = "all") {
            for (let i = 0; i < urls.length; i++) {
                const url = urls[i];
                const base = filenameFromUrl(url, `image_${i + 1}.jpg`, true);
                const num = String(i + 1).padStart(2, "0");
                const response = await downloadOne(url, folderCode, `${num}_${base}`);

                if (!response?.success) {
                    console.warn("MLive Linkifier: download-all item failed", JSON.stringify({ url, response }));
                }

                await new Promise(r => setTimeout(r, 800));
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

        const MLIVE_SEARCH_MODE_LISTING = "1";
        const MLIVE_SEARCH_MODE_MARKET = "11";
        const MLIVE_SEARCH_BRIDGE_VERSION = 3;
        const MLIVE_SEARCH_BRIDGE_SLOT_IDS = ["1", "2", "3", "4", "5"];
        const MLIVE_SEARCH_BRIDGE_OLD_CONDITION_KEY = "mliveSearchBridgeCondition";
        const MLIVE_SEARCH_BRIDGE_SLOTS_KEY = "mliveSearchBridgeSlots";
        const MLIVE_SEARCH_BRIDGE_PENDING_KEY = "mliveSearchBridgePending";
        const ARAI_SEARCH_BRIDGE_SLOTS_KEY = "araiSearchBridgeSlots";
        const ARAI_SEARCH_BRIDGE_PENDING_KEY = "araiSearchBridgePending";
        const JU_SEARCH_BRIDGE_SLOTS_KEY = "juSearchBridgeSlots";
        const JU_SEARCH_BRIDGE_PENDING_KEY = "juSearchBridgePending";
        const MLIVE_NORMAL_AA_CODES = new Set(["131", "220", "132"]);
        let mliveSearchBridgePendingRunning = false;
        let mliveSearchBridgePendingApplied = false;
        const siteSearchBridgeState = {
            arai: { pendingRunning: false, pendingApplied: false },
            ju: { pendingRunning: false, pendingApplied: false }
        };

        function processMLive() {
            // リンク化
            processOnce();

            processMLiveAutoSelect();

            processMLiveSearchBridge();

            // ボタン表示
            const boxId = "mlive-save-ui";
            if (document.getElementById(boxId)) return;

            // 画像URL収集
            function collect() {
                const anchorsAll = Array.from(document.querySelectorAll('a[data-fancybox^="gallery"][href]'));
                const visibleAnchors = anchorsAll.filter(a => a.offsetWidth || a.offsetHeight || a.getClientRects().length);
                const anchors = visibleAnchors.length > 0 ? visibleAnchors : anchorsAll;
                const urls = anchors
                    .map(a => a.getAttribute("href"))
                    .filter(Boolean)
                    .filter(u => !/\/no_image/i.test(u))
                    .map(u => {
                        try { return new URL(u, location.href).toString(); } catch { return null; }
                    })
                    .filter(Boolean);
                return Array.from(new Set(urls));
            }

            function isMLiveSheetImageUrl(url) {
                try {
                    return /\/pict\/d\//i.test(new URL(url, location.href).pathname);
                } catch {
                    return false;
                }
            }

            function collectMLiveImageSets() {
                const allUrls = collect();
                const sheetUrl = allUrls.find(isMLiveSheetImageUrl) || "";
                const vehicleUrls = sheetUrl ? allUrls.filter(url => url !== sheetUrl) : allUrls;

                return { allUrls, vehicleUrls, sheetUrl };
            }

            function getMLiveTableValue(labelText) {
                for (const row of Array.from(document.querySelectorAll("tr"))) {
                    const cells = Array.from(row.children);
                    if (cells.length < 2) continue;

                    const label = (cells[0].textContent || "").replace(/\s+/g, "");
                    if (!label.includes(labelText)) continue;

                    const value = (cells[1].textContent || "").replace(/\s+/g, " ").trim();
                    if (value) return value;
                }

                return "";
            }

            function getMLiveSaveMeta() {
                const params = new URL(location.href).searchParams;
                const auctionNo = (getMLiveTableValue("出品番号") || params.get("seriNo") || "").replace(/\s*号車$/, "").trim();
                const carName = getMLiveTableValue("車名") || "";
                const saveBase = sanitizeDownloadName([auctionNo, carName].filter(Boolean).join("_"), "mlive_unknown");

                if (!auctionNo || !carName) {
                    console.warn("MLive Linkifier: MLive save name is missing a field", { auctionNo, carName, saveBase });
                }

                return {
                    filenameBase: saveBase,
                    folderCode: `mlive/${saveBase}`
                };
            }

            async function downloadMLiveImages(urls, saveMeta) {
                for (let i = 0; i < urls.length; i++) {
                    const num = String(i + 1).padStart(2, "0");
                    const extension = imageExtensionFromUrl(urls[i]);
                    await downloadOne(urls[i], saveMeta.folderCode, `${saveMeta.filenameBase}_${num}${extension}`);
                    await new Promise(r => setTimeout(r, 250));
                }
            }

            async function downloadMLiveFullSet(imageSets, saveMeta) {
                if (imageSets.sheetUrl) {
                    await downloadOne(imageSets.sheetUrl, saveMeta.folderCode, `${saveMeta.filenameBase}_出品票.jpg`);
                    await new Promise(r => setTimeout(r, 250));
                }

                if (imageSets.vehicleUrls.length > 0) {
                    await downloadMLiveImages(imageSets.vehicleUrls, saveMeta);
                }
            }

            const initialImages = collectMLiveImageSets();
            if (initialImages.allUrls.length === 0) return;

            const wrap = createFloatingContainer(boxId);
            if (!wrap) return;

            // ①枚目
            wrap.appendChild(createButton("出品票保存", async () => {
                const current = collectMLiveImageSets();
                if (!current.sheetUrl) {
                    console.warn("MLive Linkifier: MLive sheet image was not found");
                    return;
                }

                const saveMeta = getMLiveSaveMeta();
                await downloadOne(current.sheetUrl, saveMeta.folderCode, `${saveMeta.filenameBase}_出品票.jpg`);
            }));

            wrap.appendChild(createButton("Pickup(車6+票)", async () => {
                const current = collectMLiveImageSets();
                if (current.vehicleUrls.length === 0 && !current.sheetUrl) return;

                const saveMeta = getMLiveSaveMeta();
                await downloadMLiveImages(current.vehicleUrls.slice(0, 6), saveMeta);

                if (current.sheetUrl) {
                    await downloadOne(current.sheetUrl, saveMeta.folderCode, `${saveMeta.filenameBase}_出品票.jpg`);
                }
            }));

            // 全画像
            wrap.appendChild(createButton(`全保存(票+車${initialImages.vehicleUrls.length})`, async () => {
                const current = collectMLiveImageSets();
                if (current.vehicleUrls.length === 0 && !current.sheetUrl) return;
                await downloadMLiveFullSet(current, getMLiveSaveMeta());
            }));
        }

        function processMLiveSearchBridge() {
            if (!document.body) return;

            if (isMLiveSearchCarPage()) {
                installMLiveSearchCarBridge();
                applyPendingMLiveBridgeSearch();
                return;
            }

            if (isMLiveMyCarBridgePage() || isMLiveDetailPage()) {
                installMLiveSavedSearchBridge();
            }
        }

        function isMLiveSearchCarPage() {
            return location.pathname.includes("/SearchCar");
        }

        function isMLiveMyCarBridgePage() {
            if (!location.pathname.includes("/MyCar")) return false;

            const mode = getMLivePageSearchMode();
            return isMLiveBridgeMode(mode);
        }

        function isMLiveDetailPage() {
            return location.pathname.includes("/CarDetail");
        }

        function normalizeMLiveMode(value) {
            return String(value || "").trim();
        }

        function isMLiveBridgeMode(mode) {
            return mode === MLIVE_SEARCH_MODE_LISTING || mode === MLIVE_SEARCH_MODE_MARKET;
        }

        function getMLiveOppositeMode(mode) {
            return mode === MLIVE_SEARCH_MODE_MARKET ? MLIVE_SEARCH_MODE_LISTING : MLIVE_SEARCH_MODE_MARKET;
        }

        function getMLiveModeLabel(mode) {
            return mode === MLIVE_SEARCH_MODE_MARKET ? "相場" : "出品";
        }

        function getMLiveSearchForm() {
            return document.querySelector("form#searchForm");
        }

        function getMLivePageSearchMode(form = null) {
            const scopedForm = form || getMLiveSearchForm();
            const fieldMode = scopedForm?.querySelector('[name="cond.SearchMode"]')?.value ||
                document.querySelector('[name="cond.SearchMode"]')?.value ||
                document.querySelector('[name="SearchMode"]')?.value ||
                "";
            const params = new URL(location.href).searchParams;
            const paramMode = params.get("SearchMode") || params.get("searchMode") || "";

            return normalizeMLiveMode(fieldMode || paramMode);
        }

        function createMLiveBridgeContainer(id) {
            if (document.getElementById(id)) return null;

            const wrap = document.createElement("div");
            wrap.id = id;
            wrap.style.position = "fixed";
            wrap.style.top = "58px";
            wrap.style.right = "12px";
            wrap.style.zIndex = "999998";
            wrap.style.display = "flex";
            wrap.style.flexWrap = "wrap";
            wrap.style.justifyContent = "flex-end";
            wrap.style.gap = "0";
            wrap.style.maxWidth = "calc(100vw - 24px)";
            document.body.appendChild(wrap);
            return wrap;
        }

        function createMLiveBridgePanel(id) {
            if (document.getElementById(id)) return null;

            const wrap = document.createElement("div");
            wrap.id = id;
            wrap.style.position = "fixed";
            wrap.style.top = "58px";
            wrap.style.right = "12px";
            wrap.style.zIndex = "999998";
            wrap.style.fontFamily = "sans-serif";
            wrap.style.fontSize = "12px";
            document.body.appendChild(wrap);
            return wrap;
        }

        function styleMLiveBridgeLauncher(wrap) {
            wrap.style.display = "block";
            wrap.style.width = "auto";
            wrap.style.maxHeight = "";
            wrap.style.overflow = "visible";
            wrap.style.padding = "0";
            wrap.style.border = "none";
            wrap.style.borderRadius = "0";
            wrap.style.background = "transparent";
            wrap.style.boxShadow = "none";
            wrap.style.color = "#111827";
        }

        function styleMLiveBridgeExpandedPanel(wrap) {
            wrap.style.display = "flex";
            wrap.style.flexDirection = "column";
            wrap.style.gap = "6px";
            wrap.style.width = "min(520px, calc(100vw - 24px))";
            wrap.style.maxHeight = "calc(100vh - 90px)";
            wrap.style.overflow = "auto";
            wrap.style.padding = "8px";
            wrap.style.border = "1px solid rgba(0,0,0,0.18)";
            wrap.style.borderRadius = "8px";
            wrap.style.background = "rgba(255,255,255,0.98)";
            wrap.style.boxShadow = "0 3px 14px rgba(0,0,0,0.18)";
            wrap.style.color = "#111827";
        }

        function createMLiveBridgeButton(text, onClick, disabled = false) {
            const btn = createButton(text, onClick);
            btn.style.padding = "6px 8px";
            btn.style.borderRadius = "6px";
            btn.style.fontSize = "12px";
            btn.style.marginRight = "0";
            btn.style.boxShadow = "none";
            btn.style.whiteSpace = "nowrap";

            if (disabled) {
                btn.disabled = true;
                btn.style.opacity = "0.45";
                btn.style.cursor = "default";
            }

            return btn;
        }

        function normalizeSearchBridgeText(value) {
            return String(value || "").replace(/\s+/g, " ").trim();
        }

        function getSearchBridgeSlotDefaultName(id) {
            return `保存${id}`;
        }

        function normalizeSearchBridgeSlotName(value, id) {
            const text = normalizeSearchBridgeText(value).slice(0, 24);
            return text || getSearchBridgeSlotDefaultName(id);
        }

        function normalizeSearchBridgeSummary(summary) {
            if (!Array.isArray(summary)) return [];

            return summary
                .map(item => normalizeSearchBridgeText(item).slice(0, 80))
                .filter(Boolean)
                .slice(0, 5);
        }

        function formatSearchBridgePreview(summary) {
            const items = normalizeSearchBridgeSummary(summary);
            return items.length > 0 ? items.join(" / ") : "内容なし";
        }

        function createSearchBridgeSlotNameElement(slot, renameHandler) {
            const label = document.createElement("div");
            label.textContent = normalizeSearchBridgeSlotName(slot.name, slot.id);
            label.title = "ダブルクリックで名前変更";
            label.style.fontWeight = "700";
            label.style.cursor = "text";
            label.style.overflow = "hidden";
            label.style.textOverflow = "ellipsis";
            label.style.whiteSpace = "nowrap";

            label.addEventListener("dblclick", async () => {
                const currentName = normalizeSearchBridgeSlotName(slot.name, slot.id);
                const input = prompt("保存名を入力してください", currentName);
                if (input === null) return;

                const nextName = normalizeSearchBridgeSlotName(input, slot.id);
                await renameHandler(nextName);
            });

            return label;
        }

        function createSearchBridgeSlotStatusBlock(metaText, previewText, titleText = "") {
            const wrap = document.createElement("div");
            wrap.style.minWidth = "0";

            const meta = document.createElement("div");
            meta.textContent = metaText;
            meta.style.overflow = "hidden";
            meta.style.textOverflow = "ellipsis";
            meta.style.whiteSpace = "nowrap";
            wrap.appendChild(meta);

            const preview = document.createElement("div");
            preview.textContent = previewText;
            preview.title = titleText || previewText;
            preview.style.marginTop = "2px";
            preview.style.fontSize = "11px";
            preview.style.color = "#4b5563";
            preview.style.overflow = "hidden";
            preview.style.textOverflow = "ellipsis";
            preview.style.whiteSpace = "nowrap";
            wrap.appendChild(preview);

            return wrap;
        }

        function formatMLiveSlotStatus(condition) {
            if (!condition) return "空";

            const savedAt = Number(condition.savedAt || 0);
            const date = new Date(Number.isFinite(savedAt) && savedAt > 0 ? savedAt : Date.now());
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            const hour = String(date.getHours()).padStart(2, "0");
            const minute = String(date.getMinutes()).padStart(2, "0");
            const mode = isMLiveBridgeMode(condition.sourceMode) ? getMLiveModeLabel(condition.sourceMode) : "条件";

            return `${mode} ${month}/${day} ${hour}:${minute}`;
        }

        function getMLiveConditionPreview(condition) {
            if (!condition) return "未保存";

            const summary = normalizeSearchBridgeSummary(condition.summary);
            if (summary.length > 0) return formatSearchBridgePreview(summary);

            const fields = condition.fields || {};
            const items = [];

            for (const [name, rawValues] of Object.entries(fields)) {
                const values = (Array.isArray(rawValues) ? rawValues : [rawValues])
                    .map(value => normalizeSearchBridgeText(value))
                    .filter(Boolean);
                if (values.length === 0) continue;

                items.push(`${getMLiveFieldSummaryLabel(name)}:${values.slice(0, 2).join("/")}`);
                if (items.length >= 5) break;
            }

            return formatSearchBridgePreview(items);
        }

        function getMLiveFieldSummaryLabel(name) {
            return normalizeSearchBridgeText(name).replace(/^cond\./, "") || "条件";
        }

        function getMLiveControlDisplayText(control, value) {
            if (!control) return normalizeSearchBridgeText(value);

            const textValue = normalizeSearchBridgeText(value);
            if (control.tagName === "SELECT") {
                const option = Array.from(control.options || []).find(item => String(item.value ?? "") === String(value ?? ""));
                return normalizeSearchBridgeText(option?.textContent || textValue);
            }

            if (control.type === "checkbox" || control.type === "radio") {
                return normalizeSearchBridgeText(getSearchBridgeControlLabel(control) || textValue);
            }

            return textValue;
        }

        function buildMLiveConditionSummary(form, fields) {
            const items = [];

            for (const [name, rawValues] of Object.entries(fields || {})) {
                const values = (Array.isArray(rawValues) ? rawValues : [rawValues])
                    .map(value => normalizeSearchBridgeText(value))
                    .filter(Boolean);
                if (values.length === 0) continue;

                const controls = getMLiveFormControls(form, name);
                const displayValues = values
                    .map(value => {
                        const control = controls.find(item => String(item.value ?? "") === String(value ?? "")) || controls[0];
                        return getMLiveControlDisplayText(control, value);
                    })
                    .filter(Boolean);

                const label = getMLiveFieldSummaryLabel(name);
                items.push(`${label}:${displayValues.slice(0, 2).join("/")}`);
                if (items.length >= 5) break;
            }

            return normalizeSearchBridgeSummary(items);
        }

        function renderMLiveSlotLauncher(wrap, options) {
            wrap.textContent = "";
            styleMLiveBridgeLauncher(wrap);

            const btn = createMLiveBridgeButton("条件保存", async () => {
                await renderMLiveSlotPanel(wrap, options);
            });
            btn.style.padding = "8px 10px";
            btn.style.borderRadius = "18px";
            btn.style.fontWeight = "700";
            btn.style.boxShadow = "0 2px 10px rgba(0,0,0,0.18)";
            wrap.appendChild(btn);
        }

        async function renderMLiveSlotPanel(wrap, options) {
            styleMLiveBridgeExpandedPanel(wrap);
            wrap.textContent = "保存条件を読み込み中...";

            try {
                const store = await getMLiveSearchSlotStore();
                wrap.textContent = "";

                const header = document.createElement("div");
                header.style.display = "flex";
                header.style.alignItems = "center";
                header.style.justifyContent = "space-between";
                header.style.gap = "8px";
                header.style.marginBottom = "2px";

                const title = document.createElement("div");
                title.textContent = "MLive条件保存";
                title.style.fontWeight = "700";
                header.appendChild(title);

                header.appendChild(createMLiveBridgeButton("閉じる", async () => {
                    renderMLiveSlotLauncher(wrap, options);
                }));

                wrap.appendChild(header);

                for (const slot of store.slots) {
                    wrap.appendChild(createMLiveSlotRow(wrap, slot, options));
                }
            } catch (error) {
                console.warn("MLive Linkifier: slot panel render failed", error);
                wrap.textContent = "保存条件を読み込めませんでした";
            }
        }

        function createMLiveSlotRow(wrap, slot, options) {
            const row = document.createElement("div");
            row.style.display = "grid";
            row.style.gridTemplateColumns = options.allowSave ? "92px minmax(120px, 1fr) auto auto auto" : "92px minmax(120px, 1fr) auto auto auto";
            row.style.alignItems = "center";
            row.style.gap = "6px";
            row.style.padding = "6px";
            row.style.border = "1px solid rgba(0,0,0,0.1)";
            row.style.borderRadius = "6px";
            row.style.background = "#f9fafb";

            row.appendChild(createSearchBridgeSlotNameElement(slot, async (nextName) => {
                await renameMLiveSearchConditionSlot(slot.id, nextName);
                showMLiveBridgeNotice(`保存${slot.id}の名前を変更しました`);
                await renderMLiveSlotPanel(wrap, options);
            }));

            const previewText = getMLiveConditionPreview(slot.condition);
            row.appendChild(createSearchBridgeSlotStatusBlock(
                formatMLiveSlotStatus(slot.condition),
                previewText,
                slot.condition?.sourceUrl || previewText
            ));

            if (options.allowSave) {
                row.appendChild(createMLiveBridgeButton("この条件を保存", async () => {
                    const condition = await saveMLiveSearchConditionSlot(options.form, slot.id);
                    if (condition) showMLiveBridgeNotice(`保存${slot.id}に保存しました`);
                    await renderMLiveSlotPanel(wrap, options);
                }));

                const targetMode = getMLiveOppositeMode(options.currentMode);
                row.appendChild(createMLiveBridgeButton(`${getMLiveModeLabel(targetMode)}へ`, async () => {
                    await startMLiveBridgeSearch(targetMode, slot.condition);
                }, !slot.condition));
            } else {
                row.appendChild(createMLiveBridgeButton("相場へ", async () => {
                    await startMLiveBridgeSearch(MLIVE_SEARCH_MODE_MARKET, slot.condition);
                }, !slot.condition));

                row.appendChild(createMLiveBridgeButton("出品へ", async () => {
                    await startMLiveBridgeSearch(MLIVE_SEARCH_MODE_LISTING, slot.condition);
                }, !slot.condition));
            }

            row.appendChild(createMLiveBridgeButton("削除", async () => {
                await deleteMLiveSearchConditionSlot(slot.id);
                showMLiveBridgeNotice(`保存${slot.id}を削除しました`);
                await renderMLiveSlotPanel(wrap, options);
            }, !slot.condition));

            return row;
        }

        function showMLiveBridgeNotice(message, type = "info") {
            const old = document.getElementById("mlive-search-bridge-notice");
            if (old) old.remove();

            const notice = document.createElement("div");
            notice.id = "mlive-search-bridge-notice";
            notice.textContent = message;
            notice.style.position = "fixed";
            notice.style.right = "16px";
            notice.style.bottom = "16px";
            notice.style.zIndex = "1000000";
            notice.style.maxWidth = "min(420px, calc(100vw - 32px))";
            notice.style.padding = "10px 12px";
            notice.style.borderRadius = "8px";
            notice.style.boxShadow = "0 4px 18px rgba(0,0,0,0.25)";
            notice.style.fontSize = "13px";
            notice.style.lineHeight = "1.4";
            notice.style.fontFamily = "sans-serif";
            notice.style.color = "white";
            notice.style.background = type === "error" ? "#b91c1c" : "#1f2937";
            document.body.appendChild(notice);

            setTimeout(() => notice.remove(), 4500);
        }

        function isMLiveSavableConditionName(name) {
            if (!name || !name.startsWith("cond.")) return false;
            if (name === "cond.SearchMode") return false;

            return ![
                "cond.AaCode",
                "cond.BeforeAaCode",
                "cond.AucNoFrom",
                "cond.AucNoTo"
            ].includes(name);
        }

        function addMLiveConditionValue(fields, name, value) {
            if (!isMLiveSavableConditionName(name)) return;
            if (!fields[name]) fields[name] = [];
            fields[name].push(String(value ?? ""));
        }

        function collectMLiveSearchCondition(form) {
            const sourceMode = getMLivePageSearchMode(form);
            const fields = {};

            for (const el of Array.from(form.elements)) {
                if (!isMLiveSavableConditionName(el.name)) continue;
                if (el.disabled) continue;
                if (/^(button|submit|reset|file)$/i.test(el.type || "")) continue;

                if (el.type === "checkbox" || el.type === "radio") {
                    if (el.checked) addMLiveConditionValue(fields, el.name, el.value);
                    continue;
                }

                if (el.tagName === "SELECT" && el.multiple) {
                    Array.from(el.selectedOptions).forEach(option => {
                        addMLiveConditionValue(fields, el.name, option.value);
                    });
                    continue;
                }

                addMLiveConditionValue(fields, el.name, el.value);
            }

            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                sourceMode,
                fields,
                summary: buildMLiveConditionSummary(form, fields),
                savedAt: Date.now(),
                sourceUrl: location.href
            };
        }

        function createEmptyMLiveSlotStore() {
            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                slots: MLIVE_SEARCH_BRIDGE_SLOT_IDS.map(id => ({
                    id,
                    name: getSearchBridgeSlotDefaultName(id),
                    condition: null
                }))
            };
        }

        function normalizeMLiveCondition(condition) {
            if (!condition || !condition.fields) return null;
            const savedAt = Number(condition.savedAt || Date.now());

            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                sourceMode: normalizeMLiveMode(condition.sourceMode),
                fields: condition.fields,
                summary: normalizeSearchBridgeSummary(condition.summary),
                savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
                sourceUrl: condition.sourceUrl || ""
            };
        }

        function normalizeMLiveSlotStore(value) {
            const store = createEmptyMLiveSlotStore();
            if (!value || !Array.isArray(value.slots)) return store;

            for (const slot of value.slots) {
                const id = String(slot?.id || "");
                const targetSlot = store.slots.find(item => item.id === id);
                if (!targetSlot) continue;

                targetSlot.name = normalizeSearchBridgeSlotName(slot.name || slot.title || slot.label, id);
                targetSlot.condition = normalizeMLiveCondition(slot.condition);
            }

            return store;
        }

        async function getMLiveSearchSlotStore() {
            const result = await chrome.storage.local.get([
                MLIVE_SEARCH_BRIDGE_SLOTS_KEY,
                MLIVE_SEARCH_BRIDGE_OLD_CONDITION_KEY
            ]);
            const store = normalizeMLiveSlotStore(result[MLIVE_SEARCH_BRIDGE_SLOTS_KEY]);
            const hasSavedSlot = store.slots.some(slot => slot.condition);
            const oldCondition = normalizeMLiveCondition(result[MLIVE_SEARCH_BRIDGE_OLD_CONDITION_KEY]);

            if (!hasSavedSlot && oldCondition) {
                store.slots[0].condition = oldCondition;
                await chrome.storage.local.set({ [MLIVE_SEARCH_BRIDGE_SLOTS_KEY]: store });
                await chrome.storage.local.remove(MLIVE_SEARCH_BRIDGE_OLD_CONDITION_KEY);
            }

            return store;
        }

        async function saveMLiveSearchConditionSlot(form, slotId) {
            if (!form) {
                showMLiveBridgeNotice("検索条件フォームが見つかりませんでした", "error");
                return null;
            }

            const condition = collectMLiveSearchCondition(form);
            const store = await getMLiveSearchSlotStore();
            const slot = store.slots.find(item => item.id === String(slotId));
            if (!slot) return null;

            slot.condition = condition;
            await chrome.storage.local.set({ [MLIVE_SEARCH_BRIDGE_SLOTS_KEY]: store });
            return condition;
        }

        async function renameMLiveSearchConditionSlot(slotId, name) {
            const store = await getMLiveSearchSlotStore();
            const slot = store.slots.find(item => item.id === String(slotId));
            if (!slot) return null;

            slot.name = normalizeSearchBridgeSlotName(name, slot.id);
            await chrome.storage.local.set({ [MLIVE_SEARCH_BRIDGE_SLOTS_KEY]: store });
            return slot.name;
        }

        async function deleteMLiveSearchConditionSlot(slotId) {
            const store = await getMLiveSearchSlotStore();
            const slot = store.slots.find(item => item.id === String(slotId));
            if (!slot) return null;

            slot.condition = null;
            await chrome.storage.local.set({ [MLIVE_SEARCH_BRIDGE_SLOTS_KEY]: store });
            return store;
        }

        async function startMLiveBridgeSearch(targetMode, condition = null) {
            const savedCondition = normalizeMLiveCondition(condition);

            if (!savedCondition) {
                showMLiveBridgeNotice("保存条件が空です", "error");
                return;
            }

            const pending = {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                targetMode,
                condition: savedCondition,
                createdAt: Date.now(),
                sourceUrl: location.href
            };
            const url = new URL("/MLiveWebMember/SearchCar", location.origin);
            url.searchParams.set("SearchMode", targetMode);

            await chrome.storage.local.set({
                [MLIVE_SEARCH_BRIDGE_PENDING_KEY]: pending
            });

            location.href = url.toString();
        }

        function installMLiveSearchCarBridge() {
            const form = getMLiveSearchForm();
            if (!form) return;

            const mode = getMLivePageSearchMode(form);
            if (!isMLiveBridgeMode(mode)) return;
            if (document.getElementById("mlive-search-bridge-ui")) return;

            const wrap = createMLiveBridgePanel("mlive-search-bridge-ui");
            if (!wrap) return;

            renderMLiveSlotLauncher(wrap, {
                form,
                currentMode: mode,
                allowSave: true,
                showBothTargets: false
            });
        }

        function installMLiveSavedSearchBridge() {
            if (document.getElementById("mlive-search-bridge-saved-ui")) return;

            const wrap = createMLiveBridgePanel("mlive-search-bridge-saved-ui");
            if (!wrap) return;

            renderMLiveSlotLauncher(wrap, {
                form: null,
                currentMode: getMLivePageSearchMode(),
                allowSave: false,
                showBothTargets: true
            });
        }

        async function applyPendingMLiveBridgeSearch() {
            if (mliveSearchBridgePendingRunning || mliveSearchBridgePendingApplied) return;

            const form = getMLiveSearchForm();
            if (!form) return;

            const mode = getMLivePageSearchMode(form);
            if (!isMLiveBridgeMode(mode)) return;

            mliveSearchBridgePendingRunning = true;
            try {
                const result = await chrome.storage.local.get(MLIVE_SEARCH_BRIDGE_PENDING_KEY);
                const pending = result[MLIVE_SEARCH_BRIDGE_PENDING_KEY];
                if (!pending) return;
                if (pending.version !== MLIVE_SEARCH_BRIDGE_VERSION || !pending.condition) {
                    await chrome.storage.local.remove(MLIVE_SEARCH_BRIDGE_PENDING_KEY);
                    return;
                }

                if (Date.now() - Number(pending.createdAt || 0) > 10 * 60 * 1000) {
                    await chrome.storage.local.remove(MLIVE_SEARCH_BRIDGE_PENDING_KEY);
                    return;
                }

                if (normalizeMLiveMode(pending.targetMode) !== mode) return;

                resetMLiveSearchFormCondition(form);
                applyMLiveConditionToForm(form, pending.condition.fields, mode);
                setMLiveFieldValue(form, "cond.SearchMode", mode);
                setMLiveFieldValue(form, "ActionMode", "Search");
                setMLiveFieldValue(form, "pageVm.CurrentPage", "1");
                setMLiveFieldValue(form, "pageVm.SortField", "");
                setMLiveFieldValue(form, "pageVm.SortOrder", "");
                setMLiveFieldValue(form, "pageVm.DispType", "1");

                mliveSearchBridgePendingApplied = true;
                await chrome.storage.local.remove(MLIVE_SEARCH_BRIDGE_PENDING_KEY);

                showMLiveBridgeNotice(`保存条件で${getMLiveModeLabel(mode)}検索します`);
                setTimeout(() => submitMLiveSearchForm(form), 80);
            } catch (error) {
                console.warn("MLive Linkifier: pending bridge search failed", error);
                showMLiveBridgeNotice("保存条件の検索に失敗しました", "error");
            } finally {
                mliveSearchBridgePendingRunning = false;
            }
        }

        function resetMLiveSearchFormCondition(form) {
            form.querySelectorAll('[data-mlive-bridge-hidden="1"]').forEach(el => el.remove());

            for (const el of Array.from(form.elements)) {
                if (!isMLiveSavableConditionName(el.name)) continue;
                if (/^(button|submit|reset)$/i.test(el.type || "")) continue;

                if (el.type === "checkbox" || el.type === "radio") {
                    el.checked = false;
                } else if (el.tagName === "SELECT") {
                    if (el.multiple) {
                        Array.from(el.options).forEach(option => { option.selected = false; });
                    } else {
                        el.value = "";
                        if (el.value !== "") el.selectedIndex = 0;
                    }
                } else {
                    el.value = "";
                }
            }
        }

        function applyMLiveConditionToForm(form, fields, targetMode) {
            const compatibleFields = getMLiveCompatibleConditionFields(fields, targetMode);

            for (const [name, values] of Object.entries(compatibleFields)) {
                applyMLiveConditionField(form, name, values);
            }
        }

        function getMLiveCompatibleConditionFields(fields, targetMode) {
            const compatible = {};

            for (const [name, rawValues] of Object.entries(fields || {})) {
                if (!isMLiveSavableConditionName(name)) continue;

                const values = Array.isArray(rawValues) ? rawValues : [rawValues];
                const mappedValues = name === "cond.LstAaCode"
                    ? values.map(value => mapMLiveAaCodeForTarget(value, targetMode)).filter(Boolean)
                    : values.map(value => String(value ?? ""));

                const uniqueValues = Array.from(new Set(mappedValues));
                if (uniqueValues.length > 0) compatible[name] = uniqueValues;
            }

            return compatible;
        }

        function mapMLiveAaCodeForTarget(value, targetMode) {
            const text = String(value || "").trim();
            if (!text) return "";

            if (targetMode === MLIVE_SEARCH_MODE_MARKET) {
                if (text.includes("|")) {
                    const [kind, aaCode] = text.split("|");
                    if (kind === aaCode && MLIVE_NORMAL_AA_CODES.has(aaCode)) return aaCode;
                    return "";
                }

                return MLIVE_NORMAL_AA_CODES.has(text) ? text : "";
            }

            if (targetMode === MLIVE_SEARCH_MODE_LISTING) {
                if (text.includes("|")) {
                    const [kind, aaCode] = text.split("|");
                    if (kind === aaCode && MLIVE_NORMAL_AA_CODES.has(aaCode)) return text;
                    return "";
                }

                return MLIVE_NORMAL_AA_CODES.has(text) ? `${text}|${text}` : "";
            }

            return text;
        }

        function getMLiveFormControls(form, name) {
            const controls = form.elements[name];
            if (!controls) return [];
            if (controls instanceof Element) return [controls];

            return Array.from(controls).filter(Boolean);
        }

        function applyMLiveConditionField(form, name, values) {
            const controls = getMLiveFormControls(form, name);
            const stringValues = values.map(value => String(value ?? ""));

            if (controls.length === 0) {
                appendMLiveHiddenValues(form, name, stringValues);
                return;
            }

            const first = controls[0];
            if (first.type === "checkbox" || first.type === "radio") {
                const matched = new Set();

                for (const control of controls) {
                    const shouldCheck = stringValues.includes(control.value);
                    control.checked = shouldCheck;
                    if (shouldCheck) matched.add(control.value);
                    dispatchMLiveChangeEvents(control);
                }

                const missingValues = stringValues.filter(value => value && !matched.has(value));
                appendMLiveHiddenValues(form, name, missingValues);
                return;
            }

            if (first.tagName === "SELECT") {
                if (first.multiple) {
                    Array.from(first.options).forEach(option => {
                        option.selected = stringValues.includes(option.value);
                    });
                } else {
                    first.value = stringValues[0] || "";
                }
                dispatchMLiveChangeEvents(first);
                return;
            }

            if (controls.length === 1) {
                first.value = stringValues[0] || "";
                dispatchMLiveChangeEvents(first);
                return;
            }

            controls.forEach((control, index) => {
                control.value = stringValues[index] || "";
                dispatchMLiveChangeEvents(control);
            });
            appendMLiveHiddenValues(form, name, stringValues.slice(controls.length));
        }

        function appendMLiveHiddenValues(form, name, values) {
            values.filter(value => value !== "").forEach(value => {
                const input = document.createElement("input");
                input.type = "hidden";
                input.name = name;
                input.value = value;
                input.dataset.mliveBridgeHidden = "1";
                form.appendChild(input);
            });
        }

        function setMLiveFieldValue(form, name, value) {
            const controls = getMLiveFormControls(form, name);
            const target = controls[0];
            if (!target) return;

            target.value = value;
            dispatchMLiveChangeEvents(target);
        }

        function dispatchMLiveChangeEvents(el) {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        function submitMLiveSearchForm(form) {
            const submitter = form.querySelector("#searchBtn") || form.querySelector('[type="submit"]');

            if (typeof form.requestSubmit === "function") {
                form.requestSubmit(submitter || undefined);
            } else if (submitter) {
                submitter.click();
            } else {
                form.submit();
            }
        }

        // ===== 共通 検索条件5枠ブリッジ (Arai/JU) =====

        function normalizeSiteSearchBridgeMode(value) {
            return String(value || "").trim();
        }

        function createEmptySiteSearchBridgeSlotStore() {
            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                slots: MLIVE_SEARCH_BRIDGE_SLOT_IDS.map(id => ({
                    id,
                    name: getSearchBridgeSlotDefaultName(id),
                    condition: null
                }))
            };
        }

        function normalizeSiteSearchBridgeCondition(condition) {
            if (!condition || !Array.isArray(condition.fields)) return null;

            const savedAt = Number(condition.savedAt || Date.now());
            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                sourceMode: normalizeSiteSearchBridgeMode(condition.sourceMode),
                fields: condition.fields.filter(Boolean),
                summary: normalizeSearchBridgeSummary(condition.summary),
                savedAt: Number.isFinite(savedAt) ? savedAt : Date.now(),
                sourceUrl: condition.sourceUrl || ""
            };
        }

        function normalizeSiteSearchBridgeSlotStore(value) {
            const store = createEmptySiteSearchBridgeSlotStore();
            if (!value || !Array.isArray(value.slots)) return store;

            for (const slot of value.slots) {
                const id = String(slot?.id || "");
                const targetSlot = store.slots.find(item => item.id === id);
                if (!targetSlot) continue;

                targetSlot.name = normalizeSearchBridgeSlotName(slot.name || slot.title || slot.label, id);
                targetSlot.condition = normalizeSiteSearchBridgeCondition(slot.condition);
            }

            return store;
        }

        async function getSiteSearchBridgeSlotStore(storageKey) {
            const result = await chrome.storage.local.get(storageKey);
            return normalizeSiteSearchBridgeSlotStore(result[storageKey]);
        }

        async function saveSiteSearchBridgeConditionSlot(adapter, slotId) {
            const condition = adapter.collectCondition();
            if (!condition) {
                showSiteSearchBridgeNotice(adapter, "この画面では保存できる検索条件が見つかりません", "error");
                return null;
            }

            const store = await getSiteSearchBridgeSlotStore(adapter.storageKey);
            const slot = store.slots.find(item => item.id === String(slotId));
            if (!slot) return null;

            slot.condition = condition;
            await chrome.storage.local.set({ [adapter.storageKey]: store });
            return condition;
        }

        async function renameSiteSearchBridgeConditionSlot(adapter, slotId, name) {
            const store = await getSiteSearchBridgeSlotStore(adapter.storageKey);
            const slot = store.slots.find(item => item.id === String(slotId));
            if (!slot) return null;

            slot.name = normalizeSearchBridgeSlotName(name, slot.id);
            await chrome.storage.local.set({ [adapter.storageKey]: store });
            return slot.name;
        }

        async function deleteSiteSearchBridgeConditionSlot(adapter, slotId) {
            const store = await getSiteSearchBridgeSlotStore(adapter.storageKey);
            const slot = store.slots.find(item => item.id === String(slotId));
            if (!slot) return null;

            slot.condition = null;
            await chrome.storage.local.set({ [adapter.storageKey]: store });
            return store;
        }

        async function startSiteSearchBridgeSearch(adapter, targetMode, condition = null) {
            const savedCondition = normalizeSiteSearchBridgeCondition(condition);
            if (!savedCondition) {
                showSiteSearchBridgeNotice(adapter, "保存条件が空です", "error");
                return;
            }

            const targetUrl = adapter.getTargetUrl(targetMode);
            if (!targetUrl) {
                showSiteSearchBridgeNotice(adapter, "移動先の検索画面が特定できません", "error");
                return;
            }

            const pending = {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                targetMode,
                condition: savedCondition,
                createdAt: Date.now(),
                sourceUrl: location.href
            };

            await chrome.storage.local.set({ [adapter.pendingKey]: pending });
            location.href = targetUrl;
        }

        function createSiteSearchBridgeContainer(adapter) {
            if (document.getElementById(adapter.uiId)) return null;

            const wrap = document.createElement("div");
            wrap.id = adapter.uiId;
            wrap.style.position = "fixed";
            wrap.style.zIndex = "999998";
            wrap.style.fontFamily = "sans-serif";
            wrap.style.fontSize = "12px";
            Object.assign(wrap.style, adapter.position || {});
            document.body.appendChild(wrap);
            return wrap;
        }

        function styleSiteSearchBridgeLauncher(wrap) {
            wrap.style.display = "block";
            wrap.style.width = "auto";
            wrap.style.maxHeight = "";
            wrap.style.overflow = "visible";
            wrap.style.padding = "0";
            wrap.style.border = "none";
            wrap.style.borderRadius = "0";
            wrap.style.background = "transparent";
            wrap.style.boxShadow = "none";
            wrap.style.color = "#111827";
        }

        function styleSiteSearchBridgeExpandedPanel(wrap) {
            wrap.style.display = "flex";
            wrap.style.flexDirection = "column";
            wrap.style.gap = "6px";
            wrap.style.width = "min(540px, calc(100vw - 24px))";
            wrap.style.maxHeight = "calc(100vh - 90px)";
            wrap.style.overflow = "auto";
            wrap.style.padding = "8px";
            wrap.style.border = "1px solid rgba(0,0,0,0.18)";
            wrap.style.borderRadius = "8px";
            wrap.style.background = "rgba(255,255,255,0.98)";
            wrap.style.boxShadow = "0 3px 14px rgba(0,0,0,0.18)";
            wrap.style.color = "#111827";
        }

        function createSiteSearchBridgeButton(text, onClick, disabled = false) {
            const btn = createButton(text, onClick);
            btn.style.padding = "6px 8px";
            btn.style.borderRadius = "6px";
            btn.style.fontSize = "12px";
            btn.style.marginRight = "0";
            btn.style.boxShadow = "none";
            btn.style.whiteSpace = "nowrap";

            if (disabled) {
                btn.disabled = true;
                btn.style.opacity = "0.45";
                btn.style.cursor = "default";
            }

            return btn;
        }

        function formatSiteSearchBridgeSlotStatus(adapter, condition) {
            if (!condition) return "空";

            const savedAt = Number(condition.savedAt || 0);
            const date = new Date(Number.isFinite(savedAt) && savedAt > 0 ? savedAt : Date.now());
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            const hour = String(date.getHours()).padStart(2, "0");
            const minute = String(date.getMinutes()).padStart(2, "0");
            const mode = adapter.getModeLabel(condition.sourceMode) || "条件";

            return `${mode} ${month}/${day} ${hour}:${minute}`;
        }

        function getSiteSearchBridgeConditionPreview(condition) {
            if (!condition) return "未保存";

            const summary = normalizeSearchBridgeSummary(condition.summary);
            if (summary.length > 0) return formatSearchBridgePreview(summary);

            return formatSearchBridgePreview(buildSiteSearchBridgeConditionSummary(condition.fields || []));
        }

        function buildSiteSearchBridgeConditionSummary(fields) {
            const items = [];

            for (const field of fields || []) {
                if (!field) continue;

                const type = String(field.type || "").toLowerCase();
                if ((type === "checkbox" || type === "radio") && !field.checked) continue;

                const label = normalizeSearchBridgeText(field.label || field.key || field.id || field.name || "条件");
                const displayValue = normalizeSearchBridgeText(field.displayValue || field.selectedValues?.join("/") || field.value);
                if (!displayValue) continue;

                items.push(`${label}:${displayValue}`);
                if (items.length >= 5) break;
            }

            return normalizeSearchBridgeSummary(items);
        }

        function renderSiteSearchBridgeLauncher(wrap, adapter) {
            wrap.textContent = "";
            styleSiteSearchBridgeLauncher(wrap);

            const btn = createSiteSearchBridgeButton("条件保存", async () => {
                await renderSiteSearchBridgePanel(wrap, adapter);
            });
            btn.style.padding = "8px 10px";
            btn.style.borderRadius = "18px";
            btn.style.fontWeight = "700";
            btn.style.boxShadow = "0 2px 10px rgba(0,0,0,0.18)";
            wrap.appendChild(btn);
        }

        async function renderSiteSearchBridgePanel(wrap, adapter) {
            styleSiteSearchBridgeExpandedPanel(wrap);
            wrap.textContent = "保存条件を読み込み中...";

            try {
                const store = await getSiteSearchBridgeSlotStore(adapter.storageKey);
                wrap.textContent = "";

                const header = document.createElement("div");
                header.style.display = "flex";
                header.style.alignItems = "center";
                header.style.justifyContent = "space-between";
                header.style.gap = "8px";
                header.style.marginBottom = "2px";

                const title = document.createElement("div");
                title.textContent = `${adapter.title}条件保存`;
                title.style.fontWeight = "700";
                header.appendChild(title);

                header.appendChild(createSiteSearchBridgeButton("閉じる", async () => {
                    renderSiteSearchBridgeLauncher(wrap, adapter);
                }));

                wrap.appendChild(header);

                for (const slot of store.slots) {
                    wrap.appendChild(createSiteSearchBridgeSlotRow(wrap, adapter, slot));
                }
            } catch (error) {
                console.warn("MLive Linkifier: site bridge panel render failed", adapter.siteId, error);
                wrap.textContent = "保存条件を読み込めませんでした";
            }
        }

        function getSiteSearchBridgeTargetModes(adapter) {
            const currentMode = adapter.getCurrentMode();
            if (adapter.isSearchMode(currentMode)) {
                return [adapter.getOppositeMode(currentMode)];
            }

            return adapter.targetModes.slice();
        }

        function createSiteSearchBridgeSlotRow(wrap, adapter, slot) {
            const row = document.createElement("div");
            const allowSave = adapter.canSaveCurrent();
            const targetModes = getSiteSearchBridgeTargetModes(adapter);
            const actionCount = targetModes.length + (allowSave ? 1 : 0) + 1;

            row.style.display = "grid";
            row.style.gridTemplateColumns = `92px minmax(120px, 1fr) repeat(${actionCount}, auto)`;
            row.style.alignItems = "center";
            row.style.gap = "6px";
            row.style.padding = "6px";
            row.style.border = "1px solid rgba(0,0,0,0.1)";
            row.style.borderRadius = "6px";
            row.style.background = "#f9fafb";

            row.appendChild(createSearchBridgeSlotNameElement(slot, async (nextName) => {
                await renameSiteSearchBridgeConditionSlot(adapter, slot.id, nextName);
                showSiteSearchBridgeNotice(adapter, `保存${slot.id}の名前を変更しました`);
                await renderSiteSearchBridgePanel(wrap, adapter);
            }));

            const previewText = getSiteSearchBridgeConditionPreview(slot.condition);
            row.appendChild(createSearchBridgeSlotStatusBlock(
                formatSiteSearchBridgeSlotStatus(adapter, slot.condition),
                previewText,
                slot.condition?.sourceUrl || previewText
            ));

            if (allowSave) {
                row.appendChild(createSiteSearchBridgeButton("この条件を保存", async () => {
                    const condition = await saveSiteSearchBridgeConditionSlot(adapter, slot.id);
                    if (condition) showSiteSearchBridgeNotice(adapter, `保存${slot.id}に保存しました`);
                    await renderSiteSearchBridgePanel(wrap, adapter);
                }));
            }

            for (const targetMode of targetModes) {
                row.appendChild(createSiteSearchBridgeButton(`${adapter.getModeLabel(targetMode)}へ`, async () => {
                    await startSiteSearchBridgeSearch(adapter, targetMode, slot.condition);
                }, !slot.condition));
            }

            row.appendChild(createSiteSearchBridgeButton("削除", async () => {
                if (!confirm(`保存${slot.id}を削除しますか？`)) return;

                await deleteSiteSearchBridgeConditionSlot(adapter, slot.id);
                showSiteSearchBridgeNotice(adapter, `保存${slot.id}を削除しました`);
                await renderSiteSearchBridgePanel(wrap, adapter);
            }, !slot.condition));

            return row;
        }

        function showSiteSearchBridgeNotice(adapter, message, type = "info") {
            const id = `${adapter.siteId}-search-bridge-notice`;
            const old = document.getElementById(id);
            if (old) old.remove();

            const notice = document.createElement("div");
            notice.id = id;
            notice.textContent = message;
            notice.style.position = "fixed";
            notice.style.right = "16px";
            notice.style.bottom = "16px";
            notice.style.zIndex = "1000000";
            notice.style.maxWidth = "min(420px, calc(100vw - 32px))";
            notice.style.padding = "10px 12px";
            notice.style.borderRadius = "8px";
            notice.style.boxShadow = "0 4px 18px rgba(0,0,0,0.25)";
            notice.style.fontSize = "13px";
            notice.style.lineHeight = "1.4";
            notice.style.fontFamily = "sans-serif";
            notice.style.color = "white";
            notice.style.background = type === "error" ? "#b91c1c" : "#1f2937";
            document.body.appendChild(notice);

            setTimeout(() => notice.remove(), 4500);
        }

        function installSiteSearchBridge(adapter) {
            if (!document.body || !adapter.shouldInstall()) return;
            if (document.getElementById(adapter.uiId)) return;

            const wrap = createSiteSearchBridgeContainer(adapter);
            if (!wrap) return;

            renderSiteSearchBridgeLauncher(wrap, adapter);
        }

        async function applySiteSearchBridgePending(adapter) {
            if (adapter.state.pendingRunning || adapter.state.pendingApplied) return;

            const currentMode = adapter.getCurrentMode();
            if (!adapter.isSearchMode(currentMode) || !adapter.isRestoreReady()) return;

            adapter.state.pendingRunning = true;
            try {
                const result = await chrome.storage.local.get(adapter.pendingKey);
                const pending = result[adapter.pendingKey];
                if (!pending) return;

                if (pending.version !== MLIVE_SEARCH_BRIDGE_VERSION || !pending.condition) {
                    await chrome.storage.local.remove(adapter.pendingKey);
                    return;
                }

                if (Date.now() - Number(pending.createdAt || 0) > 10 * 60 * 1000) {
                    await chrome.storage.local.remove(adapter.pendingKey);
                    return;
                }

                if (normalizeSiteSearchBridgeMode(pending.targetMode) !== currentMode) return;

                const condition = normalizeSiteSearchBridgeCondition(pending.condition);
                if (!condition) {
                    await chrome.storage.local.remove(adapter.pendingKey);
                    return;
                }

                if (typeof adapter.beforeRestore === "function") {
                    adapter.beforeRestore(currentMode);
                }
                adapter.restoreCondition(condition, currentMode);
                adapter.state.pendingApplied = true;
                await chrome.storage.local.remove(adapter.pendingKey);

                showSiteSearchBridgeNotice(adapter, `保存条件で${adapter.getModeLabel(currentMode)}検索します`);
                setTimeout(() => adapter.submitSearch(), 160);
            } catch (error) {
                console.warn("MLive Linkifier: site bridge pending search failed", adapter.siteId, error);
                showSiteSearchBridgeNotice(adapter, "保存条件の検索に失敗しました", "error");
            } finally {
                adapter.state.pendingRunning = false;
            }
        }

        function isSearchBridgeSavableControl(el) {
            if (!el || el.disabled) return false;
            if (!el.id && !el.name) return false;

            const type = String(el.type || "").toLowerCase();
            if (/^(button|submit|reset|file|image|password|hidden)$/i.test(type)) return false;

            const marker = `${el.id || ""} ${el.name || ""}`.toLowerCase();
            if (/(requestverificationtoken|csrf|token|password)/i.test(marker)) return false;

            return /^(INPUT|SELECT|TEXTAREA)$/i.test(el.tagName);
        }

        function getSearchBridgeControlLabel(el) {
            if (!el) return "";

            const candidates = [];
            if (el.labels) {
                Array.from(el.labels).forEach(label => candidates.push(label.textContent));
            }

            if (el.id) {
                const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
                if (label) candidates.push(label.textContent);
            }

            candidates.push(
                el.getAttribute("aria-label"),
                el.getAttribute("placeholder"),
                el.getAttribute("title")
            );

            const tableCell = el.closest("td,th");
            const tableRow = el.closest("tr");
            if (tableRow && tableCell) {
                const cells = Array.from(tableRow.children);
                const index = cells.indexOf(tableCell);
                if (index > 0) candidates.push(cells[index - 1]?.textContent);
            }

            const parentText = el.closest("label,li,td,div")?.textContent;
            candidates.push(parentText);

            const labelText = candidates
                .map(value => normalizeSearchBridgeText(value))
                .find(value => value && value !== normalizeSearchBridgeText(el.value));

            return labelText ? labelText.slice(0, 28) : "";
        }

        function getSearchBridgeControlDisplayValue(el) {
            if (!el || !("value" in el)) return "";

            const type = String(el.type || "").toLowerCase();
            if (type === "checkbox" || type === "radio") {
                if (!el.checked) return "";
                return normalizeSearchBridgeText(getSearchBridgeControlLabel(el) || el.value);
            }

            if (el.tagName === "SELECT") {
                const selectedOptions = el.multiple
                    ? Array.from(el.selectedOptions)
                    : Array.from(el.options || []).filter(option => option.selected);

                return selectedOptions
                    .map(option => normalizeSearchBridgeText(option.textContent || option.value))
                    .filter(Boolean)
                    .join("/");
            }

            return normalizeSearchBridgeText(el.value);
        }

        function createSearchBridgeFieldRecord(el, extra = {}) {
            if (!isSearchBridgeSavableControl(el)) return null;

            const type = String(el.type || "").toLowerCase();
            const record = {
                id: el.id || "",
                name: el.name || "",
                tag: String(el.tagName || "").toLowerCase(),
                type,
                value: "value" in el ? String(el.value ?? "") : "",
                label: getSearchBridgeControlLabel(el),
                displayValue: getSearchBridgeControlDisplayValue(el),
                ...extra
            };

            if (type === "checkbox" || type === "radio") {
                record.checked = !!el.checked;
                record.value = String(el.value ?? "");
            } else if (el.tagName === "SELECT" && el.multiple) {
                record.selectedValues = Array.from(el.selectedOptions).map(option => String(option.value ?? ""));
            }

            return record;
        }

        function applySearchBridgeFieldRecord(el, record) {
            if (!el || !record) return;

            const type = String(el.type || "").toLowerCase();
            if (type === "checkbox" || type === "radio") {
                el.checked = !!record.checked;
            } else if (el.tagName === "SELECT" && el.multiple && Array.isArray(record.selectedValues)) {
                const selected = new Set(record.selectedValues.map(value => String(value ?? "")));
                Array.from(el.options).forEach(option => {
                    option.selected = selected.has(String(option.value ?? ""));
                });
            } else if ("value" in el) {
                el.value = String(record.value ?? "");
            }

            dispatchSearchBridgeFieldEvents(el);
        }

        function dispatchSearchBridgeFieldEvents(el) {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
        }

        function findSearchBridgeControlByName(record) {
            if (!record.name) return null;

            const candidates = Array.from(document.querySelectorAll("input,select,textarea"))
                .filter(el => el.name === record.name);

            if (record.type === "checkbox" || record.type === "radio") {
                return candidates.find(el => String(el.value ?? "") === String(record.value ?? "")) || null;
            }

            return candidates[0] || null;
        }

        function findSearchBridgeButtonByText(text, root = document) {
            const expected = normalizeSearchBridgeText(text);
            const candidates = Array.from(root.querySelectorAll("button,input[type='button'],input[type='submit'],a"));

            return candidates.find(el => {
                const actual = normalizeSearchBridgeText(el.textContent || el.value || el.getAttribute("aria-label"));
                return actual === expected;
            }) || null;
        }

        function findVisibleSearchBridgeButtonByText(text, root = document) {
            const expected = normalizeSearchBridgeText(text);
            const candidates = Array.from(root.querySelectorAll("button,input[type='button'],input[type='submit'],a"));

            return candidates.find(el => {
                const actual = normalizeSearchBridgeText(el.textContent || el.value || el.getAttribute("aria-label"));
                return actual === expected && isSearchBridgeElementVisible(el);
            }) || null;
        }

        function isSearchBridgeElementVisible(el) {
            if (!el) return false;
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        }

        function clickSearchBridgeElement(el) {
            if (!el) return false;
            el.click();
            return true;
        }

        // ===== Arai 検索条件ブリッジ =====

        function getAraiSearchBridgeMode() {
            const path = location.pathname.toLowerCase().replace(/\/+$/, "");
            const search = location.search.toLowerCase();

            if (path.endsWith("/01_search.html")) return "listing";
            if (path.endsWith("/04_information.html") && /(?:^\?|[?&])id=0(?:[=&]|$)/.test(search)) return "market";

            return "";
        }

        function getAraiSearchBridgeModeLabel(mode) {
            if (mode === "market") return "相場";
            if (mode === "listing") return "出品";
            return "条件";
        }

        function getAraiOppositeSearchBridgeMode(mode) {
            return mode === "market" ? "listing" : "market";
        }

        function isAraiSearchBridgeMode(mode) {
            return mode === "listing" || mode === "market";
        }

        function shouldInstallAraiSearchBridge() {
            const mode = getAraiSearchBridgeMode();
            if (isAraiSearchBridgeMode(mode)) return true;

            const path = location.pathname.toLowerCase();
            if (path.includes("/00_")) return false;

            return path.includes("/01_") ||
                path.includes("/04_") ||
                !!document.querySelector("#spList,#mainGazou,ul#gazou");
        }

        function collectAraiSearchBridgeCondition() {
            const sourceMode = getAraiSearchBridgeMode();
            if (!isAraiSearchBridgeMode(sourceMode)) return null;

            const fields = Array.from(document.querySelectorAll("input,select,textarea"))
                .map(el => createSearchBridgeFieldRecord(el))
                .filter(Boolean);

            if (fields.length === 0) return null;

            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                sourceMode,
                fields,
                summary: buildSiteSearchBridgeConditionSummary(fields),
                savedAt: Date.now(),
                sourceUrl: location.href
            };
        }

        function findAraiSearchBridgeControl(record) {
            if (record.id) {
                const byId = document.getElementById(record.id);
                if (byId) return byId;
            }

            return findSearchBridgeControlByName(record);
        }

        function restoreAraiSearchBridgeCondition(condition) {
            for (const record of condition.fields || []) {
                const target = findAraiSearchBridgeControl(record);
                if (!target) continue;

                applySearchBridgeFieldRecord(target, record);
            }
        }

        function getAraiSearchBridgeTargetUrl(mode) {
            if (mode === "listing") return new URL("/01_search.html", location.origin).toString();
            if (mode === "market") return new URL("/04_information.html?id=0=", location.origin).toString();
            return "";
        }

        function activateAraiSearchBridgeConditionTab(mode) {
            const tabId = mode === "market" ? "johoTab3" : "tbSearchTab5";
            const tab = document.getElementById(tabId) ||
                Array.from(document.querySelectorAll("a,button")).find(el => normalizeSearchBridgeText(el.textContent) === "条件指定");

            if (isSearchBridgeElementVisible(tab)) {
                tab.click();
            }
        }

        function getVisibleAraiSearchButton(ids) {
            for (const id of ids) {
                const button = document.getElementById(id);
                if (isSearchBridgeElementVisible(button)) return button;
            }

            return null;
        }

        function clickAraiVenueSearchIfReady() {
            const venueButton = getVisibleAraiSearchButton(["btn_kaijo", "btKaijo_exe"]);
            if (venueButton) return clickSearchBridgeElement(venueButton);

            const venueArea = document.getElementById("tbKaijoList");
            if (isSearchBridgeElementVisible(venueArea)) {
                const searchButton = Array.from(venueArea.querySelectorAll("button,input[type='button'],input[type='submit'],a"))
                    .find(el => isSearchBridgeElementVisible(el) && /検索|次へ/.test(normalizeSearchBridgeText(el.textContent || el.value)));
                if (searchButton) return clickSearchBridgeElement(searchButton);
            }

            return false;
        }

        function scheduleAraiVenueSearchAttempts() {
            [250, 800, 1600, 2600].forEach(delay => {
                setTimeout(() => {
                    clickAraiVenueSearchIfReady();
                }, delay);
            });
        }

        function submitAraiSearchBridge() {
            if (clickAraiVenueSearchIfReady()) return;

            const conditionButton = getVisibleAraiSearchButton(["btSearch", "btKaijo_exe"]) ||
                findVisibleSearchBridgeButtonByText("この条件で検索") ||
                findVisibleSearchBridgeButtonByText("次へ");

            if (isSearchBridgeElementVisible(conditionButton)) {
                conditionButton.click();
                scheduleAraiVenueSearchAttempts();
                return;
            }

            showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "検索ボタンが見つかりません", "error");
        }

        function getAraiSearchBridgeAdapter() {
            return {
                siteId: "arai",
                title: "Arai",
                storageKey: ARAI_SEARCH_BRIDGE_SLOTS_KEY,
                pendingKey: ARAI_SEARCH_BRIDGE_PENDING_KEY,
                uiId: "arai-search-bridge-ui",
                position: { right: "12px", bottom: "78px" },
                state: siteSearchBridgeState.arai,
                targetModes: ["listing", "market"],
                shouldInstall: shouldInstallAraiSearchBridge,
                getCurrentMode: getAraiSearchBridgeMode,
                getModeLabel: getAraiSearchBridgeModeLabel,
                getOppositeMode: getAraiOppositeSearchBridgeMode,
                isSearchMode: isAraiSearchBridgeMode,
                canSaveCurrent: () => isAraiSearchBridgeMode(getAraiSearchBridgeMode()) && document.querySelectorAll("input,select,textarea").length > 0,
                collectCondition: collectAraiSearchBridgeCondition,
                beforeRestore: activateAraiSearchBridgeConditionTab,
                restoreCondition: restoreAraiSearchBridgeCondition,
                getTargetUrl: getAraiSearchBridgeTargetUrl,
                isRestoreReady: () => isAraiSearchBridgeMode(getAraiSearchBridgeMode()) && document.querySelectorAll("input,select,textarea").length > 0,
                submitSearch: submitAraiSearchBridge
            };
        }

        function processAraiSearchBridge() {
            const adapter = getAraiSearchBridgeAdapter();
            installSiteSearchBridge(adapter);
            applySiteSearchBridgePending(adapter);
        }

        // ===== JU 検索条件ブリッジ =====

        function getNormalizedJuSearchBridgePath() {
            return location.pathname.toLowerCase().replace(/\/+$/, "");
        }

        function getJuSearchBridgeModeFromForm(form) {
            const id = String(form?.id || "");
            const action = String(form?.action || "").toLowerCase();

            if (id === "b5-Form" || /\/junaviweb\/carsearch(?:[/?#]|$)/i.test(action)) return "listing";
            if (id === "b3-Form" || /\/junaviweb\/marketpricesearch(?:[/?#]|$)/i.test(action)) return "market";

            return "";
        }

        function getJuSearchBridgeMode() {
            const path = getNormalizedJuSearchBridgePath();
            if (path.endsWith("/junaviweb/carsearch")) return "listing";
            if (path.endsWith("/junaviweb/marketpricesearch")) return "market";

            for (const form of Array.from(document.querySelectorAll("form"))) {
                const mode = getJuSearchBridgeModeFromForm(form);
                if (mode) return mode;
            }

            return "";
        }

        function getJuSearchBridgeModeLabel(mode) {
            if (mode === "market") return "相場";
            if (mode === "listing") return "出品";
            return "条件";
        }

        function getJuOppositeSearchBridgeMode(mode) {
            return mode === "market" ? "listing" : "market";
        }

        function isJuSearchBridgeMode(mode) {
            return mode === "listing" || mode === "market";
        }

        function getJuSearchBridgeForm(mode = "") {
            const forms = Array.from(document.querySelectorAll("form"));
            const exact = document.querySelector("#b5-Form") || document.querySelector("#b3-Form");
            if (!mode && exact) return exact;

            const targetMode = mode || getJuSearchBridgeMode();
            if (targetMode) {
                const byMode = forms.find(form => getJuSearchBridgeModeFromForm(form) === targetMode);
                if (byMode) return byMode;
            }

            return exact || forms.find(form => /^b\d+-Form$/.test(form.id || "")) || forms[0] || null;
        }

        function shouldInstallJuSearchBridge() {
            const mode = getJuSearchBridgeMode();
            if (isJuSearchBridgeMode(mode)) return true;

            const path = getNormalizedJuSearchBridgePath();
            return path.includes("/junaviweb/") &&
                !path.endsWith("/junaviweb/top") &&
                /(search|marketprice|detail|list)/i.test(path);
        }

        function getJuSearchBridgeFieldKey(el) {
            const id = el.id || "";
            const match = id.match(/^b\d+-(.+)$/);
            if (match) return match[1];

            return id || el.name || "";
        }

        function collectJuSearchBridgeCondition() {
            const sourceMode = getJuSearchBridgeMode();
            const form = getJuSearchBridgeForm(sourceMode);
            if (!isJuSearchBridgeMode(sourceMode) || !form) return null;

            const fields = Array.from(form.querySelectorAll("input,select,textarea"))
                .map(el => {
                    const key = getJuSearchBridgeFieldKey(el);
                    if (!key) return null;

                    return createSearchBridgeFieldRecord(el, { key });
                })
                .filter(Boolean);

            if (fields.length === 0) return null;

            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                sourceMode,
                fields,
                summary: buildSiteSearchBridgeConditionSummary(fields),
                savedAt: Date.now(),
                sourceUrl: location.href
            };
        }

        function getJuSearchBridgeTargetPrefix(mode) {
            const form = getJuSearchBridgeForm(mode);
            const match = String(form?.id || "").match(/^(b\d+)-Form$/);
            if (match) return `${match[1]}-`;

            return mode === "market" ? "b3-" : "b5-";
        }

        function restoreJuSearchBridgeCondition(condition, targetMode) {
            const prefix = getJuSearchBridgeTargetPrefix(targetMode);
            const form = getJuSearchBridgeForm(targetMode) || document;

            for (const record of condition.fields || []) {
                const key = record.key || getJuSearchBridgeFieldKey(record);
                if (!key) continue;

                const target = document.getElementById(`${prefix}${key}`) ||
                    form.querySelector?.(`[id$="-${CSS.escape(key)}"]`) ||
                    document.querySelector(`[id$="-${CSS.escape(key)}"]`);
                if (!target) continue;

                applySearchBridgeFieldRecord(target, record);
            }
        }

        function getJuSearchBridgeTargetUrl(mode) {
            if (mode === "listing") return new URL("/JUNaviWEB/CarSearch", location.origin).toString();
            if (mode === "market") return new URL("/JUNaviWEB/MarketPriceSearch", location.origin).toString();
            return "";
        }

        function submitJuSearchBridge() {
            const form = getJuSearchBridgeForm(getJuSearchBridgeMode());
            const button = findSearchBridgeButtonByText("この条件で検索", form || document);

            if (button) {
                button.click();
                return;
            }

            if (form && typeof form.requestSubmit === "function") {
                form.requestSubmit();
                return;
            }

            showSiteSearchBridgeNotice(getJuSearchBridgeAdapter(), "検索ボタンが見つかりません", "error");
        }

        function getJuSearchBridgeAdapter() {
            return {
                siteId: "ju",
                title: "JU",
                storageKey: JU_SEARCH_BRIDGE_SLOTS_KEY,
                pendingKey: JU_SEARCH_BRIDGE_PENDING_KEY,
                uiId: "ju-search-bridge-ui",
                position: { right: "12px", bottom: "112px" },
                state: siteSearchBridgeState.ju,
                targetModes: ["listing", "market"],
                shouldInstall: shouldInstallJuSearchBridge,
                getCurrentMode: getJuSearchBridgeMode,
                getModeLabel: getJuSearchBridgeModeLabel,
                getOppositeMode: getJuOppositeSearchBridgeMode,
                isSearchMode: isJuSearchBridgeMode,
                canSaveCurrent: () => {
                    const mode = getJuSearchBridgeMode();
                    return isJuSearchBridgeMode(mode) && !!getJuSearchBridgeForm(mode);
                },
                collectCondition: collectJuSearchBridgeCondition,
                restoreCondition: restoreJuSearchBridgeCondition,
                getTargetUrl: getJuSearchBridgeTargetUrl,
                isRestoreReady: () => {
                    const mode = getJuSearchBridgeMode();
                    return isJuSearchBridgeMode(mode) && !!getJuSearchBridgeForm(mode);
                },
                submitSearch: submitJuSearchBridge
            };
        }

        function processJuSearchBridge() {
            const adapter = getJuSearchBridgeAdapter();
            installSiteSearchBridge(adapter);
            applySiteSearchBridgePending(adapter);
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
            processAraiSearchBridge();
            // window.open override is handled in the entry point at document_start


            // 2. 画像保存ボタンの追加
            const boxId = "araiaa-save-ui";
            if (document.getElementById(boxId)) return;

            // 画像URL収集
            function collect() {
                function toImageUrl(value) {
                    if (!value || !/\.(?:jpe?g|png|webp|gif|bmp)(?:[?#]|$)/i.test(value)) return null;

                    try {
                        return new URL(value, location.href).toString();
                    } catch {
                        return null;
                    }
                }

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
                                .map(toImageUrl)
                                .filter(Boolean);

                            if (urls.length > 0) return Array.from(new Set(urls));
                        }
                    }
                }

                // パターン2: 詳細ページのサムネイルリスト (ul#gazou)
                const detailImgs = Array.from(document.querySelectorAll("ul#gazou img:not(.img_4k)"));
                if (detailImgs.length > 0) {
                    const urls = detailImgs
                        .map(img => img.src) // srcをそのまま使う (クエリ付きでもOK、保存時にファイル名生成で除去されるはず)
                        .filter(Boolean)
                        .map(toImageUrl)
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
                        .map(toImageUrl)
                        .filter(Boolean);
                    return Array.from(new Set(urls));
                }

                return [];
            }

            function isAraiSheetImageUrl(url) {
                try {
                    return /\/OH\//i.test(new URL(url, location.href).pathname);
                } catch {
                    return false;
                }
            }

            function collectAraiImageSets() {
                const allUrls = collect();
                const sheetUrl = allUrls.find(isAraiSheetImageUrl) || "";
                const vehicleUrls = sheetUrl ? allUrls.filter(url => url !== sheetUrl) : allUrls;

                return { allUrls, vehicleUrls, sheetUrl };
            }

            function normalizeAraiText(value) {
                return (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
            }

            function textFromSelector(selector) {
                const el = document.querySelector(selector);
                if (!el) return "";

                if ("value" in el && el.value) {
                    return normalizeAraiText(el.value);
                }

                return normalizeAraiText(el.textContent || el.getAttribute("title") || el.getAttribute("alt"));
            }

            function cleanAraiInfoValue(value) {
                return normalizeAraiText(value)
                    .replace(/^[：:\-=]+/, "")
                    .replace(/[：:\-=]+$/, "")
                    .trim();
            }

            function escapeRegex(value) {
                return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            }

            function findAraiValueByLabels(labels) {
                const labelPattern = new RegExp(labels.map(escapeRegex).join("|"), "i");

                for (const dl of Array.from(document.querySelectorAll("dl"))) {
                    const label = normalizeAraiText(dl.querySelector("dt")?.textContent);
                    const value = normalizeAraiText(dl.querySelector("dd")?.textContent);
                    if (label && value && labelPattern.test(label)) return value;
                }

                for (const row of Array.from(document.querySelectorAll("tr"))) {
                    const cells = Array.from(row.children).filter(el => /^(TH|TD)$/i.test(el.tagName));
                    if (cells.length < 2) continue;

                    const label = normalizeAraiText(cells[0].textContent);
                    const value = normalizeAraiText(cells.slice(1).map(el => el.textContent).join(" "));
                    if (label && value && labelPattern.test(label)) return value;
                }

                const lines = (document.body?.innerText || "")
                    .replace(/\u00a0/g, " ")
                    .split(/[\r\n]+/)
                    .map(line => normalizeAraiText(line))
                    .filter(Boolean);

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    const match = labels.find(label => line.includes(label));
                    if (!match) continue;

                    const afterLabel = cleanAraiInfoValue(line.slice(line.indexOf(match) + match.length));
                    if (afterLabel) return afterLabel;

                    const nextLine = lines[i + 1];
                    if (nextLine && !labels.some(label => nextLine.includes(label))) return nextLine;
                }

                return "";
            }

            function getAraiSaveMeta() {
                const auctionNo = cleanAraiInfoValue(
                    textFromSelector("#sno") ||
                    textFromSelector("#sp02") ||
                    findAraiValueByLabels(["出品番号", "出品No", "出品NO", "出品Ｎｏ", "出品ＮＯ", "EntryNo.", "Entry No", "SNO"])
                );
                const carName = cleanAraiInfoValue(
                    textFromSelector("#syamei") ||
                    findAraiValueByLabels(["車名", "車種", "車両名", "Name", "Vehicle"])
                );
                const saveBase = sanitizeDownloadName([auctionNo, carName].filter(Boolean).join("_"), "araiaa_unknown");

                if (!auctionNo || !carName) {
                    console.warn("MLive Linkifier: Arai save name is missing a field", { auctionNo, carName, saveBase });
                }

                return {
                    filenameBase: saveBase,
                    folderCode: `araiaa/${saveBase}`
                };
            }

            function imageExtensionFromUrl(url) {
                const base = filenameFromUrl(url, "image.jpg", true);
                const match = base.match(/\.(jpe?g|png|webp|gif|bmp)$/i);
                if (!match) return ".jpg";

                return `.${match[1].toLowerCase().replace("jpeg", "jpg")}`;
            }

            async function downloadAraiImages(urls, saveMeta) {
                for (let i = 0; i < urls.length; i++) {
                    const num = String(i + 1).padStart(2, "0");
                    const extension = imageExtensionFromUrl(urls[i]);
                    await downloadOne(urls[i], saveMeta.folderCode, `${saveMeta.filenameBase}_${num}${extension}`);
                    await new Promise(r => setTimeout(r, 250));
                }
            }

            async function downloadAraiFullSet(imageSets, saveMeta) {
                if (imageSets.sheetUrl) {
                    await downloadOne(imageSets.sheetUrl, saveMeta.folderCode, `${saveMeta.filenameBase}_出品票.jpg`);
                    await new Promise(r => setTimeout(r, 250));
                }

                if (imageSets.vehicleUrls.length > 0) {
                    await downloadAraiImages(imageSets.vehicleUrls, saveMeta);
                }
            }

            const initialImages = collectAraiImageSets();
            if (initialImages.allUrls.length === 0) return;

            const wrap = createFloatingContainer(boxId);
            if (!wrap) return;

            // 全画像保存
            // ①枚目保存
            wrap.appendChild(createButton("出品票保存", async () => {
                const current = collectAraiImageSets();
                if (!current.sheetUrl) {
                    console.warn("MLive Linkifier: Arai sheet image was not found");
                    return;
                }

                const saveMeta = getAraiSaveMeta();
                await downloadOne(current.sheetUrl, saveMeta.folderCode, `${saveMeta.filenameBase}_出品票.jpg`);
            }));

            // 数枚保存 (最初から6枚 + 最後の画像)
            wrap.appendChild(createButton("Pickup(車6+票)", async () => {
                const current = collectAraiImageSets();
                if (current.vehicleUrls.length === 0 && !current.sheetUrl) return;

                const saveMeta = getAraiSaveMeta();
                await downloadAraiImages(current.vehicleUrls.slice(0, 6), saveMeta);

                if (current.sheetUrl) {
                    await downloadOne(current.sheetUrl, saveMeta.folderCode, `${saveMeta.filenameBase}_出品票.jpg`);
                }
            }));

            wrap.appendChild(createButton(`全保存(票+車${initialImages.vehicleUrls.length})`, async () => {
                const current = collectAraiImageSets();
                if (current.vehicleUrls.length === 0 && !current.sheetUrl) return;
                await downloadAraiFullSet(current, getAraiSaveMeta());
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
            processJuSearchBridge();
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

                function collectJuNaviImageSets() {
                    const allUrls = collect();
                    return {
                        allUrls,
                        sheetUrl: allUrls[0] || "",
                        vehicleUrls: allUrls.slice(1)
                    };
                }

                function normalizeJuNaviText(value) {
                    return (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
                }

                function findJuNaviValueByLabels(labels) {
                    const lines = (root.innerText || "")
                        .replace(/\u00a0/g, " ")
                        .split(/[\r\n]+/)
                        .map(line => normalizeJuNaviText(line))
                        .filter(Boolean);

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i];
                        const label = labels.find(item => line.includes(item));
                        if (!label) continue;

                        const afterLabel = normalizeJuNaviText(line.slice(line.indexOf(label) + label.length));
                        if (afterLabel) return afterLabel;

                        const nextLine = lines[i + 1];
                        if (nextLine && !labels.some(item => nextLine.includes(item))) return nextLine;
                    }

                    return "";
                }

                function cleanJuNaviAuctionNo(value) {
                    const text = normalizeJuNaviText(value).replace(/\s*号車$/, "");
                    const match = text.match(/[A-Z]?\d{2,}(?:-\d+)?/i);
                    return match ? match[0] : text;
                }

                function getJuNaviAuctionNo() {
                    const direct = normalizeJuNaviText(root.querySelector(".junaviweb-detail-shuppinno span")?.textContent);
                    if (direct) return cleanJuNaviAuctionNo(direct);

                    const params = new URL(location.href).searchParams;
                    const paramValue = params.get("seriNo") || params.get("sno") || params.get("aucNo") || params.get("auctionNo") || params.get("exhibitNo") || "";
                    const labelValue = findJuNaviValueByLabels(["出品番号", "出品No", "出品NO", "出品Ｎｏ", "出品ＮＯ", "号車"]);

                    return cleanJuNaviAuctionNo(labelValue || paramValue);
                }

                // 車名取得 (このスクリーン内限定)
                function getCarName() {
                    let el = root.querySelector(".junaviweb-detail-car-list-row-carname-grede-text");
                    if (!el) {
                        el = root.querySelector(".junaviweb-detail-carname-grade");
                    }
                    if (!el) return "unknown";
                    return normalizeJuNaviText(el.textContent);
                }

                function getJuNaviSaveMeta() {
                    const auctionNo = getJuNaviAuctionNo();
                    const carName = getCarName();
                    const parts = [auctionNo, carName].filter(value => value && value !== "unknown");
                    const filenameBase = sanitizeDownloadName(parts.join("_"), "junavi_unknown");

                    if (!auctionNo || !carName || carName === "unknown") {
                        console.warn("MLive Linkifier: JU Navi save name is missing a field", { auctionNo, carName, filenameBase });
                    }

                    return {
                        filenameBase,
                        folderPath: `junavi/${filenameBase}`
                    };
                }

                const initialImages = collectJuNaviImageSets();
                if (initialImages.allUrls.length === 0) return;

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

                async function downloadJuNaviBlob(blobUrl, saveMeta, filename) {
                    const dataUrl = await blobToDataUrl(blobUrl);
                    if (dataUrl) {
                        await downloadOne(dataUrl, saveMeta.folderPath, filename);
                    }
                }

                async function downloadJuNaviImages(blobUrls, saveMeta) {
                    for (let i = 0; i < blobUrls.length; i++) {
                        const num = String(i + 1).padStart(2, "0");
                        await downloadJuNaviBlob(blobUrls[i], saveMeta, `${saveMeta.filenameBase}_${num}.jpg`);
                        await new Promise(r => setTimeout(r, 250));
                    }
                }

                async function downloadJuNaviFullSet(imageSets, saveMeta) {
                    if (imageSets.sheetUrl) {
                        await downloadJuNaviBlob(imageSets.sheetUrl, saveMeta, `${saveMeta.filenameBase}_出品票.jpg`);
                        await new Promise(r => setTimeout(r, 250));
                    }

                    if (imageSets.vehicleUrls.length > 0) {
                        await downloadJuNaviImages(imageSets.vehicleUrls, saveMeta);
                    }
                }

                // ボタン: 出品票保存
                wrap.appendChild(createButton("出品票保存", async () => {
                    const current = collectJuNaviImageSets();
                    if (!current.sheetUrl) return;

                    const saveMeta = getJuNaviSaveMeta();
                    await downloadJuNaviBlob(current.sheetUrl, saveMeta, `${saveMeta.filenameBase}_出品票.jpg`);
                }));

                wrap.appendChild(createButton("Pickup(車6+票)", async () => {
                    const current = collectJuNaviImageSets();
                    if (current.vehicleUrls.length === 0 && !current.sheetUrl) return;

                    const saveMeta = getJuNaviSaveMeta();
                    await downloadJuNaviImages(current.vehicleUrls.slice(0, 6), saveMeta);

                    if (current.sheetUrl) {
                        await downloadJuNaviBlob(current.sheetUrl, saveMeta, `${saveMeta.filenameBase}_出品票.jpg`);
                    }
                }));

                // ボタン: 全保存
                wrap.appendChild(createButton(`全保存(票+車${initialImages.vehicleUrls.length})`, async () => {
                    const current = collectJuNaviImageSets();
                    if (current.vehicleUrls.length === 0 && !current.sheetUrl) return;

                    await downloadJuNaviFullSet(current, getJuNaviSaveMeta());
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
