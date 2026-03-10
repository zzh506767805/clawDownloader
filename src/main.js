const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.tauri?.invoke;

let currentStep = 0;
const totalSteps = 4;
let envCheckDone = false;
let envResult = null;

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
    nextBtn.textContent = "开始检测";
    nextBtn.disabled = false;
    nextBtn.style.display = "";
  } else if (step === 1) {
    // Enter install page: auto run env check, hide next until check done
    nextBtn.style.display = "none";
    if (!envCheckDone) {
      runEnvCheck();
    }
  } else if (step === 2) {
    nextBtn.textContent = "配置并继续";
    nextBtn.disabled = false;
    nextBtn.style.display = "";
  } else if (step === 3) {
    nextBtn.textContent = "关闭";
    nextBtn.disabled = false;
    nextBtn.style.display = "";
  }

  currentStep = step;
}

// --- Step 1 Phase 1: Environment check only ---
async function runEnvCheck() {
  envCheckDone = false;
  hideAction();

  setLoading("env-node");
  setLoading("env-npm");
  setLoading("env-claw");
  document.getElementById("node-ver").textContent = "检测中...";
  document.getElementById("npm-ver").textContent = "检测中...";
  document.getElementById("claw-ver").textContent = "检测中...";

  try {
    envResult = await invoke("check_environment");
  } catch (e) {
    showAction(`<p style="color:#ff6b4a">环境检测失败：${e}</p>`);
    return;
  }

  setStatus("env-node", envResult.node_installed, "node-ver", envResult.node_installed ? envResult.node_version : "未安装");
  setStatus("env-npm", envResult.npm_installed, "npm-ver", envResult.npm_installed ? envResult.npm_version : "未安装");
  setStatus("env-claw", envResult.openclaw_installed, "claw-ver", envResult.openclaw_installed ? envResult.openclaw_version : "未安装");

  envCheckDone = true;

  // Show appropriate action based on results
  if (!envResult.node_installed) {
    showAction(
      '<p style="color:#ff6b4a;font-size:13px;margin-bottom:8px;">需要先安装 Node.js</p>' +
      '<button class="btn btn-primary" id="btn-install-node">通过 Homebrew 安装 Node.js</button>'
    );
    document.getElementById("btn-install-node").onclick = async () => {
      showAction('<p style="color:#888;font-size:13px;">正在安装 Node.js...</p>');
      try {
        const r = await invoke("install_node");
        if (r.success) {
          showAction('<p style="color:#4ade80;font-size:13px;">Node.js 安装成功！</p>');
          envCheckDone = false;
          setTimeout(runEnvCheck, 500);
        } else {
          showAction(`<p style="color:#ff6b4a;font-size:13px;">${r.message}</p>`);
        }
      } catch (e) {
        showAction(`<p style="color:#ff6b4a;font-size:13px;">错误：${e}</p>`);
      }
    };
  } else if (envResult.openclaw_installed) {
    showAction('<p style="color:#4ade80;font-size:13px;">OpenClaw 已安装！</p>');
    const nextBtn = document.getElementById("btn-next");
    nextBtn.textContent = "下一步";
    nextBtn.disabled = false;
    nextBtn.style.display = "";
  } else {
    // Node OK, OpenClaw not installed → show install button
    showAction(
      '<button class="btn btn-primary" id="btn-do-install" style="padding:10px 28px;">安装 OpenClaw</button>'
    );
    document.getElementById("btn-do-install").onclick = () => {
      hideAction();
      runInstall();
    };
  }
}

// --- Step 1 Phase 2: Actually install OpenClaw ---
async function runInstall() {
  const installSection = document.getElementById("install-section");
  const bar = document.getElementById("install-progress");
  const log = document.getElementById("install-log");
  installSection.style.display = "";

  log.textContent = "正在安装 OpenClaw...\n";
  bar.style.width = "0%";
  bar.style.background = "";

  let pct = 5, shown = -1;
  const msgs = [
    [8, "[npm] 解析依赖..."],
    [25, "[npm] 下载 OpenClaw..."],
    [50, "[npm] 安装组件..."],
    [75, "[npm] 链接程序..."],
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
      log.textContent += "\n安装完成！";
      setStatus("env-claw", true, "claw-ver", "已安装");
      // Show next button
      const nextBtn = document.getElementById("btn-next");
      nextBtn.textContent = "下一步";
      nextBtn.disabled = false;
      nextBtn.style.display = "";
    } else {
      bar.style.width = "100%";
      bar.style.background = "#dc2626";
      log.textContent += "\n" + r.message;
      showAction(
        '<button class="btn btn-primary" id="btn-retry">重试</button>'
      );
      document.getElementById("btn-retry").onclick = () => {
        hideAction();
        installSection.style.display = "none";
        envCheckDone = false;
        runEnvCheck();
      };
    }
  } catch (e) {
    clearInterval(timer);
    log.textContent += "\n错误：" + e;
    bar.style.background = "#dc2626";
  }
}

// --- Step 2: Configure Kimi ---
async function configureKimi() {
  const apiKey = document.getElementById("input-api-key").value.trim();
  if (!apiKey) {
    showConfigStatus("请输入 API 密钥", false);
    return false;
  }
  if (!apiKey.startsWith("sk-")) {
    showConfigStatus("API 密钥应以 'sk-' 开头", false);
    return false;
  }

  showConfigStatus("正在配置 Kimi AI...", null);

  try {
    const r = await invoke("configure_kimi", { apiKey });
    if (r.success) {
      showConfigStatus("Kimi AI 配置成功！", true);
      return true;
    } else {
      showConfigStatus(r.message, false);
      return false;
    }
  } catch (e) {
    showConfigStatus("错误：" + e, false);
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
  } catch (_) {}
});

// --- Dashboard button ---
document.getElementById("btn-dashboard").addEventListener("click", async () => {
  const btn = document.getElementById("btn-dashboard");
  btn.disabled = true;
  btn.textContent = "启动中...";
  try {
    const r = await invoke("open_dashboard");
    btn.textContent = "已打开控制台";
    if (r.log) {
      document.getElementById("gw-password").textContent = r.log;
      document.getElementById("password-info").style.display = "";
    }
    setTimeout(() => {
      btn.disabled = false;
      btn.textContent = "打开控制台";
    }, 3000);
  } catch (e) {
    btn.textContent = "打开控制台";
    btn.disabled = false;
  }
});

// --- Copy password ---
document.getElementById("btn-copy-pw").addEventListener("click", () => {
  const pw = document.getElementById("gw-password").textContent;
  if (pw) {
    navigator.clipboard.writeText(pw).then(() => {
      document.getElementById("btn-copy-pw").textContent = "[已复制]";
      setTimeout(() => {
        document.getElementById("btn-copy-pw").textContent = "[复制]";
      }, 2000);
    });
  }
});

// --- Navigation ---
document.getElementById("btn-next").addEventListener("click", async () => {
  if (currentStep === totalSteps - 1) {
    try { await invoke("quit_app"); } catch (_) { window.close(); }
    return;
  }
  if (currentStep === 1) {
    // From install page, go to configure
    goToStep(2);
    return;
  }
  if (currentStep === 2) {
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
