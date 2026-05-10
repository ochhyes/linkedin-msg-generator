// Suppress flood `chrome-extension://invalid/ net::ERR_FAILED` w konsoli.
//
// LinkedIn'owy obfuscated bundle (np. d3jr0erc6y93o17nx3pgkd9o9.js:12275)
// cache'uje URL'e do extension'ów (chrome.runtime.getURL z poprzednich
// sesji) i pinguje je przez window.fetch po reload extension'a.
// Chrome zwraca dla nieważnych extension URL'i specjalny wirtualny URL
// "chrome-extension://invalid/" → fetch leci → ERR_FAILED → console flood.
//
// Mitygacja v1.2.1 (#12b) była: orphan auto-reload jednorazowy. Czyściła
// niektóre cache'y, ale nie wszystkie — LinkedIn rebuilduje swój runtime
// i znowu próbuje pingować. Marcin nadal widział flood w v1.11.1.
//
// To rozwiązanie jest kompletne: patch'ujemy window.fetch w main world
// (przez manifest content_script `world: "MAIN"`) z run_at:document_start
// żeby załadować się PRZED LinkedIn'owym bundle'em. Patch przechwytuje
// requests do chrome-extension://invalid* i zwraca silent 204 No Content
// zamiast network error → LinkedIn'owy fetch caller dostaje resolved
// Promise, nie loguje error w konsoli.
//
// Patch jest idempotent (window.__lmgFetchPatched flag) — multiple
// content_script injections (np. SPA history nav) nie nakładają warstw.
// Defensywny try/catch wokół URL extraction handle'uje exotic input
// types (Request object, URL object, FormData wrapper).

(function () {
  if (window.__lmgFetchPatched) return;
  window.__lmgFetchPatched = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    let url = "";
    try {
      if (typeof input === "string") {
        url = input;
      } else if (input instanceof URL) {
        url = input.href;
      } else if (input && typeof input.url === "string") {
        // Request object
        url = input.url;
      }
    } catch (_) {
      // input nie ma .url accessible — przekaż dalej do origFetch.
    }

    if (url && url.indexOf("chrome-extension://invalid") === 0) {
      // Silent no-op — empty 204 response. LinkedIn'owy caller dostaje
      // valid Response object, nie console error.
      return Promise.resolve(
        new Response("", {
          status: 204,
          statusText: "No Content",
        })
      );
    }

    return origFetch(input, init);
  };
})();
