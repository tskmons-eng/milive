(() => {
    if (!window._mlive_arai_search_bridge_installed) {
        window._mlive_arai_search_bridge_installed = true;

        const ARAI_KAIJO_ACTION_ATTR = "data-mlive-arai-kaijo-action";
        const ARAI_KAIJO_RESULT_ATTR = "data-mlive-arai-kaijo-result";
        const ARAI_KAIJO_ERROR_ATTR = "data-mlive-arai-kaijo-error";
        const ARAI_KAIJO_DIAGNOSTIC_ATTR = "data-mlive-arai-kaijo-diagnostic";
        const ARAI_KAIJO_PROBE_ONLY_ATTR = "data-mlive-arai-kaijo-probe-only";
        const ARAI_KAIJO_ACTION_EVENT = "mlive-linkifier:arai-kaijo-action";

        const isVisible = (el) => {
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.opacity !== "0" &&
                !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
        };

        const readAraiKaijoState = (action) => {
            const button = document.getElementById(action) ||
                document.getElementById("btKaijo_exe") ||
                document.getElementById("btn_kaijo");
            const checkboxes = Array.from(document.querySelectorAll("input[type='checkbox']"));
            const venueInputs = checkboxes.filter(el => {
                const marker = `${el.name || ""} ${el.id || ""}`;
                return /^(kaijo|aa4w|tp4w|week4w)/i.test(el.name || el.id || "") ||
                    /(?:^|\s)(?:2w|4w|ke|ab)\d+/i.test(marker) ||
                    el.name === "kaijo4w";
            });
            const selectedInputs = venueInputs.filter(el => el.checked);

            return {
                href: location.href,
                readyState: document.readyState,
                action,
                hasCmKaijoSelector: !!window.cmKaijoSelector,
                hasOnclick: typeof window.cmKaijoSelector?.onclick === "function",
                hasDoKaijoSend: typeof window.cmKaijoSelector?.doKaijoSend === "function",
                hasDoQuerySelsct: typeof window.cmKaijoSelector?.doQuerySelsct === "function",
                cmKaijoSelectorKeys: window.cmKaijoSelector ? Object.keys(window.cmKaijoSelector).slice(0, 12) : [],
                hasButton: !!button,
                buttonId: button?.id || "",
                buttonText: (button?.textContent || button?.value || "").replace(/\s+/g, " ").trim().slice(0, 80),
                buttonVisible: isVisible(button),
                hasConditionButton: !!document.getElementById("btAppointed"),
                hasMarketConditionTab: !!document.getElementById("johoTab3"),
                hasListingConditionTab: !!document.getElementById("tbSearchTab5"),
                hasJquery: typeof window.jQuery === "function",
                toggleCarClass: document.getElementById("toggle_car")?.className || "",
                ckAll4wClass: document.getElementById("CKALL4W")?.className || "",
                activeVenueNodeCount: document.querySelectorAll("#tab_view dl.active,#tab_view .active").length,
                searchTabMode: typeof window.cmSearchTab?.getMode === "function" ? window.cmSearchTab.getMode() : null,
                johoTabMode: typeof window.johoTab?.getMode === "function" ? window.johoTab.getMode() : window.johoTab?.mode ?? null,
                functionMode: typeof window.functionMenu?.getMode === "function" ? window.functionMenu.getMode() : null,
                kaisaiKbn: window.cmKaijoSelector?.kaisaiKbn ?? null,
                fourwheelSelectCount: Array.isArray(window.cmKaijoSelector?.fourwheelList_select) ? window.cmKaijoSelector.fourwheelList_select.length : null,
                bykeSelectCount: Array.isArray(window.cmKaijoSelector?.bykeList_select) ? window.cmKaijoSelector.bykeList_select.length : null,
                kenkiSelectCount: Array.isArray(window.cmKaijoSelector?.kenkiList_select) ? window.cmKaijoSelector.kenkiList_select.length : null,
                abroadSelectCount: Array.isArray(window.cmKaijoSelector?.abroadList_select) ? window.cmKaijoSelector.abroadList_select.length : null,
                dispListSelectCount: Array.isArray(window.cmKaijoSelector?.dispList_select) ? window.cmKaijoSelector.dispList_select.length : null,
                venueInputCount: venueInputs.length,
                selectedVenueCount: selectedInputs.length,
                selectedVenueSample: selectedInputs.slice(0, 8).map(el => el.id || el.name || el.value),
                hasCKALL4W: !!document.getElementById("CKALL4W"),
                ckAll4wVisible: isVisible(document.getElementById("CKALL4W"))
            };
        };

        const writeAraiKaijoDiagnostic = (payload) => {
            const root = document.documentElement;
            if (!root) return;

            try {
                root.setAttribute(ARAI_KAIJO_DIAGNOSTIC_ATTR, JSON.stringify(payload).slice(0, 16000));
            } catch (error) {
                root.setAttribute(ARAI_KAIJO_DIAGNOSTIC_ATTR, JSON.stringify({
                    diagnosticError: String(error?.message || error).slice(0, 200)
                }));
            }
        };

        const dispatchAraiNativeClick = (el) => {
            const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
            eventTypes.forEach(type => {
                const EventCtor = type.startsWith("pointer") && typeof window.PointerEvent === "function"
                    ? window.PointerEvent
                    : window.MouseEvent;
                el.dispatchEvent(new EventCtor(type, {
                    bubbles: true,
                    cancelable: true,
                    view: window,
                    pointerId: 1,
                    pointerType: "mouse",
                    isPrimary: true,
                    button: 0,
                    buttons: type.endsWith("down") ? 1 : 0
                }));
            });
        };

        const triggerAraiElementClick = (id, options = {}) => {
            const el = document.getElementById(id);
            if (!el) {
                return { ok: false, method: "", error: `${id} is missing` };
            }

            if (options.preferNative) {
                dispatchAraiNativeClick(el);
                return { ok: true, method: `native-events:${id}`, error: "" };
            }

            if (typeof window.jQuery === "function") {
                window.jQuery(el).trigger("click");
                return { ok: true, method: `jquery.trigger:${id}`, error: "" };
            }

            dispatchAraiNativeClick(el);
            return { ok: true, method: `mouseevent:${id}`, error: "" };
        };

        const getAraiSelectedCount = (state) => {
            return Number(state.selectedVenueCount || 0) +
                Number(state.fourwheelSelectCount || 0) +
                Number(state.bykeSelectCount || 0) +
                Number(state.kenkiSelectCount || 0) +
                Number(state.abroadSelectCount || 0) +
                Number(state.dispListSelectCount || 0) +
                Number(state.activeVenueNodeCount || 0);
        };

        const runAraiAttempt = (action, label, fn, isSuccess) => {
            const before = readAraiKaijoState(action);
            let error = "";
            let alertMessage = "";
            const originalAlert = window.alert;
            try {
                window.alert = (message) => {
                    alertMessage = String(message || "").slice(0, 300);
                };
                fn();
            } catch (err) {
                error = String(err?.message || err).slice(0, 300);
            } finally {
                window.alert = originalAlert;
            }
            const after = readAraiKaijoState(action);
            const ok = !error && !alertMessage && isSuccess(before, after);
            return {
                label,
                ok,
                error,
                alertMessage,
                beforeSelectedCount: getAraiSelectedCount(before),
                afterSelectedCount: getAraiSelectedCount(after),
                before,
                after
            };
        };

        const setAraiFourWheelDomSelection = () => {
            const inputs = Array.from(document.querySelectorAll("input[type='checkbox']"))
                .filter(el => el.name === "kaijo4w" || /^4w\d+$/i.test(el.id || ""));
            const extraIds = ["we4wAA", "we4wTP"];
            let changed = 0;

            inputs.forEach(el => {
                if (!el.checked) changed += 1;
                el.checked = true;
                el.dispatchEvent(new Event("input", { bubbles: true }));
                el.dispatchEvent(new Event("change", { bubbles: true }));
            });

            extraIds.forEach(id => {
                const el = document.getElementById(id);
                if (el && "checked" in el) {
                    if (!el.checked) changed += 1;
                    el.checked = true;
                    el.dispatchEvent(new Event("input", { bubbles: true }));
                    el.dispatchEvent(new Event("change", { bubbles: true }));
                }
            });

            return changed || inputs.length;
        };

        const runAraiVenueSelectionAttempts = () => {
            const attempts = [];
            const isSelected = (before, after) => Number(after.selectedVenueCount || 0) > 0 ||
                Number(after.selectedVenueCount || 0) > Number(before.selectedVenueCount || 0);
            const tryAttempt = (label, fn) => {
                const attempt = runAraiAttempt("select_venues_auto", label, fn, isSelected);
                attempts.push(attempt);
                return attempt.ok;
            };

            if (tryAttempt("cmKaijoSelector.onclick(CKALL4W)+checked", () => {
                if (typeof window.cmKaijoSelector?.onclick !== "function") throw new Error("cmKaijoSelector.onclick is not ready");
                window.cmKaijoSelector.onclick("CKALL4W");
                setAraiFourWheelDomSelection();
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("setMultiSelection+onclick(CKALL4W)+checked", () => {
                if (typeof window.cmKaijoSelector?.setMultiSelection === "function") window.cmKaijoSelector.setMultiSelection();
                if (typeof window.cmKaijoSelector?.onclick !== "function") throw new Error("cmKaijoSelector.onclick is not ready");
                window.cmKaijoSelector.onclick("CKALL4W");
                setAraiFourWheelDomSelection();
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("jquery-trigger(CKALL4W)+checked", () => {
                const result = triggerAraiElementClick("CKALL4W");
                if (!result.ok) throw new Error(result.error);
                setAraiFourWheelDomSelection();
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("native-events(CKALL4W)+checked", () => {
                const result = triggerAraiElementClick("CKALL4W", { preferNative: true });
                if (!result.ok) throw new Error(result.error);
                setAraiFourWheelDomSelection();
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("dom-check-fourwheel", () => {
                const changed = setAraiFourWheelDomSelection();
                if (!changed) throw new Error("four wheel venue inputs were not found");
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("dom-check+setMultiSelection", () => {
                const changed = setAraiFourWheelDomSelection();
                if (typeof window.cmKaijoSelector?.setMultiSelection === "function") window.cmKaijoSelector.setMultiSelection();
                if (!changed) throw new Error("four wheel venue inputs were not found");
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            return { ok: false, method: "", attempts };
        };

        const forceAraiConditionRender = () => {
            if (typeof window.cmKaijoSelector?.newDraw === "function") {
                window.cmKaijoSelector.newDraw();
            }
            if (typeof window.functionMenu?.drawClient === "function") {
                window.functionMenu.drawClient();
            }
            if (typeof window.cmDetailAppointer?.initScreen === "function") {
                window.cmDetailAppointer.initScreen();
            }
        };

        const runAraiNextAttempts = () => {
            const attempts = [];
            const hasConditionForm = (_before, after) => !!after.hasConditionButton;
            const tryAttempt = (label, fn) => {
                const attempt = runAraiAttempt("next_auto", label, fn, hasConditionForm);
                attempts.push(attempt);
                return attempt.ok;
            };

            if (tryAttempt("jquery-trigger(btKaijo_exe)", () => {
                activateAraiConditionMode();
                setAraiFourWheelDomSelection();
                const result = triggerAraiElementClick("btKaijo_exe");
                if (!result.ok) throw new Error(result.error);
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("cmKaijoSelector.onclick(btKaijo_exe)", () => {
                activateAraiConditionMode();
                setAraiFourWheelDomSelection();
                if (typeof window.cmKaijoSelector?.onclick !== "function") throw new Error("cmKaijoSelector.onclick is not ready");
                window.cmKaijoSelector.onclick("btKaijo_exe");
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("activateMode+doKaijoSend", () => {
                activateAraiConditionMode();
                setAraiFourWheelDomSelection();
                if (typeof window.cmKaijoSelector?.doKaijoSend !== "function") throw new Error("cmKaijoSelector.doKaijoSend is not ready");
                window.cmKaijoSelector.doKaijoSend();
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("doQuerySelsct", () => {
                if (typeof window.cmKaijoSelector?.doQuerySelsct !== "function") throw new Error("cmKaijoSelector.doQuerySelsct is not ready");
                window.cmKaijoSelector.doQuerySelsct();
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            if (tryAttempt("force-condition-render", () => {
                forceAraiConditionRender();
            })) return { ok: true, method: attempts.at(-1).label, attempts };

            return { ok: false, method: "", attempts };
        };

        const activateAraiConditionMode = () => {
            const functionMode = typeof window.functionMenu?.getMode === "function"
                ? window.functionMenu.getMode()
                : null;
            const result = {
                functionMode,
                cmSearchTabBefore: typeof window.cmSearchTab?.getMode === "function" ? window.cmSearchTab.getMode() : null,
                johoTabBefore: typeof window.johoTab?.getMode === "function" ? window.johoTab.getMode() : window.johoTab?.mode ?? null
            };

            const listingConditionMode = typeof window.SRAECH_MODE_CONDITION !== "undefined"
                ? window.SRAECH_MODE_CONDITION
                : 4;
            const marketConditionMode = typeof window.JOHO_MODE_SOUBA_COND !== "undefined"
                ? window.JOHO_MODE_SOUBA_COND
                : 2;

            if (typeof window.cmSearchTab?.setMode === "function") {
                const shouldSetListingMode = document.getElementById("tbSearchTab5") ||
                    functionMode === window.FUNCTION_MODE_KENSAKU_CM;
                if (shouldSetListingMode) {
                    window.cmSearchTab.setMode(listingConditionMode);
                }
            }

            if (typeof window.johoTab?.setMode === "function") {
                const shouldSetMarketMode = document.getElementById("johoTab3") ||
                    functionMode === window.FUNCTION_MODE_JOHO;
                if (shouldSetMarketMode) {
                    window.johoTab.setMode(marketConditionMode);
                }
            }

            result.cmSearchTabAfter = typeof window.cmSearchTab?.getMode === "function" ? window.cmSearchTab.getMode() : null;
            result.johoTabAfter = typeof window.johoTab?.getMode === "function" ? window.johoTab.getMode() : window.johoTab?.mode ?? null;
            return result;
        };

        const activateAraiConditionTab = () => {
            const result = {
                method: "",
                modeActivation: null
            };

            if (document.getElementById("johoTab3")) {
                const clickResult = triggerAraiElementClick("johoTab3");
                result.method = clickResult.method;
            } else if (document.getElementById("tbSearchTab5")) {
                const clickResult = triggerAraiElementClick("tbSearchTab5");
                result.method = clickResult.method;
            } else {
                result.method = "setMode";
            }

            result.modeActivation = activateAraiConditionMode();

            return result;
        };

        const handleAraiKaijoAction = () => {
            const root = document.documentElement;
            const action = root?.getAttribute(ARAI_KAIJO_ACTION_ATTR) || "";
            const probeOnly = root?.getAttribute(ARAI_KAIJO_PROBE_ONLY_ATTR) === "1";
            const before = readAraiKaijoState(action);

            try {
                if (probeOnly) {
                    root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, before.hasOnclick ? "1" : "0");
                    if (before.hasOnclick) {
                        root?.removeAttribute(ARAI_KAIJO_ERROR_ATTR);
                    } else {
                        root?.setAttribute(ARAI_KAIJO_ERROR_ATTR, "cmKaijoSelector is not ready");
                    }
                    writeAraiKaijoDiagnostic({ phase: "probe", before, after: readAraiKaijoState(action) });
                    return;
                }

                if (action === "activate_condition_tab") {
                    const tabResult = activateAraiConditionTab();
                    root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, "1");
                    root?.removeAttribute(ARAI_KAIJO_ERROR_ATTR);
                    writeAraiKaijoDiagnostic({
                        phase: "condition_tab",
                        method: tabResult.method,
                        modeActivation: tabResult.modeActivation,
                        before,
                        after: readAraiKaijoState(action)
                    });
                    window.setTimeout(() => {
                        writeAraiKaijoDiagnostic({
                            phase: "condition_tab_after_delay",
                            method: tabResult.method,
                            modeActivation: tabResult.modeActivation,
                            before,
                            after: readAraiKaijoState(action)
                        });
                    }, 300);
                    return;
                }

                if (action === "diagnose_state") {
                    root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, "1");
                    root?.removeAttribute(ARAI_KAIJO_ERROR_ATTR);
                    writeAraiKaijoDiagnostic({
                        phase: "diagnose_state",
                        before,
                        after: readAraiKaijoState(action)
                    });
                    return;
                }

                if (action === "select_venues_auto") {
                    const selectResult = runAraiVenueSelectionAttempts();
                    root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, selectResult.ok ? "1" : "0");
                    if (selectResult.ok) {
                        root?.removeAttribute(ARAI_KAIJO_ERROR_ATTR);
                    } else {
                        root?.setAttribute(ARAI_KAIJO_ERROR_ATTR, "Arai venue selection attempts failed");
                    }
                    writeAraiKaijoDiagnostic({
                        phase: "select_venues_auto",
                        method: selectResult.method,
                        attempts: selectResult.attempts,
                        before,
                        after: readAraiKaijoState(action)
                    });
                    return;
                }

                if (action === "next_auto") {
                    const nextResult = runAraiNextAttempts();
                    root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, nextResult.ok ? "1" : "0");
                    if (nextResult.ok) {
                        root?.removeAttribute(ARAI_KAIJO_ERROR_ATTR);
                    } else {
                        root?.setAttribute(ARAI_KAIJO_ERROR_ATTR, "Arai next attempts did not reach condition form");
                    }
                    writeAraiKaijoDiagnostic({
                        phase: "next_auto",
                        method: nextResult.method,
                        attempts: nextResult.attempts,
                        before,
                        after: readAraiKaijoState(action)
                    });
                    window.setTimeout(() => {
                        writeAraiKaijoDiagnostic({
                            phase: "next_auto_after_delay",
                            method: nextResult.method,
                            attempts: nextResult.attempts,
                            before,
                            after: readAraiKaijoState(action)
                        });
                    }, 1000);
                    return;
                }

                if (window.cmKaijoSelector && action) {
                    let method = "";
                    let modeActivation = null;
                    if (action === "CKALL4W" && typeof window.cmKaijoSelector.onclick === "function") {
                        method = "cmKaijoSelector.onclick:CKALL4W";
                        window.cmKaijoSelector.onclick("CKALL4W");
                    } else if (action === "btKaijo_exe" && document.getElementById("btKaijo_exe")) {
                        const clickResult = triggerAraiElementClick("btKaijo_exe");
                        method = clickResult.method;
                    } else if (typeof window.cmKaijoSelector.onclick === "function") {
                        method = "onclick";
                        window.cmKaijoSelector.onclick(action);
                    } else {
                        root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, "0");
                        root?.setAttribute(ARAI_KAIJO_ERROR_ATTR, "cmKaijoSelector is not ready");
                        writeAraiKaijoDiagnostic({ phase: "not_ready", before, after: readAraiKaijoState(action) });
                        return;
                    }

                    const afterAction = readAraiKaijoState(action);
                    const selectedListCount = Number(afterAction.fourwheelSelectCount || 0) +
                        Number(afterAction.bykeSelectCount || 0) +
                        Number(afterAction.kenkiSelectCount || 0) +
                        Number(afterAction.abroadSelectCount || 0);
                    if (
                        action === "btKaijo_exe" &&
                        method === "doKaijoSend" &&
                        !afterAction.hasConditionButton &&
                        selectedListCount > 0 &&
                        typeof window.cmKaijoSelector.doQuerySelsct === "function"
                    ) {
                        method += "+doQuerySelsctFallback";
                        window.cmKaijoSelector.doQuerySelsct();
                    }

                    root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, "1");
                    root?.removeAttribute(ARAI_KAIJO_ERROR_ATTR);
                    writeAraiKaijoDiagnostic({
                        phase: "action",
                        method,
                        modeActivation,
                        before,
                        after: readAraiKaijoState(action)
                    });
                    window.setTimeout(() => {
                        writeAraiKaijoDiagnostic({
                            phase: "action_after_delay",
                            method,
                            modeActivation,
                            before,
                            after: readAraiKaijoState(action)
                        });
                    }, 300);
                    return;
                }

                root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, "0");
                root?.setAttribute(ARAI_KAIJO_ERROR_ATTR, "cmKaijoSelector is not ready");
                writeAraiKaijoDiagnostic({
                    phase: "not_ready",
                    before,
                    after: readAraiKaijoState(action)
                });
            } catch (error) {
                root?.setAttribute(ARAI_KAIJO_RESULT_ATTR, "0");
                root?.setAttribute(ARAI_KAIJO_ERROR_ATTR, String(error?.message || error).slice(0, 200));
                writeAraiKaijoDiagnostic({
                    phase: "error",
                    before,
                    after: readAraiKaijoState(action),
                    error: String(error?.message || error).slice(0, 300)
                });
                console.warn("MLive Linkifier: Arai venue bridge action failed", error);
            }
        };

        window.addEventListener(ARAI_KAIJO_ACTION_EVENT, handleAraiKaijoAction);
    }

    // window.open をオーバーライドして強制的に新しいタブで開く
    // Object.definePropertyを使うことで、より確実に定義する

    // すでにオーバーライド済みなら何もしない
    if (window._mlive_overridden) return;
    window._mlive_overridden = true;

    const originalOpen = window.open;

    Object.defineProperty(window, 'open', {
        configurable: true, // サイト側が壊れないように念のためtrue
        writable: true,
        value: function (url, name, features) {
            console.log("MLive Linkifier: Intercepted window.open", { url, name, features });

            // 第3引数(features)を無視し、第2引数(name)を _blank にすることで新しいタブを強制
            // ※ name が指定されていると、その名前の既存のポップアップを再利用しようとするため _blank に書き換える
            return originalOpen(url, '_blank');
        }
    });

    console.log("MLive Linkifier: window.open override installed (MAIN world, hardened)");
})();
