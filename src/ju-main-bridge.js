(() => {
    if (!location.hostname.includes("junavi.jp") || window._mlive_ju_react_bridge_installed) return;
    window._mlive_ju_react_bridge_installed = true;

    const ACTION_ATTR = "data-mlive-ju-main-action";
    const RESULT_ATTR = "data-mlive-ju-main-action-result";
    const HISTORY_ATTR = "data-mlive-ju-main-action-history";
    const TOKEN_ATTR = "data-mlive-ju-main-action-token";
    const READY_ATTR = "data-mlive-ju-main-bridge-ready";
    const ACTION_EVENT = "mlive-linkifier:ju-main-action";
    const ACTION_HISTORY_LIMIT = 24;

    const writeResult = result => {
        const root = document.documentElement;
        if (!root) return;

        try {
            const entry = { at: Date.now(), ...result };
            root.setAttribute(RESULT_ATTR, JSON.stringify(entry).slice(0, 1200));

            const rawHistory = root.getAttribute(HISTORY_ATTR) || "[]";
            const history = JSON.parse(rawHistory);
            const nextHistory = Array.isArray(history) ? history : [];
            nextHistory.push(entry);
            root.setAttribute(HISTORY_ATTR, JSON.stringify(nextHistory.slice(-ACTION_HISTORY_LIMIT)).slice(0, 12000));
        } catch {
            root.setAttribute(RESULT_ATTR, JSON.stringify({ ok: false, error: "result_serialize_failed" }));
        }
    };

    const createReactEvent = (type, target, currentTarget) => ({
        type,
        target,
        currentTarget,
        nativeEvent: { type, target, currentTarget },
        bubbles: true,
        cancelable: true,
        defaultPrevented: false,
        preventDefault() {
            this.defaultPrevented = true;
        },
        stopPropagation() {},
        persist() {},
        isDefaultPrevented() {
            return this.defaultPrevented;
        },
        isPropagationStopped() {
            return false;
        }
    });

    const findReactProps = node => {
        if (!node) return null;

        const keys = Object.getOwnPropertyNames(node);
        const propKey = keys.find(key => /^__reactProps\$/.test(key)) ||
            keys.find(key => /^__reactEventHandlers\$/.test(key));
        if (!propKey) return null;

        const props = node[propKey];
        return props && typeof props === "object" ? { key: propKey, props } : null;
    };

    const findReactHandler = (target, eventName) => {
        const seen = new Set();
        const inspect = node => {
            if (!node || seen.has(node)) return null;
            seen.add(node);

            const react = findReactProps(node);
            const handler = react?.props?.[eventName];
            return typeof handler === "function"
                ? { handler, node, propKey: react.key }
                : null;
        };

        let current = target;
        for (let depth = 0; current && current !== document.body && depth < 7; depth += 1) {
            const match = inspect(current);
            if (match) return match;
            current = current.parentElement;
        }

        for (const descendant of target.querySelectorAll("*")) {
            const match = inspect(descendant);
            if (match) return match;
        }

        return null;
    };

    const handleAction = () => {
        const root = document.documentElement;
        if (!root) return;

        let payload;
        try {
            payload = JSON.parse(root.getAttribute(ACTION_ATTR) || "");
        } catch {
            writeResult({ ok: false, error: "invalid_payload" });
            return;
        }

        const action = String(payload?.action || "");
        const token = String(payload?.token || "");
        const eventName = action === "change" ? "onChange" : action === "click" ? "onClick" : "";
        if (!token || !eventName) {
            writeResult({ ok: false, action, error: "invalid_action" });
            return;
        }

        const target = document.querySelector(`[${TOKEN_ATTR}="${token}"]`);
        if (!target) {
            writeResult({ ok: false, action, error: "target_missing" });
            return;
        }

        const reactHandler = findReactHandler(target, eventName);
        if (!reactHandler) {
            writeResult({ ok: false, action, error: `${eventName}_missing` });
            return;
        }

        try {
            if (action === "change") {
                if (typeof target.checked !== "boolean") {
                    writeResult({ ok: false, action, error: "checkbox_missing" });
                    return;
                }
                target.checked = !!payload.checked;
            }

            const output = reactHandler.handler(createReactEvent(action, target, reactHandler.node));
            writeResult({
                ok: true,
                action,
                eventName,
                targetId: target.id || "",
                handlerNodeId: reactHandler.node.id || "",
                handlerNodeTag: reactHandler.node.tagName || "",
                propKey: reactHandler.propKey,
                handlerName: reactHandler.handler.name || "anonymous"
            });

            Promise.resolve(output).catch(error => {
                writeResult({
                    ok: false,
                    action,
                    error: String(error?.message || error).slice(0, 200)
                });
            });
        } catch (error) {
            writeResult({
                ok: false,
                action,
                error: String(error?.message || error).slice(0, 200)
            });
        }
    };

    window.addEventListener(ACTION_EVENT, handleAction);
    document.documentElement?.setAttribute(READY_ATTR, "1");
})();
