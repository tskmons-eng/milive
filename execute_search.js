// execute_search.js
(function () {
    console.log("Execute Search Script Injected");
    try {
        if (typeof stock_search === 'function') {
            console.log("Calling stock_search()...");
            stock_search();
        } else {
            console.error("stock_search function is not defined in this page context.");
        }
    } catch (e) {
        console.error("Error executing stock_search:", e);
    }
})();
