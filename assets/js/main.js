/* Allen Technical Solutions — front-end behaviour for the design preview.
   In WordPress: menus -> core Navigation block, search -> core Search block
   (or SearchWP / Relevanssi), cart -> WooCommerce mini-cart, forms -> plugin. */
(function () {
  "use strict";

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const desktop = () => window.matchMedia("(min-width: 1181px)").matches;
  const store = {
    get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  };

  /* ---------- Mega menus ---------- */
  const megas = $$(".has-mega");
  const closeAll = (except) => megas.forEach((li) => {
    if (li === except) return;
    li.classList.remove("open");
    $(".nav-link", li).setAttribute("aria-expanded", "false");
  });
  megas.forEach((li) => {
    const btn = $(".nav-link", li);
    let timer;
    btn.addEventListener("click", () => {
      const open = !li.classList.contains("open");
      closeAll(li);
      li.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    });
    li.addEventListener("mouseenter", () => {
      if (!desktop()) return;
      clearTimeout(timer);
      closeAll(li);
      li.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
    });
    li.addEventListener("mouseleave", () => {
      if (!desktop()) return;
      timer = setTimeout(() => { li.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); }, 120);
    });
  });
  document.addEventListener("click", (e) => { if (desktop() && !e.target.closest(".has-mega")) closeAll(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeAll(); document.body.classList.remove("nav-open"); hideSuggest(); }
  });

  /* ---------- Mobile nav ---------- */
  const openBtn = $("[data-menu-open]"), closeBtn = $("[data-menu-close]");
  openBtn && openBtn.addEventListener("click", () => document.body.classList.add("nav-open"));
  closeBtn && closeBtn.addEventListener("click", () => document.body.classList.remove("nav-open"));
  document.addEventListener("click", (e) => {
    if (document.body.classList.contains("nav-open") && !e.target.closest(".primary-nav") && !e.target.closest("[data-menu-open]")) {
      document.body.classList.remove("nav-open");
    }
  });

  /* ---------- Search ---------- */
  let indexPromise;
  const loadIndex = () => indexPromise || (indexPromise = fetch("search-index.json").then((r) => r.json()).catch(() => []));
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function search(index, q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return index.map((e) => {
      const t = e.title.toLowerCase(), k = e.keywords.toLowerCase(), s = e.summary.toLowerCase(), x = e.text.toLowerCase();
      let score = 0;
      for (const term of terms) {
        let hit = 0;
        if (t.includes(term)) hit += 10;
        if (k.includes(term)) hit += 6;
        if (s.includes(term)) hit += 3;
        if (x.includes(term)) hit += 1;
        if (!hit) return null;
        score += hit;
      }
      if (!e.url.includes("#")) score += 1;
      return { e, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).map((r) => r.e);
  }

  const input = $("#site-search"), suggest = $("#search-suggest");
  let active = -1;
  function hideSuggest() { if (suggest) { suggest.classList.remove("show"); active = -1; } }
  if (input && suggest) {
    input.addEventListener("focus", loadIndex);
    input.addEventListener("input", async () => {
      const q = input.value.trim();
      if (q.length < 2) return hideSuggest();
      const res = search(await loadIndex(), q).slice(0, 6);
      suggest.innerHTML = res.length
        ? res.map((r) => `<li><a href="${r.url}" role="option">${esc(r.title)}<small>${esc(r.summary.slice(0, 80))}</small></a></li>`).join("") +
          `<li><a href="search.html?q=${encodeURIComponent(q)}"><strong>See all results for “${esc(q)}”</strong></a></li>`
        : `<li class="empty">No matches yet. Press Enter to search everything.</li>`;
      suggest.classList.add("show");
      active = -1;
    });
    input.addEventListener("keydown", (e) => {
      const links = $$("a", suggest);
      if (!links.length || !suggest.classList.contains("show")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        active = (active + (e.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
        links.forEach((l, i) => l.classList.toggle("active", i === active));
      } else if (e.key === "Enter" && active >= 0) {
        e.preventDefault();
        location.href = links[active].href;
      }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search-form")) hideSuggest(); });
  }

  // Full results page
  const resultsEl = $("[data-search-results]");
  if (resultsEl) {
    const q = new URLSearchParams(location.search).get("q") || "";
    $$("input[name=q]").forEach((i) => (i.value = q));
    const title = $("[data-search-title]");
    loadIndex().then((index) => {
      const res = q ? search(index, q) : [];
      if (title) title.textContent = q ? `${res.length} result${res.length === 1 ? "" : "s"} for “${q}”` : "Search the site";
      const mark = (s) => {
        let out = esc(s);
        q.split(/\s+/).filter((t) => t.length > 1).forEach((t) => {
          out = out.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"), "<mark>$1</mark>");
        });
        return out;
      };
      resultsEl.innerHTML = res.length
        ? res.map((r) => `<li><a href="${r.url}"><h3>${mark(r.title)}</h3><p>${mark(r.summary)}</p></a></li>`).join("")
        : q ? `<li><p>Nothing matched. Try “engineering”, “WordPress”, “invoice” or <a href="contact.html">ask us directly</a>.</p></li>` : "";
    });
  }

  /* ---------- Mock cart (WooCommerce later) ---------- */
  const countEls = $$("[data-cart-count]");
  const renderCount = () => {
    const n = store.get("ats-cart", []).length;
    countEls.forEach((el) => { el.textContent = n; el.style.visibility = n ? "visible" : "hidden"; });
  };
  renderCount();
  $$("[data-add-to-cart]").forEach((btn) => btn.addEventListener("click", () => {
    const cart = store.get("ats-cart", []);
    cart.push(btn.dataset.addToCart);
    store.set("ats-cart", cart);
    renderCount();
    const label = btn.textContent;
    btn.textContent = "Added ✓";
    setTimeout(() => (btn.textContent = label), 1400);
  }));
  const cartList = $("[data-cart-list]");
  if (cartList) {
    const draw = () => {
      const items = store.get("ats-cart", []);
      cartList.innerHTML = items.length ? items.map((i) => `<li>${esc(i)}</li>`).join("") : "<li>Your cart is empty.</li>";
    };
    draw();
    const clear = $("[data-cart-clear]");
    clear && clear.addEventListener("click", () => { store.set("ats-cart", []); draw(); renderCount(); });
  }

  /* ---------- Filters (projects) ---------- */
  const filterBars = $$("[data-filter-group]");
  filterBars.forEach((bar) => {
    const target = $(bar.dataset.filterGroup);
    $$("button", bar).forEach((b) => b.addEventListener("click", () => {
      $$("button", bar).forEach((x) => x.classList.toggle("active", x === b));
      const f = b.dataset.filter;
      $$("[data-cat]", target).forEach((c) => { c.style.display = f === "all" || c.dataset.cat.includes(f) ? "" : "none"; });
    }));
  });

  /* ---------- Mock forms ---------- */
  $$("form[data-mock-form]").forEach((form) => form.addEventListener("submit", (e) => {
    e.preventDefault();
    const ok = $(".form-success", form) || form.nextElementSibling;
    if (ok && ok.classList.contains("form-success")) ok.classList.add("show");
    else { const b = $("button[type=submit]", form); if (b) b.textContent = "Thanks ✓"; }
    form.reset();
  }));

  /* ---------- Software trial dialog (WooCommerce downloadable product + license plugin later) ---------- */
  const trial = $("#trial-dialog");
  if (trial && trial.showModal) {
    $$("[data-trial]").forEach((b) => b.addEventListener("click", () => {
      $("[data-trial-name]", trial).textContent = b.dataset.trial;
      $(".form-success", trial).classList.remove("show");
      trial.showModal();
    }));
    $$("[data-dialog-close]", trial).forEach((b) => b.addEventListener("click", () => trial.close()));
    trial.addEventListener("click", (e) => { if (e.target === trial) trial.close(); });
  }

  /* ---------- Home hero: slideshow ---------- */
  const hero = $("[data-hero]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let surge = () => {};
  if (hero) {
    const SLIDE_MS = 8000;
    hero.style.setProperty("--slide-ms", SLIDE_MS + "ms");
    const slides = $$(".hero-slide", hero), dots = $$(".hero-dots button", hero), copy = $(".hero-copy", hero);
    let current = 0, timer = 0, startedAt = 0, remaining = SLIDE_MS, paused = false;
    const arm = (ms) => {
      clearTimeout(timer);
      if (reduceMotion || paused) return;
      startedAt = performance.now();
      remaining = ms;
      timer = setTimeout(() => show(current + 1), ms);
    };
    function show(i, quiet) {
      current = (i + slides.length) % slides.length;
      slides.forEach((s, k) => {
        const on = k === current;
        s.classList.toggle("is-active", on);
        s.setAttribute("aria-hidden", String(!on));
        s.inert = !on;
      });
      dots.forEach((d, k) => {
        d.classList.remove("is-active");
        d.removeAttribute("aria-current");
        if (k === current) { void d.offsetWidth; d.classList.add("is-active"); d.setAttribute("aria-current", "true"); }
      });
      if (!quiet) surge(current);
      arm(SLIDE_MS);
    }
    const pause = (on) => {
      if (on === paused) return;
      paused = on;
      hero.classList.toggle("hero-paused", on);
      if (on) { clearTimeout(timer); remaining -= performance.now() - startedAt; }
      else arm(Math.max(400, remaining));
    };
    dots.forEach((d, k) => d.addEventListener("click", () => show(k)));
    $("[data-slide-prev]", hero).addEventListener("click", () => show(current - 1));
    $("[data-slide-next]", hero).addEventListener("click", () => show(current + 1));
    copy.addEventListener("mouseenter", () => pause(true));
    copy.addEventListener("mouseleave", () => pause(false));
    copy.addEventListener("focusin", () => pause(true));
    copy.addEventListener("focusout", (e) => { if (!copy.contains(e.relatedTarget)) pause(false); });
    let touchX = null;
    hero.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener("touchend", (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1));
      touchX = null;
    });
    show(0, true);
  }

  /* ---------- Home hero: electron tracers ----------
     Electrons start slow and dim, then accelerate and brighten along the baked circuit
     traces (paths come from src/hero_traces.py) and flash the pad they land in. */
  const traceSvg = hero && $(".hero-traces", hero);
  if (traceSvg && !reduceMotion) {
    const NS = "http://www.w3.org/2000/svg";
    const sparks = $(".hero-sparks", traceSvg);
    const routes = $$("[data-route]", traceSvg).map((p) => ({
      el: p, id: p.dataset.route, end: p.dataset.end, w: +p.dataset.weight, big: !!p.dataset.big,
      d: p.getAttribute("d"), len: p.getTotalLength(),
      branches: (p.dataset.branches || "").split(";").filter(Boolean).map((b) => {
        const [id, x, y] = b.split(",");
        return { id, x: +x, y: +y };
      }),
    }));
    const byId = Object.fromEntries(routes.map((r) => [r.id, r]));
    routes.forEach((r) => r.branches.forEach((b) => {
      let best = 0, bestD = Infinity;
      for (let s = 0; s <= r.len; s += 3) {
        const pt = r.el.getPointAtLength(s), dd = (pt.x - b.x) ** 2 + (pt.y - b.y) ** 2;
        if (dd < bestD) { bestD = dd; best = s; }
      }
      b.at = best;
    }));

    // Map the visible part of the image: "right center / cover" on desktop, the art crop on narrow screens
    const narrow = window.matchMedia("(max-width: 1024px)");
    let scale = 1;
    const fit = () => {
      const box = traceSvg.getBoundingClientRect();
      let x0, x1 = 2601, y0 = 0, y1 = 942;
      if (narrow.matches) {
        traceSvg.setAttribute("viewBox", "1000 0 1601 942");
        traceSvg.setAttribute("preserveAspectRatio", "xMidYMin meet");
        scale = box.width / 1601; x0 = 1000;
      } else {
        traceSvg.setAttribute("viewBox", "0 0 2601 942");
        traceSvg.setAttribute("preserveAspectRatio", "xMaxYMid slice");
        scale = Math.max(box.width / 2601, box.height / 942);
        x0 = 2601 - box.width / scale;
        y0 = (942 - box.height / scale) / 2; y1 = 942 - y0;
      }
      routes.forEach((r) => {
        r.s0 = null;
        for (let s = 0; s <= r.len; s += 6) {
          const pt = r.el.getPointAtLength(s);
          if (pt.x >= x0 - 8 && pt.x <= x1 + 8 && pt.y >= y0 - 8 && pt.y <= y1 + 8) { r.s0 = Math.max(0, s - 40); break; }
        }
      });
    };

    const live = new Set(), flashes = new Set();
    const make = (parent, tag, attrs) => {
      const e = document.createElementNS(NS, tag);
      for (const k in attrs) e.setAttribute(k, attrs[k]);
      parent.appendChild(e);
      return e;
    };
    const spawn = (r, opts = {}) => {
      if (!r || r.s0 === null || r.s0 === undefined || live.size > 7) return;
      const g = make(sparks, "g", {});
      const s0 = opts.from ?? r.s0, dist = r.len - s0;
      const e = {
        r, g, s0, dist, t0: performance.now(), pow: opts.pow || 2.6, fired: new Set(),
        dur: opts.dur || Math.min(7200, Math.max(2400, (dist * scale) / 0.17)),
        glow: make(g, "path", { class: "spark-glow", d: r.d, "stroke-width": 8 / scale }),
        core: make(g, "path", { class: "spark-core", d: r.d, "stroke-width": 2.2 / scale }),
        halo: make(g, "circle", { fill: "url(#spark-halo)", r: 14 / scale }),
        head: make(g, "circle", { class: "spark-head", r: 2.6 / scale }),
      };
      live.add(e);
    };
    const flash = (x, y, big) => {
      const c = make(sparks, "circle", { class: "pad-flash", cx: x, cy: y, fill: "url(#spark-halo)" });
      flashes.add({ c, big, t0: performance.now() });
    };
    // after a main feed lands, the A's leg it just climbed keeps glowing and fades out
    const glows = new Set();
    const afterglow = (r) => {
      const L = Math.min(340, r.len);
      const a = make(sparks, "path", { class: "afterglow", d: r.d, "stroke-dasharray": `${L} ${r.len}`, "stroke-dashoffset": String(L - r.len) });
      glows.add({ a, t0: performance.now() });
    };
    const pick = () => {
      const pool = routes.filter((r) => r.w > 0 && r.s0 !== null);
      let x = Math.random() * pool.reduce((a, r) => a + r.w, 0);
      for (const r of pool) if ((x -= r.w) <= 0) return r;
      return pool[0];
    };
    surge = (i) => spawn(byId[i % 2 ? "feed-right" : "feed-left"]);

    const step = (now) => {
      for (const e of live) {
        const p = Math.min(1, Math.max(0, (now - e.t0) / e.dur));
        const s = e.s0 + e.dist * Math.pow(p, e.pow);
        const speed = Math.pow(p, e.pow - 1);                 // 0 at launch, 1 at arrival
        const tail = (8 + 120 * speed) / scale;
        const dash = `${tail} ${e.r.len + tail}`, off = String(tail - s);
        e.glow.setAttribute("stroke-dasharray", dash); e.glow.setAttribute("stroke-dashoffset", off);
        e.core.setAttribute("stroke-dasharray", dash); e.core.setAttribute("stroke-dashoffset", off);
        const pt = e.r.el.getPointAtLength(s);
        e.head.setAttribute("cx", pt.x); e.head.setAttribute("cy", pt.y);
        e.halo.setAttribute("cx", pt.x); e.halo.setAttribute("cy", pt.y);
        e.halo.setAttribute("r", (10 + 22 * speed) / scale);
        e.g.style.opacity = (0.1 + 0.9 * Math.pow(p, 1.3)).toFixed(3);
        e.glow.style.opacity = (0.3 + 0.45 * speed).toFixed(3);
        for (const b of e.r.branches) {
          if (!e.fired.has(b.id) && s >= b.at) { e.fired.add(b.id); spawn(byId[b.id], { from: 0, dur: 650, pow: 1.3 }); }
        }
        if (p >= 1) {
          live.delete(e); e.g.remove();
          if (e.r.end !== "edge") flash(pt.x, pt.y, e.r.big && e.r.end === "pad");
          if (e.r.big) afterglow(e.r);
        }
      }
      for (const f of flashes) {
        const q = (now - f.t0) / (f.big ? 1200 : 750);
        if (q >= 1) { flashes.delete(f); f.c.remove(); continue; }
        const r0 = f.big ? 24 : 8, grow = f.big ? 50 : 20;
        f.c.setAttribute("r", r0 + grow * Math.sqrt(q));
        f.c.setAttribute("stroke-width", ((f.big ? 4 : 2.5) * (1 - q) + 0.4) / scale);
        f.c.style.opacity = (0.95 * (1 - q)).toFixed(3);
        f.c.style.fillOpacity = (0.5 * (1 - q)).toFixed(3);
      }
      for (const a of glows) {
        const q = (now - a.t0) / 1600;
        if (q >= 1) { glows.delete(a); a.a.remove(); continue; }
        a.a.setAttribute("stroke-width", (3 + 5 * (1 - q)) / scale);
        a.a.style.opacity = (0.75 * (1 - q) * (1 - q)).toFixed(3);
      }
    };

    let running = false, raf = 0, nextAt = 0, stoppedAt = 0, onScreen = true;
    const loop = (now) => {
      if (now >= nextAt) { if (live.size < 4) spawn(pick()); nextAt = now + 700 + Math.random() * 1500; }
      step(now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || !onScreen || document.hidden) return;
      running = true;
      const gap = stoppedAt ? performance.now() - stoppedAt : 0;
      live.forEach((e) => (e.t0 += gap));
      flashes.forEach((f) => (f.t0 += gap));
      glows.forEach((a) => (a.t0 += gap));
      raf = requestAnimationFrame(loop);
    };
    const stop = () => { if (running) { running = false; stoppedAt = performance.now(); cancelAnimationFrame(raf); } };
    fit();
    let resizeTimer = 0;
    window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(fit, 150); });
    new IntersectionObserver((entries) => { onScreen = entries[0].isIntersecting; onScreen ? start() : stop(); }).observe(hero);
    document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
    start();
    spawn(byId["feed-left"]);
  }

  /* ---------- Misc ---------- */
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
})();
