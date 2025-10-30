// ... keep the rest of your file unchanged

function applyTicketBadge($, status, table) {
  const map = {
    pending: { text: "Rezultat în așteptare", cls: "btn-warning" },
    win:     { text: "Bilet câștigător",     cls: "btn-success" },
    loss:    { text: "Bilet pierdut",         cls: "btn-danger"  },
  };
  const cfg = map[status] || map.pending;

  let changed = false;

  // 1) Update the “main” button near the table if it exists
  let $btn =
    $('a.btn:contains("Rezultat"), button.btn:contains("Rezultat"), .ticket-result, .ticket-status, .status-bilet, .status_bilet')
      .first();

  if ($btn.length) {
    const oldText = ($btn.text() || "").trim();
    const oldClasses = $btn.attr("class") || "";

    if (oldText !== cfg.text) changed = true;

    // normalize state classes
    const newClasses = oldClasses
      .replace(/\bbtn-warning\b|\bbtn-success\b|\bbtn-danger\b/g, "")
      .trim();
    if (!newClasses.split(/\s+/).includes(cfg.cls)) changed = true;

    $btn.removeClass("btn-warning btn-success btn-danger");
    $btn.addClass(cfg.cls);
    $btn.text(cfg.text);
    // also mirror status on element for future reads
    $btn.attr("data-ticket-status", status);
  }

  // 2) Update ANY other shortcode-rendered status badges/buttons on the page
  const candidates = $(
    '.status-bilet, .status_bilet, .ticket-result, .ticket-status, ' +
    'a.btn:contains("Rezultat în așteptare"), a.btn:contains("Bilet câștigător"), a.btn:contains("Bilet pierdut"), ' +
    'button.btn:contains("Rezultat în așteptare"), button.btn:contains("Bilet câștigător"), button.btn:contains("Bilet pierdut")'
  ).toArray();

  for (const el of candidates) {
    const $el = $(el);
    const oldText = ($el.text() || "").trim();
    const oldClasses = $el.attr("class") || "";

    if (oldText !== cfg.text) changed = true;

    const newClasses = oldClasses
      .replace(/\bbtn-warning\b|\bbtn-success\b|\bbtn-danger\b/g, "")
      .trim();
    if (!newClasses.split(/\s+/).includes(cfg.cls)) changed = true;

    $el.removeClass("btn-warning btn-success btn-danger");
    $el.addClass(cfg.cls);
    $el.text(cfg.text);
    $el.attr("data-ticket-status", status);
  }

  // 3) Mark table & total row (so status next to total odd stays in sync)
  const oldAttr = table.attr("data-ticket-status") || "pending";
  if (oldAttr !== status) changed = true;
  table.attr("data-ticket-status", status);
  table.find("tr.total").attr("data-status", status);

  return changed;
}

// ... keep the rest of your file unchanged
