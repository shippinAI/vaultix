const ALLOWED = new Set([
  "glossary", "did-you-know", "knowledge-drop", "configure-step",
  "action-button", "narration", "stamp", "next-hint",
]);

const identity = () =>
  localStorage.getItem("vaultix-identity") || "operator";

async function api(method, path, body) {
  const headers = {
    "Content-Type": "application/json",
    "X-Vaultix-Identity": identity(),
  };
  const pin = sessionStorage.getItem("vaultix-elevated");
  if (pin) headers["X-Vaultix-Elevated"] = pin;
  const res = await fetch(path, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

function refuse(name) {
  const el = document.createElement("p");
  el.className = "refused";
  el.textContent = "Refused: component “" + name + "” is not in the Vaultix A2UI catalog.";
  return el;
}

function renderComponent(c, model) {
  const name = c.component;
  if (!ALLOWED.has(name)) return refuse(name);
  const props = c.properties || {};
  const wrap = document.createElement("section");
  wrap.className = name === "stamp" ? "stamp" : "card";
  if (name === "stamp") {
    wrap.innerHTML = "<strong>" + esc(props.product || "Vaultix") + "</strong><span>" +
      esc(props.owner || "") + " · " + esc(props.presentedAs || "clyffy") +
      (props.step ? " · step " + props.step + "/" + props.of : "") + "</span>";
    return wrap;
  }
  if (name === "narration" || name === "configure-step" || name === "glossary" ||
      name === "did-you-know" || name === "knowledge-drop") {
    const h = document.createElement("h2");
    h.textContent = props.title || (model && model.title) || name;
    const p = document.createElement("p");
    p.textContent = (model && model.body) || props.text || "";
    wrap.append(h, p);
    return wrap;
  }
  if (name === "next-hint") {
    wrap.className = "mute";
    wrap.textContent = "Next: " + (props.nextTitle || "");
    return wrap;
  }
  if (name === "action-button") {
    const b = document.createElement("button");
    b.textContent = props.label || "Do it";
    b.dataset.actionId = props.actionId || "";
    b.addEventListener("click", () => runAction(props.actionId));
    wrap.append(b);
    return wrap;
  }
  return refuse(name);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]
  ));
}

function renderMessages(messages, host) {
  host.innerHTML = "";
  let model = {};
  for (const m of messages || []) {
    if (m.type === "updateDataModel") model = (m.payload && m.payload.dataModel) || {};
  }
  for (const m of messages || []) {
    if (m.type !== "updateComponents") continue;
    const comps = (m.payload && m.payload.components) || [];
    for (const c of comps) host.append(renderComponent(c, model));
  }
}

let stepIndex = 0;

async function showConfigure() {
  const data = await api("GET", "/api/v1/vaultix/configure?index=" + stepIndex);
  const stage = document.getElementById("stage");
  renderMessages(data.messages, stage);
}

async function runAction(actionId) {
  const inputs = collectInputs(actionId);
  const out = await api("POST", "/api/v1/vaultix/source/act", {
    actionId, actor: "operator", inputs,
  });
  const log = document.getElementById("log");
  log.textContent = JSON.stringify(out.result || out, null, 2);
  if (JSON.stringify(out).includes("sk-") || (inputs.value && JSON.stringify(out).includes(inputs.value))) {
    log.textContent = "Refused: a secret value came back. That is a product bug.";
  }
}

function collectInputs(actionId) {
  const inputs = {};
  document.querySelectorAll("[data-input]").forEach((el) => {
    inputs[el.getAttribute("data-input")] = el.value;
  });
  if (actionId === "vaultix.make-box") {
    inputs.name = document.getElementById("app-name")?.value || "";
  }
  return inputs;
}

async function boot() {
  const root = document.getElementById("root");
  const vp = await api("GET", "/api/v1/vaultix/viewport?route=route.configure");
  const answer = await api("POST", "/api/v1/vaultix/runtime/answer", {
    kind: "route-opened", routeId: "route.configure",
  });
  root.innerHTML = "";
  const stamp = document.createElement("div");
  stamp.className = "stamp";
  stamp.innerHTML = "<span>" + esc(vp.stamp?.owner) + " · " + esc(vp.stamp?.host) +
    "</span><span>trusts " + esc(vp.stamp?.trusts) + " · " + esc(vp.stamp?.presentedAs) + "</span>";
  const intro = document.createElement("div");
  intro.id = "catalog";
  renderMessages(answer.messages, intro);
  const stage = document.createElement("div");
  stage.id = "stage";
  const form = document.createElement("div");
  form.className = "card";
  form.innerHTML =
    "<label>Your operator name</label><input id=\"who\" value=\"" + esc(identity()) + "\" />" +
    "<label>App name (the box)</label><input id=\"app-name\" placeholder=\"my-app\" />" +
    "<label>Key name</label><input data-input=\"name\" placeholder=\"API_KEY\" />" +
    "<label>Where it’s used</label><input data-input=\"environment\" placeholder=\"dev\" />" +
    "<label>Which box (after you make it)</label><input data-input=\"projectId\" placeholder=\"box id\" />" +
    "<label>Key value (never shown back)</label><input data-input=\"value\" type=\"password\" />" +
    "<p class=\"mute\">PIN step-up still sits on the API. This page teaches the path, not a second store.</p>";
  const nav = document.createElement("p");
  const prev = document.createElement("button");
  prev.textContent = "Back";
  prev.onclick = () => { stepIndex = Math.max(0, stepIndex - 1); showConfigure(); };
  const next = document.createElement("button");
  next.textContent = "Next";
  next.onclick = () => { stepIndex += 1; showConfigure(); };
  nav.append(prev, " ", next);
  const log = document.createElement("pre");
  log.id = "log";
  log.className = "mute";
  root.append(stamp, intro, form, nav, stage, log);
  document.getElementById("who").addEventListener("change", (e) => {
    localStorage.setItem("vaultix-identity", e.target.value);
  });
  await showConfigure();
}

boot().catch((err) => {
  document.getElementById("root").textContent = String(err);
});
