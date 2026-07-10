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
        const ARAI_SEARCH_BRIDGE_LOG_KEY = "araiSearchBridgeDebugLog";
        const ARAI_SEARCH_BRIDGE_RUN_KEY = "araiSearchBridgeRunState";
        const ARAI_NAME_DIAGNOSTIC_KEY = "araiNameCascadeDiagnostic";
        const JU_SELECTION_DIAGNOSTIC_KEY = "juSelectionCascadeDiagnostic";
        const ARAI_PENDING_FALLBACK_ATTR = "data-mlive-arai-pending-fallback";
        const ARAI_PENDING_FALLBACK_COMMAND_ATTR = "data-mlive-arai-pending-fallback-command";
        const ARAI_PENDING_FALLBACK_RESULT_ATTR = "data-mlive-arai-pending-fallback-result";
        const ARAI_PENDING_FALLBACK_EVENT = "mlive-linkifier:arai-pending-fallback";
        const ARAI_NAME_DIAGNOSTIC_ACTIVE_ATTR = "data-mlive-arai-name-diagnostic-active";
        const ARAI_NAME_DIAGNOSTIC_COMMAND_ATTR = "data-mlive-arai-name-diagnostic-command";
        const ARAI_NAME_DIAGNOSTIC_RESULT_ATTR = "data-mlive-arai-name-diagnostic-result";
        const ARAI_NAME_DIAGNOSTIC_ALERT_ATTR = "data-mlive-arai-name-diagnostic-alert";
        const ARAI_NAME_DIAGNOSTIC_SUMMARY_ATTR = "data-mlive-arai-name-diagnostic-summary";
        const JU_SELECTION_DIAGNOSTIC_SUMMARY_ATTR = "data-mlive-ju-selection-diagnostic-summary";
        const ARAI_NAME_DIAGNOSTIC_EVENT = "mlive-linkifier:arai-name-diagnostic";
        const ARAI_NAME_DIAGNOSTIC_ALERT_EVENT = "mlive-linkifier:arai-name-diagnostic-alert";
        const ARAI_SEARCH_BRIDGE_LOG_LIMIT = 80;
        const ARAI_NAME_DIAGNOSTIC_STEP_LIMIT = 60;
        const JU_SELECTION_DIAGNOSTIC_STEP_LIMIT = 80;
        const SEARCH_BRIDGE_PENDING_MAX_AGE_MS = 10 * 60 * 1000;
        const JU_SEARCH_BRIDGE_SLOTS_KEY = "juSearchBridgeSlots";
        const JU_SEARCH_BRIDGE_PENDING_KEY = "juSearchBridgePending";
        const MLIVE_NORMAL_AA_CODES = new Set(["131", "220", "132"]);
        let mliveSearchBridgePendingRunning = false;
        let mliveSearchBridgePendingApplied = false;
        const siteSearchBridgeState = {
            arai: {
                pendingRunning: false,
                pendingApplied: false,
                pendingRetryTimer: null
            },
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
            Object.assign(btn.style, adapter.launcherStyle || {});
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

                if (Date.now() - Number(pending.createdAt || 0) > SEARCH_BRIDGE_PENDING_MAX_AGE_MS) {
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

        function normalizeSiteSearchBridgeKind(value) {
            const text = String(value || "").trim();
            return text === "name" || text === "condition" ? text : "";
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

        function normalizeAraiNameCascade(value) {
            const steps = Array.isArray(value?.steps) ? value.steps : [];
            const normalizedSteps = steps
                .map(step => ({
                    kind: String(step?.kind || "").trim(),
                    sourceId: String(step?.sourceId || "").trim(),
                    inputId: String(step?.inputId || "").trim(),
                    inputValue: String(step?.inputValue || "").trim(),
                    label: normalizeSearchBridgeText(step?.label || "").slice(0, 120),
                    candidateKey: normalizeSearchBridgeText(step?.candidateKey || "").slice(0, 120)
                }))
                .filter(step => /^(maker|car|shasyu|grade|katasiki)$/.test(step.kind) &&
                    !!(step.candidateKey || step.label));

            return normalizedSteps.length ? { version: 1, steps: normalizedSteps } : undefined;
        }

        function normalizeSiteSearchBridgeCondition(condition) {
            if (!condition || !Array.isArray(condition.fields)) return null;

            const savedAt = Number(condition.savedAt || Date.now());
            const araiNameCascade = normalizeAraiNameCascade(condition.araiNameCascade);
            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                sourceMode: normalizeSiteSearchBridgeMode(condition.sourceMode),
                araiSearchKind: normalizeSiteSearchBridgeKind(condition.araiSearchKind || condition.searchKind),
                fields: condition.fields.filter(Boolean),
                araiNameCascade,
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

        function getSiteSearchBridgeLocalStorage() {
            return globalThis.chrome?.storage?.local || null;
        }

        function requireSiteSearchBridgeLocalStorage() {
            const storage = getSiteSearchBridgeLocalStorage();
            if (!storage) throw new Error("Extension storage is unavailable");
            return storage;
        }

        function isSiteSearchBridgeStorageUnavailableError(error) {
            const message = String(error?.message || error || "");
            return /extension context invalidated/i.test(message) ||
                /reading 'local'|reading "local"|storage is unavailable/i.test(message);
        }

        function renderSiteSearchBridgeStorageUnavailable(wrap, adapter) {
            wrap.textContent = "";

            const message = document.createElement("div");
            message.textContent = "拡張更新後の古いページです。ページを再読み込みしてください。";
            message.style.fontWeight = "700";
            message.style.lineHeight = "1.5";
            wrap.appendChild(message);

            const close = createSiteSearchBridgeButton("閉じる", async () => {
                renderSiteSearchBridgeLauncher(wrap, adapter);
            });
            close.style.marginTop = "6px";
            wrap.appendChild(close);
        }

        async function getSiteSearchBridgeSlotStore(storageKey) {
            const storage = requireSiteSearchBridgeLocalStorage();
            const result = await storage.get(storageKey);
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
            await requireSiteSearchBridgeLocalStorage().set({ [adapter.storageKey]: store });
            return condition;
        }

        async function renameSiteSearchBridgeConditionSlot(adapter, slotId, name) {
            const store = await getSiteSearchBridgeSlotStore(adapter.storageKey);
            const slot = store.slots.find(item => item.id === String(slotId));
            if (!slot) return null;

            slot.name = normalizeSearchBridgeSlotName(name, slot.id);
            await requireSiteSearchBridgeLocalStorage().set({ [adapter.storageKey]: store });
            return slot.name;
        }

        async function deleteSiteSearchBridgeConditionSlot(adapter, slotId) {
            const store = await getSiteSearchBridgeSlotStore(adapter.storageKey);
            const slot = store.slots.find(item => item.id === String(slotId));
            if (!slot) return null;

            slot.condition = null;
            await requireSiteSearchBridgeLocalStorage().set({ [adapter.storageKey]: store });
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
                id: `${adapter.siteId || "site"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                targetMode,
                condition: savedCondition,
                createdAt: Date.now(),
                sourceUrl: location.href
            };

            if (adapter.state) {
                if (adapter.state.pendingRetryTimer) {
                    clearTimeout(adapter.state.pendingRetryTimer);
                    adapter.state.pendingRetryTimer = null;
                }
                adapter.state.pendingApplied = false;
                adapter.state.pendingRunning = false;
            }
            await requireSiteSearchBridgeLocalStorage().set({ [adapter.pendingKey]: pending });
            if (typeof adapter.afterPendingCreated === "function") {
                await adapter.afterPendingCreated(pending, targetMode, savedCondition);
            }
            if (typeof adapter.beforePendingNavigate === "function") {
                adapter.beforePendingNavigate(pending, targetMode);
            }
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

            const btn = createSiteSearchBridgeButton(`${adapter.title || ""}条件保存`, async () => {
                await renderSiteSearchBridgePanel(wrap, adapter);
            });
            btn.style.padding = "8px 10px";
            btn.style.borderRadius = "18px";
            btn.style.fontWeight = "700";
            btn.style.boxShadow = "0 2px 10px rgba(0,0,0,0.18)";
            Object.assign(btn.style, adapter.launcherStyle || {});
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

                const headerActions = document.createElement("div");
                headerActions.style.display = "flex";
                headerActions.style.alignItems = "center";
                headerActions.style.gap = "6px";

                if (typeof adapter.appendPanelActions === "function") {
                    adapter.appendPanelActions(headerActions, wrap, adapter);
                }

                headerActions.appendChild(createSiteSearchBridgeButton("閉じる", async () => {
                    renderSiteSearchBridgeLauncher(wrap, adapter);
                }));

                header.appendChild(headerActions);
                wrap.appendChild(header);

                if (typeof adapter.appendPanelContent === "function") {
                    await adapter.appendPanelContent(wrap, adapter);
                }

                for (const slot of store.slots) {
                    wrap.appendChild(createSiteSearchBridgeSlotRow(wrap, adapter, slot));
                }
            } catch (error) {
                console.warn("MLive Linkifier: site bridge panel render failed", adapter.siteId, error);
                if (isSiteSearchBridgeStorageUnavailableError(error)) {
                    renderSiteSearchBridgeStorageUnavailable(wrap, adapter);
                    return;
                }
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
            if (adapter.buildId) wrap.dataset.searchBridgeBuild = adapter.buildId;

            renderSiteSearchBridgeLauncher(wrap, adapter);
        }

        function scheduleSiteSearchBridgePendingRetry(adapter, delay = 700) {
            if (!adapter?.state || adapter.state.pendingRetryTimer) return;

            adapter.state.pendingRetryTimer = setTimeout(() => {
                adapter.state.pendingRetryTimer = null;
                applySiteSearchBridgePending(adapter);
            }, delay);
        }

        async function applySiteSearchBridgePending(adapter) {
            if (adapter.state.pendingRunning || adapter.state.pendingApplied) return;

            const currentMode = adapter.getCurrentMode();
            if (!adapter.isSearchMode(currentMode)) return;

            adapter.state.pendingRunning = true;
            try {
                const storage = getSiteSearchBridgeLocalStorage();
                const result = storage ? await storage.get(adapter.pendingKey) : {};
                const storedPending = result[adapter.pendingKey];
                const fallbackPending = typeof adapter.getPendingFallback === "function"
                    ? adapter.getPendingFallback(currentMode)
                    : null;
                const storedTargetMode = normalizeSiteSearchBridgeMode(storedPending?.targetMode);
                const fallbackTargetMode = normalizeSiteSearchBridgeMode(fallbackPending?.targetMode);
                const useFallback = fallbackTargetMode === currentMode && storedTargetMode !== currentMode;
                const pending = useFallback ? fallbackPending : (storedPending || fallbackPending);
                const fromFallback = pending === fallbackPending && !!fallbackPending;

                if (typeof adapter.onPendingProbe === "function") {
                    adapter.onPendingProbe({
                        currentMode,
                        storedPresent: !!storedPending,
                        storedTargetMode,
                        fallbackPresent: !!fallbackPending,
                        fallbackTargetMode,
                        selectedSource: pending ? (fromFallback ? "fallback" : "storage") : "none"
                    });
                }
                if (!pending) {
                    if (!storage && typeof adapter.onPendingStorageUnavailable === "function") {
                        adapter.onPendingStorageUnavailable(currentMode);
                    } else if (typeof adapter.onPendingMissing === "function") {
                        adapter.onPendingMissing(currentMode);
                    }
                    return;
                }

                if (typeof adapter.onPendingFound === "function") {
                    adapter.onPendingFound(pending, currentMode, { fromFallback });
                }

                if (pending.version !== MLIVE_SEARCH_BRIDGE_VERSION || !pending.condition) {
                    if (storage) await storage.remove(adapter.pendingKey);
                    if (typeof adapter.clearPendingFallback === "function") adapter.clearPendingFallback();
                    if (typeof adapter.afterPendingCleared === "function") {
                        await adapter.afterPendingCleared("invalid_pending", pending);
                    }
                    return;
                }

                if (Date.now() - Number(pending.createdAt || 0) > SEARCH_BRIDGE_PENDING_MAX_AGE_MS) {
                    if (storage) await storage.remove(adapter.pendingKey);
                    if (typeof adapter.clearPendingFallback === "function") adapter.clearPendingFallback();
                    if (typeof adapter.afterPendingCleared === "function") {
                        await adapter.afterPendingCleared("expired_pending", pending);
                    }
                    return;
                }

                if (normalizeSiteSearchBridgeMode(pending.targetMode) !== currentMode) return;

                const condition = normalizeSiteSearchBridgeCondition(pending.condition);
                if (!condition) {
                    if (storage) await storage.remove(adapter.pendingKey);
                    if (typeof adapter.clearPendingFallback === "function") adapter.clearPendingFallback();
                    if (typeof adapter.afterPendingCleared === "function") {
                        await adapter.afterPendingCleared("empty_condition", pending);
                    }
                    return;
                }

                if (typeof adapter.beforePendingRestore === "function") {
                    const handled = await adapter.beforePendingRestore(pending, currentMode, condition);
                    if (handled) return;
                }

                if (typeof adapter.beforeRestore === "function") {
                    adapter.beforeRestore(currentMode, condition);
                }

                if (!adapter.isRestoreReady(currentMode, condition)) {
                    scheduleSiteSearchBridgePendingRetry(adapter);
                    return;
                }

                const restoreResult = await adapter.restoreCondition(condition, currentMode);
                if (restoreResult === false) {
                    scheduleSiteSearchBridgePendingRetry(adapter, 700);
                    return;
                }

                adapter.state.pendingApplied = true;
                if (storage) await storage.remove(adapter.pendingKey);
                if (typeof adapter.clearPendingFallback === "function") adapter.clearPendingFallback();

                showSiteSearchBridgeNotice(adapter, `保存条件で${adapter.getModeLabel(currentMode)}検索します`);
                setTimeout(() => adapter.submitSearch(condition, currentMode), 160);
            } catch (error) {
                if (/extension context invalidated/i.test(String(error?.message || error))) {
                    return;
                }
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
                return actual.includes(expected) && isSearchBridgeElementVisible(el);
            }) || null;
        }

        function isSearchBridgeElementVisible(el) {
            if (!el) return false;
            return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        }

        function clickSearchBridgeElement(el, withMouseEvents = false) {
            if (!el) return false;

            const doc = el.ownerDocument || document;
            const view = doc.defaultView || window;
            const dispatchMouseEvents = () => {
                const rect = typeof el.getBoundingClientRect === "function"
                    ? el.getBoundingClientRect()
                    : { left: 0, top: 0, width: 0, height: 0 };
                const clientX = Math.round(rect.left + Math.max(1, rect.width / 2));
                const clientY = Math.round(rect.top + Math.max(1, rect.height / 2));
                const common = {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    view,
                    clientX,
                    clientY,
                    screenX: clientX,
                    screenY: clientY,
                    button: 0,
                    buttons: 1
                };
                const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
                for (const type of eventTypes) {
                    let event;
                    try {
                        event = type.startsWith("pointer") && typeof PointerEvent === "function"
                            ? new PointerEvent(type, { ...common, pointerId: 1, pointerType: "mouse", isPrimary: true })
                            : new MouseEvent(type, common);
                    } catch (error) {
                        event = doc.createEvent("MouseEvents");
                        event.initMouseEvent(type, true, true, view, 1, clientX, clientY, clientX, clientY, false, false, false, false, 0, null);
                    }
                    el.dispatchEvent(event);
                }
            };

            if (withMouseEvents) {
                dispatchMouseEvents();
                if (typeof el.click === "function") {
                    el.click();
                }
                return true;
            }

            if (typeof el.click === "function") {
                el.click();
                return true;
            }

            dispatchMouseEvents();
            return true;
        }

        // ===== Arai 検索条件ブリッジ =====

        const ARAI_KAIJO_ACTION_ATTR = "data-mlive-arai-kaijo-action";
        const ARAI_KAIJO_RESULT_ATTR = "data-mlive-arai-kaijo-result";
        const ARAI_KAIJO_ERROR_ATTR = "data-mlive-arai-kaijo-error";
        const ARAI_KAIJO_DIAGNOSTIC_ATTR = "data-mlive-arai-kaijo-diagnostic";
        const ARAI_KAIJO_PROBE_ONLY_ATTR = "data-mlive-arai-kaijo-probe-only";
        const ARAI_KAIJO_PAYLOAD_ATTR = "data-mlive-arai-kaijo-payload";
        const ARAI_KAIJO_ACTION_EVENT = "mlive-linkifier:arai-kaijo-action";
        const ARAI_PENDING_PROBE_ATTR = "data-mlive-arai-pending-probe";
        const ARAI_SEARCH_KIND_NAME = "name";
        const ARAI_SEARCH_KIND_CONDITION = "condition";
        const ARAI_NAME_CASCADE_MAX_WAIT_MS = 12000;

        const araiSearchBridgeFlow = {
            pendingId: "",
            venuePageLogged: false,
            venueSelectedLogged: false,
            venueSelectClicked: false,
            venueSelectAttemptCount: 0,
            conditionFormLoggedUrl: "",
            resultLoggedUrl: "",
            conditionTabActivated: false,
            nextAttempted: false,
            nextAttemptedAt: 0,
            nextAttemptCount: 0,
            awaitingConditionAfterNext: false,
            nextActionFailures: 0,
            lastSignature: "",
            sameSignatureCount: 0,
            nameCascadeSignature: "",
            nameCascadeIndex: 0,
            nameCascadeActionAt: 0,
            nameCascadeActionId: "",
            nameCascadeWaitStartedAt: 0,
            nameCascadeLoggedIndex: -1,
            stopped: false
        };

        let araiResultCheckRunning = false;
        let araiPendingFallbackStartupRetryScheduled = false;
        let araiNameDiagnosticRecord = null;
        let araiNameDiagnosticObserver = null;
        let araiNameDiagnosticMutationTimer = null;
        let araiNameDiagnosticSnapshotSignature = "";
        let araiNameDiagnosticAlertValue = "";
        let araiNameDiagnosticWriteQueue = Promise.resolve();
        let juSelectionDiagnosticRecord = null;
        let juSelectionDiagnosticObserver = null;
        let juSelectionDiagnosticMutationTimer = null;
        let juSelectionDiagnosticSnapshotSignature = "";
        let juSelectionDiagnosticWriteQueue = Promise.resolve();
        let juSelectionDiagnosticInitialized = false;

        function getAraiNameDiagnosticTarget(target) {
            const element = target?.nodeType === 1 ? target : target?.parentElement;
            if (!element) return null;

            const control = element.closest("button,a,input,select,textarea,label,li,span") || element;
            const scope = control.closest("[id^='s1_'],#tbCarNameList,#tbGradeList,#search_box,#tabclient0,#tabclient1,#tabclient2,#tabclient3");
            return {
                tag: String(control.tagName || "").toLowerCase(),
                id: control.id || "",
                name: control.name || "",
                type: control.type || "",
                value: "value" in control ? String(control.value || "").slice(0, 120) : "",
                text: normalizeSearchBridgeText(control.innerText || control.textContent || "").slice(0, 120),
                scope: scope?.id || ""
            };
        }

        function isAraiNameDiagnosticRelevantTarget(target) {
            const element = target?.nodeType === 1 ? target : target?.parentElement;
            return !!element?.closest("[id^='s1_'],#tbCarNameList,#tbGradeList,#search_box,#tabclient0,#tabclient1,#tabclient2,#tabclient3");
        }

        function getAraiNameDiagnosticCandidateTexts(root) {
            if (!root) return [];

            const seen = new Set();
            return Array.from(root.querySelectorAll("a,button,label,li,span,input[type='checkbox'],input[type='radio']"))
                .filter(el => isSearchBridgeElementVisible(el))
                .map(el => normalizeSearchBridgeText(el.innerText || el.textContent || el.value || ""))
                .filter(text => text && text.length <= 120 && !seen.has(text) && (seen.add(text), true))
                .slice(0, 16);
        }

        function getAraiNameDiagnosticSnapshot() {
            const visibleDialogs = Array.from(document.querySelectorAll("[id^='s1_']"))
                .filter(el => /^s1_\d+$/i.test(el.id || "") && isSearchBridgeElementVisible(el))
                .map(el => ({
                    id: el.id,
                    title: normalizeSearchBridgeText(el.querySelector("h1,h2,h3,h4,h5,.title,#gTitle")?.textContent || "").slice(0, 80),
                    candidates: getAraiNameDiagnosticCandidateTexts(el)
                }));
            const candidateLists = Array.from(document.querySelectorAll("#tbCarNameList,#tbGradeList,[id^='s1_'] [id$='List']"))
                .filter((el, index, all) => all.indexOf(el) === index && isSearchBridgeElementVisible(el))
                .map(el => ({ id: el.id || "", candidates: getAraiNameDiagnosticCandidateTexts(el) }));
            const nameInput = document.getElementById("history_check") || document.querySelector("input[name='pattern']");
            const activeNameTab = getAraiSearchKindTabId(getAraiSearchBridgeMode(), ARAI_SEARCH_KIND_NAME);

            return {
                url: location.href,
                mode: getAraiSearchBridgeMode(),
                activeNameTab: isAraiSearchKindTabActive(activeNameTab),
                keyword: normalizeSearchBridgeText(nameInput?.value || "").slice(0, 120),
                dialogs: visibleDialogs,
                candidateLists,
                selectedVenueCount: getAraiCheckedVenueCount()
            };
        }

        function getAraiNameDiagnosticSnapshotSignature(snapshot = getAraiNameDiagnosticSnapshot()) {
            return JSON.stringify({
                mode: snapshot.mode,
                activeNameTab: snapshot.activeNameTab,
                keyword: snapshot.keyword,
                dialogs: snapshot.dialogs,
                candidateLists: snapshot.candidateLists,
                selectedVenueCount: snapshot.selectedVenueCount
            });
        }

        function getAraiNameDiagnosticSummary(record = araiNameDiagnosticRecord) {
            const steps = Array.isArray(record?.steps) ? record.steps : [];
            const last = steps.at(-1) || null;
            return {
                version: record?.version || 1,
                status: record?.status || "empty",
                startedAt: record?.startedAt || 0,
                updatedAt: record?.updatedAt || 0,
                stepCount: steps.length,
                lastKind: last?.kind || "",
                lastTarget: last?.detail?.target || null,
                lastSnapshot: last?.snapshot || null
            };
        }

        function publishAraiNameDiagnosticSummary(record = araiNameDiagnosticRecord) {
            const root = document.documentElement;
            if (!root) return;

            try {
                root.setAttribute(ARAI_NAME_DIAGNOSTIC_SUMMARY_ATTR, JSON.stringify(getAraiNameDiagnosticSummary(record)));
            } catch {
                root.removeAttribute(ARAI_NAME_DIAGNOSTIC_SUMMARY_ATTR);
            }
        }

        function cloneAraiNameDiagnosticRecord(record) {
            return JSON.parse(JSON.stringify(record));
        }

        function queueAraiNameDiagnosticWrite(record = araiNameDiagnosticRecord) {
            const storage = getSiteSearchBridgeLocalStorage();
            if (!storage || !record) return Promise.resolve();

            const snapshot = cloneAraiNameDiagnosticRecord(record);
            araiNameDiagnosticWriteQueue = araiNameDiagnosticWriteQueue
                .catch(() => undefined)
                .then(() => storage.set({ [ARAI_NAME_DIAGNOSTIC_KEY]: snapshot }))
                .catch(error => {
                    if (!/extension context invalidated/i.test(String(error?.message || error))) {
                        console.warn("MLive Linkifier: Arai name diagnostic write failed", error);
                    }
                });
            return araiNameDiagnosticWriteQueue;
        }

        async function getAraiNameDiagnosticRecord() {
            const storage = getSiteSearchBridgeLocalStorage();
            if (!storage) return null;

            const result = await storage.get(ARAI_NAME_DIAGNOSTIC_KEY);
            const record = result[ARAI_NAME_DIAGNOSTIC_KEY];
            return record && typeof record === "object" ? record : null;
        }

        function recordAraiNameDiagnosticStep(kind, detail = {}) {
            const record = araiNameDiagnosticRecord;
            if (!record || record.status !== "recording") return;

            const snapshot = getAraiNameDiagnosticSnapshot();
            const signature = getAraiNameDiagnosticSnapshotSignature(snapshot);
            if (kind === "dom_update" && signature === araiNameDiagnosticSnapshotSignature) return;

            araiNameDiagnosticSnapshotSignature = signature;
            record.steps.push({
                sequence: Number(record.nextSequence || 1),
                at: Date.now(),
                kind,
                detail,
                snapshot
            });
            record.nextSequence = Number(record.nextSequence || 1) + 1;
            if (record.steps.length > ARAI_NAME_DIAGNOSTIC_STEP_LIMIT) {
                record.steps.splice(0, record.steps.length - ARAI_NAME_DIAGNOSTIC_STEP_LIMIT);
            }
            record.updatedAt = Date.now();
            publishAraiNameDiagnosticSummary(record);
            void queueAraiNameDiagnosticWrite(record);
        }

        function isAraiNameDiagnosticMutationRelevant(mutations) {
            const selector = "[id^='s1_'],#tbCarNameList,#tbGradeList,#search_box,#tabclient0,#tabclient1,#tabclient2,#tabclient3";
            return mutations.some(mutation => {
                const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
                if (target?.closest(selector)) return true;

                return Array.from(mutation.addedNodes || []).some(node => {
                    const element = node?.nodeType === 1 ? node : node?.parentElement;
                    return !!(element?.matches?.(selector) || element?.querySelector?.(selector));
                });
            });
        }

        function scheduleAraiNameDiagnosticMutationRecord() {
            if (araiNameDiagnosticMutationTimer) clearTimeout(araiNameDiagnosticMutationTimer);
            araiNameDiagnosticMutationTimer = setTimeout(() => {
                araiNameDiagnosticMutationTimer = null;
                recordAraiNameDiagnosticStep("dom_update");
            }, 120);
        }

        function handleAraiNameDiagnosticClick(event) {
            if (!event.isTrusted || !isAraiNameDiagnosticRelevantTarget(event.target)) return;
            recordAraiNameDiagnosticStep("user_click", { target: getAraiNameDiagnosticTarget(event.target) });
        }

        function handleAraiNameDiagnosticChange(event) {
            if (!event.isTrusted || !isAraiNameDiagnosticRelevantTarget(event.target)) return;
            recordAraiNameDiagnosticStep("user_change", { target: getAraiNameDiagnosticTarget(event.target) });
        }

        function handleAraiNameDiagnosticInput(event) {
            const target = event.target;
            if (!event.isTrusted || !(target?.id === "history_check" || target?.name === "pattern")) return;
            recordAraiNameDiagnosticStep("user_input", { target: getAraiNameDiagnosticTarget(target) });
        }

        function handleAraiNameDiagnosticAlert() {
            const message = normalizeSearchBridgeText(document.documentElement?.getAttribute(ARAI_NAME_DIAGNOSTIC_ALERT_ATTR) || "");
            if (!message || message === araiNameDiagnosticAlertValue) return;
            araiNameDiagnosticAlertValue = message;
            recordAraiNameDiagnosticStep("alert", { message: message.slice(0, 240) });
        }

        function installAraiNameDiagnosticListeners() {
            document.addEventListener("click", handleAraiNameDiagnosticClick, true);
            document.addEventListener("change", handleAraiNameDiagnosticChange, true);
            document.addEventListener("input", handleAraiNameDiagnosticInput, true);
            window.addEventListener(ARAI_NAME_DIAGNOSTIC_ALERT_EVENT, handleAraiNameDiagnosticAlert);

            araiNameDiagnosticObserver = new MutationObserver(mutations => {
                if (isAraiNameDiagnosticMutationRelevant(mutations)) scheduleAraiNameDiagnosticMutationRecord();
            });
            araiNameDiagnosticObserver.observe(document.documentElement, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ["class", "style", "value", "checked", "aria-selected", "aria-checked"]
            });
        }

        function removeAraiNameDiagnosticListeners() {
            document.removeEventListener("click", handleAraiNameDiagnosticClick, true);
            document.removeEventListener("change", handleAraiNameDiagnosticChange, true);
            document.removeEventListener("input", handleAraiNameDiagnosticInput, true);
            window.removeEventListener(ARAI_NAME_DIAGNOSTIC_ALERT_EVENT, handleAraiNameDiagnosticAlert);
            araiNameDiagnosticObserver?.disconnect();
            araiNameDiagnosticObserver = null;
            if (araiNameDiagnosticMutationTimer) clearTimeout(araiNameDiagnosticMutationTimer);
            araiNameDiagnosticMutationTimer = null;
        }

        function runAraiNameDiagnosticMainAction(command) {
            const root = document.documentElement;
            if (!root) return false;

            try {
                root.setAttribute(ARAI_NAME_DIAGNOSTIC_ACTIVE_ATTR, command === "start" ? "1" : "0");
                root.setAttribute(ARAI_NAME_DIAGNOSTIC_COMMAND_ATTR, command);
                root.setAttribute(ARAI_NAME_DIAGNOSTIC_RESULT_ATTR, "0");
                window.dispatchEvent(new Event(ARAI_NAME_DIAGNOSTIC_EVENT));
                return root.getAttribute(ARAI_NAME_DIAGNOSTIC_RESULT_ATTR) === "1";
            } catch {
                return false;
            } finally {
                root.removeAttribute(ARAI_NAME_DIAGNOSTIC_COMMAND_ATTR);
            }
        }

        async function startAraiNameDiagnostic() {
            if (!isAraiSearchBridgeMode(getAraiSearchBridgeMode()) || getAraiCurrentSearchKind() !== ARAI_SEARCH_KIND_NAME) {
                showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "車名検索タブで開始してください", "error");
                return false;
            }
            if (!getSiteSearchBridgeLocalStorage()) {
                showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "拡張を更新後、ページを再読み込みしてください", "error");
                return false;
            }

            removeAraiNameDiagnosticListeners();
            const now = Date.now();
            araiNameDiagnosticAlertValue = "";
            araiNameDiagnosticSnapshotSignature = "";
            araiNameDiagnosticRecord = {
                version: 1,
                status: "recording",
                startedAt: now,
                updatedAt: now,
                sourceUrl: location.href,
                nextSequence: 1,
                steps: []
            };
            runAraiNameDiagnosticMainAction("start");
            installAraiNameDiagnosticListeners();
            recordAraiNameDiagnosticStep("recording_started");
            await queueAraiNameDiagnosticWrite(araiNameDiagnosticRecord);
            return true;
        }

        async function stopAraiNameDiagnostic() {
            const record = araiNameDiagnosticRecord || await getAraiNameDiagnosticRecord();
            if (!record) return null;

            araiNameDiagnosticRecord = record;

            recordAraiNameDiagnosticStep("recording_finished");
            record.status = "stopped";
            record.updatedAt = Date.now();
            removeAraiNameDiagnosticListeners();
            runAraiNameDiagnosticMainAction("stop");
            publishAraiNameDiagnosticSummary(record);
            await queueAraiNameDiagnosticWrite(record);
            return record;
        }

        async function discardAraiNameDiagnostic() {
            removeAraiNameDiagnosticListeners();
            runAraiNameDiagnosticMainAction("clear");
            araiNameDiagnosticRecord = null;
            araiNameDiagnosticSnapshotSignature = "";
            document.documentElement?.removeAttribute(ARAI_NAME_DIAGNOSTIC_SUMMARY_ATTR);
            const storage = getSiteSearchBridgeLocalStorage();
            if (storage) await storage.remove(ARAI_NAME_DIAGNOSTIC_KEY);
        }

        function formatAraiNameDiagnosticStep(step) {
            const target = step?.detail?.target;
            const targetText = target ? (target.id || target.text || target.name || target.tag || "") : "";
            const dialogText = Array.isArray(step?.snapshot?.dialogs)
                ? step.snapshot.dialogs.map(dialog => dialog.title || dialog.id).filter(Boolean).join(" > ")
                : "";
            return `${step?.sequence || ""}. ${step?.kind || ""}${targetText ? ` ${targetText}` : ""}${dialogText ? ` [${dialogText}]` : ""}`;
        }

        async function showAraiNameDiagnosticLog() {
            const record = araiNameDiagnosticRecord || await getAraiNameDiagnosticRecord();
            if (!record) {
                showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "選択記録はありません", "error");
                return;
            }

            araiNameDiagnosticRecord = record;
            publishAraiNameDiagnosticSummary(record);

            const old = document.getElementById("arai-name-diagnostic-log");
            if (old) old.remove();

            const panel = document.createElement("div");
            panel.id = "arai-name-diagnostic-log";
            panel.style.position = "fixed";
            panel.style.right = "16px";
            panel.style.bottom = "16px";
            panel.style.zIndex = "1000002";
            panel.style.width = "min(520px, calc(100vw - 32px))";
            panel.style.maxHeight = "min(420px, calc(100vh - 32px))";
            panel.style.overflow = "auto";
            panel.style.padding = "10px";
            panel.style.border = "1px solid rgba(0,0,0,0.25)";
            panel.style.borderRadius = "8px";
            panel.style.background = "#fff";
            panel.style.boxShadow = "0 6px 24px rgba(0,0,0,0.25)";
            panel.style.fontFamily = "sans-serif";
            panel.style.fontSize = "12px";
            panel.style.color = "#111827";

            const header = document.createElement("div");
            header.style.display = "flex";
            header.style.justifyContent = "space-between";
            header.style.gap = "8px";
            const title = document.createElement("strong");
            title.textContent = `Arai選択記録 ${record.status === "recording" ? "記録中" : "記録済み"} ${record.steps?.length || 0}件`;
            header.appendChild(title);
            header.appendChild(createSiteSearchBridgeButton("閉じる", () => panel.remove()));
            panel.appendChild(header);

            const pre = document.createElement("pre");
            pre.style.margin = "8px 0 0";
            pre.style.whiteSpace = "pre-wrap";
            pre.style.wordBreak = "break-word";
            pre.textContent = (record.steps || []).map(formatAraiNameDiagnosticStep).join("\n") || "記録はありません";
            panel.appendChild(pre);
            document.body.appendChild(panel);
        }

        async function createAraiNameDiagnosticControls(wrap, adapter) {
            const record = araiNameDiagnosticRecord || await getAraiNameDiagnosticRecord();
            const controls = document.createElement("div");
            controls.style.display = "flex";
            controls.style.flexWrap = "wrap";
            controls.style.alignItems = "center";
            controls.style.gap = "6px";
            controls.style.padding = "6px";
            controls.style.border = "1px solid rgba(0,0,0,0.1)";
            controls.style.borderRadius = "6px";
            controls.style.background = "#f3f4f6";

            const status = document.createElement("span");
            status.style.fontSize = "11px";
            status.style.color = "#374151";
            status.textContent = record
                ? `${record.status === "recording" ? "記録中" : "記録済み"} ${record.steps?.length || 0}件`
                : "選択記録";
            controls.appendChild(status);

            controls.appendChild(createSiteSearchBridgeButton("選択記録開始", async () => {
                if (await startAraiNameDiagnostic()) {
                    showSiteSearchBridgeNotice(adapter, "Arai選択記録を開始しました");
                    await renderSiteSearchBridgePanel(wrap, adapter);
                }
            }, record?.status === "recording"));
            controls.appendChild(createSiteSearchBridgeButton("記録終了", async () => {
                const stopped = await stopAraiNameDiagnostic();
                if (stopped) {
                    showSiteSearchBridgeNotice(adapter, `Arai選択記録を終了しました (${stopped.steps?.length || 0}件)`);
                    await renderSiteSearchBridgePanel(wrap, adapter);
                }
            }, record?.status !== "recording"));
            controls.appendChild(createSiteSearchBridgeButton("診断記録", async () => {
                await showAraiNameDiagnosticLog();
            }, !record));
            controls.appendChild(createSiteSearchBridgeButton("記録破棄", async () => {
                await discardAraiNameDiagnostic();
                showSiteSearchBridgeNotice(adapter, "Arai選択記録を破棄しました");
                await renderSiteSearchBridgePanel(wrap, adapter);
            }, !record));

            return controls;
        }

        function getAraiSearchBridgePendingId(pending) {
            return String(pending?.id || `${pending?.createdAt || ""}:${pending?.targetMode || ""}`);
        }

        function resetAraiSearchBridgeFlow(pending = null) {
            Object.assign(araiSearchBridgeFlow, {
                pendingId: pending ? getAraiSearchBridgePendingId(pending) : "",
                venuePageLogged: false,
                venueSelectedLogged: false,
                venueSelectClicked: false,
                venueSelectAttemptCount: 0,
                conditionFormLoggedUrl: "",
                resultLoggedUrl: "",
                conditionTabActivated: false,
                nextAttempted: false,
                nextAttemptedAt: 0,
                nextAttemptCount: 0,
                awaitingConditionAfterNext: false,
                nextActionFailures: 0,
                lastSignature: "",
                sameSignatureCount: 0,
                nameCascadeSignature: "",
                nameCascadeIndex: 0,
                nameCascadeActionAt: 0,
                nameCascadeActionId: "",
                nameCascadeWaitStartedAt: 0,
                nameCascadeLoggedIndex: -1,
                stopped: false
            });
        }

        function runAraiPendingFallbackAction(command, payload = "") {
            const root = document.documentElement;
            if (!root) return false;

            try {
                if (payload) root.setAttribute(ARAI_PENDING_FALLBACK_ATTR, payload);
                root.setAttribute(ARAI_PENDING_FALLBACK_COMMAND_ATTR, command);
                window.dispatchEvent(new Event(ARAI_PENDING_FALLBACK_EVENT));
                return root.getAttribute(ARAI_PENDING_FALLBACK_RESULT_ATTR) === "1";
            } catch {
                return false;
            } finally {
                root.removeAttribute(ARAI_PENDING_FALLBACK_COMMAND_ATTR);
            }
        }

        function setAraiPendingFallback(pending) {
            try {
                return runAraiPendingFallbackAction("save", JSON.stringify(pending));
            } catch {
                return false;
            }
        }

        function getAraiPendingFallback() {
            const root = document.documentElement;
            if (!root) return null;

            runAraiPendingFallbackAction("read");
            try {
                const raw = root.getAttribute(ARAI_PENDING_FALLBACK_ATTR);
                const pending = raw ? JSON.parse(raw) : null;
                return pending && typeof pending === "object" ? pending : null;
            } catch {
                return null;
            }
        }

        function recordAraiPendingProbe(detail) {
            try {
                document.documentElement?.setAttribute(ARAI_PENDING_PROBE_ATTR, JSON.stringify({
                    at: Date.now(),
                    ...detail
                }));
            } catch {
                // Diagnostics must never interrupt the bridge.
            }
        }

        function clearAraiPendingFallback() {
            runAraiPendingFallbackAction("clear");
        }

        function handleAraiPendingFound(pending, currentMode, source = {}) {
            if (source.fromFallback) {
                recordAraiSearchBridgeLog("pending取得", {
                    targetMode: currentMode,
                    pendingId: getAraiSearchBridgePendingId(pending),
                    source: source.fromFallback ? "main_world_fallback" : "chrome_storage"
                });
            }
        }

        function ensureAraiSearchBridgeFlow(pending) {
            const pendingId = getAraiSearchBridgePendingId(pending);
            if (araiSearchBridgeFlow.pendingId !== pendingId) {
                resetAraiSearchBridgeFlow(pending);
            }
        }

        function getAraiVenueInputs() {
            return Array.from(document.querySelectorAll("input[type='checkbox']"))
                .filter(el => {
                    const marker = `${el.name || ""} ${el.id || ""}`;
                    return /^(kaijo|aa4w|tp4w|week4w)/i.test(el.name || el.id || "") ||
                        /(?:^|\s)(?:2w|4w|ke|ab)\d+/i.test(marker) ||
                        el.name === "kaijo4w";
                });
        }

        function getAraiSelectedVenueInputs() {
            return getAraiVenueInputs().filter(el => el.checked);
        }

        function getAraiCheckedVenueCount() {
            return getAraiSelectedVenueInputs().length;
        }

        function forceAraiFourWheelVenueCheckboxes() {
            const inputs = Array.from(document.querySelectorAll("input[type='checkbox']"))
                .filter(el => el.name === "kaijo4w" || /^4w\d+$/i.test(el.id || ""));
            const extraIds = ["we4wAA", "we4wTP"];
            let changed = 0;

            for (const el of inputs) {
                if (!el.checked) changed += 1;
                el.checked = true;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            }

            for (const id of extraIds) {
                const el = document.getElementById(id);
                if (el && "checked" in el) {
                    if (!el.checked) changed += 1;
                    el.checked = true;
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }

            return changed || inputs.length;
        }

        function parseAraiKaijoDiagnostic() {
            const raw = document.documentElement?.getAttribute(ARAI_KAIJO_DIAGNOSTIC_ATTR) || "";
            if (!raw) return null;

            try {
                return JSON.parse(raw);
            } catch (error) {
                return { parseError: String(error?.message || error), raw: raw.slice(0, 300) };
            }
        }

        function getAraiDomSelectedVenueCount() {
            let count = 0;
            const activeSelectors = [
                "#toggle_car.active",
                "#toggle_car.selected",
                "#toggle_car.on",
                "#CKALL4W.active",
                "#CKALL4W.selected",
                "#CKALL4W.on",
                "#CKALL4W[aria-checked='true']",
                "#CKALL4W[aria-selected='true']"
            ];

            for (const selector of activeSelectors) {
                if (document.querySelector(selector)) count += 1;
            }

            const all4w = document.getElementById("CKALL4W");
            if (all4w && "checked" in all4w && all4w.checked) count += 1;

            return count;
        }

        function hasAraiSearchBridgeResultContent() {
            if (document.querySelector("#spList,#mainGazou,ul#gazou")) return true;

            const text = document.body?.innerText || "";
            return /該当件数|検索結果|該当.*件|0件/.test(text);
        }

        function getAraiSearchBridgeStage() {
            if (isAraiSearchBridgeLoading()) return "loading";
            if (isAraiVenueSelectionStep() && !hasAraiAnySearchButton()) {
                return hasAraiSelectedVenue() ? "venue_selected" : "venue_select";
            }
            if (hasAraiAnySearchButton()) return "condition";
            if (hasAraiSearchBridgeResultContent()) return "result";
            return "unknown";
        }

        function createAraiSearchBridgeSnapshot(extra = {}) {
            const root = document.documentElement;
            const venueInputs = getAraiVenueInputs();
            const selectedInputs = venueInputs.filter(el => el.checked);
            const mainDiagnostic = parseAraiKaijoDiagnostic();
            const mainState = mainDiagnostic?.after || mainDiagnostic?.before || null;
            const mainInternalSelectedVenueCount = mainState
                ? Number(mainState.fourwheelSelectCount || 0) +
                    Number(mainState.bykeSelectCount || 0) +
                    Number(mainState.kenkiSelectCount || 0) +
                    Number(mainState.abroadSelectCount || 0) +
                    Number(mainState.dispListSelectCount || 0)
                : 0;
            const mainActiveVenueNodeCount = Number(mainState?.activeVenueNodeCount || 0);
            const domSelectedVenueCount = getAraiDomSelectedVenueCount();

            return {
                url: location.href,
                mode: getAraiSearchBridgeMode(),
                stage: getAraiSearchBridgeStage(),
                readyState: document.readyState,
                loading: isAraiSearchBridgeLoading(),
                venueStep: isAraiVenueSelectionStep(),
                venueInputCount: venueInputs.length,
                selectedVenueCount: selectedInputs.length,
                domSelectedVenueCount,
                mainInternalSelectedVenueCount,
                mainActiveVenueNodeCount,
                effectiveSelectedVenueCount: Math.max(
                    selectedInputs.length,
                    domSelectedVenueCount,
                    mainActiveVenueNodeCount
                ),
                selectedVenueSample: selectedInputs.slice(0, 8).map(el => el.id || el.name || el.value),
                hasCKALL4W: isSearchBridgeElementVisible(document.getElementById("CKALL4W")),
                hasBtnKaijo: isSearchBridgeElementVisible(document.getElementById("btn_kaijo")),
                hasBtKaijoExe: isSearchBridgeElementVisible(document.getElementById("btKaijo_exe")),
                hasConditionButton: hasAraiConditionSearchButton(),
                hasNameButton: hasAraiSearchButtonForKind(ARAI_SEARCH_KIND_NAME),
                hasAnySearchButton: hasAraiAnySearchButton(),
                hasResultContent: hasAraiSearchBridgeResultContent(),
                bridgeAction: root?.getAttribute(ARAI_KAIJO_ACTION_ATTR) || "",
                bridgeResult: root?.getAttribute(ARAI_KAIJO_RESULT_ATTR) || "",
                bridgeError: root?.getAttribute(ARAI_KAIJO_ERROR_ATTR) || "",
                mainDiagnostic,
                ...extra
            };
        }

        function getAraiEffectiveSelectedVenueCount(snapshot = createAraiSearchBridgeSnapshot()) {
            return Number(snapshot.effectiveSelectedVenueCount || 0);
        }

        function recordAraiSearchBridgeLog(step, detail = {}) {
            const entry = {
                at: new Date().toISOString(),
                step,
                detail,
                snapshot: createAraiSearchBridgeSnapshot()
            };

            console.info("MLive Linkifier: Arai bridge", step, entry);

            const storage = globalThis.chrome?.storage?.local;
            if (!storage) return;

            void (async () => {
                const result = await storage.get(ARAI_SEARCH_BRIDGE_LOG_KEY);
                const log = Array.isArray(result[ARAI_SEARCH_BRIDGE_LOG_KEY])
                    ? result[ARAI_SEARCH_BRIDGE_LOG_KEY]
                    : [];
                log.push(entry);
                await storage.set({ [ARAI_SEARCH_BRIDGE_LOG_KEY]: log.slice(-ARAI_SEARCH_BRIDGE_LOG_LIMIT) });
            })().catch(error => {
                if (!/extension context invalidated/i.test(String(error?.message || error))) {
                    console.warn("MLive Linkifier: Arai bridge log failed", error);
                }
            });
        }

        async function clearAraiSearchBridgePending(reason = "manual") {
            resetAraiSearchBridgeFlow();
            clearAraiPendingFallback();
            await chrome.storage.local.remove([ARAI_SEARCH_BRIDGE_PENDING_KEY, ARAI_SEARCH_BRIDGE_RUN_KEY]);
            if (siteSearchBridgeState.arai.pendingRetryTimer) {
                clearTimeout(siteSearchBridgeState.arai.pendingRetryTimer);
                siteSearchBridgeState.arai.pendingRetryTimer = null;
            }
            siteSearchBridgeState.arai.pendingApplied = false;
            siteSearchBridgeState.arai.pendingRunning = false;
            recordAraiSearchBridgeLog("保留クリア", { reason });
        }

        function getAraiVenueStateSignature() {
            const snapshot = createAraiSearchBridgeSnapshot();
            return JSON.stringify({
                url: snapshot.url,
                stage: snapshot.stage,
                selectedVenueCount: snapshot.selectedVenueCount,
                effectiveSelectedVenueCount: snapshot.effectiveSelectedVenueCount,
                mainInternalSelectedVenueCount: snapshot.mainInternalSelectedVenueCount,
                hasCKALL4W: snapshot.hasCKALL4W,
                hasBtnKaijo: snapshot.hasBtnKaijo,
                hasBtKaijoExe: snapshot.hasBtKaijoExe,
                hasConditionButton: snapshot.hasConditionButton,
                bridgeAction: snapshot.bridgeAction,
                bridgeResult: snapshot.bridgeResult,
                bridgeError: snapshot.bridgeError
            });
        }

        function updateAraiVenueRepeatState() {
            const signature = getAraiVenueStateSignature();
            if (signature === araiSearchBridgeFlow.lastSignature) {
                araiSearchBridgeFlow.sameSignatureCount += 1;
            } else {
                araiSearchBridgeFlow.lastSignature = signature;
                araiSearchBridgeFlow.sameSignatureCount = 1;
            }

            return araiSearchBridgeFlow.sameSignatureCount;
        }

        async function stopAraiSearchBridgeFlow(reason, detail = {}) {
            if (araiSearchBridgeFlow.stopped) return;

            araiSearchBridgeFlow.stopped = true;
            recordAraiSearchBridgeLog("失敗停止", { reason, ...detail });
            showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), reason, "error");
            clearAraiPendingFallback();
            await chrome.storage.local.remove([ARAI_SEARCH_BRIDGE_PENDING_KEY, ARAI_SEARCH_BRIDGE_RUN_KEY]);
        }

        async function markAraiSearchBridgeAwaitingResult(detail = {}) {
            await chrome.storage.local.set({
                [ARAI_SEARCH_BRIDGE_RUN_KEY]: {
                    awaitingResult: true,
                    createdAt: Date.now(),
                    url: location.href,
                    mode: getAraiSearchBridgeMode(),
                    detail
                }
            });
        }

        async function logAraiSearchBridgeResultIfReady() {
            if (araiResultCheckRunning) return;

            araiResultCheckRunning = true;
            try {
                const result = await chrome.storage.local.get(ARAI_SEARCH_BRIDGE_RUN_KEY);
                const runState = result[ARAI_SEARCH_BRIDGE_RUN_KEY];
                if (!runState?.awaitingResult) return;

                if (Date.now() - Number(runState.createdAt || 0) > 2 * 60 * 1000) {
                    await chrome.storage.local.remove(ARAI_SEARCH_BRIDGE_RUN_KEY);
                    recordAraiSearchBridgeLog("失敗停止", { reason: "検索結果の到達確認が時間切れになりました" });
                    return;
                }

                const stage = getAraiSearchBridgeStage();
                if (stage === "result") {
                    recordAraiSearchBridgeLog("結果到達", { from: runState.url, mode: runState.mode });
                    await chrome.storage.local.remove(ARAI_SEARCH_BRIDGE_RUN_KEY);
                }
            } catch (error) {
                if (!/extension context invalidated/i.test(String(error?.message || error))) {
                    console.warn("MLive Linkifier: Arai result log failed", error);
                }
            } finally {
                araiResultCheckRunning = false;
            }
        }

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

        function getAraiSearchKindTabId(mode, searchKind) {
            const kind = normalizeSiteSearchBridgeKind(searchKind) || ARAI_SEARCH_KIND_NAME;
            if (mode === "market") return kind === ARAI_SEARCH_KIND_CONDITION ? "johoTab3" : "johoTab1";
            return kind === ARAI_SEARCH_KIND_CONDITION ? "tbSearchTab5" : "tbSearchTab1";
        }

        function isAraiSearchKindTabActive(id) {
            const tab = document.getElementById(id);
            if (!tab) return false;

            const classText = String(tab.className || "");
            return /\b(active|on|selected|current)\b/i.test(classText);
        }

        function getAraiCurrentSearchKind() {
            const mode = getAraiSearchBridgeMode();
            if (isAraiSearchKindTabActive(getAraiSearchKindTabId(mode, ARAI_SEARCH_KIND_CONDITION))) {
                return ARAI_SEARCH_KIND_CONDITION;
            }
            if (isAraiSearchKindTabActive(getAraiSearchKindTabId(mode, ARAI_SEARCH_KIND_NAME))) {
                return ARAI_SEARCH_KIND_NAME;
            }

            if (isSearchBridgeElementVisible(document.getElementById("btAppointed"))) {
                return ARAI_SEARCH_KIND_CONDITION;
            }
            if (isSearchBridgeElementVisible(document.getElementById("history_check"))) {
                return ARAI_SEARCH_KIND_NAME;
            }

            return ARAI_SEARCH_KIND_NAME;
        }

        function isAraiConditionSearchFieldRecord(record) {
            const marker = `${record?.id || ""} ${record?.name || ""} ${record?.label || ""}`.toLowerCase();
            return /(nenshiki|year|odo|meter|soukou|mileage|hyoka|score|point|price|kakaku|color|colour|shaken|inspection|fuel|gas|cc|haiki|mission|shift|katashiki|modelyear)/i.test(marker);
        }

        function isAraiNameSearchFieldRecord(record) {
            const id = String(record?.id || "");
            const name = String(record?.name || "");
            return id === "history_check" ||
                id === "pattern" ||
                name === "history_check" ||
                name === "pattern" ||
                id === "aaa" ||
                /^(maker|model|car|grade|syasyu|syamei|shashu|ckcarname|ckshasyu|ckgrade|ckkatasiki)\d+$/i.test(id);
        }

        function isAraiNameCascadeFieldRecord(record) {
            return /^(maker|ckcarname|ckshasyu|ckgrade|ckkatasiki)\d+$/i.test(String(record?.id || ""));
        }

        function isAraiNameSearchTailFieldRecord(record) {
            const id = String(record?.id || "").toLowerCase();
            const name = String(record?.name || "").toLowerCase();
            if (isAraiNameSearchKeywordRecord(record) || id === "aaa") return true;

            return /^(radio[13]|nen(?:_|$)|soko(?:_|$)|hyoka(?:_|$)|sekisai(?:_|$)|bariki(?:_|$)|me_kbn(?:_|$)|haiki(?:_|$)|shaken(?:_|$)|color(?:_|$)|mission(?:_|$)|shift(?:_|$)|fuel(?:_|$)|gas(?:_|$)|cc(?:_|$)|katashiki(?:_|$)|katasiki(?:_|$))/.test(id) ||
                /^(nen|soko|hyoka|sekisai|bariki|me_kbn|haiki|shaken|color|mission|shift|fuel|gas|cc|katashiki|katasiki)/.test(name);
        }

        function isAraiNameSearchStructuredFieldRecord(record) {
            return isAraiNameCascadeFieldRecord(record) || isAraiNameSearchTailFieldRecord(record);
        }

        const ARAI_NAME_CASCADE_DEFINITIONS = [
            {
                kind: "maker",
                selector: "#makerList a[id^='t']",
                getInputId: id => `maker${String(id).slice(1)}`
            },
            {
                kind: "car",
                selector: "#syameiList a[id^='carName']",
                getInputId: id => `ck${id}`
            },
            {
                kind: "shasyu",
                selector: "#shasyuList a[id^='shasyu']",
                getInputId: id => `ck${id}`
            },
            {
                kind: "grade",
                selector: "#gradeList a[id^='grade']",
                getInputId: id => `ck${id}`
            },
            {
                kind: "katasiki",
                selector: "#katasikiList a[id^='katasiki']",
                getInputId: id => `ck${id}`
            }
        ];

        function getAraiNameCascadeDefinition(kind) {
            return ARAI_NAME_CASCADE_DEFINITIONS.find(definition => definition.kind === kind) || null;
        }

        function normalizeAraiNameCascadeLabel(value) {
            return normalizeSearchBridgeText(value)
                .replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
                .replace(/\d[\d,]*\s*(?:台|件)/g, " ")
                .replace(/\s+/g, " ")
                .trim();
        }

        function getAraiNameCascadeCandidateKey(value) {
            return normalizeAraiNameCascadeLabel(value)
                .replace(/\s+/g, "")
                .toLowerCase();
        }

        function getAraiSelectedNameCascadeSteps() {
            const steps = [];

            for (const definition of ARAI_NAME_CASCADE_DEFINITIONS) {
                const candidates = Array.from(document.querySelectorAll(definition.selector));
                for (const candidate of candidates) {
                    const inputId = definition.getInputId(candidate.id);
                    const input = document.getElementById(inputId);
                    if (!input?.checked) continue;

                    const label = normalizeAraiNameCascadeLabel(candidate.textContent || "");
                    const candidateKey = getAraiNameCascadeCandidateKey(label);
                    if (!label || !candidateKey) continue;

                    steps.push({
                        kind: definition.kind,
                        sourceId: candidate.id,
                        inputId,
                        inputValue: String(input.value || ""),
                        label,
                        candidateKey
                    });
                }
            }

            return steps;
        }

        function getAraiNameCascadeSteps(condition = null) {
            const steps = Array.isArray(condition?.araiNameCascade?.steps)
                ? condition.araiNameCascade.steps
                : [];

            return steps.filter(step => {
                const definition = getAraiNameCascadeDefinition(step?.kind);
                return !!definition && !!getAraiNameCascadeCandidateKey(step?.candidateKey || step?.label || "");
            });
        }

        function hasAraiLegacyNameCascadeSelection(condition = null) {
            return (condition?.fields || []).some(record =>
                isAraiNameCascadeFieldRecord(record) && !!record.checked
            );
        }

        function getAraiConditionSearchKind(condition) {
            const explicitKind = normalizeSiteSearchBridgeKind(condition?.araiSearchKind || condition?.searchKind);
            if (explicitKind) return explicitKind;

            const fields = Array.isArray(condition?.fields) ? condition.fields : [];
            if (fields.some(record => isAraiNameSearchFieldRecord(record))) return ARAI_SEARCH_KIND_NAME;

            return fields.some(record => isAraiConditionSearchFieldRecord(record))
                ? ARAI_SEARCH_KIND_CONDITION
                : ARAI_SEARCH_KIND_NAME;
        }

        function isAraiFieldCompatibleWithSearchKind(record, searchKind) {
            const kind = normalizeSiteSearchBridgeKind(searchKind) || ARAI_SEARCH_KIND_NAME;
            if (kind === ARAI_SEARCH_KIND_NAME) return isAraiNameSearchStructuredFieldRecord(record);
            return !isAraiNameSearchFieldRecord(record);
        }

        function isAraiNameSearchKeywordRecord(record) {
            const id = String(record?.id || "");
            const name = String(record?.name || "");
            return id === "history_check" ||
                id === "pattern" ||
                name === "history_check" ||
                name === "pattern";
        }

        function getAraiSavedNameSearchKeyword(condition = null) {
            const fields = Array.isArray(condition?.fields) ? condition.fields : [];
            for (const record of fields) {
                if (!isAraiNameSearchKeywordRecord(record)) continue;

                const keyword = normalizeSearchBridgeText(record?.value);
                if (keyword) return keyword;
            }

            return "";
        }

        function getAraiNameSearchInput() {
            const historyInput = document.getElementById("history_check");
            if (isSearchBridgeElementVisible(historyInput)) return historyInput;

            const patternInput = document.querySelector("input[name='pattern']");
            if (isSearchBridgeElementVisible(patternInput)) return patternInput;

            return null;
        }

        function getAraiCurrentNameSearchKeyword() {
            const input = getAraiNameSearchInput();
            return normalizeSearchBridgeText(input?.value || "");
        }

        function hasAraiNameSearchKeyword(condition = null) {
            if (getAraiSavedNameSearchKeyword(condition)) return true;

            return !!getAraiCurrentNameSearchKeyword();
        }

        function getAraiSearchKindAction(searchKind) {
            return getAraiConditionSearchKind({ araiSearchKind: searchKind }) === ARAI_SEARCH_KIND_NAME
                ? "activate_name_tab"
                : "activate_condition_tab";
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

            const araiSearchKind = getAraiCurrentSearchKind();
            const fields = Array.from(document.querySelectorAll("input,select,textarea"))
                .map(el => createSearchBridgeFieldRecord(el))
                .filter(record => record && isAraiFieldCompatibleWithSearchKind(record, araiSearchKind));

            if (fields.length === 0) return null;

            const araiNameCascade = araiSearchKind === ARAI_SEARCH_KIND_NAME
                ? { version: 1, steps: getAraiSelectedNameCascadeSteps() }
                : null;
            const cascadeSummary = araiNameCascade?.steps
                .map(step => step.label)
                .filter(Boolean)
                .join(" > ");
            const genericSummary = buildSiteSearchBridgeConditionSummary(fields);

            return {
                version: MLIVE_SEARCH_BRIDGE_VERSION,
                sourceMode,
                araiSearchKind,
                fields,
                araiNameCascade: araiNameCascade?.steps.length ? araiNameCascade : undefined,
                summary: cascadeSummary ? `車名:${cascadeSummary}${genericSummary ? ` / ${genericSummary}` : ""}` : genericSummary,
                savedAt: Date.now(),
                sourceUrl: location.href
            };
        }

        function findAraiSearchBridgeControl(record, searchKind = ARAI_SEARCH_KIND_NAME) {
            const kind = getAraiConditionSearchKind({ araiSearchKind: searchKind });

            if (kind === ARAI_SEARCH_KIND_NAME) {
                if (isAraiNameSearchKeywordRecord(record)) {
                    return getAraiNameSearchInput() ||
                        document.querySelector("input[name='pattern']") ||
                        document.getElementById("history_check") ||
                        findSearchBridgeControlByName(record);
                }

                if (record.id === "aaa") {
                    return document.getElementById("aaa") || findSearchBridgeControlByName(record);
                }
            }

            if (record.id) {
                const byId = document.getElementById(record.id);
                if (byId) return byId;
            }

            return findSearchBridgeControlByName(record);
        }

        function clickAraiNameSearchMirrorControl(target) {
            if (!target?.id) return false;

            const makerMatch = String(target.id).match(/^(maker|model|car|grade|syasyu|syamei|shashu)(\d+)$/i);
            const candidateIds = makerMatch ? [`t${makerMatch[2]}`, `${target.id}_label`, `${target.id}_btn`] : [];
            for (const id of candidateIds) {
                const mirror = document.getElementById(id);
                if (isSearchBridgeElementVisible(mirror) && clickSearchBridgeElement(mirror, true)) return true;
            }

            const nearby = target.closest("li,td,div,label")?.querySelector("a,button,label,span");
            return isSearchBridgeElementVisible(nearby) ? clickSearchBridgeElement(nearby, true) : false;
        }

        function applyAraiSearchBridgeFieldRecord(target, record, searchKind) {
            const kind = getAraiConditionSearchKind({ araiSearchKind: searchKind });
            const type = String(target?.type || "").toLowerCase();

            if (kind === ARAI_SEARCH_KIND_NAME && (type === "checkbox" || type === "radio") && target.checked !== !!record.checked) {
                clickAraiNameSearchMirrorControl(target);
            }

            applySearchBridgeFieldRecord(target, record);

            if (kind === ARAI_SEARCH_KIND_NAME && (target.id === "history_check" || target.name === "pattern")) {
                target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
                target.dispatchEvent(new Event("blur", { bubbles: true }));
            }
        }

        function findAraiNameCascadeCandidate(step) {
            const definition = getAraiNameCascadeDefinition(step?.kind);
            const candidateKey = getAraiNameCascadeCandidateKey(step?.candidateKey || step?.label || "");
            if (!definition || !candidateKey) return { definition, candidates: [], allMatches: [], matches: [] };

            const candidates = Array.from(document.querySelectorAll(definition.selector));
            const allMatches = candidates.filter(candidate =>
                getAraiNameCascadeCandidateKey(candidate.textContent || "") === candidateKey
            );
            const matches = allMatches.filter(candidate => isSearchBridgeElementVisible(candidate));
            return { definition, candidates, allMatches, matches };
        }

        function isAraiNameCascadeCandidateSelected(candidate, definition) {
            if (!candidate || !definition) return false;
            const input = document.getElementById(definition.getInputId(candidate.id));
            return !!input?.checked;
        }

        function resetAraiNameCascadeProgress(signature) {
            Object.assign(araiSearchBridgeFlow, {
                nameCascadeSignature: signature,
                nameCascadeIndex: 0,
                nameCascadeActionAt: 0,
                nameCascadeActionId: "",
                nameCascadeWaitStartedAt: 0,
                nameCascadeLoggedIndex: -1
            });
        }

        async function advanceAraiNameCascadeRestore(condition) {
            const steps = getAraiNameCascadeSteps(condition);
            if (steps.length === 0) {
                if (hasAraiLegacyNameCascadeSelection(condition)) {
                    await stopAraiSearchBridgeFlow("保存条件に車名選択の順序情報がありません。車名検索画面で同じ条件を保存し直してください。");
                    return { complete: false, stopped: true };
                }
                return { complete: true, stopped: false };
            }

            const signature = JSON.stringify(steps.map(step => [step.kind, step.candidateKey || step.label || ""]));
            if (araiSearchBridgeFlow.nameCascadeSignature !== signature) {
                resetAraiNameCascadeProgress(signature);
            }

            while (araiSearchBridgeFlow.nameCascadeIndex < steps.length) {
                const currentStep = steps[araiSearchBridgeFlow.nameCascadeIndex];
                const match = findAraiNameCascadeCandidate(currentStep);
                if (match.allMatches.length !== 1 || !isAraiNameCascadeCandidateSelected(match.allMatches[0], match.definition)) break;

                araiSearchBridgeFlow.nameCascadeIndex += 1;
                araiSearchBridgeFlow.nameCascadeActionAt = 0;
                araiSearchBridgeFlow.nameCascadeActionId = "";
                araiSearchBridgeFlow.nameCascadeWaitStartedAt = 0;
            }

            if (araiSearchBridgeFlow.nameCascadeIndex >= steps.length) {
                recordAraiSearchBridgeLog("車名選択復元完了", { stepCount: steps.length });
                return { complete: true, stopped: false };
            }

            const index = araiSearchBridgeFlow.nameCascadeIndex;
            const currentStep = steps[index];
            const match = findAraiNameCascadeCandidate(currentStep);
            const currentLabel = currentStep.label || currentStep.kind;
            const elapsed = araiSearchBridgeFlow.nameCascadeWaitStartedAt
                ? Date.now() - araiSearchBridgeFlow.nameCascadeWaitStartedAt
                : 0;

            if (match.matches.length !== 1) {
                if (!araiSearchBridgeFlow.nameCascadeWaitStartedAt) {
                    araiSearchBridgeFlow.nameCascadeWaitStartedAt = Date.now();
                }
                if (araiSearchBridgeFlow.nameCascadeLoggedIndex !== index) {
                    araiSearchBridgeFlow.nameCascadeLoggedIndex = index;
                    recordAraiSearchBridgeLog("車名候補待機", {
                        index,
                        kind: currentStep.kind,
                        label: currentLabel,
                        candidateCount: match.candidates.length,
                        matchCount: match.matches.length
                    });
                }
                if (elapsed > ARAI_NAME_CASCADE_MAX_WAIT_MS) {
                    await stopAraiSearchBridgeFlow(`Araiの車名候補「${currentLabel}」が表示されませんでした。検索は実行していません。`, {
                        index,
                        kind: currentStep.kind,
                        candidateCount: match.candidates.length,
                        matchCount: match.matches.length
                    });
                    return { complete: false, stopped: true };
                }
                return { complete: false, stopped: false };
            }

            const candidate = match.matches[0];
            const actionId = `${currentStep.kind}:${candidate.id}`;
            if (araiSearchBridgeFlow.nameCascadeActionId !== actionId) {
                const action = runAraiKaijoSelectorAction("name_cascade_step", {
                    payload: {
                        kind: currentStep.kind,
                        candidateId: candidate.id,
                        inputId: match.definition.getInputId(candidate.id),
                        label: currentLabel
                    }
                });
                if (!action.ok) {
                    await stopAraiSearchBridgeFlow(`Araiの車名候補「${currentLabel}」を選択できませんでした。検索は実行していません。`, {
                        index,
                        kind: currentStep.kind,
                        error: action.error,
                        diagnostic: action.diagnostic
                    });
                    return { complete: false, stopped: true };
                }

                araiSearchBridgeFlow.nameCascadeActionId = actionId;
                araiSearchBridgeFlow.nameCascadeActionAt = Date.now();
                araiSearchBridgeFlow.nameCascadeWaitStartedAt = Date.now();
                araiSearchBridgeFlow.nameCascadeLoggedIndex = -1;
                recordAraiSearchBridgeLog("車名候補選択", {
                    index,
                    kind: currentStep.kind,
                    label: currentLabel,
                    candidateId: candidate.id,
                    diagnostic: action.diagnostic
                });
                return { complete: false, stopped: false };
            }

            if (Date.now() - araiSearchBridgeFlow.nameCascadeActionAt > ARAI_NAME_CASCADE_MAX_WAIT_MS) {
                await stopAraiSearchBridgeFlow(`Araiの車名候補「${currentLabel}」の選択確認ができませんでした。検索は実行していません。`, {
                    index,
                    kind: currentStep.kind,
                    candidateId: candidate.id
                });
                return { complete: false, stopped: true };
            }

            return { complete: false, stopped: false };
        }

        async function restoreAraiSearchBridgeCondition(condition) {
            const targetSearchKind = getAraiConditionSearchKind(condition);
            const savedNameKeyword = getAraiSavedNameSearchKeyword(condition);
            const readiness = getAraiSearchBridgeRestoreReadiness(condition);
            if (araiSearchBridgeFlow.conditionFormLoggedUrl !== location.href) {
                araiSearchBridgeFlow.conditionFormLoggedUrl = location.href;
                recordAraiSearchBridgeLog("条件フォーム到達", {
                    targetMode: getAraiSearchBridgeMode(),
                    targetSearchKind,
                    fieldCount: condition.fields?.length || 0
                });
            }

            if (!readiness.ready) {
                recordAraiSearchBridgeLog("arai_restore_wait", {
                    targetMode: getAraiSearchBridgeMode(),
                    targetSearchKind,
                    reason: readiness.reason,
                    tabReady: readiness.tabReady,
                    keywordRestored: readiness.keywordRestored
                });
                return false;
            }

            if (targetSearchKind === ARAI_SEARCH_KIND_NAME) {
                const cascade = await advanceAraiNameCascadeRestore(condition);
                if (!cascade.complete) return false;
            }

            let restoredCount = 0;
            for (const record of condition.fields || []) {
                if (!isAraiFieldCompatibleWithSearchKind(record, targetSearchKind)) continue;
                if (targetSearchKind === ARAI_SEARCH_KIND_NAME && isAraiNameCascadeFieldRecord(record)) continue;

                const target = findAraiSearchBridgeControl(record, targetSearchKind);
                if (!target) continue;

                applyAraiSearchBridgeFieldRecord(target, record, targetSearchKind);
                restoredCount += 1;
            }

            recordAraiSearchBridgeLog("条件復元", {
                targetMode: getAraiSearchBridgeMode(),
                targetSearchKind,
                restoredCount,
                fieldCount: condition.fields?.length || 0
            });

            const restoredNameKeyword = getAraiCurrentNameSearchKeyword();
            const keywordRestored = targetSearchKind !== ARAI_SEARCH_KIND_NAME ||
                !savedNameKeyword ||
                restoredNameKeyword === savedNameKeyword ||
                !!restoredNameKeyword;
            recordAraiSearchBridgeLog("arai_restore_result", {
                targetMode: getAraiSearchBridgeMode(),
                targetSearchKind,
                tabReady: getAraiSearchBridgeRestoreReadiness(condition).tabReady,
                keywordRestored,
                savedNameKeyword,
                restoredNameKeyword
            });

            if (targetSearchKind === ARAI_SEARCH_KIND_NAME && savedNameKeyword && !keywordRestored) {
                recordAraiSearchBridgeLog("arai_restore_wait", {
                    targetMode: getAraiSearchBridgeMode(),
                    targetSearchKind,
                    reason: "name_keyword_not_restored",
                    savedNameKeyword,
                    restoredNameKeyword
                });
                return false;
            }

            return true;
        }

        function getAraiSearchBridgeTargetUrl(mode) {
            if (mode === "listing") return new URL("/01_search.html", location.origin).toString();
            if (mode === "market") return new URL(`/04_information.html?id=0=${Math.random()}`, location.origin).toString();
            return "";
        }

        function isAraiSearchBridgeLoading() {
            return (document.body?.innerText || "").includes("検索中です");
        }

        function activateAraiSearchBridgeConditionTab(mode) {
            if (isAraiSearchBridgeLoading() || hasAraiConditionSearchButton()) return;

            const tabId = mode === "market" ? "johoTab3" : "tbSearchTab5";
            const tab = document.getElementById(tabId) ||
                Array.from(document.querySelectorAll("a,button")).find(el => normalizeSearchBridgeText(el.textContent) === "条件指定");

            if (isSearchBridgeElementVisible(tab)) {
                tab.click();
            }
        }

        function activateAraiSearchBridgeTargetTab(mode, condition) {
            const targetSearchKind = getAraiConditionSearchKind(condition);
            if (isAraiSearchBridgeLoading()) return;

            if (targetSearchKind === ARAI_SEARCH_KIND_NAME && isAraiNameSearchFormReady(mode)) return;
            if (targetSearchKind === ARAI_SEARCH_KIND_CONDITION && isAraiConditionSearchFormReady(mode)) return;

            const actionResult = runAraiKaijoSelectorAction(getAraiSearchKindAction(targetSearchKind));
            recordAraiSearchBridgeLog("arai_target_tab_activate", {
                targetMode: mode,
                targetSearchKind,
                ok: actionResult.ok,
                error: actionResult.error,
                diagnostic: actionResult.diagnostic
            });

            const tab = document.getElementById(getAraiSearchKindTabId(mode, targetSearchKind));
            if (isSearchBridgeElementVisible(tab)) {
                tab.click();
            }
        }

        function isAraiNameSearchFormReady(mode = getAraiSearchBridgeMode()) {
            const nameInput = getAraiNameSearchInput();
            if (!nameInput) return false;

            const tabId = getAraiSearchKindTabId(mode, ARAI_SEARCH_KIND_NAME);
            const nameTab = document.getElementById(tabId);
            const conditionTabActive = isAraiSearchKindTabActive(getAraiSearchKindTabId(mode, ARAI_SEARCH_KIND_CONDITION));
            const tabReady = !nameTab || isAraiSearchKindTabActive(tabId) || !conditionTabActive;
            return tabReady && isSearchBridgeElementVisible(nameInput);
        }

        function isAraiConditionSearchFormReady(mode = getAraiSearchBridgeMode()) {
            const conditionTabActive = isAraiSearchKindTabActive(getAraiSearchKindTabId(mode, ARAI_SEARCH_KIND_CONDITION));
            return isSearchBridgeElementVisible(document.getElementById("btAppointed")) ||
                (conditionTabActive && isSearchBridgeElementVisible(document.getElementById("btSearch")));
        }

        function isAraiActiveSearchInputForm(condition = null, mode = getAraiSearchBridgeMode()) {
            const targetSearchKind = getAraiConditionSearchKind(condition);
            return targetSearchKind === ARAI_SEARCH_KIND_NAME
                ? isAraiNameSearchFormReady(mode)
                : isAraiConditionSearchFormReady(mode);
        }

        function getAraiSearchBridgeRestoreReadiness(condition = null, mode = getAraiSearchBridgeMode()) {
            const targetSearchKind = getAraiConditionSearchKind(condition);
            const savedKeyword = getAraiSavedNameSearchKeyword(condition);
            const nameInput = getAraiNameSearchInput();

            if (isAraiVenueSelectionStep(condition, mode)) {
                return {
                    ready: false,
                    targetSearchKind,
                    tabReady: false,
                    keywordRestored: false,
                    reason: "venue"
                };
            }

            if (targetSearchKind === ARAI_SEARCH_KIND_NAME) {
                const tabReady = isAraiNameSearchFormReady(mode);
                const keywordRestored = !savedKeyword ||
                    normalizeSearchBridgeText(nameInput?.value || "") === savedKeyword ||
                    !!normalizeSearchBridgeText(nameInput?.value || "");
                return {
                    ready: tabReady && !!nameInput,
                    targetSearchKind,
                    tabReady,
                    keywordRestored,
                    reason: tabReady && nameInput ? "" : "name_form_not_ready"
                };
            }

            const tabReady = isAraiConditionSearchFormReady(mode);
            return {
                ready: tabReady,
                targetSearchKind,
                tabReady,
                keywordRestored: true,
                reason: tabReady ? "" : "condition_form_not_ready"
            };
        }

        function getVisibleAraiSearchButton(ids) {
            for (const id of ids) {
                const button = document.getElementById(id);
                if (isSearchBridgeElementVisible(button)) return button;
            }

            return null;
        }

        function getAraiNameSearchButton() {
            const nameInput = getAraiNameSearchInput();
            if (!nameInput) return null;

            if (getAraiCurrentNameSearchKeyword()) {
                const freewordButton = getAraiFreewordSearchButton();
                if (freewordButton) return freewordButton;
            }

            return getVisibleAraiSearchButton(["btSearch"]) ||
                findVisibleSearchBridgeButtonByText("縺薙・譚｡莉ｶ縺ｧ讀懃ｴ｢");
        }

        function getAraiFreewordSearchButton() {
            const historyInput = getAraiNameSearchInput();
            if (!historyInput) return null;

            const directLink = Array.from(document.querySelectorAll("a[href]"))
                .find(el => /onK\s*\(\s*\)\s*;?/i.test(String(el.getAttribute("href") || "")) &&
                    isSearchBridgeElementVisible(el));
            if (directLink) return directLink;

            const nearbyButton = historyInput
                ? Array.from(historyInput.parentElement?.querySelectorAll("button,input[type='button'],input[type='submit'],a") || [])
                    .find(isSearchBridgeElementVisible)
                : null;

            return findVisibleSearchBridgeButtonByText("フリーワード検索") ||
                nearbyButton ||
                Array.from(document.querySelectorAll("button,input[type='button'],input[type='submit'],a"))
                    .find(el => normalizeSearchBridgeText(el.textContent || el.value || "").includes("フリーワード") && isSearchBridgeElementVisible(el)) ||
                null;
        }

        function getAraiNameSearchButtonForCondition(condition = null) {
            if (hasAraiNameSearchKeyword(condition)) {
                const freewordButton = getAraiFreewordSearchButton();
                if (freewordButton) return freewordButton;
            }

            return getAraiNameSearchButton();
        }

        function getAraiConditionSearchButton() {
            const mode = getAraiSearchBridgeMode();
            const conditionTabActive = isAraiSearchKindTabActive(getAraiSearchKindTabId(mode, ARAI_SEARCH_KIND_CONDITION));
            const nameTabActive = isAraiSearchKindTabActive(getAraiSearchKindTabId(mode, ARAI_SEARCH_KIND_NAME));
            const nameInputVisible = isSearchBridgeElementVisible(document.getElementById("history_check"));
            const mayUseBtSearch = conditionTabActive || (!nameTabActive && !nameInputVisible);
            return getVisibleAraiSearchButton(["btAppointed"]) ||
                (mayUseBtSearch ? getVisibleAraiSearchButton(["btSearch"]) : null) ||
                (mayUseBtSearch ? findVisibleSearchBridgeButtonByText("縺薙・譚｡莉ｶ縺ｧ讀懃ｴ｢") : null);
        }

        function getAraiSearchButtonForKind(searchKind, condition = null) {
            return getAraiConditionSearchKind({ araiSearchKind: searchKind }) === ARAI_SEARCH_KIND_NAME
                ? getAraiNameSearchButtonForCondition(condition)
                : getAraiConditionSearchButton();
        }

        function hasAraiSearchButtonForKind(searchKind, condition = null) {
            const kind = getAraiConditionSearchKind({ araiSearchKind: searchKind });
            if (kind === ARAI_SEARCH_KIND_NAME && hasAraiNameSearchKeyword(condition)) {
                return isAraiNameSearchFormReady();
            }

            return !!getAraiSearchButtonForKind(searchKind, condition);
        }

        function hasAraiAnySearchButton() {
            return !!(getAraiNameSearchButton() || getAraiConditionSearchButton());
        }

        function isAraiSearchBridgeInputFormReady(condition = null) {
            if (isAraiVenueSelectionStep(condition)) return false;

            const readiness = getAraiSearchBridgeRestoreReadiness(condition);
            if (readiness.ready) return true;
            if (readiness.targetSearchKind === ARAI_SEARCH_KIND_NAME) return false;

            return isSearchBridgeElementVisible(document.getElementById("btBackToMake2")) ||
                isSearchBridgeElementVisible(document.getElementById("btAddTerms"));
        }

        function hasAraiConditionSearchButton() {
            return !!getAraiConditionSearchButton();
        }

        function isAraiVenueSelectionStep(condition = null, mode = getAraiSearchBridgeMode()) {
            const venueButton = getVisibleAraiSearchButton(["btn_kaijo", "btKaijo_exe"]);
            const venueArea = document.getElementById("tbKaijoList");
            const all4w = document.getElementById("CKALL4W");

            return !!venueButton ||
                (isSearchBridgeElementVisible(venueArea) && isSearchBridgeElementVisible(all4w));
        }

        let araiPendingLoadingStartedAt = 0;

        function runAraiKaijoSelectorAction(id, options = {}) {
            const root = document.documentElement;
            if (!root) {
                return { ok: false, error: "documentElement is not ready", diagnostic: null };
            }

            const action = String(id || "");
            root.setAttribute(ARAI_KAIJO_ACTION_ATTR, action);
            root.setAttribute(ARAI_KAIJO_RESULT_ATTR, "0");
            root.setAttribute(ARAI_KAIJO_PROBE_ONLY_ATTR, options.probeOnly ? "1" : "0");
            if (options.payload !== undefined) {
                root.setAttribute(ARAI_KAIJO_PAYLOAD_ATTR, JSON.stringify(options.payload));
            } else {
                root.removeAttribute(ARAI_KAIJO_PAYLOAD_ATTR);
            }
            root.removeAttribute(ARAI_KAIJO_ERROR_ATTR);
            root.removeAttribute(ARAI_KAIJO_DIAGNOSTIC_ATTR);
            try {
                window.dispatchEvent(new CustomEvent(ARAI_KAIJO_ACTION_EVENT));

                return {
                    ok: root.getAttribute(ARAI_KAIJO_RESULT_ATTR) === "1",
                    error: root.getAttribute(ARAI_KAIJO_ERROR_ATTR) || "",
                    diagnostic: parseAraiKaijoDiagnostic()
                };
            } finally {
                root.removeAttribute(ARAI_KAIJO_PAYLOAD_ATTR);
            }
        }

        function waitForAraiBridgeDelay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        async function selectAraiFourWheelVenuesDirectly() {
            if (getAraiCheckedVenueCount() > 0) return true;
            if (araiSearchBridgeFlow.venueSelectAttemptCount >= 4) return false;
            araiSearchBridgeFlow.venueSelectAttemptCount += 1;

            const beforeSnapshot = createAraiSearchBridgeSnapshot();
            const all4w = document.getElementById("CKALL4W");
            let domClickOk = false;
            let selectResult = { ok: false, error: "", diagnostic: null };

            if (isSearchBridgeElementVisible(all4w)) {
                domClickOk = clickSearchBridgeElement(all4w, true);
                await waitForAraiBridgeDelay(450);
            }

            if (!getAraiDomSelectedVenueCount()) {
                selectResult = runAraiKaijoSelectorAction("select_venues_auto");
                await waitForAraiBridgeDelay(450);
            }

            const forcedVenueChecks = forceAraiFourWheelVenueCheckboxes();
            if (forcedVenueChecks) await waitForAraiBridgeDelay(150);

            araiSearchBridgeFlow.venueSelectClicked = true;
            const afterSnapshot = createAraiSearchBridgeSnapshot();
            const afterEffectiveSelectedVenueCount = getAraiEffectiveSelectedVenueCount(afterSnapshot);
            recordAraiSearchBridgeLog("Arai venue selection attempts", {
                ok: selectResult.ok || afterEffectiveSelectedVenueCount > 0,
                method: domClickOk ? "dom-click:CKALL4W" : "main-world:auto",
                error: selectResult.error,
                beforeEffectiveSelectedVenueCount: getAraiEffectiveSelectedVenueCount(beforeSnapshot),
                afterEffectiveSelectedVenueCount,
                domSelectedVenueCount: getAraiDomSelectedVenueCount(),
                forcedVenueChecks,
                attemptCount: araiSearchBridgeFlow.venueSelectAttemptCount,
                diagnostic: selectResult.diagnostic
            });

            return selectResult.ok || afterEffectiveSelectedVenueCount > 0;
        }

        function hasAraiSelectedVenue() {
            const venueInputs = getAraiVenueInputs();
            if (venueInputs.length > 0) {
                if (venueInputs.some(el => el.checked)) return true;
            }

            if (getAraiDomSelectedVenueCount() > 0) return true;

            const all4wIcon = document.getElementById("ic_4w");
            if (all4wIcon) {
                const style = window.getComputedStyle(all4wIcon);
                if (style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0") return true;
            }

            const toggleCar = document.getElementById("toggle_car");
            const classText = `${toggleCar?.className || ""} ${document.getElementById("CKALL4W")?.className || ""}`;
            return /\b(on|active|selected|checked|is-active|is-selected)\b/i.test(classText);
        }

        async function advanceAraiVenueSelection(pending = null) {
            if (pending) ensureAraiSearchBridgeFlow(pending);
            if (araiSearchBridgeFlow.stopped) return { handled: true, delay: 0 };
            const targetSearchKind = getAraiConditionSearchKind(pending?.condition);
            const targetTabAction = getAraiSearchKindAction(targetSearchKind);

            const repeatCount = updateAraiVenueRepeatState();
            if (!araiSearchBridgeFlow.venuePageLogged) {
                araiSearchBridgeFlow.venuePageLogged = true;
                recordAraiSearchBridgeLog("会場ページ到達", {
                    targetMode: getAraiSearchBridgeMode(),
                    pendingId: araiSearchBridgeFlow.pendingId
                });
            }

            if (!araiSearchBridgeFlow.conditionTabActivated) {
                const tabResult = runAraiKaijoSelectorAction(targetTabAction);
                recordAraiSearchBridgeLog("Arai condition tab activated", {
                    ok: tabResult.ok,
                    error: tabResult.error,
                    diagnostic: tabResult.diagnostic
                });

                if (!tabResult.ok) {
                    araiSearchBridgeFlow.nextActionFailures += 1;
                    if (araiSearchBridgeFlow.nextActionFailures >= 3) {
                        await stopAraiSearchBridgeFlow("Arai condition tab activation failed", {
                            error: tabResult.error,
                            diagnostic: tabResult.diagnostic
                        });
                        return { handled: true, delay: 0 };
                    }

                    return { handled: true, delay: 900 };
                }

                araiSearchBridgeFlow.conditionTabActivated = true;
                araiSearchBridgeFlow.lastSignature = "";
                araiSearchBridgeFlow.sameSignatureCount = 0;
                return { handled: true, delay: 900 };
            }

            const currentSnapshot = createAraiSearchBridgeSnapshot();
            let selectedCount = getAraiCheckedVenueCount();
            const effectiveSelectedCount = getAraiEffectiveSelectedVenueCount(currentSnapshot);
            const all4w = document.getElementById("CKALL4W");
            const openVenueButton = getVisibleAraiSearchButton(["btn_kaijo"]);

            if (selectedCount === 0 && effectiveSelectedCount > 0 && isSearchBridgeElementVisible(all4w)) {
                const restoredVenueChecks = forceAraiFourWheelVenueCheckboxes();
                if (restoredVenueChecks) await waitForAraiBridgeDelay(150);
                selectedCount = getAraiCheckedVenueCount();
                recordAraiSearchBridgeLog("会場チェック復元", {
                    restoredVenueChecks,
                    selectedVenueCount: selectedCount,
                    effectiveSelectedVenueCount: effectiveSelectedCount
                });
            }

            if (selectedCount === 0) {
                if (!isSearchBridgeElementVisible(all4w) && openVenueButton) {
                    recordAraiSearchBridgeLog("会場ページ到達", { action: "open_venue_selector" });
                    clickSearchBridgeElement(openVenueButton, true);
                    return { handled: true, delay: 900 };
                }

                if (isSearchBridgeElementVisible(all4w)) {
                    const selected = await selectAraiFourWheelVenuesDirectly();
                    const nextSelectedCount = getAraiCheckedVenueCount();
                    if (selected && nextSelectedCount > 0) {
                        araiSearchBridgeFlow.venueSelectedLogged = true;
                        recordAraiSearchBridgeLog("会場選択済み", {
                            selectedVenueCount: nextSelectedCount
                        });
                        return { handled: true, delay: 350 };
                    }
                }

                if (repeatCount >= 7) {
                    await stopAraiSearchBridgeFlow("Arai会場を選択できませんでした", {
                        repeatCount,
                        selectedCount
                    });
                    return { handled: true, delay: 0 };
                }

                return { handled: true, delay: 900 };
            }

            if (!araiSearchBridgeFlow.venueSelectedLogged) {
                araiSearchBridgeFlow.venueSelectedLogged = true;
                recordAraiSearchBridgeLog("会場選択済み", { selectedVenueCount: selectedCount });
            }

            const nextButton = getVisibleAraiSearchButton(["btKaijo_exe"]);
            if (!nextButton) {
                if (repeatCount >= 7) {
                    await stopAraiSearchBridgeFlow("Arai会場の次へボタンが見つかりません", {
                        repeatCount,
                        selectedCount
                    });
                    return { handled: true, delay: 0 };
                }

                return { handled: true, delay: 900 };
            }

            if (
                araiSearchBridgeFlow.nextAttempted &&
                selectedCount > 0 &&
                araiSearchBridgeFlow.nextAttemptCount < 4 &&
                Date.now() - araiSearchBridgeFlow.nextAttemptedAt > 1200
            ) {
                const elapsedAfterNext = Date.now() - araiSearchBridgeFlow.nextAttemptedAt;
                if (elapsedAfterNext < 12000) {
                    return { handled: true, delay: 700 };
                }
                await stopAraiSearchBridgeFlow("Arai condition form did not appear after next", {
                    selectedCount,
                    nextAttemptCount: araiSearchBridgeFlow.nextAttemptCount,
                    elapsedAfterNext,
                    diagnostic: parseAraiKaijoDiagnostic()
                });
                return { handled: true, delay: 0 };
            }

            if (!araiSearchBridgeFlow.nextAttempted) {
                const conditionTabResultBeforeNext = runAraiKaijoSelectorAction(targetTabAction);
                await waitForAraiBridgeDelay(150);

                let venueSelectionResultBeforeNext = null;
                if (getAraiCheckedVenueCount() === 0) {
                    venueSelectionResultBeforeNext = runAraiKaijoSelectorAction("select_venues_auto");
                    await waitForAraiBridgeDelay(150);
                }

                const forcedVenueChecksBeforeNext = forceAraiFourWheelVenueCheckboxes();
                if (forcedVenueChecksBeforeNext) await waitForAraiBridgeDelay(150);
                selectedCount = getAraiCheckedVenueCount();

                if (selectedCount === 0) {
                    recordAraiSearchBridgeLog("会場チェック未完了", {
                        conditionTabResultBeforeNext,
                        venueSelectionResultBeforeNext,
                        forcedVenueChecksBeforeNext,
                        selectedVenueCount: selectedCount
                    });
                    return { handled: true, delay: 900 };
                }

                // Arai's venue button has site-side default navigation. Run it only through the MAIN-world adapter.
                let actionResult = runAraiKaijoSelectorAction(targetSearchKind === ARAI_SEARCH_KIND_NAME ? "next_name_auto" : "next_auto");
                araiSearchBridgeFlow.nextAttempted = true;
                araiSearchBridgeFlow.nextAttemptedAt = Date.now();
                araiSearchBridgeFlow.nextAttemptCount += 1;
                araiSearchBridgeFlow.awaitingConditionAfterNext = true;
                await waitForAraiBridgeDelay(1800);

                actionResult.method = actionResult.diagnostic?.method || "main-world:next_auto";
                actionResult.ok = !isAraiVenueSelectionStep(pending?.condition) &&
                    hasAraiSearchButtonForKind(targetSearchKind, pending?.condition);
                if (!actionResult.ok && !actionResult.error) {
                    actionResult.error = "Arai's next action did not open the target search form";
                }
                recordAraiSearchBridgeLog("次へ実行", {
                    ok: actionResult.ok,
                    method: actionResult.method,
                    error: actionResult.error,
                    conditionTabResultBeforeNext,
                    venueSelectionResultBeforeNext,
                    forcedVenueChecksBeforeNext,
                    diagnostic: actionResult.diagnostic
                });

                if (!actionResult.ok) {
                    araiSearchBridgeFlow.nextActionFailures += 1;
                    if (araiSearchBridgeFlow.nextActionFailures >= 3) {
                        await stopAraiSearchBridgeFlow("Arai会場の次へ処理を実行できません", {
                            error: actionResult.error,
                            diagnostic: actionResult.diagnostic
                        });
                        return { handled: true, delay: 0 };
                    }

                    return { handled: true, delay: 1000 };
                }

                if (!isAraiVenueSelectionStep(pending?.condition) && hasAraiSearchButtonForKind(targetSearchKind, pending?.condition)) {
                    return { handled: false, delay: 0 };
                }

                return { handled: true, delay: 700 };
            }

            if (
                Date.now() - araiSearchBridgeFlow.nextAttemptedAt > 10000 &&
                repeatCount >= 8 &&
                araiSearchBridgeFlow.nextAttemptCount >= 4
            ) {
                await stopAraiSearchBridgeFlow("Arai会場の次へ後に画面が変わりません", {
                    repeatCount,
                    selectedCount,
                    nextAttemptCount: araiSearchBridgeFlow.nextAttemptCount,
                    diagnostic: parseAraiKaijoDiagnostic()
                });
                return { handled: true, delay: 0 };
            }

            return { handled: true, delay: 1000 };
        }

        function clickAraiVenueSearchIfReady() {
            if (!isAraiVenueSelectionStep()) return false;

            void advanceAraiVenueSelection();
            return true;
        }

        async function handleAraiPendingBeforeRestore(pending, currentMode) {
            ensureAraiSearchBridgeFlow(pending);
            if (araiSearchBridgeFlow.stopped) return true;
            const targetSearchKind = getAraiConditionSearchKind(pending?.condition);

            if (isAraiVenueSelectionStep(pending?.condition, currentMode)) {
                araiPendingLoadingStartedAt = 0;
                const result = await advanceAraiVenueSelection(pending, currentMode);
                if (result.delay > 0 && !araiSearchBridgeFlow.stopped) {
                    scheduleSiteSearchBridgePendingRetry(getAraiSearchBridgeAdapter(), result.delay);
                }
                return result.handled;
            }

            if (isAraiSearchBridgeLoading()) {
                if (!araiPendingLoadingStartedAt) araiPendingLoadingStartedAt = Date.now();

                if (Date.now() - araiPendingLoadingStartedAt > 45 * 1000) {
                    await chrome.storage.local.remove(getAraiSearchBridgeAdapter().pendingKey);
                    araiPendingLoadingStartedAt = 0;
                    showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "Arai search page did not finish loading", "error");
                    return true;
                }

                setTimeout(() => processAraiSearchBridge(), 1000);
                return true;
            }

            activateAraiSearchBridgeTargetTab(currentMode, pending?.condition);
            const restoreReadiness = getAraiSearchBridgeRestoreReadiness(pending?.condition, currentMode);
            if (!isAraiSearchBridgeInputFormReady(pending?.condition)) {
                recordAraiSearchBridgeLog("arai_restore_not_ready", {
                    targetMode: currentMode,
                    targetSearchKind,
                    reason: restoreReadiness.reason,
                    tabReady: restoreReadiness.tabReady,
                    keywordRestored: restoreReadiness.keywordRestored
                });
                scheduleSiteSearchBridgePendingRetry(getAraiSearchBridgeAdapter(), 700);
                return true;
            }

            araiPendingLoadingStartedAt = 0;
            if (!isAraiVenueSelectionStep(pending?.condition, currentMode) && hasAraiSearchButtonForKind(targetSearchKind, pending?.condition) && araiSearchBridgeFlow.conditionFormLoggedUrl !== location.href) {
                araiSearchBridgeFlow.conditionFormLoggedUrl = location.href;
                recordAraiSearchBridgeLog("条件フォーム到達", {
                    targetMode: currentMode,
                    targetSearchKind,
                    beforeRestore: true
                });
            }

            return false;
        }

        async function submitAraiSearchBridge(condition = null) {
            const targetSearchKind = getAraiConditionSearchKind(condition);
            if (isAraiVenueSelectionStep(condition)) {
                const result = await advanceAraiVenueSelection({ condition });
                if (result.handled) return;
            }

            if (targetSearchKind === ARAI_SEARCH_KIND_NAME) {
                const savedNameKeyword = getAraiSavedNameSearchKeyword(condition);
                if (!isAraiNameSearchFormReady()) {
                    recordAraiSearchBridgeLog("arai_search_submit_wait", {
                        targetSearchKind,
                        reason: "name_form_not_ready",
                        tabReady: getAraiSearchBridgeRestoreReadiness(condition).tabReady,
                        keywordRestored: false
                    });
                    showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "車名検索フォームの表示を待っています", "error");
                    return;
                }

                if (hasAraiNameSearchKeyword(condition)) {
                    await waitForAraiBridgeDelay(450);
                }

                const restoredNameKeyword = getAraiCurrentNameSearchKeyword();
                if (savedNameKeyword && !restoredNameKeyword) {
                    recordAraiSearchBridgeLog("arai_search_submit_wait", {
                        targetSearchKind,
                        reason: "name_keyword_not_restored",
                        savedNameKeyword,
                        restoredNameKeyword,
                        tabReady: getAraiSearchBridgeRestoreReadiness(condition).tabReady,
                        keywordRestored: false
                    });
                    showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "車名検索ワードの復元を待っています", "error");
                    return;
                }

                if (!restoredNameKeyword) {
                    const nameSearchButton = getAraiNameSearchButton();
                    if (nameSearchButton) {
                        const buttonInfo = {
                            buttonId: nameSearchButton?.id || "",
                            targetSearchKind,
                            buttonText: normalizeSearchBridgeText(nameSearchButton?.textContent || nameSearchButton?.value || ""),
                            submitMethod: "name_search_button"
                        };
                        recordAraiSearchBridgeLog("arai_search_submit", buttonInfo);
                        await markAraiSearchBridgeAwaitingResult(buttonInfo);
                        clickSearchBridgeElement(nameSearchButton, true);
                        return;
                    }
                }

                await waitForAraiBridgeDelay(900);
                const freewordButton = getAraiFreewordSearchButton();
                const buttonInfo = {
                    buttonId: freewordButton?.id || "onK",
                    targetSearchKind: ARAI_SEARCH_KIND_NAME,
                    buttonText: normalizeSearchBridgeText(freewordButton?.textContent || freewordButton?.value || "onK"),
                    keyword: restoredNameKeyword,
                    submitMethod: "freeword_keyword"
                };
                recordAraiSearchBridgeLog("arai_search_submit", buttonInfo);
                await markAraiSearchBridgeAwaitingResult(buttonInfo);
                const mainResult = runAraiKaijoSelectorAction("freeword_search");
                if (mainResult.ok) {
                    recordAraiSearchBridgeLog("arai_freeword_search_main", {
                        ok: true,
                        diagnostic: mainResult.diagnostic
                    });
                    return;
                }
                recordAraiSearchBridgeLog("arai_freeword_search_main", {
                    ok: false,
                    error: mainResult.error,
                    diagnostic: mainResult.diagnostic
                });

                if (freewordButton) {
                    clickSearchBridgeElement(freewordButton, true);
                    return;
                }

                recordAraiSearchBridgeLog("arai_search_button_missing", {
                    targetSearchKind,
                    reason: "freeword_button_missing",
                    keyword: restoredNameKeyword,
                    tabReady: getAraiSearchBridgeRestoreReadiness(condition).tabReady,
                    keywordRestored: !!restoredNameKeyword
                });
                showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "車名検索の検索ボタンが見つかりません", "error");
                return;
            }

            const searchButton = getAraiSearchButtonForKind(targetSearchKind, condition) ||
                (!isAraiVenueSelectionStep(condition) ? findVisibleSearchBridgeButtonByText("次へ") : null);

            if (searchButton) {
                const buttonInfo = {
                    buttonId: searchButton?.id || "",
                    targetSearchKind,
                    buttonText: normalizeSearchBridgeText(searchButton?.textContent || searchButton?.value || ""),
                    submitMethod: targetSearchKind === ARAI_SEARCH_KIND_CONDITION ? "condition_search_button" : "search_button"
                };
                recordAraiSearchBridgeLog("arai_search_submit", buttonInfo);
                await markAraiSearchBridgeAwaitingResult(buttonInfo);
                clickSearchBridgeElement(searchButton, true);
                return;
            }

            if (clickAraiVenueSearchIfReady()) return;

            recordAraiSearchBridgeLog("arai_search_button_missing", { targetSearchKind });
            showSiteSearchBridgeNotice(getAraiSearchBridgeAdapter(), "検索ボタンが見つかりません", "error");
        }
        function getAraiSearchBridgeAdapter() {
            return {
                siteId: "arai",
                title: "Arai",
                storageKey: ARAI_SEARCH_BRIDGE_SLOTS_KEY,
                pendingKey: ARAI_SEARCH_BRIDGE_PENDING_KEY,
                uiId: "arai-search-bridge-ui",
                buildId: "arai-name-cascade-20260710",
                position: { right: "12px", top: "132px" },
                launcherStyle: { padding: "10px 14px", fontSize: "13px" },
                state: siteSearchBridgeState.arai,
                targetModes: ["listing", "market"],
                shouldInstall: shouldInstallAraiSearchBridge,
                getCurrentMode: getAraiSearchBridgeMode,
                getModeLabel: getAraiSearchBridgeModeLabel,
                getOppositeMode: getAraiOppositeSearchBridgeMode,
                isSearchMode: isAraiSearchBridgeMode,
                canSaveCurrent: () => isAraiSearchBridgeMode(getAraiSearchBridgeMode()) && document.querySelectorAll("input,select,textarea").length > 0,
                collectCondition: collectAraiSearchBridgeCondition,
                afterPendingCreated: async (pending, targetMode) => {
                    resetAraiSearchBridgeFlow(pending);
                    recordAraiSearchBridgeLog("pending作成", {
                        pendingId: pending.id,
                        targetMode,
                        sourceMode: pending.condition?.sourceMode || ""
                    });
                },
                beforePendingNavigate: setAraiPendingFallback,
                afterPendingCleared: async (reason, pending) => {
                    resetAraiSearchBridgeFlow();
                    clearAraiPendingFallback();
                    recordAraiSearchBridgeLog("保留クリア", {
                        reason,
                        pendingId: pending?.id || ""
                    });
                },
                getPendingFallback: getAraiPendingFallback,
                onPendingProbe: recordAraiPendingProbe,
                clearPendingFallback: clearAraiPendingFallback,
                onPendingFound: handleAraiPendingFound,
                beforePendingRestore: handleAraiPendingBeforeRestore,
                beforeRestore: activateAraiSearchBridgeTargetTab,
                restoreCondition: restoreAraiSearchBridgeCondition,
                getTargetUrl: getAraiSearchBridgeTargetUrl,
                isRestoreReady: (_currentMode, condition) => isAraiSearchBridgeMode(getAraiSearchBridgeMode()) &&
                    !isAraiSearchBridgeLoading() &&
                    !isAraiVenueSelectionStep(condition, _currentMode) &&
                    isAraiSearchBridgeInputFormReady(condition) &&
                    hasAraiSearchButtonForKind(getAraiConditionSearchKind(condition), condition) &&
                    document.querySelectorAll("input,select,textarea").length > 0,
                submitSearch: submitAraiSearchBridge
            };
        }

        function processAraiSearchBridge() {
            const adapter = getAraiSearchBridgeAdapter();
            installSiteSearchBridge(adapter);
            applySiteSearchBridgePending(adapter);

            // The MAIN-world fallback is published just after page startup. Retry once after it is available.
            if (!araiPendingFallbackStartupRetryScheduled) {
                araiPendingFallbackStartupRetryScheduled = true;
                scheduleSiteSearchBridgePendingRetry(adapter, 450);
            }

            void logAraiSearchBridgeResultIfReady();
        }

        // ===== JU 検索条件ブリッジ =====

        function getJuSelectionDiagnosticRelevantSelector() {
            return "#b3-Form,#b4-Form,#b5-Form,[id^='b3-'],[id^='b4-'],[id^='b5-'],dialog,[role='dialog'],[aria-modal='true'],[class*='modal'],[class*='popup'],[class*='dialog']";
        }

        function getJuSelectionDiagnosticOverlaySelector() {
            return "dialog,[role='dialog'],[aria-modal='true'],[class*='modal'],[class*='popup'],[class*='dialog']";
        }

        function isJuSelectionDiagnosticOwnUi(element) {
            return !!element?.closest?.("#ju-search-bridge-ui");
        }

        function getJuSelectionDiagnosticTarget(target) {
            const element = target?.nodeType === 1 ? target : target?.parentElement;
            if (!element || isJuSelectionDiagnosticOwnUi(element)) return null;

            const control = element.closest("button,a,input,select,textarea,label,li,[role='option'],[role='button']") || element;
            if (isJuSelectionDiagnosticOwnUi(control)) return null;

            const scope = control.closest(getJuSelectionDiagnosticRelevantSelector());
            const selectedTexts = control.tagName === "SELECT"
                ? Array.from(control.selectedOptions || [])
                    .map(option => normalizeSearchBridgeText(option.textContent || option.value || ""))
                    .filter(Boolean)
                    .slice(0, 8)
                : [];

            return {
                tag: String(control.tagName || "").toLowerCase(),
                id: control.id || "",
                name: control.name || "",
                type: control.type || "",
                value: "value" in control ? String(control.value || "").slice(0, 160) : "",
                checked: "checked" in control ? !!control.checked : null,
                selectedTexts,
                text: normalizeSearchBridgeText(control.innerText || control.textContent || "").slice(0, 160),
                scope: scope?.id || scope?.getAttribute?.("role") || ""
            };
        }

        function isJuSelectionDiagnosticRelevantTarget(target) {
            const element = target?.nodeType === 1 ? target : target?.parentElement;
            if (!element || isJuSelectionDiagnosticOwnUi(element)) return false;

            return !!element.closest(getJuSelectionDiagnosticRelevantSelector());
        }

        function getJuSelectionDiagnosticCandidateTexts(root) {
            if (!root) return [];

            const seen = new Set();
            return Array.from(root.querySelectorAll("button,a,label,li,[role='option'],[role='button'],input[type='checkbox'],input[type='radio']"))
                .filter(element => isSearchBridgeElementVisible(element) && !isJuSelectionDiagnosticOwnUi(element))
                .map(element => normalizeSearchBridgeText(element.innerText || element.textContent || element.value || ""))
                .filter(text => text && text.length <= 160 && !seen.has(text) && (seen.add(text), true))
                .slice(0, 20);
        }

        function getJuSelectionDiagnosticSnapshot() {
            const controlSelector = "#b3-Form input,#b3-Form select,#b3-Form textarea,#b4-Form input,#b4-Form select,#b4-Form textarea,#b5-Form input,#b5-Form select,#b5-Form textarea";
            const overlaySelector = getJuSelectionDiagnosticOverlaySelector();
            const controls = Array.from(document.querySelectorAll(controlSelector))
                .filter(element => isSearchBridgeElementVisible(element))
                .map(element => getJuSelectionDiagnosticTarget(element))
                .filter(Boolean);
            const overlays = Array.from(document.querySelectorAll(overlaySelector))
                .filter(element => isSearchBridgeElementVisible(element) && !isJuSelectionDiagnosticOwnUi(element))
                .filter(element => !element.parentElement?.closest(overlaySelector))
                .slice(0, 8)
                .map(element => ({
                    tag: String(element.tagName || "").toLowerCase(),
                    id: element.id || "",
                    className: String(element.className || "").slice(0, 160),
                    title: normalizeSearchBridgeText(element.querySelector("h1,h2,h3,h4,h5,.title,[data-title]")?.textContent || "").slice(0, 120),
                    candidates: getJuSelectionDiagnosticCandidateTexts(element)
                }));
            const actionButtons = Array.from(document.querySelectorAll("#b3-Form button,#b4-Form button,#b5-Form button"))
                .filter(element => isSearchBridgeElementVisible(element))
                .map(element => ({
                    id: element.id || "",
                    text: normalizeSearchBridgeText(element.innerText || element.textContent || "").slice(0, 120),
                    disabled: !!element.disabled
                }))
                .filter(button => button.text || button.id)
                .slice(0, 20);
            const alerts = Array.from(document.querySelectorAll("[role='alert'],.alert,[class*='alert']"))
                .filter(element => isSearchBridgeElementVisible(element) && !isJuSelectionDiagnosticOwnUi(element))
                .map(element => normalizeSearchBridgeText(element.innerText || element.textContent || ""))
                .filter(Boolean)
                .slice(0, 8);

            return {
                url: location.href,
                mode: getJuSearchBridgeMode(),
                formId: getJuSearchBridgeForm(getJuSearchBridgeMode())?.id || "",
                controls,
                overlays,
                actionButtons,
                alerts
            };
        }

        function getJuSelectionDiagnosticSnapshotSignature(snapshot = getJuSelectionDiagnosticSnapshot()) {
            return JSON.stringify(snapshot);
        }

        function getJuSelectionDiagnosticSummary(record = juSelectionDiagnosticRecord) {
            const steps = Array.isArray(record?.steps) ? record.steps : [];
            const last = steps.at(-1) || null;
            return {
                version: record?.version || 1,
                status: record?.status || "empty",
                startedAt: record?.startedAt || 0,
                updatedAt: record?.updatedAt || 0,
                stepCount: steps.length,
                lastKind: last?.kind || "",
                lastTarget: last?.detail?.target || null,
                lastSnapshot: last?.snapshot || null
            };
        }

        function publishJuSelectionDiagnosticSummary(record = juSelectionDiagnosticRecord) {
            const root = document.documentElement;
            if (!root) return;

            try {
                root.setAttribute(JU_SELECTION_DIAGNOSTIC_SUMMARY_ATTR, JSON.stringify(getJuSelectionDiagnosticSummary(record)));
            } catch {
                root.removeAttribute(JU_SELECTION_DIAGNOSTIC_SUMMARY_ATTR);
            }
        }

        function cloneJuSelectionDiagnosticRecord(record) {
            return JSON.parse(JSON.stringify(record));
        }

        function queueJuSelectionDiagnosticWrite(record = juSelectionDiagnosticRecord) {
            const storage = getSiteSearchBridgeLocalStorage();
            if (!storage || !record) return Promise.resolve();

            const snapshot = cloneJuSelectionDiagnosticRecord(record);
            juSelectionDiagnosticWriteQueue = juSelectionDiagnosticWriteQueue
                .catch(() => undefined)
                .then(() => storage.set({ [JU_SELECTION_DIAGNOSTIC_KEY]: snapshot }))
                .catch(error => {
                    if (!/extension context invalidated/i.test(String(error?.message || error))) {
                        console.warn("MLive Linkifier: JU selection diagnostic write failed", error);
                    }
                });
            return juSelectionDiagnosticWriteQueue;
        }

        async function getJuSelectionDiagnosticRecord() {
            const storage = getSiteSearchBridgeLocalStorage();
            if (!storage) return null;

            const result = await storage.get(JU_SELECTION_DIAGNOSTIC_KEY);
            const record = result[JU_SELECTION_DIAGNOSTIC_KEY];
            return record && typeof record === "object" ? record : null;
        }

        function recordJuSelectionDiagnosticStep(kind, detail = {}) {
            const record = juSelectionDiagnosticRecord;
            if (!record || record.status !== "recording") return;

            const snapshot = getJuSelectionDiagnosticSnapshot();
            const signature = getJuSelectionDiagnosticSnapshotSignature(snapshot);
            if (kind === "dom_update" && signature === juSelectionDiagnosticSnapshotSignature) return;

            juSelectionDiagnosticSnapshotSignature = signature;
            record.steps.push({
                sequence: Number(record.nextSequence || 1),
                at: Date.now(),
                kind,
                detail,
                snapshot
            });
            record.nextSequence = Number(record.nextSequence || 1) + 1;
            if (record.steps.length > JU_SELECTION_DIAGNOSTIC_STEP_LIMIT) {
                record.steps.splice(0, record.steps.length - JU_SELECTION_DIAGNOSTIC_STEP_LIMIT);
            }
            record.updatedAt = Date.now();
            publishJuSelectionDiagnosticSummary(record);
            void queueJuSelectionDiagnosticWrite(record);
        }

        function isJuSelectionDiagnosticMutationRelevant(mutations) {
            const selector = getJuSelectionDiagnosticRelevantSelector();

            return mutations.some(mutation => {
                const target = mutation.target?.nodeType === 1 ? mutation.target : mutation.target?.parentElement;
                if (target?.closest?.(selector) && !isJuSelectionDiagnosticOwnUi(target)) return true;

                return Array.from(mutation.addedNodes || []).some(node => {
                    const element = node?.nodeType === 1 ? node : node?.parentElement;
                    if (!element || isJuSelectionDiagnosticOwnUi(element)) return false;
                    return !!(element.matches?.(selector) || element.querySelector?.(selector));
                });
            });
        }

        function scheduleJuSelectionDiagnosticMutationRecord() {
            if (juSelectionDiagnosticMutationTimer) clearTimeout(juSelectionDiagnosticMutationTimer);
            juSelectionDiagnosticMutationTimer = setTimeout(() => {
                juSelectionDiagnosticMutationTimer = null;
                recordJuSelectionDiagnosticStep("dom_update");
            }, 120);
        }

        function handleJuSelectionDiagnosticClick(event) {
            if (!event.isTrusted || !isJuSelectionDiagnosticRelevantTarget(event.target)) return;
            recordJuSelectionDiagnosticStep("user_click", { target: getJuSelectionDiagnosticTarget(event.target) });
        }

        function handleJuSelectionDiagnosticChange(event) {
            if (!event.isTrusted || !isJuSelectionDiagnosticRelevantTarget(event.target)) return;
            recordJuSelectionDiagnosticStep("user_change", { target: getJuSelectionDiagnosticTarget(event.target) });
        }

        function handleJuSelectionDiagnosticInput(event) {
            if (!event.isTrusted || !isJuSelectionDiagnosticRelevantTarget(event.target)) return;
            recordJuSelectionDiagnosticStep("user_input", { target: getJuSelectionDiagnosticTarget(event.target) });
        }

        function installJuSelectionDiagnosticListeners() {
            document.addEventListener("click", handleJuSelectionDiagnosticClick, true);
            document.addEventListener("change", handleJuSelectionDiagnosticChange, true);
            document.addEventListener("input", handleJuSelectionDiagnosticInput, true);

            juSelectionDiagnosticObserver = new MutationObserver(mutations => {
                if (isJuSelectionDiagnosticMutationRelevant(mutations)) scheduleJuSelectionDiagnosticMutationRecord();
            });
            juSelectionDiagnosticObserver.observe(document.documentElement, {
                subtree: true,
                childList: true,
                attributes: true,
                attributeFilter: ["class", "style", "value", "checked", "selected", "aria-selected", "aria-checked", "aria-expanded"]
            });
        }

        function removeJuSelectionDiagnosticListeners() {
            document.removeEventListener("click", handleJuSelectionDiagnosticClick, true);
            document.removeEventListener("change", handleJuSelectionDiagnosticChange, true);
            document.removeEventListener("input", handleJuSelectionDiagnosticInput, true);
            juSelectionDiagnosticObserver?.disconnect();
            juSelectionDiagnosticObserver = null;
            if (juSelectionDiagnosticMutationTimer) clearTimeout(juSelectionDiagnosticMutationTimer);
            juSelectionDiagnosticMutationTimer = null;
        }

        async function startJuSelectionDiagnostic() {
            const mode = getJuSearchBridgeMode();
            if (!isJuSearchBridgeMode(mode) || !getJuSearchBridgeForm(mode)) {
                showSiteSearchBridgeNotice(getJuSearchBridgeAdapter(), "JUの検索画面で開始してください", "error");
                return false;
            }
            if (!getSiteSearchBridgeLocalStorage()) {
                showSiteSearchBridgeNotice(getJuSearchBridgeAdapter(), "拡張更新後の古いページです。ページを再読み込みしてください", "error");
                return false;
            }

            removeJuSelectionDiagnosticListeners();
            const now = Date.now();
            juSelectionDiagnosticSnapshotSignature = "";
            juSelectionDiagnosticRecord = {
                version: 1,
                status: "recording",
                startedAt: now,
                updatedAt: now,
                sourceMode: mode,
                sourceUrl: location.href,
                nextSequence: 1,
                steps: []
            };
            juSelectionDiagnosticInitialized = true;
            installJuSelectionDiagnosticListeners();
            recordJuSelectionDiagnosticStep("recording_started");
            await queueJuSelectionDiagnosticWrite(juSelectionDiagnosticRecord);
            return true;
        }

        async function stopJuSelectionDiagnostic() {
            const record = juSelectionDiagnosticRecord || await getJuSelectionDiagnosticRecord();
            if (!record) return null;

            juSelectionDiagnosticRecord = record;
            recordJuSelectionDiagnosticStep("recording_finished");
            record.status = "stopped";
            record.updatedAt = Date.now();
            removeJuSelectionDiagnosticListeners();
            publishJuSelectionDiagnosticSummary(record);
            await queueJuSelectionDiagnosticWrite(record);
            return record;
        }

        async function initializeJuSelectionDiagnostic() {
            if (juSelectionDiagnosticInitialized) return;
            juSelectionDiagnosticInitialized = true;

            try {
                const record = await getJuSelectionDiagnosticRecord();
                if (record?.status !== "recording" || !isJuSearchBridgeMode(getJuSearchBridgeMode())) return;

                juSelectionDiagnosticRecord = record;
                juSelectionDiagnosticSnapshotSignature = "";
                installJuSelectionDiagnosticListeners();
                recordJuSelectionDiagnosticStep("page_loaded");
            } catch (error) {
                if (!/extension context invalidated/i.test(String(error?.message || error))) {
                    console.warn("MLive Linkifier: JU selection diagnostic startup failed", error);
                }
            }
        }

        function createJuSelectionDiagnosticPanelAction(wrap, adapter) {
            const button = createSiteSearchBridgeButton("選択記録", async () => {
                button.disabled = true;
                try {
                    const record = juSelectionDiagnosticRecord || await getJuSelectionDiagnosticRecord();
                    if (record?.status === "recording") {
                        const stopped = await stopJuSelectionDiagnostic();
                        showSiteSearchBridgeNotice(adapter, `JU選択記録を終了しました (${stopped?.steps?.length || 0}件)`);
                    } else if (await startJuSelectionDiagnostic()) {
                        showSiteSearchBridgeNotice(adapter, "JU選択記録を開始しました");
                    }
                    await renderSiteSearchBridgePanel(wrap, adapter);
                } finally {
                    button.disabled = false;
                }
            });

            void getJuSelectionDiagnosticRecord()
                .then(record => {
                    const isRecording = record?.status === "recording";
                    button.textContent = isRecording ? "記録終了" : "選択記録";
                    button.title = isRecording ? "JUの選択記録を終了" : "JUの選択記録を開始";
                })
                .catch(() => undefined);
            return button;
        }

        function getNormalizedJuSearchBridgePath() {
            return location.pathname.toLowerCase().replace(/\/+$/, "");
        }

        function getJuSearchBridgeModeFromPath(path = getNormalizedJuSearchBridgePath()) {
            if (path.endsWith("/junaviweb/carsearch") || path.endsWith("/junaviweb/searchlist")) return "listing";
            if (path.endsWith("/junaviweb/marketpricesearch") || path.endsWith("/junaviweb/marketpricelist")) return "market";

            return "";
        }

        function getJuSearchBridgeModeFromForm(form) {
            const id = String(form?.id || "");
            const action = String(form?.action || "").toLowerCase();

            if (id === "b5-Form" || /\/junaviweb\/(?:carsearch|searchlist)(?:[/?#]|$)/i.test(action)) return "listing";
            if (id === "b3-Form" || id === "b4-Form" || /\/junaviweb\/marketprice(?:search|list)(?:[/?#]|$)/i.test(action)) return "market";

            return "";
        }

        function getJuSearchBridgeMode() {
            const path = getNormalizedJuSearchBridgePath();
            const pathMode = getJuSearchBridgeModeFromPath(path);
            if (pathMode) return pathMode;

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
            const exact = document.querySelector("#b5-Form") ||
                document.querySelector("#b3-Form") ||
                document.querySelector("#b4-Form");
            if (!mode && exact) return exact;

            const targetMode = mode || getJuSearchBridgeMode();
            if (targetMode) {
                const byMode = forms.find(form => getJuSearchBridgeModeFromForm(form) === targetMode);
                if (byMode) return byMode;
            }

            return exact || forms.find(form => /^b\d+-Form$/.test(form.id || "")) || forms[0] || null;
        }

        function isJuSearchBridgeSearchPage() {
            const path = getNormalizedJuSearchBridgePath();
            return path.endsWith("/junaviweb/carsearch") || path.endsWith("/junaviweb/marketpricesearch");
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

        function isJuSearchBridgeConditionControl(el) {
            if (!isSearchBridgeSavableControl(el)) return false;
            if (/^b\d+-/.test(el.id || "")) return true;

            return isJuSearchBridgeSearchPage();
        }

        function collectJuSearchBridgeCondition() {
            const sourceMode = getJuSearchBridgeMode();
            const form = getJuSearchBridgeForm(sourceMode);
            if (!isJuSearchBridgeMode(sourceMode) || !form) return null;

            const fields = Array.from(form.querySelectorAll("input,select,textarea"))
                .filter(el => isJuSearchBridgeConditionControl(el))
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

        function getJuSearchBridgeTargetControl(form, prefix, key) {
            if (!key) return null;

            return document.getElementById(`${prefix}${key}`) ||
                form?.querySelector?.(`[id$="-${CSS.escape(key)}"]`) ||
                document.querySelector(`[id$="-${CSS.escape(key)}"]`);
        }

        function isJuSearchBridgeFieldRecordApplied(target, record) {
            const type = String(target?.type || "").toLowerCase();
            if (type === "checkbox" || type === "radio") {
                return !!target.checked === !!record.checked;
            }

            if (target?.tagName === "SELECT" && target.multiple && Array.isArray(record.selectedValues)) {
                const current = Array.from(target.selectedOptions).map(option => String(option.value ?? ""));
                const expected = record.selectedValues.map(value => String(value ?? ""));
                return current.length === expected.length && current.every(value => expected.includes(value));
            }

            return String(target?.value ?? "") === String(record.value ?? "");
        }

        function areJuSearchBridgeConditionFieldsApplied(condition, targetMode) {
            const form = getJuSearchBridgeForm(targetMode);
            if (!form) return false;

            const prefix = getJuSearchBridgeTargetPrefix(targetMode);
            let comparableCount = 0;

            for (const record of condition?.fields || []) {
                const key = record.key || getJuSearchBridgeFieldKey(record);
                const target = getJuSearchBridgeTargetControl(form, prefix, key);
                if (!target) continue;

                comparableCount += 1;
                if (!isJuSearchBridgeFieldRecordApplied(target, record)) return false;
            }

            return comparableCount > 0;
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
            const button =
                findVisibleSearchBridgeButtonByText("この条件で検索", form || document) ||
                findVisibleSearchBridgeButtonByText("この条件で検索", document) ||
                findSearchBridgeButtonByText("この条件で検索", form || document) ||
                findSearchBridgeButtonByText("この条件で検索", document);

            if (clickSearchBridgeElement(button)) {
                return;
            }

            if (form && typeof form.requestSubmit === "function") {
                form.requestSubmit();
                return;
            }

            showSiteSearchBridgeNotice(getJuSearchBridgeAdapter(), "検索ボタンが見つかりません", "error");
        }

        function submitJuSearchBridgeWhenReady(condition, targetMode) {
            const mode = targetMode || getJuSearchBridgeMode();
            let attempt = 0;

            const submit = () => {
                attempt += 1;

                // JU rerenders reactive fields after restore, so wait and apply once more before submitting.
                setTimeout(() => {
                    const form = getJuSearchBridgeForm(mode);
                    if (!form) {
                        showSiteSearchBridgeNotice(getJuSearchBridgeAdapter(), "JU search form was not found", "error");
                        return;
                    }

                    restoreJuSearchBridgeCondition(condition, mode);

                    setTimeout(() => {
                        const settledForm = getJuSearchBridgeForm(mode);
                        const restored = !condition || areJuSearchBridgeConditionFieldsApplied(condition, mode);
                        if ((!settledForm || !restored) && attempt < 3) {
                            submit();
                            return;
                        }

                        if (!settledForm || !restored) {
                            showSiteSearchBridgeNotice(getJuSearchBridgeAdapter(), "JU condition restore did not settle", "error");
                            return;
                        }

                        const button =
                            findVisibleSearchBridgeButtonByText("この条件で検索", settledForm) ||
                            findVisibleSearchBridgeButtonByText("この条件で検索", document) ||
                            findSearchBridgeButtonByText("この条件で検索", settledForm) ||
                            findSearchBridgeButtonByText("この条件で検索", document);

                        if (button && !button.disabled) {
                            clickSearchBridgeElement(button, true);
                            return;
                        }

                        if (typeof settledForm.requestSubmit === "function") {
                            settledForm.requestSubmit();
                            return;
                        }

                        showSiteSearchBridgeNotice(getJuSearchBridgeAdapter(), "JU search button was not found", "error");
                    }, 360);
                }, 360);
            };

            submit();
        }

        function getJuSearchBridgeAdapter() {
            return {
                siteId: "ju",
                title: "JU",
                storageKey: JU_SEARCH_BRIDGE_SLOTS_KEY,
                pendingKey: JU_SEARCH_BRIDGE_PENDING_KEY,
                uiId: "ju-search-bridge-ui",
                buildId: "ju-submit-ready-20260710",
                position: { right: "12px", top: "84px" },
                launcherStyle: { padding: "10px 14px", fontSize: "13px" },
                state: siteSearchBridgeState.ju,
                targetModes: ["listing", "market"],
                appendPanelActions: (headerActions, wrap, adapter) => {
                    headerActions.appendChild(createJuSelectionDiagnosticPanelAction(wrap, adapter));
                },
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
                submitSearch: submitJuSearchBridgeWhenReady
            };
        }

        function processJuSearchBridge() {
            const adapter = getJuSearchBridgeAdapter();
            installSiteSearchBridge(adapter);
            applySiteSearchBridgePending(adapter);
            void initializeJuSelectionDiagnostic();
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
