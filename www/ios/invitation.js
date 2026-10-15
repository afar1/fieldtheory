/* Keep the working email invitation path until an approved TestFlight link exists. */
(() => {
  "use strict";
  const isTestFlightLink = value => typeof value === "string"
    && /^https:\/\/testflight\.apple\.com\/join\/[A-Za-z0-9]+$/.test(value);

  fetch("/ios/invitation.json", { cache: "no-store", credentials: "omit" })
    .then(response => response.ok ? response.json() : null)
    .then(config => {
      if (config?.acceptingTesters !== true || !isTestFlightLink(config.publicLink)) return;
      const join = document.getElementById("beta-join");
      join.href = config.publicLink;
      join.textContent = "Join on TestFlight";
      document.getElementById("beta-status").textContent = "The Field Theory beta is open.";
      document.getElementById("beta-note").textContent =
        "Open this link on your iPhone or iPad. Apple handles enrollment; no email form is needed here. Places may be limited.";
    })
    .catch(() => { /* Leave the honest, usable email fallback visible. */ });
})();
