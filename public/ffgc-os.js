/* FFGC OS — APPLICATION SHELL */
(() => {
  "use strict";

  if (document.getElementById("ffgcOSDock")) return;

  const apps = [
    { id: "home", icon: "⌂", name: "Home" },
    { id: "leaderboard", icon: "🏆", name: "Rankings" },
    { id: "tasks", icon: "⚡", name: "Challenges" },
    { id: "polls", icon: "🗳️", name: "Voting Arena" },
    { id: "auctionHouse", icon: "🔨", name: "Auction House" },
    { id: "economy", icon: "📈", name: "Economic Empire" },
    { id: "announcements", icon: "🔔", name: "Updates" },
    { id: "profile", icon: "👤", name: "My Profile" },
    { id: "admin", icon: "👑", name: "God Admin" }
  ];

  const dock = document.createElement("nav");
  dock.id = "ffgcOSDock";
  dock.setAttribute("aria-label", "FFGC quick navigation");

  dock.innerHTML = `
    <button type="button" data-os-action="launcher">
      <span>▦</span>Apps
    </button>
    <button type="button" data-os-action="home">
      <span>⌂</span>Home
    </button>
    <button type="button" data-os-action="search">
      <span>⌕</span>Search
    </button>
    <button type="button" data-os-action="updates">
      <span>♧</span>Updates
    </button>
  `;

  const launcher = document.createElement("div");
  launcher.id = "ffgcOSLauncher";
  launcher.setAttribute("role", "dialog");
  launcher.setAttribute("aria-label", "FFGC application launcher");

  launcher.innerHTML = `
    <div class="ffgcOSHead">
      <div>
        <div class="ffgcOSBrand">FFGC2K26 / OPERATING SYSTEM</div>
        <div class="ffgcOSDate" id="ffgcOSDate">THE OFFICIAL ARENA</div>
      </div>
      <button class="ffgcOSClose" type="button"
        data-os-action="close" aria-label="Close launcher">×</button>
    </div>

    <div class="ffgcOSWelcome">
      <small>WELCOME TO YOUR ARENA</small>
      <h2>Everything.<br>In one place.</h2>
      <p>Your FFGC2K26 mobile command center.</p>
    </div>

    <label class="ffgcOSSearch">
      <span>⌕</span>
      <input id="ffgcOSSearchInput" type="search"
        placeholder="Search apps and sections..."
        autocomplete="off">
    </label>

    <div class="ffgcOSLabel">YOUR APPLICATIONS</div>
    <div class="ffgcOSGrid" id="ffgcOSGrid"></div>

    <div class="ffgcOSWidget">
      <h3>✦ Arena Status</h3>
      <p id="ffgcOSStatus">Connected to the FFGC2K26 Arena interface.</p>
    </div>

    <div class="ffgcOSWidget">
      <h3>🔔 Latest Announcements</h3>
      <div id="ffgcOSNotices">
        <p>Open Updates to view official announcements.</p>
      </div>
    </div>

    <div class="ffgcOSWidget">
      <h3>FFGC2K26</h3>
      <p>One arena. One community. A legacy in progress.</p>
    </div>
  `;

  const toast = document.createElement("div");
  toast.id = "ffgcOSToast";
  toast.setAttribute("role", "status");

  document.body.append(dock, launcher, toast);

  const grid = launcher.querySelector("#ffgcOSGrid");
  const searchInput = launcher.querySelector("#ffgcOSSearchInput");

  function renderApps(filter = "") {
    const term = filter.trim().toLowerCase();

    grid.replaceChildren();

    apps
      .filter(app =>
        `${app.name} ${app.id}`.toLowerCase().includes(term)
      )
      .forEach(app => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ffgcOSApp";
        button.dataset.osApp = app.id;

        const icon = document.createElement("span");
        icon.className = "appIcon";
        icon.textContent = app.icon;

        const name = document.createElement("span");
        name.className = "appName";
        name.textContent = app.name;

        button.append(icon, name);
        grid.append(button);
      });

    if (!grid.children.length) {
      const empty = document.createElement("p");
      empty.textContent = "No matching application found.";
      empty.style.color = "#91a5b9";
      grid.append(empty);
    }
  }

  function showToast(message) {
    toast.textContent = message;
    toast.style.display = "block";

    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      toast.style.display = "none";
    }, 2300);
  }

  function openLauncher() {
    renderApps(searchInput.value);
    launcher.classList.add("open");
    launcher.scrollTop = 0;
  }

  function closeLauncher() {
    launcher.classList.remove("open");
  }

  function goToSection(id) {
    const target = document.getElementById(id);

    if (!target) {
      showToast("This section is not available on this page.");
      return;
    }

    target.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    closeLauncher();
  }

  function openApp(id) {
    if (id === "home") {
      closeLauncher();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (id === "economy") {
      closeLauncher();
      document.getElementById("openEconomicEmpire")?.click();
      return;
    }

    if (id === "profile") {
      closeLauncher();
      const profileButton =
        document.querySelector('[data-v5-route="profile"]');

      if (profileButton) {
        profileButton.click();
      } else {
        showToast("Profile is not available right now.");
      }
      return;
    }

    if (id === "admin") {
      closeLauncher();
      document.getElementById("adminBtn")?.click();
      return;
    }

    goToSection(id);
  }

  function renderAnnouncements() {
    const destination = launcher.querySelector("#ffgcOSNotices");
    const source = document.getElementById("newsCards");

    destination.replaceChildren();

    if (!source || !source.children.length) {
      const empty = document.createElement("p");
      empty.textContent = "No announcements are currently displayed.";
      destination.append(empty);
      return;
    }

    [...source.children].slice(0, 4).forEach(item => {
      const notice = document.createElement("div");
      notice.className = "ffgcOSNotice";
      notice.textContent = (item.innerText || item.textContent || "")
        .trim()
        .slice(0, 240);

      if (notice.textContent) destination.append(notice);
    });

    if (!destination.children.length) {
      const empty = document.createElement("p");
      empty.textContent = "No announcements are currently displayed.";
      destination.append(empty);
    }
  }

  function searchPage(value) {
    const term = value.trim().toLowerCase();

    if (!term) {
      showToast("Type something to search.");
      return;
    }

    const sections = [
      "leaderboard",
      "teams",
      "tasks",
      "polls",
      "announcements",
      "auctionHouse",
      "eliminationArena",
      "decisionChamber"
    ];

    const match = sections
      .map(id => document.getElementById(id))
      .find(section =>
        section &&
        section.innerText.toLowerCase().includes(term)
      );

    if (match) {
      closeLauncher();
      match.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast("Matching section found.");
    } else {
      showToast("No matching section found.");
    }
  }

  function updateDate() {
    const date = new Date();

    launcher.querySelector("#ffgcOSDate").textContent =
      date.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
      });
  }

  dock.addEventListener("click", event => {
    const button = event.target.closest("[data-os-action]");
    if (!button) return;

    const action = button.dataset.osAction;

    if (action === "launcher") openLauncher();
    if (action === "home") openApp("home");

    if (action === "search") {
      openLauncher();
      searchInput.focus();
    }

    if (action === "updates") {
      renderAnnouncements();
      openLauncher();
      launcher.querySelector("#ffgcOSNotices")
        .scrollIntoView({ behavior: "smooth", block: "center" });
    }
  });

  launcher.addEventListener("click", event => {
    const appButton = event.target.closest("[data-os-app]");

    if (appButton) {
      openApp(appButton.dataset.osApp);
      return;
    }

    if (event.target.closest('[data-os-action="close"]')) {
      closeLauncher();
    }
  });

  searchInput.addEventListener("input", () => {
    renderApps(searchInput.value);
  });

  searchInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      searchPage(searchInput.value);
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") closeLauncher();
  });

  updateDate();
  renderApps();

  window.addEventListener("load", () => {
    renderAnnouncements();
    launcher.querySelector("#ffgcOSStatus").textContent =
      "Arena interface loaded. Your existing sections are connected.";
  });
})();
