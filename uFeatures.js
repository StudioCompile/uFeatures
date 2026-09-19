/// uFeatures.js
// Inject on every site via a userscript manager (Violentmonkey / Tampermonkey).
//
// HOW IT WORKS:
//   1. Ctrl+`  →  opens the uFeatures popup right on the current page.
//   2. Scripts you save are written straight into THAT SITE's own
//      localStorage — no cross-site sync, no bridge tabs, no separate
//      settings page. Whatever you save on example.com only ever lives on
//      example.com, and the popup only ever shows/edits example.com's list.
//   3. The "Domain" field on a script is how sensitive matching is to the
//      current page: leave it as the plain hostname to run everywhere on
//      the site, use "*.example.com" to also catch subdomains, or add a
//      path ("example.com/blog") to restrict it further. This is checked
//      on every page load before a script runs.
//   4. Ctrl+Shift+I  →  Chii remote debugger.
//   5. Ctrl+V (outside a text field) → runs a javascript: bookmarklet URL
//      from your clipboard.

!function(){

  // Guard against double injection. Some injection methods (including some
  // uBlock Origin configurations) can run the same script more than once on
  // a page. If that happens here, we'd end up with duplicate message
  // listeners, duplicate MutationObservers, and duplicate keydown handlers
  // all fighting each other — which can look like "nothing works" even
  // though the script technically ran. This makes re-injection a no-op.
  if(window.__uFeaturesLoaded) return;
  window.__uFeaturesLoaded = true;

  var SITE_KEY = "__uFeaturesScripts";

  // ── Storage (always scoped to THIS site's own localStorage) ───────
  function siteLoad(){
    try{ return JSON.parse(localStorage.getItem(SITE_KEY)||"[]"); }
    catch(e){ return []; }
  }
  function siteSave(arr){
    localStorage.setItem(SITE_KEY, JSON.stringify(arr));
  }

  // ── Securly blocker ───────────────────────────────────────────────
  function killSecurly(){
    var el = document.getElementById("securly_overlay");
    if(el) el.remove();
    ["securly-overlay","securly_overlay","securly-extension"].forEach(function(c){
      var nl = document.getElementsByClassName(c);
      for(var i=nl.length-1;i>=0;i--) nl[i].remove();
    });
  }
  new MutationObserver(killSecurly).observe(document.documentElement,{childList:true,subtree:true});
  killSecurly();

  // ── Domain matching (this is the "sensitivity" dial) ───────────────
  function stripWww(h){ return h.replace(/^www\./,""); }
  function stripProtocol(s){ return s.replace(/^https?:\/\//i,""); }

  // A script saved here already can't ever run anywhere but this exact
  // host — localStorage is per-origin, so a subdomain simply never sees
  // it. So the only thing worth matching on is host (should always equal
  // the current one) plus an optional path restriction.
  function matchesDomain(pattern){
    if(!pattern||!pattern.trim()) return false;
    var host = stripWww(location.hostname), path = location.pathname;
    return pattern.trim().split(",").some(function(p){
      p = stripProtocol(p.trim()); if(!p) return false;
      var si = p.indexOf("/");
      var hp = stripWww(si===-1 ? p : p.slice(0,si));
      var pp = si===-1 ? "" : p.slice(si);
      if(host!==hp) return false; if(!pp) return true;
      var norm = pp.endsWith("/") ? pp : pp+"/";
      return path===pp||path.startsWith(norm);
    });
  }

  // Decodes only well-formed %XX runs (including multi-byte UTF-8 sequences
  // like %E2%80%99), leaving any other "%" untouched. Plain decodeURIComponent
  // is all-or-nothing: a single stray "%" anywhere in the string (e.g. "50%
  // off", or "x % y" used as a modulus) makes it throw for the ENTIRE string,
  // so legitimate %20-style escapes never get decoded either — leaving literal
  // "%20" sitting in the code, which then breaks as invalid JS syntax. This
  // decodes each contiguous run of %XX groups independently, so one bad
  // sequence only affects that run rather than everything else in the script.
  function safeDecodeURIComponent(str){
    var out = "", i = 0, n = str.length;
    while(i < n){
      if(str[i] === "%" && /^[0-9A-Fa-f]{2}$/.test(str.substr(i+1,2))){
        var j = i, run = "";
        while(str[j] === "%" && /^[0-9A-Fa-f]{2}$/.test(str.substr(j+1,2))){
          run += str.substr(j,3);
          j += 3;
        }
        try{
          out += decodeURIComponent(run);
          i = j;
          continue;
        }catch(e){
          // Not a valid UTF-8 sequence — keep this run literal and move on
          // one character at a time so we don't lose/skip anything.
        }
      }
      out += str[i];
      i++;
    }
    return out;
  }

  // Strips a leading "javascript:" and URL-decodes the rest. Scripts saved
  // via copy-paste from a browser's bookmarks bar come in exactly that
  // form — percent-encoded, "javascript:" prefix and all — and would
  // otherwise fail outright when run through new Function(). Safe to run
  // on plain, non-encoded code too: safeDecodeURIComponent only touches
  // well-formed %XX runs and leaves everything else (including stray "%"
  // used as a modulus operator or inside a string) exactly as written.
  function normalizeScriptCode(code){
    var c = (code||"").trim();
    c = c.replace(/^javascript:/i, "");
    c = safeDecodeURIComponent(c);
    return c;
  }

  // Populated fresh on every run of runSiteScripts — read by the popup's
  // status line so it always reflects the current page, not stale data
  // from a previous load.
  var _ufRunningScripts = [];

  // ── Run stored scripts (from THIS site's own localStorage) ────────
  function runSiteScripts(){
    _ufRunningScripts = [];
    siteLoad().forEach(function(s){
      if(s.enabled && matchesDomain(s.domain)){
        try{
          new Function(normalizeScriptCode(s.code))();
          _ufRunningScripts.push({ name:s.name, ok:true });
        }catch(e){
          console.warn("[uFeatures]", s.name, e);
          _ufRunningScripts.push({ name:s.name, ok:false, error:String(e) });
        }
      }
    });
  }
  if(document.readyState==="loading")
    document.addEventListener("DOMContentLoaded",runSiteScripts);
  else runSiteScripts();

  // ── Iframe maximize relay ─────────────────────────────────────────
  // "Fullscreen" here means expanding within the page/site itself — not the
  // real browser Fullscreen API. When a frame asks to maximize, we walk UP
  // the frame chain. At EVERY level, the iframe element that leads down to
  // the frame that asked breaks completely out of that level's own layout
  // via position:fixed (covering that frame's own 100vw/100vh, which for
  // a nested frame means covering its OWN viewport — not the real browser
  // window). Doing this at every level, not just the true top, matters:
  // if an intermediate iframe only got resized to 100% of its container,
  // it would still be boxed in by whatever layout (headers, sidebars, a
  // fixed-size wrapper) that container has — so the actual clicked-into
  // iframe wouldn't visually fill the screen, some OTHER outer box would.
  // Breaking out of flow at every level avoids that and correctly ends up
  // filling the whole screen with the frame the user actually clicked in.
  //
  // We only ever touch position/top/left/width/height/z-index via
  // setProperty, one at a time — never overwrite the whole style
  // attribute. Sites often control their own iframe's opacity/visibility/
  // display inline (e.g. fading it in via JS); replacing the entire style
  // attribute wipes that out and can make the iframe appear blank/invisible
  // even though it's sized correctly. Only the specific properties we set
  // are ever touched, and only those are restored on toggle-off.
  (function(){
    var PROPS = ["position","top","left","width","height","z-index"];

    function saveOrig(f){
      if(f.__ufOrigProps) return;
      f.__ufOrigProps = {};
      PROPS.forEach(function(p){ f.__ufOrigProps[p] = f.style.getPropertyValue(p); });
      f.__ufOrigTransition = f.style.getPropertyValue("transition");
    }
    function restoreOrig(f){
      if(!f.__ufOrigProps) return;
      var orig = f.__ufOrigProps;
      var origTransition = f.__ufOrigTransition;
      // transition is already forced to "none" from applyBreakout, so this
      // snap-back is instant regardless of any transition the site applies.
      Object.keys(orig).forEach(function(p){
        var v = orig[p];
        if(v) f.style.setProperty(p, v);
        else f.style.removeProperty(p);
      });
      delete f.__ufOrigProps;
      // Give the site its own transition back only after the instant snap
      // has painted, so re-enabling it doesn't animate the snap itself.
      requestAnimationFrame(function(){
        if(origTransition) f.style.setProperty("transition", origTransition);
        else f.style.removeProperty("transition");
        delete f.__ufOrigTransition;
      });
    }
    function applyBreakout(f){
      saveOrig(f);
      // Kill transitions first (and force a reflow so it actually takes
      // effect before the next changes) — many sites apply a universal
      // `transition: all ...` rule that would otherwise animate our resize
      // and make it feel slow/laggy, or land mid-animation when a message
      // from another nested level arrives.
      f.style.setProperty("transition","none","important");
      void f.offsetWidth;
      f.style.setProperty("position","fixed","important");
      f.style.setProperty("top","0","important");
      f.style.setProperty("left","0","important");
      f.style.setProperty("width","100vw","important");
      f.style.setProperty("height","100vh","important");
      f.style.setProperty("z-index","2147483000","important");
    }

    window.addEventListener("message", function(e){
      var d = e.data;
      if(!d || typeof d !== "object" || d.type !== "uf_frame_maximize") return;
      var frames = document.querySelectorAll("iframe");
      for(var i=0;i<frames.length;i++){
        if(frames[i].contentWindow !== e.source) continue;
        var f = frames[i];
        if(d.on) applyBreakout(f); else restoreOrig(f);
        // Keep relaying upward until we reach the real top page
        if(window !== window.top){
          try{ window.parent.postMessage(d, "*"); }catch(ex){}
        }
        return;
      }
    });
  })();

  // ── Iframe corner menu ────────────────────────────────────────────
  (function(){
    if(window === window.top) return;

    // 12x12 invisible hot zone fixed to bottom-right corner
    var zone = document.createElement("div");
    zone.style.cssText = "position:fixed;bottom:0;right:0;width:12px;height:12px;z-index:2147483644";

    // Buffer so mouse can travel from corner to the widget without closing
    var buffer = document.createElement("div");
    buffer.style.cssText = "position:fixed;bottom:0;right:0;width:260px;height:50px;z-index:2147483645;pointer-events:none";

    // Styled like Chrome's own bottom-corner link-preview tooltip — flush
    // against the corner (no offset/gap), white background, square corners,
    // thin single-pixel outline, small text — just a bit taller than
    // Chrome's version and pinned to the right instead of the left. The URL
    // field and the fullscreen toggle are fused into one continuous bar
    // (no gap between them) rather than two separate floating widgets, with
    // the fullscreen button picked out in the site's accent red so it reads
    // as "attached to" the URL it controls.
    var popup = document.createElement("div");
    popup.style.cssText = [
      "position:fixed;bottom:0;right:0;z-index:2147483646",
      "display:flex;align-items:stretch;height:24px",
      "background:#fff;border:1px solid #999;border-radius:0",
      "font-family:'Segoe UI',system-ui,-apple-system,sans-serif",
      "opacity:0;pointer-events:none",
      "transition:opacity .15s ease"
    ].join(";");

    var input = document.createElement("input");
    input.type = "text";
    input.style.cssText = [
      "border:none;padding:0 8px",
      "font-family:inherit;font-size:11px",
      "color:#1c1b22;background:#fff;outline:none",
      "width:200px;height:100%;box-sizing:border-box"
    ].join(";");
    input.onkeydown = function(e){
      if(e.key!=="Enter") return;
      var url = input.value.trim();
      if(url) try{ window.parent.postMessage({ type:"uf_iframe_nav", url:url }, "*"); }catch(ex){}
    };

    var ICON_EXPAND  = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 3 3 3 3 8"></polyline><polyline points="16 3 21 3 21 8"></polyline><polyline points="3 16 3 21 8 21"></polyline><polyline points="21 16 21 21 16 21"></polyline></svg>';
    var ICON_RESTORE = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 9 9 9 9 4"></polyline><polyline points="20 9 15 9 15 4"></polyline><polyline points="4 15 9 15 9 20"></polyline><polyline points="20 15 15 15 15 20"></polyline></svg>';

    var maximized = false;
    var btnFs = document.createElement("button");
    btnFs.innerHTML = ICON_EXPAND;
    btnFs.style.cssText = [
      "width:24px;height:100%;padding:0",
      "display:flex;align-items:center;justify-content:center",
      "cursor:pointer;border:none;border-left:1px solid #999;border-radius:0",
      "background:#7f0000;outline:none;flex-shrink:0",
      "transition:background .1s"
    ].join(";");
    btnFs.onmouseover = function(){ this.style.background="#6a0000"; };
    btnFs.onmouseout  = function(){ this.style.background="#7f0000"; };
    btnFs.onclick = function(e){
      e.stopPropagation();
      maximized = !maximized;
      btnFs.innerHTML = maximized ? ICON_RESTORE : ICON_EXPAND;
      try{ window.parent.postMessage({ type:"uf_frame_maximize", on:maximized }, "*"); }catch(ex){}
    };

    popup.appendChild(input);
    popup.appendChild(btnFs);

    var hideTimer = null;
    var visible = false;

    function show(){
      clearTimeout(hideTimer);
      if(visible) return;
      visible = true;
      input.value = location.href;
      popup.style.pointerEvents = "auto";
      buffer.style.pointerEvents = "auto";
      popup.style.opacity = "1";
    }
    function scheduleHide(){
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function(){
        visible = false;
        popup.style.opacity = "0";
        popup.style.pointerEvents = "none";
        buffer.style.pointerEvents = "none";
      }, 250);
    }

    zone.addEventListener("mouseenter", show);
    zone.addEventListener("mouseleave", scheduleHide);
    buffer.addEventListener("mouseenter", function(){ clearTimeout(hideTimer); });
    buffer.addEventListener("mouseleave", scheduleHide);
    popup.addEventListener("mouseenter", function(){ clearTimeout(hideTimer); });
    popup.addEventListener("mouseleave", scheduleHide);

    function attach(){
      if(!document.body) return;
      document.body.appendChild(zone);
      document.body.appendChild(buffer);
      document.body.appendChild(popup);
    }
    if(document.body) attach();
    else document.addEventListener("DOMContentLoaded", attach);

    // If parent told us to reopen after a navigation, show once loaded
    window.addEventListener("message", function(e){
      if(e.data && e.data.type === "uf_iframe_reopen") show();
    });
  })();

  // Parent side: listen for uf_iframe_nav, update src, then tell new page to reopen popup
  if(window === window.top){
    window.addEventListener("message", function(e){
      var d = e.data;
      if(!d || typeof d !== "object" || d.type !== "uf_iframe_nav" || !d.url) return;
      var frames = document.querySelectorAll("iframe");
      for(var i=0; i<frames.length; i++){
        try{
          if(frames[i].contentWindow === e.source){
            frames[i].src = d.url;
            // After load, tell the new page to show the popup
            frames[i].addEventListener("load", function(){
              try{ frames[i].contentWindow.postMessage({ type:"uf_iframe_reopen" }, "*"); }catch(ex){}
            }, { once:true });
            return;
          }
        }catch(ex){}
      }
    });
  }

  // ── Bookmarklet runner ────────────────────────────────────────────
  function runBookmarklet(text){
    var t=(text||"").trim();
    if(!/^javascript:/i.test(t)) return false;
    var code = t.replace(/^javascript:/i,"");
    // Many bookmarklets are URL-encoded (spaces as %20, etc). safeDecodeURIComponent
    // decodes only well-formed %XX runs and leaves any stray "%" (a modulus
    // operator, a literal "%" in a string, etc) untouched — a plain
    // decodeURIComponent would throw on the whole string over a single bad
    // sequence, leaving legitimate %20s undecoded and breaking as invalid JS.
    code = safeDecodeURIComponent(code);
    try{ new Function(code)(); }
    catch(e){ showToast("Bookmarklet error: "+e, "#cc0000"); }
    return true;
  }

  // ── Chii debugger ─────────────────────────────────────────────────
  // Two cooperating halves, since this script also runs INSIDE the chii
  // iframe itself (chii.liriliri.io):
  //   1. HOST side (the real page): docks chii's own iframe element at
  //      full panel width — no separate sidebar reserved for us anymore.
  //   2. IFRAME side (running inside chii.liriliri.io): builds a small
  //      close button directly in ITS OWN document, in a Shadow DOM so
  //      chii's own styles can't touch it. This keeps the host page's DOM
  //      completely clean — nothing of ours shows up there for its own
  //      inspector to see — and the close control genuinely lives inside
  //      devtools rather than floating over it from outside.
  var _chiiState = 0; // 0 = not loaded, 1 = loading, 2 = loaded
  var _chiiFrame = null;
  var _chiiWrap = null;
  var _chiiHidden = false;
  var _chiiApplyingStyles = false;
  var _chiiWidth = 420;
  var _chiiLastCss = "";
  var _chiiHost = null;
  var _chiiResizeHandle = null;
  var _chiiFilterRestore = null;
  var _chiiInFrameTopbarReady = false;

  var CHII_SRC = "https://chii.liriliri.io/target.js";
  var CHII_MIN_WIDTH = 260;
  var CHII_MAX_WIDTH = 1600;

  // Properties known to get hijacked by broad host-page CSS resets
  // (grayscale filters behind a site's own modals, opacity tricks, blend
  // modes). Forcing these with !important on every piece of our own UI
  // guarantees it renders identically regardless of what the page around
  // it is doing.
  var UF_STYLE_RESET = "filter:none !important;-webkit-filter:none !important;backdrop-filter:none !important;opacity:1 !important;mix-blend-mode:normal !important;";

  var _chiiCloseBtn = null;

  function _chiiSetupHost(){
    if(_chiiHost) return;

    _chiiHost = document.createElement("div");
    _chiiHost.id = "__chii_host";
    document.documentElement.appendChild(_chiiHost);
    var root = _chiiHost.attachShadow({ mode:"open" });

    var style = document.createElement("style");
    style.textContent = [
      ":host{all:initial;--panel-width:"+_chiiWidth+"px}",
      "*{box-sizing:border-box}",
      "#chii-resize-handle{position:fixed;top:0;right:var(--panel-width);width:5px;margin-right:-2px;height:100vh;cursor:col-resize;z-index:2147483647;background:transparent;touch-action:none;display:none;"+UF_STYLE_RESET+"}",
      "#chii-resize-handle::after{content:'';position:absolute;top:0;left:2px;width:1px;height:100%;background:#474747}",
      "#chii-resize-handle.open{display:block}",
      // Guaranteed close button — lives here on the host side because
      // this script is confirmed to run here. The in-frame version inside
      // chii's own iframe (see _chiiBuildInFrameTopbar) only works if the
      // browser extension is also injecting into that third-party iframe,
      // which depends on your extension's own settings — this one doesn't.
      "#chii-close{position:fixed;top:0;right:0;width:26px;height:26px;z-index:2147483647;"+
        "border:none;background:#3c3c3c;color:#c7c7c7;"+
        "display:none;align-items:center;justify-content:center;padding:0;"+
        UF_STYLE_RESET+"}",
      "#chii-close.open{display:flex}",
      "#chii-close:hover{color:#e3e3e3;background:#464646}",
      "#chii-close svg{width:14px;height:14px;pointer-events:none}"
    ].join("\n");
    root.appendChild(style);

    _chiiResizeHandle = document.createElement("div");
    _chiiResizeHandle.id = "chii-resize-handle";
    root.appendChild(_chiiResizeHandle);

    _chiiCloseBtn = document.createElement("button");
    _chiiCloseBtn.id = "chii-close";
    _chiiCloseBtn.title = "Close DevTools";
    _chiiCloseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';
    _chiiCloseBtn.addEventListener("click", function(){ _chiiClose(); });
    root.appendChild(_chiiCloseBtn);

    _chiiResizeHandle.addEventListener("pointerdown", function(e){
      _chiiResizeHandle.setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
    });
    _chiiResizeHandle.addEventListener("pointermove", function(e){
      if(!_chiiResizeHandle.hasPointerCapture(e.pointerId)) return;
      _chiiSetWidth(window.innerWidth - e.clientX);
    });
    function endDrag(e){
      if(_chiiResizeHandle.hasPointerCapture(e.pointerId)) _chiiResizeHandle.releasePointerCapture(e.pointerId);
      document.body.style.userSelect = "";
    }
    _chiiResizeHandle.addEventListener("pointerup", endDrag);
    _chiiResizeHandle.addEventListener("pointercancel", endDrag);

    // Bonus path: if the in-frame close button (_chiiBuildInFrameTopbar)
    // ever does manage to run — i.e. your extension does inject into the
    // chii.liriliri.io iframe — it messages us here too. Harmless either
    // way since the host-side button above works regardless.
    window.addEventListener("message", function(e){
      if(e.data && e.data.type === "uf_chii_close") _chiiClose();
    });
  }

  function _chiiSetWidth(px){
    _chiiWidth = Math.max(CHII_MIN_WIDTH, Math.min(CHII_MAX_WIDTH, px));
    _chiiHost.style.setProperty("--panel-width", _chiiWidth+"px");
    _chiiResizeHandle.style.right = _chiiWidth+"px";
    _chiiApplyDockedStyle();
  }

  function _chiiSetOpenState(open){
    if(_chiiResizeHandle) _chiiResizeHandle.classList.toggle("open", open);
  }

  function _chiiMatchesFrame(node){
    if(!node || node.tagName!=="IFRAME") return false;
    var src = node.getAttribute("src")||"";
    return src.indexOf("chii_app.html")!==-1;
  }
  function _chiiFindFrameIn(node){
    if(!node || node.nodeType!==1) return null;
    if(_chiiMatchesFrame(node)) return node;
    if(node.querySelector){
      var f = node.querySelector('iframe[src*="chii_app.html"]');
      if(f) return f;
    }
    return null;
  }

  function _chiiApplyDockedStyle(){
    if(!_chiiWrap || !_chiiFrame) return;
    // No sidebar reserved anymore — the panel occupies its full width,
    // flush against the right edge. filter/opacity/blend-mode are forced
    // here too so the panel itself can't be grayed out or hidden by
    // whatever CSS the host page happens to apply broadly.
    var wrapCss =
      "position:fixed !important;top:0 !important;"+
      "right:0 !important;left:auto !important;bottom:auto !important;"+
      "width:"+_chiiWidth+"px !important;max-width:none !important;"+
      "height:100vh !important;max-height:none !important;"+
      "z-index:2147483647 !important;background:#282828 !important;overflow:hidden !important;"+
      "display:"+(_chiiHidden?"none":"block")+" !important;"+
      "margin:0 !important;padding:0 !important;border:none !important;transform:none !important;"+
      UF_STYLE_RESET;
    var frameCss =
      "width:100% !important;max-width:none !important;"+
      "height:100% !important;max-height:none !important;"+
      "border:none !important;display:block !important;margin:0 !important;padding:0 !important;"+
      "background:#282828 !important;"+
      UF_STYLE_RESET;
    if(wrapCss===_chiiLastCss) return;
    _chiiLastCss = wrapCss;
    _chiiApplyingStyles = true;
    _chiiWrap.style.cssText = wrapCss;
    _chiiFrame.style.cssText = frameCss;
    setTimeout(function(){ _chiiApplyingStyles=false; }, 0);
  }

  function _chiiDockRight(frame){
    _chiiFrame = frame;
    _chiiWrap = frame.parentNode;
    _chiiFrame.setAttribute("scrolling","no");
    _chiiApplyDockedStyle();
    _chiiSetOpenState(true);
    _chiiState = 2;

    var styleObserver = new MutationObserver(function(){
      if(_chiiApplyingStyles) return;
      _chiiApplyDockedStyle();
    });
    styleObserver.observe(_chiiWrap, { attributes:true, attributeFilter:["style"] });
    styleObserver.observe(_chiiFrame, { attributes:true, attributeFilter:["style"] });
  }

  function _chiiOpen(){
    if(!_chiiWrap) return;
    _chiiHidden = false;
    _chiiApplyDockedStyle();
    _chiiSetOpenState(true);
  }
  function _chiiClose(){
    if(!_chiiWrap) return;
    _chiiHidden = true;
    _chiiApplyDockedStyle();
    _chiiSetOpenState(false);
  }
  function toggleChii(){
    if(!_chiiWrap) return;
    if(_chiiHidden) _chiiOpen(); else _chiiClose();
  }

  // Runs INSIDE the chii iframe's own document (a separate script
  // instance, since this file is injected on every frame). Tries to
  // insert a real close button into chii's own tab bar — the empty
  // .tabbed-pane-right-toolbar on the right of its header. If that never
  // shows up (different chii build, markup changed, whatever), a floating
  // fallback button guarantees there's always SOME way to close the
  // panel.
  function _chiiBuildInFrameTopbar(){
    if(_chiiInFrameTopbarReady) return;
    _chiiInFrameTopbarReady = true;

    var BTN_ID = "__uf_chii_close_btn";

    function closeAction(e){
      if(e) e.stopPropagation();
      try{ window.parent.postMessage({ type:"uf_chii_close" }, "*"); }catch(ex){}
    }

    function getRoot(){
      return document.body || document.documentElement;
    }

    function whenRootReady(fn){
      if(getRoot()){
        fn();
        return;
      }
      setTimeout(function(){ whenRootReady(fn); }, 25);
    }

    function wireCloseButton(btn){
      if(!btn) return false;
      var row = btn.parentNode;
      var menu = row && row.querySelector ? row.querySelector(".main-menu") : null;
      if(menu && menu.nextSibling !== btn) row.insertBefore(btn, menu.nextSibling);
      var rightToolbar = btn.closest ? btn.closest(".tabbed-pane-right-toolbar") : null;
      if(rightToolbar){
        rightToolbar.style.setProperty("min-width","78px","important");
        rightToolbar.style.setProperty("flex","0 0 auto","important");
      }
      if(row && row.style){
        row.style.setProperty("display","flex","important");
        row.style.setProperty("align-items","center","important");
        row.style.setProperty("position","relative","important");
      }
      btn.classList.remove("hidden");
      btn.hidden = false;
      btn.style.setProperty("display","flex","important");
      btn.style.setProperty("position","relative","important");
      btn.style.setProperty("inset","auto","important");
      btn.style.setProperty("z-index","auto","important");
      btn.style.setProperty("flex","0 0 26px","important");
      btn.style.setProperty("width","26px","important");
      btn.style.setProperty("height","26px","important");
      btn.style.setProperty("margin","0","important");
      btn.style.setProperty("border","none","important");
      btn.style.setProperty("background","transparent","important");
      btn.setAttribute("aria-label","Close");
      btn.title = "Close";
      if(!btn.__ufChiiCloseWired){
        btn.__ufChiiCloseWired = true;
        btn.addEventListener("click", closeAction, true);
      }
      return true;
    }

    function findDeep(root, selector){
      if(!root) return null;
      if(root.querySelector){
        var found = root.querySelector(selector);
        if(found) return found;
      }
      var all = root.querySelectorAll ? root.querySelectorAll("*") : [];
      for(var i=0;i<all.length;i++){
        if(all[i].shadowRoot){
          var nested = findDeep(all[i].shadowRoot, selector);
          if(nested) return nested;
        }
      }
      return null;
    }

    function selectNativeCloseButton(){
      var buttons = document.querySelectorAll("button.close-devtools");
      var selected = null;
      for(var i=0;i<buttons.length;i++){
        var parent = buttons[i].parentNode;
        if(parent && parent.querySelector && parent.querySelector(".main-menu")){
          selected = buttons[i];
          break;
        }
      }
      if(!selected) selected = findDeep(document, ".toolbar-shadow button.close-devtools")
                         || findDeep(document, "button.close-devtools");
      for(var j=0;j<buttons.length;j++){
        if(buttons[j] === selected) continue;
        buttons[j].classList.add("hidden");
        buttons[j].hidden = true;
        buttons[j].style.setProperty("display","none","important");
      }
      return selected;
    }

    function removeCustomCloseButtons(){
      var buttons = document.querySelectorAll("#"+BTN_ID);
      for(var i=0;i<buttons.length;i++){
        try{ buttons[i].remove(); }catch(ex){}
      }
    }

    function ensureToolbarButton(){
      removeCustomCloseButtons();
      var nativeBtn = selectNativeCloseButton();
      if(nativeBtn) return wireCloseButton(nativeBtn);
      return false;
    }

    whenRootReady(function(){
      ensureToolbarButton();

      // Keep watching indefinitely — chii can re-render its header after
      // the initial load, which would silently remove our button along
      // with it if we ever stopped checking.
      new MutationObserver(ensureToolbarButton)
        .observe(document.documentElement, { childList:true, subtree:true });

      var fastPoll = setInterval(ensureToolbarButton, 25);
      setTimeout(function(){ clearInterval(fastPoll); }, 5000);
    });
  }

  function injectChii(){
    // If we ARE the chii devtools iframe itself, don't try to load a
    // second nested copy of the inspector inside it — instead build our
    // small close-button UI directly here, inside this frame's own
    // document. Regular nested iframes elsewhere on the page (anything
    // that isn't chii's own app) are completely unaffected.
    if(location.hostname === "chii.liriliri.io"){
      try{ window.parent.postMessage({ type:"uf_chii_close" }, "*"); }catch(ex){}
      return;
    }

    if(_chiiState===1) return;
    if(_chiiState===2){ toggleChii(); return; }
    _chiiState = 1;

    // Some sites apply a filter (commonly grayscale) to <html>/<body> to
    // dim the page behind their own modals. Since filter affects the
    // whole subtree regardless of z-index, that would gray out chii's
    // panel too. Neutralize it once, for the lifetime of this page —
    // toggling chii open/closed afterward shouldn't flicker it back.
    if(!_chiiFilterRestore) _chiiFilterRestore = neutralizePageFilter();

    _chiiSetupHost();

    var observer = new MutationObserver(function(mutations){
      for(var i=0;i<mutations.length;i++){
        var added = mutations[i].addedNodes;
        for(var j=0;j<added.length;j++){
          var frame = _chiiFindFrameIn(added[j]);
          if(frame){
            _chiiDockRight(frame);
            observer.disconnect();
            return;
          }
        }
      }
    });
    observer.observe(document.body || document.documentElement, { childList:true, subtree:true });

    var s = document.createElement("script");
    s.setAttribute("embedded","true");
    s.setAttribute("src", CHII_SRC);
    (document.head || document.documentElement).appendChild(s);
  }

  if(location.hostname === "chii.liriliri.io"){
    _chiiBuildInFrameTopbar();
  }

  // ── UI helpers (generic modal, toast, style hardening) ─────────────
  // Everything here is self-contained since it can appear on any
  // arbitrary site — never relies on external CSS classes.
  var UF_ICON = "https://raw.githubusercontent.com/StudioCompile/uFeatures/main/Logo.png";
  var _modalEl = null;
  var _modalFilterRestore = null;

  // Sites sometimes apply filter/opacity/box-sizing rules broadly (grayscale
  // overlays behind their own modals, icon resets, box model resets) that
  // would otherwise bleed into anything we inject. This walks every element
  // we just built and forces the properties that matter back to sane
  // values, with !important so it wins even against the site's own
  // !important rules.
  function hardenAgainstPageStyles(root){
    var all = [root].concat(Array.prototype.slice.call(root.querySelectorAll("*")));
    all.forEach(function(el){
      try{
        el.style.setProperty("filter","none","important");
        el.style.setProperty("-webkit-filter","none","important");
        el.style.setProperty("backdrop-filter","none","important");
        el.style.setProperty("opacity","1","important");
        el.style.setProperty("mix-blend-mode","normal","important");
        el.style.setProperty("box-sizing","border-box","important");
        el.style.setProperty("text-transform","none","important");
        el.style.setProperty("letter-spacing","normal","important");
        if(el.tagName==="svg" || el.tagName==="SVG"){
          var w=el.getAttribute("width"), h=el.getAttribute("height");
          if(w) el.style.setProperty("width", w+"px", "important");
          if(h) el.style.setProperty("height", h+"px", "important");
        }
      }catch(ex){}
    });
  }

  function neutralizePageFilter(){
    var html = document.documentElement, body = document.body;
    var htmlOrig = html.style.getPropertyValue("filter");
    var bodyOrig = body ? body.style.getPropertyValue("filter") : "";
    html.style.setProperty("filter","none","important");
    if(body) body.style.setProperty("filter","none","important");
    return function(){
      if(htmlOrig) html.style.setProperty("filter", htmlOrig);
      else html.style.removeProperty("filter");
      if(body){
        if(bodyOrig) body.style.setProperty("filter", bodyOrig);
        else body.style.removeProperty("filter");
      }
    };
  }

  function closeModal(){
    if(!_modalEl) return;
    try{ _modalEl.remove(); }catch(ex){}
    _modalEl = null;
    if(_modalFilterRestore){ _modalFilterRestore(); _modalFilterRestore = null; }
  }

  // Generic centered modal shell: backdrop + panel + header (logo, title, X)
  // + whatever body node you pass in. Returns the panel in case the caller
  // needs to focus something inside it.
  function openModal(titleText, bodyNode, widthPx){
    closeModal();
    _modalFilterRestore = neutralizePageFilter();

    var backdrop = document.createElement("div");
    backdrop.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center";
    backdrop.addEventListener("click", closeModal);

    var panel = document.createElement("div");
    panel.style.cssText = [
      "position:relative;z-index:2147483647",
      "width:"+(widthPx||280)+"px;background:#fff;border:1px solid #d8d8d8;border-radius:0",
      "overflow:hidden",
      "font-family:'Segoe UI',system-ui,-apple-system,sans-serif"
    ].join(";");
    panel.addEventListener("click", function(e){ e.stopPropagation(); });

    var header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;gap:8px;padding:10px 10px 10px 12px;border-bottom:1px solid #d8d8d8";
    var logoImg = document.createElement("img");
    logoImg.src = UF_ICON;
    logoImg.setAttribute("width","18");
    logoImg.setAttribute("height","18");
    logoImg.style.cssText = "width:18px;height:18px;object-fit:contain;image-rendering:auto;flex-shrink:0";
    var titleEl = document.createElement("span");
    titleEl.textContent = titleText;
    titleEl.style.cssText = "font-size:16px;font-weight:600;color:#1c1b22;flex:1";

    var closeBtn = document.createElement("button");
    closeBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#777" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="4" x2="20" y2="20"></line><line x1="20" y1="4" x2="4" y2="20"></line></svg>';
    closeBtn.style.cssText = "width:24px;height:24px;padding:0;display:flex;align-items:center;justify-content:center;border:none;border-radius:0;background:transparent;cursor:pointer;flex-shrink:0";
    closeBtn.onmouseover = function(){ this.style.background="#f0f0f0"; };
    closeBtn.onmouseout  = function(){ this.style.background="transparent"; };
    closeBtn.onclick = function(e){ e.stopPropagation(); closeModal(); };

    header.appendChild(logoImg);
    header.appendChild(titleEl);
    header.appendChild(closeBtn);
    panel.appendChild(header);
    panel.appendChild(bodyNode);
    backdrop.appendChild(panel);

    hardenAgainstPageStyles(backdrop);
    document.body.appendChild(backdrop);
    _modalEl = backdrop;

    document.addEventListener("keydown", function escHandler(e){
      if(e.key==="Escape"){ closeModal(); document.removeEventListener("keydown", escHandler); }
    });

    return panel;
  }

  // Lightweight auto-dismissing notification — replaces alert() for errors
  // and confirmations so nothing ever uses a native browser dialog.
  function showToast(msg, color){
    var restore = neutralizePageFilter();
    var t = document.createElement("div");
    t.style.cssText = [
      "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:2147483647",
      "background:#fff;border:1px solid #d8d8d8;border-radius:4px;padding:10px 16px",
      "font-family:'Segoe UI',system-ui,-apple-system,sans-serif;font-size:13px",
      "color:"+(color||"#1c1b22"),
      "opacity:0;transition:opacity .15s ease;max-width:320px"
    ].join(";");
    t.textContent = msg;
    hardenAgainstPageStyles(t);
    document.body.appendChild(t);
    requestAnimationFrame(function(){ t.style.setProperty("opacity","1","important"); });
    setTimeout(function(){
      t.style.setProperty("opacity","0","important");
      setTimeout(function(){ try{ t.remove(); }catch(ex){} restore(); }, 200);
    }, 3000);
  }

  // Shared field builders for modal forms — border #cfcfcf, focus #7f0000,
  // radius 3px, same as everything else in the popup.
  function ufLabel(text){
    var l = document.createElement("div");
    l.textContent = text;
    l.style.cssText = "font-size:11px;color:#6f6e77;margin-bottom:3px";
    return l;
  }
  function ufInput(value){
    var i = document.createElement("input");
    i.type = "text";
    i.value = value||"";
    i.style.cssText = "border:1px solid #cfcfcf;border-radius:3px;padding:6px 8px;font-family:inherit;font-size:13px;color:#1c1b22;background:#fff;width:100%;outline:none;margin-bottom:10px";
    i.onfocus = function(){ this.style.borderColor="#7f0000"; };
    i.onblur  = function(){ this.style.borderColor="#cfcfcf"; };
    return i;
  }
  function ufTextarea(){
    var t = document.createElement("textarea");
    t.style.cssText = "border:1px solid #cfcfcf;border-radius:3px;padding:7px 8px;font-family:Consolas,Menlo,monospace;font-size:12px;color:#1c1b22;background:#fff;width:100%;min-height:110px;resize:vertical;outline:none;margin-bottom:10px";
    t.placeholder = "// JavaScript to run on this page...";
    t.onfocus = function(){ this.style.borderColor="#7f0000"; };
    t.onblur  = function(){ this.style.borderColor="#cfcfcf"; };
    return t;
  }
  function ufRedButton(label){
    var b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "flex:1;padding:7px 0;border:1px solid #7f0000;border-radius:0;background:#7f0000;color:#fff;font-family:inherit;font-size:13px;cursor:pointer";
    b.onmouseover = function(){ this.style.background="#6a0000"; };
    b.onmouseout  = function(){ this.style.background="#7f0000"; };
    return b;
  }
  function ufPlainButton(label){
    var b = document.createElement("button");
    b.textContent = label;
    b.style.cssText = "flex:1;padding:7px 0;border:1px solid #cfcfcf;border-radius:0;background:#fff;color:#1c1b22;font-family:inherit;font-size:13px;cursor:pointer";
    b.onmouseover = function(){ this.style.background="#f0f0f0"; };
    b.onmouseout  = function(){ this.style.background="#fff"; };
    return b;
  }

  // ── Run JavaScript modal ────────────────────────────────────────────
  // Run it once, or save it as a permanent script for THIS site — which
  // just writes straight into this origin's own localStorage.
  function openRunJsModal(){
    var body = document.createElement("div");
    body.style.cssText = "padding:12px";

    body.appendChild(ufLabel("JavaScript"));
    var codeField = ufTextarea();
    body.appendChild(codeField);

    var actionRow = document.createElement("div");
    actionRow.style.cssText = "display:flex;gap:8px";

    var runBtn = ufRedButton("Run Once");
    runBtn.onclick = function(){
      var code = normalizeScriptCode(codeField.value.trim());
      if(!code) return;
      closeModal();
      try{ new Function(code)(); }
      catch(err){ showToast("Error: "+err, "#cc0000"); }
    };

    var toSaveBtn = ufPlainButton("Save as Script");

    actionRow.appendChild(runBtn);
    actionRow.appendChild(toSaveBtn);
    body.appendChild(actionRow);

    var saveStep = document.createElement("div");
    saveStep.style.cssText = "display:none";

    saveStep.appendChild(ufLabel("Script name"));
    var nameField = ufInput("My Script");
    saveStep.appendChild(nameField);

    var saveRow = document.createElement("div");
    saveRow.style.cssText = "display:flex;gap:8px";

    var backBtn = ufPlainButton("Back");
    backBtn.onclick = function(){
      saveStep.style.display = "none";
      actionRow.style.display = "flex";
    };

    var confirmSaveBtn = ufRedButton("Save");
    confirmSaveBtn.onclick = function(){
      var code = normalizeScriptCode(codeField.value.trim());
      var name = nameField.value.trim()||"My Script";
      if(!code) return;
      var entry = { name:name, domain:stripWww(location.hostname), code:code, enabled:true };

      var arr = siteLoad();
      var idx = -1;
      for(var i=0;i<arr.length;i++){ if(arr[i].name===entry.name){ idx=i; break; } }
      if(idx>=0) arr[idx]=entry; else arr.push(entry);
      siteSave(arr);

      closeModal();
      showToast("Script saved \u2713 \u2014 refresh this page to run it", "#1e7e34");
    };

    saveRow.appendChild(backBtn);
    saveRow.appendChild(confirmSaveBtn);
    saveStep.appendChild(saveRow);
    body.appendChild(saveStep);

    toSaveBtn.onclick = function(){
      actionRow.style.display = "none";
      saveStep.style.display = "block";
      nameField.focus();
      nameField.select();
    };

    openModal("Run JavaScript", body, 400);
    codeField.focus();
  }

  // ════════════════════════════════════════════════════════════════════
  // QUICK MENU  —  the Ctrl+` popup (per-site)
  // ════════════════════════════════════════════════════════════════════
  // Built on the openModal()/ufInput()/ufRedButton() shell that was
  // already in the script. Everything it lists and edits comes from THIS
  // origin's own localStorage via siteLoad/siteSave — the same list
  // runSiteScripts() reads on page load — so there's nothing to sync.

  function openQuickMenu(){
    var list = document.createElement("div");
    list.style.cssText = "display:flex;flex-direction:column;padding:6px 6px 0";

    function addItem(label, onClick){
      var btn = document.createElement("button");
      btn.textContent = label;
      btn.style.cssText = [
        "display:block;width:100%;text-align:left",
        "padding:9px 10px;margin:0;border:none;border-radius:0",
        "background:transparent;color:#1c1b22",
        "font-family:inherit;font-size:13px;cursor:pointer"
      ].join(";");
      btn.onmouseover = function(){ this.style.background="#f5f5f5"; };
      btn.onmouseout  = function(){ this.style.background="transparent"; };
      btn.onclick = function(e){
        e.stopPropagation();
        closeModal();
        onClick();
      };
      list.appendChild(btn);
    }

    addItem("Script Manager", function(){ openScriptsModal(); });
    addItem("Inspect Element", function(){ injectChii(); });
    addItem("Run JavaScript", function(){ openRunJsModal(); });

    var wrap = document.createElement("div");
    wrap.appendChild(list);

    // Small, quiet summary at the bottom rather than another menu button.
    // Wrapped in a centered row so only the text itself (not the full row
    // width) is the clickable/hoverable target — hovering underlines it,
    // like a normal inline link, and click jumps to the running-scripts list.
    var summaryRow = document.createElement("div");
    summaryRow.style.cssText = "padding:6px 0;text-align:center";

    var n = _ufRunningScripts.length;
    var summary = document.createElement("span");
    summary.textContent = n+" script"+(n!==1?"s":"")+" running on "+stripWww(location.hostname);
    summary.style.cssText = [
      "display:inline-block",
      "font-size:10px;color:#888",
      "cursor:pointer",
      "text-decoration:none",
      "line-height:1"
    ].join(";");
    summary.onmouseover = function(){ this.style.color="#555"; this.style.textDecoration="underline"; };
    summary.onmouseout  = function(){ this.style.color="#888"; this.style.textDecoration="none"; };
    summary.onclick = function(e){
      e.stopPropagation();
      openRunningScriptsModal();
    };

    var bullet = document.createElement("span");
    bullet.textContent = "\u2022";
    bullet.style.cssText = "display:inline-block;font-size:13px;color:#888;line-height:1;margin:0 6px";

    var infoLink = document.createElement("span");
    infoLink.textContent = "Info";
    infoLink.style.cssText = summary.style.cssText;
    infoLink.onmouseover = summary.onmouseover;
    infoLink.onmouseout  = summary.onmouseout;
    infoLink.onclick = function(e){
      e.stopPropagation();
      openInfoModal();
    };

    summaryRow.appendChild(summary);
    summaryRow.appendChild(bullet);
    summaryRow.appendChild(infoLink);
    wrap.appendChild(summaryRow);

    openModal("uFeatures", wrap, 400);
  }

  // ── Info modal ──────────────────────────────────────────────────────
  // The "About" content that used to live on the google.com/ufeatures
  // Home tab, now reachable from the quick menu instead of a separate page.
  var UF_FEATURES = [
    { title:"Script Manager", desc:"Save JavaScript snippets that run automatically on this site every page load. Edit, toggle, or delete from the popup." },
    { title:"Remove Securly Loading", desc:"Removes Securly overlay elements on load and watches via MutationObserver so they cannot come back." },
    { title:"Inspect Element", desc:"Injects a remote DevTools panel into any page. Ctrl+Shift+I to toggle." },
    { title:"Bookmarklet Runner", desc:"Copy any javascript: URL then press Ctrl+V outside a text field to run it on the current page." },
    { title:"Iframe Navigator", desc:"Hover the bottom-right corner of any iframe to navigate it to a new URL." }
  ];

  // A collapsed-by-default <details>-style section with our own arrow
  // glyph in place of the native marker (which varies by browser), used
  // for both Features and Shortcuts below.
  function ufSection(label){
    var wrap = document.createElement("div");
    wrap.style.cssText = "margin-top:8px;border-top:1px solid #d8d8d8;padding-top:8px";

    var head = document.createElement("div");
    head.style.cssText = "display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;font-size:11px;font-weight:600;color:#6f6e77;text-transform:uppercase;letter-spacing:.05em";
    var arrow = document.createElement("span");
    arrow.textContent = "\u25B6";
    arrow.style.cssText = "display:inline-block;transition:transform .15s;font-size:9px";
    var lbl = document.createElement("span");
    lbl.textContent = label;
    head.appendChild(arrow); head.appendChild(lbl);

    var content = document.createElement("div");
    content.style.cssText = "display:none;margin-top:8px";

    var open = false;
    head.onclick = function(){
      open = !open;
      content.style.display = open ? "block" : "none";
      arrow.style.transform = open ? "rotate(90deg)" : "rotate(0deg)";
    };

    wrap.appendChild(head);
    wrap.appendChild(content);
    return { wrap:wrap, content:content };
  }

  // Slideshow: one feature card at a time, arrows either side plus a dot
  // row, so the popup only ever grows tall enough for a single card.
  function buildFeatureSlideshow(){
    var idx = 0;
    var slides = UF_FEATURES;

    var box = document.createElement("div");
    box.style.cssText = "display:flex;align-items:center;gap:8px";

    function arrowBtn(glyph){
      var b = document.createElement("button");
      b.textContent = glyph;
      b.style.cssText = "flex-shrink:0;width:22px;height:22px;padding:0;border:1px solid #cfcfcf;border-radius:3px;background:#fff;color:#6f6e77;font-size:12px;cursor:pointer";
      b.onmouseover = function(){ this.style.background="#f0f0f0"; };
      b.onmouseout  = function(){ this.style.background="#fff"; };
      return b;
    }
    var prevBtn = arrowBtn("\u2039");
    var nextBtn = arrowBtn("\u203A");

    var card = document.createElement("div");
    card.style.cssText = "flex:1;min-width:0;min-height:64px;padding:8px 4px";
    var cardTitle = document.createElement("div");
    cardTitle.style.cssText = "font-size:13px;font-weight:600;color:#1c1b22;margin-bottom:4px";
    var cardDesc = document.createElement("div");
    cardDesc.style.cssText = "font-size:12px;color:#555;line-height:1.5";
    card.appendChild(cardTitle); card.appendChild(cardDesc);

    var dots = document.createElement("div");
    dots.style.cssText = "display:flex;justify-content:center;gap:5px;margin-top:4px;flex-wrap:wrap";
    var dotEls = slides.map(function(_, i){
      var d = document.createElement("span");
      d.style.cssText = "width:6px;height:6px;border-radius:50%;background:#d8d8d8;cursor:pointer;display:inline-block";
      d.onclick = function(){ idx=i; render(); };
      dots.appendChild(d);
      return d;
    });

    function render(){
      cardTitle.textContent = slides[idx].title;
      cardDesc.textContent = slides[idx].desc;
      dotEls.forEach(function(d,i){ d.style.background = i===idx ? "#7f0000" : "#d8d8d8"; });
    }
    prevBtn.onclick = function(){ idx = (idx-1+slides.length)%slides.length; render(); };
    nextBtn.onclick = function(){ idx = (idx+1)%slides.length; render(); };
    render();

    box.appendChild(prevBtn);
    box.appendChild(card);
    box.appendChild(nextBtn);

    var outer = document.createElement("div");
    outer.appendChild(box);
    outer.appendChild(dots);
    return outer;
  }

  function openInfoModal(){
    var body = document.createElement("div");
    body.style.cssText = "padding:12px 16px 14px";

    var byline = document.createElement("div");
    byline.style.cssText = "font-size:11px;color:#aaa;margin-bottom:10px";
    byline.innerHTML = "By StudioCompile &mdash; Roblox: studiocompile &middot; Discord: @roblox_studio";
    body.appendChild(byline);

    var intro = document.createElement("div");
    intro.style.cssText = "font-size:13px;color:#444;line-height:1.55";
    intro.textContent = "uBlock Origin lets you inject JS into almost any website, which has a lot of potential. There are already projects out there for it, but you can only add one at a time and most aren't great. uFeatures is a great way to add all of these features \u2014 and easily add even more.";
    body.appendChild(intro);

    var featSec = ufSection("Features");
    featSec.content.appendChild(buildFeatureSlideshow());
    body.appendChild(featSec.wrap);

    var footer = document.createElement("div");
    footer.style.cssText = "display:flex;margin-top:14px";
    var backBtn = ufPlainButton("Back");
    backBtn.onclick = function(){ closeModal(); openQuickMenu(); };
    footer.appendChild(backBtn);
    body.appendChild(footer);

    openModal("uFeatures", body, 380);
  }

  // ── Scripts list ────────────────────────────────────────────────────
  // Same row layout/colors as the old Settings "Saved Scripts" card, but
  // scoped to this site only. Checkbox is hand-built from spans since this
  // renders on arbitrary pages with no stylesheet of our own to lean on.
  function openScriptsModal(){
    var body = document.createElement("div");
    body.style.cssText = "padding:0 10px";

    var card = document.createElement("div");
    card.style.cssText = "border:1px solid #d8d8d8;border-radius:4px;overflow:hidden;margin:10px 0";
    body.appendChild(card);

    var arr = siteLoad();

    if(!arr.length){
      var empty = document.createElement("div");
      empty.textContent = "No scripts saved for this site yet.";
      empty.style.cssText = "padding:24px;text-align:center;color:#bbb;font-size:13px;background:#fff";
      card.appendChild(empty);
    } else {
      arr.forEach(function(s, i){
        var row = document.createElement("div");
        row.style.cssText = [
          "display:grid;grid-template-columns:16px 1fr 46px 60px",
          "align-items:center;gap:9px;padding:8px 12px;background:#fff",
          i<arr.length-1 ? "border-bottom:1px solid #ececec" : ""
        ].join(";");

        // Checkbox — 16px, red when checked, white checkmark
        var cb = document.createElement("span");
        cb.style.cssText = "position:relative;width:16px;height:16px;flex-shrink:0;cursor:pointer;display:block;border:1px solid #cfcfcf;border-radius:0;background:#fff";
        var tick = document.createElement("span");
        tick.style.cssText = "position:absolute;left:4px;top:1px;width:6px;height:9px;border:2px solid #fff;border-top:none;border-left:none;transform:rotate(45deg)";
        cb.appendChild(tick);

        var name = document.createElement("div");
        name.style.cssText = "font-size:13px;color:#1c1b22;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        name.textContent = s.name;

        function paint(on){
          cb.style.background = on ? "#7f0000" : "#fff";
          cb.style.borderColor = on ? "#7f0000" : "#cfcfcf";
          tick.style.display = on ? "block" : "none";
          name.style.color = on ? "#1c1b22" : "#bbb";
        }
        paint(!!s.enabled);

        cb.onclick = (function(idx){ return function(e){
          e.stopPropagation();
          var a = siteLoad();
          a[idx].enabled = !a[idx].enabled;
          siteSave(a);
          paint(a[idx].enabled);
        }; })(i);

        var info = document.createElement("div");
        info.style.cssText = "min-width:0";
        var dom = document.createElement("div");
        dom.style.cssText = "font-size:11px;color:#999;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
        dom.textContent = !s.domain ? "(no domain \u2014 won't run)"
          : s.domain.indexOf("/")===-1 ? "Every page"
          : "Only "+s.domain.slice(s.domain.indexOf("/"));
        info.appendChild(name);
        info.appendChild(dom);

        function smallBtn(label, danger, width){
          var b = document.createElement("button");
          b.textContent = label;
          b.style.cssText = "width:"+(width||46)+"px;padding:4px 0;font-size:11px;font-family:inherit;cursor:pointer;border:1px solid #cfcfcf;background:#fff;border-radius:0;color:"+(danger?"#7f0000":"#1c1b22");
          b.onmouseover = function(){ this.style.background = danger?"#fbecec":"#f0f0f0"; };
          b.onmouseout  = function(){ this.style.background = "#fff"; };
          return b;
        }

        var eb = smallBtn("Edit", false, 46);
        eb.onclick = (function(sc){ return function(e){
          e.stopPropagation();
          openScriptEditor(sc);
        }; })(s);

        var db = smallBtn("Delete", true, 60);
        db.onclick = (function(idx, nm){ return function(e){
          e.stopPropagation();
          var a = siteLoad();
          a.splice(idx,1);
          siteSave(a);
          openScriptsModal();
          showToast("Deleted \""+nm+"\"", "#7f0000");
        }; })(i, s.name);

        row.appendChild(cb);
        row.appendChild(info);
        row.appendChild(eb);
        row.appendChild(db);
        card.appendChild(row);
      });
    }

    var footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:8px;padding:0 0 10px";
    var backBtn = ufPlainButton("Back");
    backBtn.onclick = function(){ closeModal(); openQuickMenu(); };
    var newBtn = ufRedButton("New Script");
    newBtn.onclick = function(){ openScriptEditor(null); };
    footer.appendChild(backBtn);
    footer.appendChild(newBtn);
    body.appendChild(footer);

    openModal("My Scripts", body, 400);
  }

  // ── Script editor ───────────────────────────────────────────────────
  // The Domain field is the "sensitivity" dial: plain hostname runs
  // everywhere on this site, "*.host" also catches subdomains, and
  // "host/some/path" restricts it to one section. Defaults to the current
  // hostname so the common case needs no thought.
  function openScriptEditor(existing){
    var host = stripWww(location.hostname);
    var body = document.createElement("div");
    body.style.cssText = "padding:12px";

    body.appendChild(ufLabel("Script name"));
    var nameField = ufInput(existing ? existing.name : "My Script");
    body.appendChild(nameField);

    body.appendChild(ufLabel("Domain"));

    // Existing entries with a path suffix (host+"/foo") come back with
    // that path pre-filled; a bare host (or nothing yet) means "whole
    // domain", so the path side starts empty.
    var existingPath = "";
    if(existing && existing.domain){
      var slash = existing.domain.indexOf("/");
      if(slash!==-1) existingPath = existing.domain.slice(slash);
    }

    var domRow = document.createElement("div");
    domRow.style.cssText = "display:flex;align-items:stretch;border:1px solid #cfcfcf;border-radius:3px;overflow:hidden;margin-bottom:6px";

    var domPrefix = document.createElement("div");
    domPrefix.textContent = host;
    domPrefix.title = "This can't be changed \u2014 a script saved here only ever runs on "+host;
    domPrefix.style.cssText = "padding:6px 0 6px 8px;background:#fff;color:#1c1b22;font-family:inherit;font-size:13px;white-space:nowrap";

    var pathField = document.createElement("input");
    pathField.type = "text";
    pathField.value = existingPath;
    pathField.placeholder = "/optional-path";
    pathField.style.cssText = "border:none;flex:1;min-width:0;padding:6px 8px 6px 1px;font-family:inherit;font-size:13px;color:#1c1b22;background:#fff;outline:none";
    pathField.onfocus = function(){ domRow.style.borderColor="#7f0000"; };
    pathField.onblur  = function(){ domRow.style.borderColor="#cfcfcf"; };

    domRow.appendChild(domPrefix);
    domRow.appendChild(pathField);
    body.appendChild(domRow);

    var hint = document.createElement("div");
    hint.style.cssText = "font-size:10px;color:#aaa;line-height:1.5;margin-bottom:8px";
    hint.textContent = "Leave blank for all directories.";
    body.appendChild(hint);

    body.appendChild(ufLabel("JavaScript"));
    var codeField = ufTextarea();
    codeField.value = existing ? existing.code : "";
    body.appendChild(codeField);

    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px";

    var backBtn = ufPlainButton("Back");
    backBtn.onclick = function(){ openScriptsModal(); };

    var saveBtn = ufRedButton(existing ? "Update" : "Save Script");
    saveBtn.onclick = function(){
      var code = normalizeScriptCode(codeField.value.trim());
      if(!code){ showToast("Code is required.", "#cc0000"); return; }
      var path = pathField.value.trim();
      if(path && path[0]!=="/") path = "/"+path;
      var entry = {
        name: nameField.value.trim()||"My Script",
        domain: path ? host+path : host,
        code: code,
        enabled: existing ? existing.enabled !== false : true
      };

      var arr = siteLoad();
      var key = existing ? existing.name : entry.name;
      var idx = -1;
      for(var i=0;i<arr.length;i++){ if(arr[i].name===key){ idx=i; break; } }
      if(idx>=0) arr[idx]=entry; else arr.push(entry);
      siteSave(arr);

      openScriptsModal();
      showToast("Saved \u2713 \u2014 refresh this page to run it", "#1e7e34");
    };

    row.appendChild(backBtn);
    row.appendChild(saveBtn);
    body.appendChild(row);

    openModal(existing ? "Edit Script" : "New Script", body, 400);
    nameField.focus();
    nameField.select();
  }

  // ── Running Scripts viewer ──────────────────────────────────────────
  // Shows exactly what runSiteScripts() executed on THIS page load — the
  // scripts that were enabled and matched this domain — with a mark for
  // whether each one actually ran without throwing. "Edit" jumps straight
  // into that script's editor instead of a separate settings page.
  function openRunningScriptsModal(){
    var body = document.createElement("div");

    var card = document.createElement("div");
    card.style.cssText = "margin:10px;border:1px solid #d8d8d8;border-radius:4px;overflow:hidden";
    body.appendChild(card);

    if(!_ufRunningScripts.length){
      var empty = document.createElement("div");
      empty.textContent = "No scripts ran on this page.";
      empty.style.cssText = "padding:24px;text-align:center;color:#bbb;font-size:13px;background:#fff";
      card.appendChild(empty);
    } else {
      _ufRunningScripts.forEach(function(s, i){
        var row = document.createElement("div");
        row.style.cssText = [
          "display:grid;grid-template-columns:8px 1fr 50px",
          "align-items:center;gap:9px;padding:8px 12px",
          "background:#fff",
          i<_ufRunningScripts.length-1 ? "border-bottom:1px solid #d8d8d8" : ""
        ].join(";");

        var dot = document.createElement("span");
        dot.style.cssText = "width:8px;height:8px;border-radius:50%;background:"+(s.ok?"#1e7e34":"#cc0000");
        dot.title = s.ok ? "Ran successfully" : "Threw an error";
        if(!s.ok && s.error) row.title = s.error;

        var name = document.createElement("span");
        name.textContent = s.name;
        name.style.cssText = "font-size:13px;color:#1c1b22;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";

        var viewBtn = document.createElement("button");
        viewBtn.textContent = "Edit";
        viewBtn.style.cssText = "width:50px;padding:4px 0;font-size:12px;font-family:inherit;cursor:pointer;border:1px solid #cfcfcf;background:#fff;color:#1c1b22;border-radius:0";
        viewBtn.onmouseover = function(){ this.style.background="#f0f0f0"; };
        viewBtn.onmouseout  = function(){ this.style.background="#fff"; };
        viewBtn.onclick = (function(nm){ return function(e){
          e.stopPropagation();
          var arr = siteLoad(), found = null;
          for(var k=0;k<arr.length;k++){ if(arr[k].name===nm){ found=arr[k]; break; } }
          if(found) openScriptEditor(found);
        }; })(s.name);

        row.appendChild(dot);
        row.appendChild(name);
        row.appendChild(viewBtn);
        card.appendChild(row);
      });
    }

    var footer = document.createElement("div");
    footer.style.cssText = "display:flex;gap:8px;padding:0 10px 10px";
    var backBtn = ufPlainButton("Back");
    backBtn.onclick = function(){ closeModal(); openQuickMenu(); };
    footer.appendChild(backBtn);
    body.appendChild(footer);

    openModal("Running Scripts", body, 340);
  }

  // ── Global shortcuts ──────────────────────────────────────────────
  document.addEventListener("keydown",function(e){
    var tag=(document.activeElement||{}).tagName;
    var typing=tag==="INPUT"||tag==="TEXTAREA"||tag==="SELECT";
    if(e.ctrlKey&&e.shiftKey&&!e.altKey&&e.key==="I"){
      // No "typing" guard here on purpose — this combo is never something
      // someone would type into a field, and the toggle should always work
      // no matter what has focus on the page.
      e.preventDefault(); injectChii(); return;
    }
    if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.code==="Backquote"){
      e.preventDefault();
      if(_modalEl) closeModal(); else openQuickMenu();
      return;
    }
    if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&e.key==="v"){
      if(typing) return;
      navigator.clipboard.readText().then(function(text){
        if(text.trim().match(/^javascript:/i)){ e.preventDefault(); runBookmarklet(text); }
      }).catch(function(){});
    }
  });

}();
