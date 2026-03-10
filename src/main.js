const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.tauri?.invoke;

let currentStep = 0;
const totalSteps = 4;

function goToStep(step) {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById(`page-${step}`).classList.add("active");

  document.querySelectorAll(".step").forEach((s) => {
    const n = parseInt(s.dataset.step);
    s.classList.remove("active", "done");
    if (n < step) s.classList.add("done");
    if (n === step) s.classList.add("active");
  });

  const prevBtn = document.getElementById("btn-prev");
  const nextBtn = document.getElementById("btn-next");

  prevBtn.style.visibility = step === 0 ? "hidden" : "visible";

  if (step === 0) {
    nextBtn.textContent = "Install Now";
    nextBtn.disabled = false;
    nextBtn.style.display = "";
  } else if (step === 1) {
    nextBtn.style.display = "none";
    runFullInstall();
  } else if (step === 2) {
    nextBtn.textContent = "Configure & Continue";
    nextBtn.disabled = false;
    nextBtn.style.display = "";
  } else if (step === 3) {
    nextBtn.textContent = "Close";
    nextBtn.disabled = false;
    nextBtn.style.display = "";
  }

  currentStep = step;
}

// --- Step 1: Full install flow ---
async function runFullInstall() {
  setLoading("env-node");
  setLoading("env-npm");
  setLoading("env-claw");

  let env;
  try {
    env = await invoke("check_environment");
  } catch (e) {
    showAction(`<p style="color:#ff6b4a">Environment check failed: ${e}</p>`);
    return;
  }

  setStatus("env-node", env.node_installed, "node-ver", env.node_version);
  setStatus("env-npm", env.npm_installed, "npm-ver", env.npm_version);
  setStatus("env-claw", env.openclaw_installed, "claw-ver", env.openclaw_version);

  // If Node.js missing, offer to install
  if (!env.node_installed) {
    showAction(
      '<p style="color:#ff6b4a;font-size:13px;margin-bottom:8px;">Node.js is required.</p>' +
      '<button class="btn btn-primary" id="btn-install-node">Install Node.js via Homebrew</button>'
    );
    document.getElementById("btn-install-node").onclick = async () => {
      showAction('<p style="color:#888;font-size:13px;">Installing Node.js...</p>');
      try {
        const r = await invoke("install_node");
        if (r.success) {
          showAction('<p style="color:#4ade80;font-size:13px;">Node.js installed! Continuing...</p>');
          setTimeout(runFullInstall, 500);
        } else {
          showAction(`<p style="color:#ff6b4a;font-size:13px;">${r.message}</p>`);
        }
      } catch (e) {
        showAction(`<p style="color:#ff6b4a;font-size:13px;">Error: ${e}</p>`);
      }
    };
    return;
  }

  // If OpenClaw already installed, skip to configure
  if (env.openclaw_installed) {
    showAction('<p style="color:#4ade80;font-size:13px;">OpenClaw is already installed!</p>');
    setTimeout(() => goToStep(2), 1000);
    return;
  }

  // Phase 2: Install OpenClaw
  const installSection = document.getElementById("install-section");
  const bar = document.getElementById("install-progress");
  const log = document.getElementById("install-log");
  installSection.style.display = "";

  log.textContent = "Installing OpenClaw...\n";
  bar.style.width = "0%";

  let pct = 5, shown = -1;
  const msgs = [
    [8, "[npm] Resolving dependencies..."],
    [25, "[npm] Downloading openclaw..."],
    [50, "[npm] Installing packages..."],
    [75, "[npm] Linking binaries..."],
  ];
  const timer = setInterval(() => {
    if (pct < 90) {
      pct += Math.random() * 2 + 0.5;
      pct = Math.min(pct, 90);
      bar.style.width = pct + "%";
      for (let i = shown + 1; i < msgs.length; i++) {
        if (msgs[i][0] <= pct) {
          log.textContent += msgs[i][1] + "\n";
          log.scrollTop = 9999;
          shown = i;
        }
      }
    }
  }, 800);

  try {
    const r = await invoke("install_openclaw");
    clearInterval(timer);
    log.textContent += "\n" + r.log;
    log.scrollTop = 9999;

    if (r.success) {
      bar.style.width = "100%";
      log.textContent += "\nDone!";
      setStatus("env-claw", true, "claw-ver", "Installed");
      setTimeout(() => goToStep(2), 1500);
    } else {
      bar.style.width = "100%";
      bar.style.background = "#dc2626";
      log.textContent += "\n" + r.message;
      showAction(
        '<button class="btn btn-primary" id="btn-retry">Retry</button>'
      );
      document.getElementById("btn-retry").onclick = () => {
        hideAction();
        bar.style.background = "";
        log.textContent = "";
        runFullInstall();
      };
    }
  } catch (e) {
    clearInterval(timer);
    log.textContent += "\nError: " + e;
    bar.style.background = "#dc2626";
  }
}

// --- Step 2: Configure Kimi ---
async function configureKimi() {
  const apiKey = document.getElementById("input-api-key").value.trim();
  if (!apiKey) {
    showConfigStatus("Please enter your API key.", false);
    return false;
  }
  if (!apiKey.startsWith("sk-")) {
    showConfigStatus("API key should start with 'sk-'.", false);
    return false;
  }

  showConfigStatus("Configuring Kimi AI...", null);

  try {
    const r = await invoke("configure_kimi", { apiKey });
    if (r.success) {
      showConfigStatus("Kimi AI configured successfully!", true);
      return true;
    } else {
      showConfigStatus(r.message, false);
      return false;
    }
  } catch (e) {
    showConfigStatus("Error: " + e, false);
    return false;
  }
}

function showConfigStatus(msg, success) {
  const el = document.getElementById("config-status");
  el.style.display = "block";
  if (success === null) {
    el.innerHTML = `<p style="color:#888;font-size:13px;">${msg}</p>`;
  } else if (success) {
    el.innerHTML = `<p style="color:#4ade80;font-size:13px;">${msg}</p>`;
  } else {
    el.innerHTML = `<p style="color:#ff6b4a;font-size:13px;">${msg}</p>`;
  }
}

// --- Helpers ---
function setLoading(id) {
  document.getElementById(id).querySelector(".env-status").className = "env-status loading";
}
function setStatus(itemId, ok, detailId, text) {
  document.getElementById(itemId).querySelector(".env-status").className = ok ? "env-status ok" : "env-status fail";
  document.getElementById(detailId).textContent = text;
}
function showAction(html) {
  const el = document.getElementById("install-action");
  el.style.display = "block";
  el.innerHTML = html;
}
function hideAction() {
  document.getElementById("install-action").style.display = "none";
}

// --- Open Moonshot platform link ---
document.getElementById("link-moonshot").addEventListener("click", () => {
  try {
    window.__TAURI__?.shell?.open("https://platform.moonshot.cn/console/api-keys");
  } catch (_) {
    // fallback: just let user know the URL
  }
});

// --- Dashboard button ---
document.getElementById("btn-dashboard").addEventListener("click", async () => {
  const btn = document.getElementById("btn-dashboard");
  btn.disabled = true;
  btn.textContent = "Starting...";
  try {
    const r = await invoke("open_dashboard");
    btn.textContent = "Dashboard Opened";
    // Show password if available
    if (r.log) {
      document.getElementById("gw-password").textContent = r.log;
      document.getElementById("password-info").style.display = "";
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "Open Dashboard";
    }, 3000);
  } catch (e) {
    btn.textContent = "Open Dashboard";
    btn.disabled = false;
  }
});

// --- Copy password ---
document.getElementById("btn-copy-pw").addEventListener("click", () => {
  const pw = document.getElementById("gw-password").textContent;
  if (pw) {
    navigator.clipboard.writeText(pw).then(() => {
      document.getElementById("btn-copy-pw").textContent = "[copied!]";
      setTimeout(() => {
        document.getElementById("btn-copy-pw").textContent = "[copy]";
      }, 2000);
    });
  }
});

// --- Navigation ---
document.getElementById("btn-next").addEventListener("click", async () => {
  if (currentStep === totalSteps - 1) {
    // Last step: close
    try { await invoke("quit_app"); } catch (_) { window.close(); }
    return;
  }
  if (currentStep === 2) {
    // Configure step: validate and save before moving on
    const ok = await configureKimi();
    if (!ok) return;
    setTimeout(() => goToStep(3), 800);
    return;
  }
  goToStep(currentStep + 1);
});

document.getElementById("btn-prev").addEventListener("click", () => {
  if (currentStep > 0) goToStep(currentStep - 1);
});
