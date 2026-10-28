// Read-only planning UI. No credentials, runtime configuration or product actions.
const $ = (id) => document.getElementById(id);
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
let activeGroup = "";
try {
  const response = await fetch("/catalog.json");
  if (!response.ok) throw new Error("Catalog unavailable");
  const data = await response.json();
  const groupById = new Map(data.groups.map((group) => [group.id, group]));
  for (const [key, label] of [
    ["capabilityRequirements", "Requirements"],
    ["uiRoutes", "UI routes mapped"],
    ["apiOperations", "API operations mapped"],
    ["sourceFiles", "Source files mapped"],
    ["providerEntries", "Adapter paths discovered"],
  ]) {
    const stat = element("div", undefined, "stat");
    stat.append(element("strong", data.coverage[key].toLocaleString()), element("span", label));
    $("stats").append(stat);
  }
  for (const phase of data.phases)
    $("phase").append(new Option(`${phase.id} · ${phase.title}`, phase.id));
  for (const state of [...new Set(data.capabilities.map((item) => item.implementation))].sort())
    $("state").append(new Option(state, state));
  const groupButtons = new Map();
  function groupButton(id, label, count) {
    const button = element("button");
    button.type = "button";
    button.append(element("span", label), element("span", count));
    button.setAttribute("aria-pressed", String(id === activeGroup));
    button.addEventListener("click", () => {
      activeGroup = id;
      render();
    });
    groupButtons.set(id, button);
    $("groups").append(button);
  }
  groupButton("", "All capabilities", data.capabilities.length);
  for (const navigation of [...new Set(data.groups.map((group) => group.navigation))]) {
    $("groups").append(element("div", navigation, "nav-label"));
    data.groups
      .filter((group) => group.navigation === navigation)
      .forEach((group) =>
        groupButton(group.id, group.title, data.domainCounts[group.id].capabilities),
      );
  }
  function detail(item) {
    $("detail-id").textContent = `${item.id} / ${groupById.get(item.group).title} / ${item.phase}`;
    $("detail-title").textContent = item.title;
    $("detail-state").textContent = item.implementation;
    $("detail-outcome").textContent = item.outcome;
    $("detail-fields").replaceChildren();
    for (const [label, value] of [
      ["Acceptance still required", item.acceptance],
      ["Whole-requirement evidence", item.evidence],
      ["Target architecture", item.target],
      ["AI boundary", item.ai],
      ["Offering proposal", item.offering],
    ]) {
      $("detail-fields").append(element("dt", label), element("dd", value));
    }
    $("detail-references").replaceChildren();
    if (!item.references.length)
      $("detail-references").append(
        element("li", "No scoped evidence reference recorded for this requirement."),
      );
    for (const path of item.references) {
      const li = element("li"),
        link = element("a", path);
      link.href = `/reference?path=${encodeURIComponent(path)}`;
      li.append(link);
      $("detail-references").append(li);
    }
    $("detail").showModal();
  }
  function render() {
    const query = $("search").value.trim().toLowerCase(),
      phase = $("phase").value,
      state = $("state").value;
    const items = data.capabilities.filter(
      (item) =>
        (!activeGroup || item.group === activeGroup) &&
        (!phase || item.phase === phase) &&
        (!state || item.implementation === state) &&
        [item.id, item.title, item.outcome, item.acceptance, groupById.get(item.group).title]
          .join(" ")
          .toLowerCase()
          .includes(query),
    );
    for (const [id, button] of groupButtons)
      button.setAttribute("aria-pressed", String(activeGroup === id));
    const group = groupById.get(activeGroup);
    $("results-title").textContent = group?.title ?? "All capabilities";
    $("group-purpose").textContent = group
      ? `${group.purpose}. Discovery: ${data.domainCounts[activeGroup].ui} UI routes · ${data.domainCounts[activeGroup].api} API operations · ${data.domainCounts[activeGroup].sourceFiles} source files.`
      : "Select a group to explore its intended outcomes.";
    $("result-count").textContent = `${items.length} of ${data.capabilities.length} requirements`;
    $("empty").hidden = items.length > 0;
    const cards = items.map((item) => {
      const card = element("article", undefined, "card"),
        meta = element("div", undefined, "meta");
      meta.append(
        element("span", `${item.id} · ${groupById.get(item.group).title}`),
        element("span", item.phase),
      );
      const button = element("button", "Review acceptance →");
      button.type = "button";
      button.setAttribute("aria-label", `Review acceptance: ${item.title}`);
      button.addEventListener("click", () => detail(item));
      card.append(
        meta,
        element("h3", item.title),
        element("p", item.outcome),
        element("span", item.implementation, "pill"),
        button,
      );
      return card;
    });
    $("cards").replaceChildren(...cards);
  }
  for (const id of ["search", "phase", "state"])
    $(id).addEventListener(id === "search" ? "input" : "change", render);
  $("reset").addEventListener("click", () => {
    activeGroup = "";
    for (const id of ["search", "phase", "state"]) $(id).value = "";
    render();
    $("search").focus();
  });
  $("close-detail").addEventListener("click", () => $("detail").close());
  for (const [name, view] of [
    ["capabilities", "capability-view"],
    ["roadmap", "roadmap-view"],
    ["providers", "provider-view"],
  ]) {
    $("show-" + name).addEventListener("click", () => {
      for (const other of ["capabilities", "roadmap", "providers"])
        $("show-" + other).setAttribute("aria-pressed", String(other === name));
      for (const other of ["capability-view", "roadmap-view", "provider-view"])
        $(other).hidden = other !== view;
    });
  }
  for (const phase of data.phases) {
    const stage = element("article", undefined, "stage");
    stage.append(
      element("span", phase.id, "eyebrow"),
      element("h3", phase.title),
      element("p", phase.exit),
      element(
        "small",
        phase.dependsOn.length ? `Requires ${phase.dependsOn.join(" + ")}` : "Foundation gate",
      ),
    );
    $("phases").append(stage);
  }
  function renderProviders() {
    const query = $("provider-search").value.trim().toLowerCase();
    const matches = data.providers.filter((item) =>
      `${item.name} ${item.family}`.toLowerCase().includes(query),
    );
    $("provider-count").textContent =
      `${matches.length} of ${data.providers.length} adapter paths · acceptance pending`;
    $("providers").replaceChildren(
      ...matches.map((item) => {
        const node = element("article", undefined, "provider");
        node.append(
          element("small", item.family),
          element("strong", item.name),
          element("p", item.path),
        );
        return node;
      }),
    );
  }
  $("provider-search").addEventListener("input", renderProviders);
  render();
  renderProviders();
} catch (error) {
  $("load-error").hidden = false;
  for (const node of document.querySelectorAll("button,input,select")) node.disabled = true;
  console.error("Capability explorer could not initialize", error);
}
