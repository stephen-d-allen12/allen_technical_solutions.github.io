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

  /* ---------- Home hero: electron tracers ----------
     Electrons start slow and dim, then accelerate and brighten along the baked circuit
     traces (paths come from src/hero_traces.py) and flash the pad they land in. Some run
     the other way, out of a pad to the edge. Speed, size, brightness, tail and timing are
     randomised so the board never settles into a pattern.
     One simulation drives every slideshow panel: each panel's overlay mirrors the same
     electrons, so they keep running through a slide change instead of starting over. */
  const hero = $("[data-hero]");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const NS = "http://www.w3.org/2000/svg";
  const narrow = window.matchMedia("(max-width: 1024px)");
  const HALO = "halo";
  const rnd = (a, b) => a + Math.random() * (b - a);
  const makeTracer = (svgs) => {
    const base = svgs[0];
    const views = svgs.map((svg) => ({ sparks: $(".hero-sparks", svg), halo: `url(#${svg.dataset.halo})` }));
    let shown = [0];
    const routes = $$("[data-route]", base).map((p) => ({
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
    let scale = 1, ready = false;
    const fit = () => {
      const box = base.getBoundingClientRect();
      if (!box.width || !box.height) { ready = false; return; }   // not laid out yet; the resize observer retries
      const vb = narrow.matches ? ["1000 0 1601 942", "xMidYMin meet"] : ["0 0 2601 942", "xMaxYMid slice"];
      svgs.forEach((s) => { s.setAttribute("viewBox", vb[0]); s.setAttribute("preserveAspectRatio", vb[1]); });
      let x0 = 1000, x1 = 2601, y0 = 0, y1 = 942;
      if (narrow.matches) scale = box.width / 1601;
      else {
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
      ready = true;
    };

    // every sprite is one element per panel; only the panels on screen are updated each frame
    const make = (tag, attrs, parents) => views.map((v, k) => {
      const e = document.createElementNS(NS, tag);
      for (const a in attrs) e.setAttribute(a, attrs[a] === HALO ? v.halo : attrs[a]);
      (parents ? parents[k] : v.sparks).appendChild(e);
      return e;
    });
    const set = (els, a, val) => { for (const k of shown) els[k].setAttribute(a, val); };
    const drop = (els) => els.forEach((e) => e.remove());

    const live = new Set(), flashes = new Set(), glows = new Set();
    const spawn = (r, o = {}) => {
      if (!ready || !r || r.s0 === null || r.s0 === undefined || live.size >= 18) return;
      const rev = !!o.rev;                                   // rev: out of the pad, back to the edge
      const s0 = rev ? 0 : o.from ?? r.s0, dist = rev ? r.len - r.s0 : r.len - s0;
      if (dist <= 0) return;
      const size = o.size || rnd(0.8, 1.3);
      const dur = o.dur || Math.min(7000, Math.max(1500, (dist * scale) / (o.speed || rnd(0.13, 0.32))));
      const g = make("g", { opacity: 0 });
      const hidden = { "stroke-dasharray": "0 100000" };
      live.add({
        r, rev, g, s0, dist, dur, size, t0: performance.now() - (o.age || 0) * dur, fired: new Set(),
        pow: o.pow || rnd(1.8, 3.2), peak: o.peak || rnd(0.6, 1), tailK: rnd(0.6, 1.5),
        glow: make("path", { class: "spark-glow", d: r.d, "stroke-width": 8 * size / scale, ...hidden }, g),
        core: make("path", { class: "spark-core", d: r.d, "stroke-width": 2.2 * size / scale, ...hidden }, g),
        halo: make("circle", { fill: HALO, r: 0 }, g),
        head: make("circle", { class: "spark-head", r: 2.6 * size / scale }, g),
      });
    };
    const flash = (x, y, big) => flashes.add({ c: make("circle", { class: "pad-flash", cx: x, cy: y, fill: HALO, r: 0 }), big, t0: performance.now() });
    // after a main feed lands, the A's leg it just climbed keeps glowing and fades out
    const afterglow = (r) => {
      const L = Math.min(340, r.len);
      glows.add({ a: make("path", { class: "afterglow", d: r.d, "stroke-dasharray": `${L} ${r.len}`, "stroke-dashoffset": String(L - r.len) }), t0: performance.now() });
    };
    const pick = () => {
      const pool = routes.filter((r) => r.w > 0 && r.s0 !== null);
      let x = Math.random() * pool.reduce((a, r) => a + r.w, 0);
      for (const r of pool) if ((x -= r.w) <= 0) return r;
      return pool[pool.length - 1];
    };
    // a route takes another electron once the last one on it is well on its way
    const busy = (r, rev, now) => {
      for (const e of live) if (e.r === r && e.rev === rev && (now - e.t0) / e.dur < 0.35) return true;
      return false;
    };
    const ambient = (o = {}) => {
      const now = performance.now();
      for (let tries = 0; tries < 6; tries++) {
        const r = pick();
        if (!r) return;
        const rev = !r.big && Math.random() < 0.3;
        if (!busy(r, rev, now)) return spawn(r, { rev, ...o });
      }
    };

    const step = (now) => {
      for (const e of live) {
        const p = Math.min(1, Math.max(0, (now - e.t0) / e.dur));
        const t = e.s0 + e.dist * Math.pow(p, e.pow);
        const s = e.rev ? e.r.len - t : t;
        const speed = Math.pow(p, e.pow - 1);                 // 0 at launch, 1 at arrival
        const tail = (8 + 120 * speed) * e.tailK / scale;
        const dash = `${tail} ${e.r.len + tail}`, off = String(e.rev ? -s : tail - s);
        set(e.glow, "stroke-dasharray", dash); set(e.glow, "stroke-dashoffset", off);
        set(e.core, "stroke-dasharray", dash); set(e.core, "stroke-dashoffset", off);
        const pt = e.r.el.getPointAtLength(s);
        set(e.head, "cx", pt.x); set(e.head, "cy", pt.y);
        set(e.halo, "cx", pt.x); set(e.halo, "cy", pt.y);
        set(e.halo, "r", (10 + 22 * speed) * e.size / scale);
        let op = (0.18 + 0.82 * Math.pow(p, 1.3)) * e.peak;
        if (e.rev || e.r.end === "edge") op *= Math.min(1, (1 - p) / 0.15);   // fade out at the edge
        set(e.g, "opacity", op.toFixed(3));
        set(e.glow, "opacity", (0.3 + 0.45 * speed).toFixed(3));
        if (!e.rev) for (const b of e.r.branches) {
          if (!e.fired.has(b.id) && t >= b.at) { e.fired.add(b.id); spawn(byId[b.id], { from: 0, dur: 650, pow: 1.3, size: e.size, peak: e.peak }); }
        }
        if (p >= 1) {
          live.delete(e); drop(e.g);
          if (!e.rev && e.r.end !== "edge") flash(pt.x, pt.y, e.r.big && e.r.end === "pad");
          if (e.r.big && !e.rev) afterglow(e.r);
        }
      }
      for (const f of flashes) {
        const q = Math.max(0, (now - f.t0) / (f.big ? 1200 : 750));   // rAF time can trail a flash spawned this frame
        if (q >= 1) { flashes.delete(f); drop(f.c); continue; }
        set(f.c, "r", (f.big ? 24 : 8) + (f.big ? 50 : 20) * Math.sqrt(q));
        set(f.c, "stroke-width", ((f.big ? 4 : 2.5) * (1 - q) + 0.4) / scale);
        set(f.c, "opacity", (0.95 * (1 - q)).toFixed(3));
        set(f.c, "fill-opacity", (0.5 * (1 - q)).toFixed(3));
      }
      for (const a of glows) {
        const q = Math.max(0, (now - a.t0) / 1600);
        if (q >= 1) { glows.delete(a); drop(a.a); continue; }
        set(a.a, "stroke-width", (3 + 5 * (1 - q)) / scale);
        set(a.a, "opacity", (0.75 * (1 - q) * (1 - q)).toFixed(3));
      }
    };

    // the crowd swells and thins: a random cap on how many run at once, random gaps, the odd burst
    let running = false, raf = 0, nextAt = 0, stoppedAt = 0, cap = 8, warmed = false;
    const loop = (now) => {
      if (!ready) fit();
      if (ready && !warmed) { warmed = true; for (let i = 0; i < 6; i++) ambient({ age: rnd(0.05, 0.8) }); }
      if (ready && now >= nextAt) {
        if (live.size < cap) {
          ambient();
          if (Math.random() < 0.3) ambient();
          if (Math.random() < 0.1) { ambient(); ambient(); }
        }
        if (Math.random() < 0.12) cap = Math.round(rnd(6, 12));
        nextAt = now + rnd(100, 900);
      }
      step(now);
      raf = requestAnimationFrame(loop);
    };
    fit();
    return {
      fit,
      start() {
        if (running) return;
        running = true;
        const gap = stoppedAt ? performance.now() - stoppedAt : 0;
        live.forEach((e) => (e.t0 += gap));
        flashes.forEach((f) => (f.t0 += gap));
        glows.forEach((a) => (a.t0 += gap));
        raf = requestAnimationFrame(loop);
      },
      stop() { if (running) { running = false; stoppedAt = performance.now(); cancelAnimationFrame(raf); } },
      // which panels are on screen (the current one, plus the incoming one during a slide)
      show(list) { shown = list; if (running && ready) step(performance.now()); },
      // the main feed that greets a panel as it slides in (left leg on odd slides, right on even), plus a small burst
      surge(i) {
        spawn(byId[i % 2 ? "feed-right" : "feed-left"], { speed: 0.22, peak: 1, size: 1.15 });
        ambient(); ambient();
      },
    };
  };

  /* ---------- Home hero: slideshow ----------
     Full-width panels: the current one slides out to the left while the next slides in
     from the right (the reverse when going back). Arrows, dots and stats stay put. */
  if (hero) {
    const SLIDE_MS = 8000, MOVE_MS = 900;
    hero.style.setProperty("--slide-ms", SLIDE_MS + "ms");
    const panels = $$(".hero-panel", hero), dots = $$(".hero-dots button", hero), n = panels.length;
    const svgs = panels.map((p) => $(".hero-traces", p)).filter(Boolean);
    const tracer = !reduceMotion && svgs.length === n ? makeTracer(svgs) : null;
    let onScreen = true;
    const syncTracer = () => { if (tracer) (onScreen && !document.hidden ? tracer.start() : tracer.stop()); };

    let current = 0, moving = false, timer = 0, startedAt = 0, remaining = SLIDE_MS, paused = false;
    const arm = (ms) => {
      clearTimeout(timer);
      if (reduceMotion || paused) return;
      startedAt = performance.now();
      remaining = ms;
      timer = setTimeout(() => go(current + 1, 1), ms);
    };
    const setDots = () => dots.forEach((d, k) => {
      d.classList.remove("is-active");
      d.removeAttribute("aria-current");
      if (k === current) { void d.offsetWidth; d.classList.add("is-active"); d.setAttribute("aria-current", "true"); }
    });
    panels.forEach((p, k) => { if (k !== current) { p.setAttribute("aria-hidden", "true"); p.inert = true; } });

    function go(i, dir) {
      const to = (i + n) % n;
      if (moving || to === current) return;
      const from = current, out = panels[from], next = panels[to];
      dir = dir || (to > from ? 1 : -1);
      moving = true;
      current = to;
      // park the incoming panel just off-screen on the side it enters from, then slide both
      next.classList.remove("is-moving");
      next.style.transform = `translateX(${dir * 100}%)`;
      next.classList.add("is-visible");
      void next.offsetWidth;
      out.classList.add("is-moving");
      next.classList.add("is-moving");
      out.style.transform = `translateX(${-dir * 100}%)`;
      next.style.transform = "translateX(0)";
      next.removeAttribute("aria-hidden"); next.inert = false;
      out.setAttribute("aria-hidden", "true"); out.inert = true;
      if (tracer) { tracer.show([from, to]); tracer.surge(to); }
      setDots();
      arm(SLIDE_MS);
      setTimeout(() => {
        out.classList.remove("is-active", "is-visible", "is-moving");
        out.style.transform = "";
        next.classList.add("is-active");
        next.classList.remove("is-visible", "is-moving");
        next.style.transform = "";
        if (tracer) tracer.show([to]);
        moving = false;
      }, reduceMotion ? 0 : MOVE_MS + 40);
    }
    const pause = (on) => {
      if (on === paused) return;
      paused = on;
      hero.classList.toggle("hero-paused", on);
      if (on) { clearTimeout(timer); remaining -= performance.now() - startedAt; }
      else arm(Math.max(400, remaining));
    };
    dots.forEach((d, k) => d.addEventListener("click", () => go(k)));
    $("[data-slide-prev]", hero).addEventListener("click", () => go(current - 1, -1));
    $("[data-slide-next]", hero).addEventListener("click", () => go(current + 1, 1));
    $$(".hero-copy, .hero-controls", hero).forEach((el) => {
      el.addEventListener("mouseenter", () => pause(true));
      el.addEventListener("mouseleave", () => pause(false));
    });
    hero.addEventListener("focusin", () => pause(true));
    hero.addEventListener("focusout", (e) => { if (!hero.contains(e.relatedTarget)) pause(false); });
    let touchX = null;
    hero.addEventListener("touchstart", (e) => { touchX = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener("touchend", (e) => {
      if (touchX === null) return;
      const dx = e.changedTouches[0].clientX - touchX;
      if (Math.abs(dx) > 50) go(current + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      touchX = null;
    });

    // the copy keeps clear of the pinned arrows and stats, whatever height they wrap to
    const ui = $(".hero-ui", hero);
    const setUi = () => hero.style.setProperty("--ui-h", ui.offsetHeight + "px");
    setUi();
    if ("ResizeObserver" in window) new ResizeObserver(setUi).observe(ui);
    else window.addEventListener("resize", setUi);

    if (tracer) {
      let resizeTimer = 0;
      const refit = () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(tracer.fit, 150);
      };
      if ("ResizeObserver" in window) new ResizeObserver(refit).observe(panels[0]);
      else window.addEventListener("resize", refit);
      new IntersectionObserver((entries) => { onScreen = entries[0].isIntersecting; syncTracer(); }).observe(hero);
      document.addEventListener("visibilitychange", syncTracer);
      syncTracer();
      tracer.surge(0);
    }
    setDots();
    arm(SLIDE_MS);
  }

  /* ---------- Misc ---------- */
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
})();
