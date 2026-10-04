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

  /* ---------- Shop filters ---------- */
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

  /* ---------- Misc ---------- */
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
})();
