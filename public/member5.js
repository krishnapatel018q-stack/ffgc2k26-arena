(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const escapeHTML = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));

  const routes = [
    ["home", "⌂", "Home", []],
    ["ranks", "♛", "Rankings", ["leaderboard", "teams"]],
    ["events", "⚔", "Events", [
      "tasks",
      "polls",
      "eliminationArena",
      "decisionChamber"
    ]],
    ["auction", "◆", "Auction", ["auctionHouse"]],
    ["spotlight", "✦", "Hall", ["spotlightSection"]],
    ["news", "▤", "News", ["announcements"]],
    ["profile", "◉", "Profile", ["myProfile", "supportMember"]]
  ];

  let member = null;
  let currentRoute = "home";
  let syncing = false;

  function create(tag, className = "", html = "") {
    const element = document.createElement(tag);
    element.className = className;
    element.innerHTML = html;
    return element;
  }

  function installStyles() {
    if ($("royale6DynamicStyles")) return;

    const style = document.createElement("style");
    style.id = "royale6DynamicStyles";

    style.textContent = `
      body.v5-body {
        background: #060917 !important;
        color: #f4f6ff;
      }

      .v5-shell {
        display: grid;
        grid-template-columns: 250px minmax(0, 1fr);
        min-height: 100vh;
      }

      .v5-sidebar {
        background:
          linear-gradient(180deg, #141c39, #080d1d) !important;
        border-right: 1px solid #7064b755;
        padding: 28px 16px;
        position: sticky;
        top: 0;
        height: 100vh;
        overflow-y: auto;
        z-index: 50;
      }

      .v5-brand {
        font-size: 24px;
        font-weight: 950;
        color: white;
        padding: 12px 8px;
      }

      .v5-brand span {
        color: #78f7e9;
      }

      .v5-brand small {
        display: block;
        margin-top: 8px;
        font-size: 10px;
        color: #9badd3;
        letter-spacing: 2px;
      }

      .v5-side-label {
        font-size: 10px;
        letter-spacing: 2px;
        color: #9badd3;
        margin: 30px 8px 14px;
      }

      .v5-side-nav {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .v5-nav-btn {
        display: flex;
        align-items: center;
        gap: 15px;
        width: 100%;
        padding: 16px;
        background: transparent;
        color: #bac8e4;
        border: 1px solid transparent;
        border-radius: 14px;
        text-align: left;
        cursor: pointer;
        transition: .25s;
      }

      .v5-nav-btn span {
        font-size: 22px;
        width: 28px;
        text-align: center;
      }

      .v5-nav-btn b {
        font-size: 14px;
      }

      .v5-nav-btn:hover {
        background: #26355b;
        color: white;
        transform: translateX(4px);
      }

      .v5-nav-btn.active {
        background: linear-gradient(110deg, #7555d7, #293b70);
        color: white;
        border-color: #a58aff;
        box-shadow: 0 8px 30px #7758dd44;
      }

      .v5-work {
        min-width: 0;
        padding: 0 32px 80px;
      }

      .v5-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        min-height: 85px;
        border-bottom: 1px solid #ffffff19;
        margin-bottom: 25px;
      }

      .v5-top small {
        display: block;
        color: #83f5e7;
        font-size: 10px;
        letter-spacing: 2px;
      }

      .v5-top strong {
        display: block;
        margin-top: 7px;
        font-size: 25px;
      }

      .v5-live {
        padding: 11px 15px;
        background: #10382e;
        color: #8bffcf;
        border: 1px solid #397d67;
        border-radius: 30px;
        font-size: 11px;
        font-weight: 800;
      }

      .v5-live i {
        display: inline-block;
        width: 8px;
        height: 8px;
        margin-right: 6px;
        border-radius: 50%;
        background: #5effb2;
        box-shadow: 0 0 14px #5effb2;
        animation: royalePulse 1.5s infinite;
      }

      .v5-area {
        min-width: 0;
      }

      .v5-hero {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: space-between;
        min-height: 430px;
        padding: 45px;
        overflow: hidden;
        border-radius: 30px;
        border: 1px solid #9380df;
        background:
          radial-gradient(circle at 80% 40%, #8855d999, transparent 43%),
          linear-gradient(120deg, #1d2850, #11162d 70%, #271a43);
        box-shadow: 0 20px 70px #0008;
      }

      .v5-hero::before {
        content: "";
        position: absolute;
        width: 360px;
        height: 360px;
        right: -90px;
        top: 25px;
        border: 2px dashed #c9b9ff66;
        border-radius: 50%;
        animation: royaleRotate 30s linear infinite;
      }

      .v5-hero-text {
        position: relative;
        z-index: 2;
        max-width: 650px;
      }

      .v5-kicker {
        display: inline-block;
        padding: 10px 14px;
        background: #6953b344;
        border: 1px solid #a18ee477;
        border-radius: 30px;
        color: #a4fff0;
        font-size: 10px;
        font-weight: 900;
        letter-spacing: 1px;
      }

      .v5-hero h1 {
        margin: 25px 0;
        font-size: clamp(45px, 6vw, 95px);
        line-height: 1.03;
        font-weight: 950;
        letter-spacing: -3px;
        color: white;
      }

      .v5-hero h1 em {
        font-style: normal;
        background: linear-gradient(90deg, #7cfff0, #bda5ff);
        -webkit-background-clip: text;
        background-clip: text;
        color: transparent;
      }

      .v5-hero p {
        color: #c1cbe4;
        font-size: 14px;
        letter-spacing: 1px;
      }

      .v5-hero-actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 30px;
      }

      .v5-hero-actions button {
        padding: 15px 20px;
        border-radius: 12px;
        border: 1px solid #7ef6e9;
        background: linear-gradient(90deg, #70f6e9, #a69cff);
        color: #10152d;
        font-weight: 900;
        cursor: pointer;
      }

      .v5-hero-actions button + button {
        background: #ffffff12;
        color: white;
        border-color: #ffffff55;
      }

      .v5-crest {
        position: relative;
        z-index: 1;
        width: 240px;
        height: 240px;
        flex-shrink: 0;
        border: 2px solid #f1d18d;
        border-radius: 50%;
        display: grid;
        place-items: center;
        box-shadow:
          0 0 70px #f0ce8d44,
          inset 0 0 50px #b69aff44;
        animation: royaleFloat 6s ease-in-out infinite;
      }

      .v5-crest-inner {
        width: 80%;
        height: 80%;
        border: 1px solid #e4c88b;
        border-radius: 50%;
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        color: #ffe0a4;
        font-size: 28px;
        text-align: center;
      }

      .v5-crest-inner strong {
        font-size: 35px;
        line-height: 1;
        margin: 8px 0;
      }

      .v5-crest-inner small {
        font-size: 8px;
        letter-spacing: 1px;
      }

      .v5-player {
        display: flex;
        align-items: center;
        gap: 20px;
        flex-wrap: wrap;
        padding: 24px;
        margin: 25px 0;
        background: linear-gradient(110deg, #302652, #182944);
        border: 1px solid #9b86eb;
        border-radius: 22px;
      }

      .v5-player[hidden] {
        display: none !important;
      }

      .v5-avatar {
        width: 65px;
        height: 65px;
        display: grid;
        place-items: center;
        background: #7658c8;
        border: 3px solid #f4d28e;
        border-radius: 50%;
        font-size: 28px;
        font-weight: 900;
      }

      .v5-player-info {
        flex: 1;
        min-width: 150px;
      }

      .v5-player-info small,
      .v5-player-stat small {
        display: block;
        color: #90f7e9;
        font-size: 10px;
        letter-spacing: 1px;
      }

      .v5-player-info h2 {
        margin: 7px 0;
        font-size: 26px;
      }

      .v5-player-info span {
        font-size: 11px;
        color: #a9b8d4;
      }

      .v5-player-stat strong {
        display: block;
        font-size: 25px;
        margin-top: 5px;
        color: #ffdc99;
      }

      .v5-player button,
      .v5-login-note button {
        padding: 13px 17px;
        border-radius: 10px;
        border: none;
        background: #83f6e9;
        color: #10192c;
        font-weight: 900;
        cursor: pointer;
      }

      .v5-login-note {
        display: flex;
        align-items: center;
        gap: 20px;
        margin: 25px 0;
        padding: 24px;
        background: #17243f;
        border: 1px solid #506d96;
        border-radius: 20px;
      }

      .v5-login-note[hidden] {
        display: none !important;
      }

      .v5-login-note > span {
        font-size: 35px;
        color: #8ff8ed;
      }

      .v5-login-note > div {
        flex: 1;
      }

      .v5-login-note b {
        font-size: 14px;
      }

      .v5-login-note p {
        color: #a9b8d5;
        font-size: 12px;
      }

      .v5-feature-heading {
        margin: 40px 0 25px;
      }

      .v5-feature-heading small {
        color: #8cf7e9;
        letter-spacing: 2px;
        font-size: 10px;
      }

      .v5-feature-heading h2 {
        font-size: clamp(25px, 4vw, 42px);
        font-weight: 950;
        margin-top: 10px;
      }

      .v5-quick {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }

      .v5-tile {
        min-height: 170px;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: space-between;
        padding: 23px;
        border: 1px solid #6579a5;
        border-radius: 20px;
        background:
          radial-gradient(circle at 100% 0%, #7c61bf55, transparent 55%),
          linear-gradient(135deg, #223254, #111b32);
        color: white;
        text-align: left;
        cursor: pointer;
        transition: .3s;
      }

      .v5-tile:hover {
        transform: translateY(-6px);
        border-color: #b59bff;
        box-shadow: 0 15px 40px #0008;
      }

      .v5-tile span {
        font-size: 37px;
        color: #8af7eb;
      }

      .v5-tile strong {
        font-size: 21px;
      }

      .v5-tile small {
        color: #d1b9ff;
      }

      .v5-endcard {
        display: flex;
        align-items: center;
        gap: 20px;
        margin-top: 35px;
        padding: 28px;
        border: 1px solid #a68c5f;
        border-radius: 20px;
        background: linear-gradient(110deg, #393046, #18233c);
      }

      .v5-endcard > span {
        font-size: 45px;
        color: #f6d48f;
      }

      .v5-endcard strong {
        display: block;
        font-size: 22px;
        color: #ffe0a2;
      }

      .v5-endcard small {
        color: #c1b6cd;
      }

      .v5-page-heading {
        padding: 35px;
        margin-bottom: 25px;
        background: linear-gradient(120deg, #252b52, #131c33);
        border: 1px solid #6867a6;
        border-radius: 25px;
      }

      .v5-page-heading[hidden],
      .v5-home[hidden] {
        display: none !important;
      }

      .v5-page-heading small {
        color: #8cf8eb;
        letter-spacing: 2px;
      }

      .v5-page-heading h1 {
        font-size: clamp(32px, 5vw, 60px);
        margin: 15px 0;
        font-weight: 950;
      }

      .v5-page-heading p {
        color: #a8b9d5;
      }

      .v5-route-hidden {
        display: none !important;
      }

      .v5-original-hero {
        display: none !important;
      }

      .v5-auction-stage {
        position: relative;
        overflow: hidden;
        padding: 35px;
        min-height: 300px;
        margin: 20px 0;
        border-radius: 25px;
        border: 1px solid #e5bd7e;
        background:
          radial-gradient(circle at 80% 50%, #b78b5888, transparent 45%),
          linear-gradient(120deg, #392e42, #181c32);
        box-shadow: 0 15px 50px #0007;
      }

      .v5-auction-eyebrow {
        font-size: 11px;
        color: #ffdb9d;
        letter-spacing: 2px;
      }

      .v5-auction-stage h2 {
        position: relative;
        z-index: 2;
        font-size: clamp(38px, 5vw, 70px);
        line-height: 1.1;
        margin: 25px 0;
        font-weight: 950;
        color: white;
      }

      .v5-auction-stage h2 em {
        font-style: normal;
        color: #f5d18c;
      }

      .v5-auction-stage p {
        position: relative;
        z-index: 2;
        color: #dfd2bd;
        max-width: 500px;
      }

      .v5-auction-emblem {
        position: absolute;
        right: 10%;
        top: 10%;
        font-size: 190px;
        color: #f5d28b77;
        text-shadow: 0 0 50px #ffd996;
        animation: royaleFloat 6s infinite;
      }

      .v5-auction-grid .auctionCard {
        border: 1px solid #b59162 !important;
        border-radius: 22px !important;
        background: linear-gradient(
          140deg, #332a41, #161f34
        ) !important;
      }

      .v5-auction-wallet {
        border: 1px solid #b8996e !important;
        border-radius: 15px !important;
        background: #2c293d !important;
      }

      .v5-welcome {
        position: fixed;
        inset: 0;
        z-index: 999999;
        display: grid;
        place-items: center;
        padding: 20px;
        background:
          radial-gradient(circle at 50% 35%, #47316e, #060918 75%);
        animation: royaleAppear .5s ease both;
      }

      .v5-welcome-box {
        width: min(100%, 550px);
        padding: 45px 25px;
        text-align: center;
        border: 1px solid #e8c587;
        border-radius: 28px;
        background:
          linear-gradient(145deg, #28234c, #10172d);
        box-shadow:
          0 0 100px #7455cf77,
          0 0 35px #e5bc7c33;
      }

      .v5-star {
        font-size: 70px;
        color: #ffe0a0;
        animation: royaleFloat 4s infinite;
      }

      .v5-welcome-box small {
        display: block;
        margin: 15px 0;
        color: #8df8eb;
        letter-spacing: 2px;
      }

      .v5-welcome-box h2 {
        color: white;
        font-size: clamp(37px, 8vw, 65px);
        line-height: 1.05;
        margin: 20px 0;
      }

      .v5-welcome-box h2 em {
        font-style: normal;
        color: #f5d08b;
      }

      .v5-welcome-box h3 {
        color: #91fff0;
        font-size: 30px;
        margin: 15px 0;
        overflow-wrap: anywhere;
      }

      .v5-welcome-box p {
        color: #aebbd7;
        font-size: 12px;
        letter-spacing: 1px;
      }

      .v5-welcome-box button {
        margin-top: 25px;
        padding: 16px 28px;
        border: 0;
        border-radius: 12px;
        background: linear-gradient(90deg, #f4d28f, #8cf8e9);
        color: #101729;
        font-weight: 950;
        cursor: pointer;
      }

      .v5-exit {
        animation: royaleDisappear .45s ease forwards;
      }

      .v5-bottom {
        display: none;
      }

      @keyframes royalePulse {
        50% { opacity: .35; transform: scale(.8); }
      }

      @keyframes royaleRotate {
        to { transform: rotate(360deg); }
      }

      @keyframes royaleFloat {
        50% { transform: translateY(-13px); }
      }

      @keyframes royaleAppear {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes royaleDisappear {
        to { opacity: 0; }
      }

      @media (max-width: 900px) {
        .v5-shell {
          grid-template-columns: 75px minmax(0, 1fr);
        }

        .v5-sidebar {
          padding: 18px 7px;
        }

        .v5-brand {
          font-size: 13px;
          padding: 8px 0;
        }

        .v5-brand small,
        .v5-side-label,
        .v5-nav-btn b {
          display: none;
        }

        .v5-nav-btn {
          justify-content: center;
          padding: 14px 5px;
        }

        .v5-work {
          padding: 0 18px 70px;
        }

        .v5-crest {
          opacity: .4;
          position: absolute;
          right: 15px;
        }
      }

      @media (max-width: 700px) {
        .v5-shell {
          display: block;
        }

        .v5-sidebar {
          display: none;
        }

        .v5-work {
          padding: 0 13px 100px;
        }

        .v5-top {
          min-height: 70px;
        }

        .v5-hero {
          min-height: 390px;
          padding: 25px;
        }

        .v5-hero h1 {
          font-size: clamp(42px, 11vw, 65px);
        }

        .v5-crest {
          width: 170px;
          height: 170px;
          right: -45px;
          top: 45px;
          opacity: .23;
        }

        .v5-quick {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
        }

        .v5-tile {
          min-height: 145px;
          padding: 17px;
        }

        .v5-tile strong {
          font-size: 17px;
        }

        .v5-player {
          gap: 13px;
        }

        .v5-bottom {
          display: flex;
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 500;
          justify-content: space-around;
          padding: 9px 5px max(9px, env(safe-area-inset-bottom));
          background: #0d1429f5;
          border-top: 1px solid #8170c266;
          backdrop-filter: blur(18px);
        }

        .v5-bottom-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
          padding: 7px 12px;
          border: 0;
          background: transparent;
          color: #bac5df;
          font-size: 11px;
          cursor: pointer;
        }

        .v5-bottom-btn span {
          font-size: 23px;
        }

        .v5-bottom-btn.active {
          color: #85f9ed;
        }

        .v5-auction-emblem {
          font-size: 120px;
          opacity: .35;
        }

        .v5-auction-stage {
          padding: 24px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .v5-body *,
        .v5-body *::before,
        .v5-body *::after {
          animation-duration: .01ms !important;
          transition-duration: .01ms !important;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function showWelcome(name) {
    document.querySelector(".v5-welcome")?.remove();

    const overlay = create(
      "div",
      "v5-welcome",
      `
      <div class="v5-welcome-box">
        <div class="v5-star">✦</div>
        <small>IDENTITY VERIFIED / FFGC2K26</small>

        <h2>
          WELCOME TO<br>
          <em>THE ARENA</em>
        </h2>

        <h3 id="v5WelcomeName"></h3>

        <p>YOUR ARENA · YOUR IDENTITY · YOUR LEGACY</p>

        <button id="v5Enter" type="button">
          ENTER MY ARENA ↗
        </button>
      </div>
      `
    );

    document.body.appendChild(overlay);

    $("v5WelcomeName").textContent = name;

    function close() {
      if (!overlay.isConnected) return;
      overlay.classList.add("v5-exit");
      setTimeout(() => overlay.remove(), 450);
    }

    $("v5Enter").addEventListener("click", close);

    setTimeout(close, 9000);
  }

  async function syncMember(welcome = false) {
    if (syncing) return;
    syncing = true;

    try {
      const response = await fetch("/api/member/me", {
        credentials: "same-origin",
        cache: "no-store"
      });

      if (!response.ok) return;

      const data = await response.json();

      const profile =
        data.profile ||
        data.member ||
        data.data?.profile ||
           data.data?.member;

      if (!profile?.name) return;

      const previousName = member?.name;
      member = profile;

      const heroTitle = $("v5HeroTitle");
      const playerName = $("v5PlayerName");
      const playerAvatar = $("v5PlayerAvatar");
      const playerPoints = $("v5PlayerPoints");
      const playerRank = $("v5PlayerRank");

      if (heroTitle) {
        heroTitle.innerHTML =
          "WELCOME BACK,<br><em>" +
          escapeHTML(profile.name.toUpperCase()) +
          ".</em>";
      }

      if (playerName) {
        playerName.textContent = profile.name;
      }

      if (playerAvatar) {
        playerAvatar.textContent =
          profile.name.trim().charAt(0).toUpperCase();
      }

      if (playerPoints) {
        playerPoints.textContent =
          Number(profile.points || 0).toLocaleString("en-IN");
      }

      if (playerRank) {
        playerRank.textContent =
          profile.rank ? "#" + profile.rank : "PLAYER";
      }

      if ($("v5Player")) {
        $("v5Player").hidden = false;
      }

      if ($("v5LoginNotice")) {
        $("v5LoginNotice").hidden = true;
      }

      if (welcome && (!previousName || previousName !== profile.name)) {
        showWelcome(profile.name);
        openRoute("home");
      }

    } catch (error) {
      console.warn("Member profile sync unavailable:", error);
    } finally {
      syncing = false;
    }
  }

  function openRoute(key) {
    if (key === "empire") {
      $("openEconomicEmpire")?.click();
      return;
    }

    if (!routes.some(route => route[0] === key)) {
      key = "home";
    }

    const scrollToHall = key === "spotlight";
    if (scrollToHall) key = "home";
    currentRoute = key;

    for (const [routeKey, , , ids] of routes) {
      for (const id of ids) {
        const section = $(id);

        // Hall of Spotlight belongs to the homepage, always visible there.
        if (id === "spotlightSection") continue;

        if (section) {
          section.classList.toggle(
            "v5-route-hidden",
            routeKey !== key
          );
        }
      }
    }

    const home = $("v5Home");
    const heading = $("v5PageHeading");

    if (home) home.hidden = key !== "home";
    if (heading) heading.hidden = key === "home";

    const route = routes.find(item => item[0] === key);
    const label = route?.[2] || "Home";

    if ($("v5Current")) {
      $("v5Current").textContent = label;
    }

    const titles = {
      ranks: "THE LEADERBOARD",
      events: "THE COMPETITION",
      auction: "ROYAL AUCTION HOUSE",
      spotlight: "HALL OF LEGENDS",
      news: "OFFICIAL BULLETIN",
      profile: "PLAYER IDENTITY"
    };

    const title = heading?.querySelector("h1");

    if (title) {
      title.textContent =
        titles[key] || label.toUpperCase();
    }

    document.querySelectorAll("[data-v5-route]").forEach(button => {
      const active = button.dataset.v5Route === key;

      button.classList.toggle("active", active);
      button.setAttribute(
        "aria-current",
        active ? "page" : "false"
      );
    });

    try {
      history.replaceState(
        null,
        "",
        key === "home" ? location.pathname : "#" + key
      );
    } catch {}

    if (scrollToHall) {
      $("spotlightSection")?.scrollIntoView({behavior:"smooth",block:"start"});
    } else {
      window.scrollTo({top:0,behavior:"smooth"});
    }
  }

  function buildLayout() {
    const main = document.querySelector("main");

    if (!main || $("v5Shell")) return;

    document.body.classList.add("v5-body");

    installStyles();

    const shell = create("div", "v5-shell");
    shell.id = "v5Shell";

    const sidebar = create(
      "aside",
      "v5-sidebar",
      `
      <div class="v5-brand">
        ✦ FFGC<span>2K26</span>
        <small>ROYALE ARENA / SEASON 2026</small>
      </div>

      <p class="v5-side-label">NAVIGATION</p>
      `
    );

    const sideNav = create("nav", "v5-side-nav");

    const work = create("div", "v5-work");

    const top = create(
      "div",
      "v5-top",
      `
      <div>
        <small>✦ THE OFFICIAL ARENA</small>
        <strong id="v5Current">Home</strong>
      </div>

      <div class="v5-live">
        <i></i> ARENA ONLINE
      </div>
      `
    );

    const area = create("div", "v5-area");

    const bottom = create("nav", "v5-bottom");
    bottom.setAttribute("aria-label", "Mobile navigation");

    const home = create("div", "v5-home");
    home.id = "v5Home";

    home.innerHTML = `
      <div class="v5-hero">
        <div class="v5-hero-text">

          <div class="v5-kicker">
            ✦ THE NEXT GENERATION OF COMPETITION
          </div>

          <h1 id="v5HeroTitle">
            THE ARENA<br>
            <em>IS YOURS.</em>
          </h1>

          <p>YOUR ARENA. YOUR IDENTITY. YOUR LEGACY.</p>

          <div class="v5-hero-actions">
            <button type="button" data-v5-route="ranks">
              EXPLORE RANKINGS ↗
            </button>

            <button type="button" data-v5-route="events">
              ENTER EVENTS →
            </button>
          </div>
        </div>

        <div class="v5-crest">
          <div class="v5-crest-inner">
            ✦
            <strong>FFGC<br>2K26</strong>
            <small>THE LEGACY CONTINUES</small>
          </div>
        </div>
      </div>

      <div id="v5Player" class="v5-player" hidden>

        <div class="v5-avatar" id="v5PlayerAvatar">
          ✦
        </div>

        <div class="v5-player-info">
          <small>VERIFIED ARENA MEMBER</small>
          <h2 id="v5PlayerName"></h2>
          <span>OFFICIAL PLAYER CARD</span>
        </div>

        <div class="v5-player-stat">
          <small>POINTS</small>
          <strong id="v5PlayerPoints">0</strong>
        </div>

        <div class="v5-player-stat">
          <small>RANK</small>
          <strong id="v5PlayerRank">PLAYER</strong>
        </div>

        <button type="button" data-v5-route="profile">
          VIEW PROFILE ↗
        </button>
      </div>

      <div id="v5LoginNotice" class="v5-login-note">
        <span>◉</span>

        <div>
          <b>UNLOCK YOUR ARENA IDENTITY</b>
          <p>
            Log in using your private member ID to activate
            your personalized dashboard.
          </p>
        </div>

        <button type="button" data-v5-route="profile">
          LOGIN →
        </button>
      </div>

      <div class="v5-feature-heading">
        <small>✦ DISCOVER THE ARENA</small>
        <h2>CHOOSE YOUR BATTLEGROUND</h2>
      </div>

      <div id="v5Quick" class="v5-quick"></div>

      <div class="v5-endcard">
        <span>✦</span>

        <div>
          <strong>GREATNESS IS EARNED.</strong>
          <small>
            FFGC2K26 — EVERY POINT COUNTS.
          </small>
        </div>
      </div>
    `;

    const heading = create(
      "div",
      "v5-page-heading",
      `
      <small>✦ FFGC2K26 / MEMBER EXPERIENCE</small>
      <h1></h1>
      <p>YOUR ARENA · YOUR IDENTITY · YOUR LEGACY</p>
      `
    );

    heading.id = "v5PageHeading";
    heading.hidden = true;

    for (const [key, icon, label] of routes) {
      const button = create(
        "button",
        "v5-nav-btn",
        `<span>${icon}</span><b>${label}</b>`
      );

      button.type = "button";
      button.dataset.v5Route = key;
      sideNav.appendChild(button);

      if (key !== "home") {
        const tile = create(
          "button",
          "v5-tile",
          `
          <span>${icon}</span>
          <strong>${label}</strong>
          <small>EXPLORE ↗</small>
          `
        );

        tile.type = "button";
        tile.dataset.v5Route = key;

        home.querySelector("#v5Quick").appendChild(tile);
      }

      if (["home", "ranks", "events", "auction", "profile"].includes(key)) {
        const mobileButton = create(
          "button",
          "v5-bottom-btn",
          `<span>${icon}</span><small>${label}</small>`
        );

        mobileButton.type = "button";
        mobileButton.dataset.v5Route = key;
        bottom.appendChild(mobileButton);
      }
    }

    sidebar.appendChild(sideNav);

    main.parentNode.insertBefore(shell, main);

    shell.append(sidebar, work);
    work.append(top, area);
    area.append(home, heading, main);

    document.body.appendChild(bottom);

    // Preserve existing functional DOM and handlers.
    const originalHero = main.querySelector(":scope > .hero");

    if (originalHero) {
      const stats = $("stats");

      if (stats) {
        home.querySelector(".v5-hero").after(stats);
      }

      originalHero.classList.add("v5-original-hero");
    }

    // Show published Spotlight achievements immediately on website load.
    // Move the existing element (do not clone it) so app.js keeps its data and handlers.
    const spotlightHome = $("spotlightSection");
    if (spotlightHome) {
      spotlightHome.classList.remove("v5-route-hidden");
      spotlightHome.classList.add("ffgc-home-spotlight");
      home.insertBefore(spotlightHome, home.firstChild);
    }

    const sections = [
      "leaderboard",
      "teams",
      "tasks",
      "polls",
      "announcements",
      "decisionChamber",
      "auctionHouse",
      "eliminationArena",
      "myProfile",
      "supportMember",
      "spotlightSection"
    ];

    for (const id of sections) {
      $(id)?.classList.add("v5-section");
    }

    // Auction House visual stage.
    const auction = $("auctionHouse");

    if (auction) {
      const auctionHeading = auction.querySelector(".sectionHeading");

      const stage = create(
        "div",
        "v5-auction-stage",
        `
        <div class="v5-auction-eyebrow">
          ◆ THE ROYAL AUCTION / LIVE BIDDING
        </div>

        <h2>
          RARE REWARDS.<br>
          <em>LEGENDARY WINS.</em>
        </h2>

        <p>
          Exclusive lots. Real competition.
          One winning bid. The stage is yours.
        </p>

        <div class="v5-auction-emblem">◆</div>
        `
      );

      auctionHeading?.after(stage);

      $("auctionCards")?.classList.add("v5-auction-grid");
      $("auctionWallet")?.classList.add("v5-auction-wallet");
      $("auctionMyRewards")?.classList.add("v5-rewards");
    }

    // Profile-only management shortcuts; keep the mobile nav unchanged.
    const profileSection = $("myProfile");
    const adminSection = $("admin");
    if (profileSection) {
      if (!$('ffgcProfileActions')) {
        const actions = create('div', 'ffgc-profile-actions', `
          <div class="ffgc-profile-actions-heading">✦ PRIVATE ACCESS PORTAL</div>
          <button type="button" id="ffgcProfileEconomy" class="ffgc-obsidian-btn">
            <span class="ffgc-obsidian-icon">◈</span>
            <span><strong>ECONOMIC EMPIRE</strong><small>Enter the marketplace ↗</small></span>
          </button>
          <button type="button" id="ffgcProfileAdmin" class="ffgc-obsidian-btn">
            <span class="ffgc-obsidian-icon">♛</span>
            <span><strong>GOD ADMIN</strong><small>Authorized control center ↗</small></span>
          </button>
        `);
        actions.id = 'ffgcProfileActions';
        profileSection.appendChild(actions);
      }
      // Admin stays under Profile, not as a separate floating page.
      if (adminSection) profileSection.appendChild(adminSection);
    }

    // Member navigation.
    document.addEventListener("click", event => {
      const routeButton = event.target.closest("[data-v5-route]");

      if (routeButton) {
        event.preventDefault();
        openRoute(routeButton.dataset.v5Route);
        return;
      }

      const anchor = event.target.closest('a[href^="#"]');

      if (!anchor) return;

      const id = anchor.getAttribute("href").slice(1);

      const map = {
        leaderboard: "ranks",
        teams: "ranks",
        tasks: "events",
        polls: "events",
        eliminationArena: "events",
        decisionChamber: "events",
        announcements: "news",
        myProfile: "profile",
        auctionHouse: "auction",
        spotlightSection: "spotlight"
      };

      if (!map[id]) return;

      event.preventDefault();

      openRoute(map[id]);

      $(id)?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    });

    // Existing app.js should dispatch this after successful login.
    window.addEventListener("arena:login-success", () => {
      syncMember(true);
    });

    // Additional login detection for existing member form.
    const loginForm = $("memberLoginForm");

    if (loginForm) {
      loginForm.addEventListener("submit", () => {
        // Allow existing app.js to finish authentication.
        setTimeout(() => syncMember(true), 1200);
      });
    }

    document.addEventListener("click", event => {
      if (event.target.closest("#memberLogout")) {
        member = null;

        if ($("v5Player")) {
          $("v5Player").hidden = true;
        }

        if ($("v5LoginNotice")) {
          $("v5LoginNotice").hidden = false;
        }

        if ($("v5HeroTitle")) {
          $("v5HeroTitle").innerHTML =
            "THE ARENA<br><em>IS YOURS.</em>";
        }
      }
    });

    const hash = (location.hash || "").slice(1);

    const legacy = {
      leaderboard: "ranks",
      tasks: "events",
      polls: "events",
      announcements: "news",
      myProfile: "profile",
      auctionHouse: "auction",
      spotlightSection: "spotlight"
    };

    openRoute(legacy[hash] || hash || "home");

    syncMember(false);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildLayout);
  } else {
    buildLayout();
  }

})();
