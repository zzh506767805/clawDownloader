#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::Command;
use serde::Serialize;

#[derive(Serialize)]
struct EnvCheck {
    node_installed: bool,
    node_version: String,
    npm_installed: bool,
    npm_version: String,
    openclaw_installed: bool,
    openclaw_version: String,
}

#[derive(Serialize)]
struct InstallResult {
    success: bool,
    message: String,
    log: String,
}

fn run_cmd(cmd: &str, args: &[&str]) -> (bool, String) {
    match Command::new(cmd).args(args).output() {
        Ok(output) => {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if output.status.success() {
                (true, stdout)
            } else {
                (false, format!("{}\n{}", stdout, stderr))
            }
        }
        Err(e) => (false, format!("Command not found: {}", e)),
    }
}

#[tauri::command]
fn check_environment() -> EnvCheck {
    let (node_ok, node_ver) = run_cmd("node", &["-v"]);
    let (npm_ok, npm_ver) = run_cmd("npm", &["-v"]);
    let (claw_ok, claw_ver) = run_cmd("openclaw", &["--version"]);

    EnvCheck {
        node_installed: node_ok,
        node_version: if node_ok { node_ver } else { "Not installed".into() },
        npm_installed: npm_ok,
        npm_version: if npm_ok { npm_ver } else { "Not installed".into() },
        openclaw_installed: claw_ok,
        openclaw_version: if claw_ok { claw_ver } else { "Not installed".into() },
    }
}

#[tauri::command]
fn install_openclaw() -> InstallResult {
    let mut log = String::new();

    // Set npm mirror for faster downloads in China
    let _ = run_cmd("npm", &["config", "set", "registry", "https://registry.npmmirror.com"]);
    log.push_str("[mirror] npm mirror configured\n");

    // Install openclaw
    log.push_str("[install] npm install -g openclaw@latest ...\n");
    let (ok, out) = run_cmd("npm", &["install", "-g", "openclaw@latest"]);
    log.push_str(&format!("[install] {}\n", out));

    if !ok {
        return InstallResult {
            success: false,
            message: "npm install failed.".into(),
            log,
        };
    }

    // Verify installation
    let (ver_ok, ver) = run_cmd("openclaw", &["--version"]);
    if ver_ok {
        log.push_str(&format!("[verify] {}\n", ver));
    }

    // Run initial setup (create config + workspace)
    log.push_str("[setup] Initializing workspace...\n");
    let (_, setup_out) = run_cmd("openclaw", &["setup", "--non-interactive"]);
    log.push_str(&format!("[setup] {}\n", setup_out));

    // Install and start gateway service
    log.push_str("[gateway] Installing gateway service...\n");
    let (gw_ok, gw_out) = run_cmd("openclaw", &["gateway", "install"]);
    log.push_str(&format!("[gateway] {}\n", gw_out));

    if gw_ok {
        log.push_str("[gateway] Starting gateway...\n");
        let (_, start_out) = run_cmd("openclaw", &["gateway", "start"]);
        log.push_str(&format!("[gateway] {}\n", start_out));
    }

    InstallResult {
        success: true,
        message: "OpenClaw installed and gateway started!".into(),
        log,
    }
}

#[tauri::command]
fn install_node() -> InstallResult {
    let (brew_ok, _) = run_cmd("brew", &["--version"]);
    if !brew_ok {
        return InstallResult {
            success: false,
            message: "Homebrew not found. Install it first: https://brew.sh".into(),
            log: "Homebrew not detected.".into(),
        };
    }

    let mut log = String::new();
    log.push_str("[node] brew install node ...\n");
    let (ok, out) = run_cmd("brew", &["install", "node"]);
    log.push_str(&format!("[node] {}\n", out));

    InstallResult {
        success: ok,
        message: if ok { "Node.js installed!".into() } else { "Failed.".into() },
        log,
    }
}

/// Configure Kimi (Moonshot) API key
#[tauri::command]
fn configure_kimi(api_key: String) -> InstallResult {
    let mut log = String::new();

    // Get home directory
    let home = match std::env::var("HOME") {
        Ok(h) => h,
        Err(_) => return InstallResult {
            success: false,
            message: "Cannot determine HOME directory".into(),
            log: "".into(),
        },
    };

    // Ensure directories exist
    let auth_dir = format!("{}/.openclaw/agents/main/agent", home);
    if let Err(e) = std::fs::create_dir_all(&auth_dir) {
        return InstallResult {
            success: false,
            message: format!("Failed to create directory: {}", e),
            log: "".into(),
        };
    }

    // Write auth-profiles.json
    let auth_path = format!("{}/auth-profiles.json", auth_dir);
    let auth_json = format!(
        r#"{{"version":1,"profiles":{{"moonshot:default":{{"type":"api_key","provider":"moonshot","key":"{}"}}}}}}"#,
        api_key
    );
    log.push_str(&format!("[auth] Writing to {}\n", auth_path));

    if let Err(e) = std::fs::write(&auth_path, &auth_json) {
        return InstallResult {
            success: false,
            message: format!("Failed to write auth profile: {}", e),
            log,
        };
    }
    log.push_str("[auth] Moonshot API key configured\n");

    // Fix config: ensure moonshot provider uses api.moonshot.cn and set default model
    let config_path = format!("{}/.openclaw/openclaw.json", home);
    let config_content = std::fs::read_to_string(&config_path).unwrap_or_default();
    if let Ok(mut json) = serde_json::from_str::<serde_json::Value>(&config_content) {
        // Ensure models.providers.moonshot exists with correct baseUrl
        let moonshot_config: serde_json::Value = serde_json::json!({
            "baseUrl": "https://api.moonshot.cn/v1",
            "api": "openai-completions",
            "models": [{
                "id": "kimi-k2.5",
                "name": "Kimi K2.5",
                "reasoning": false,
                "input": ["text", "image"],
                "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
                "contextWindow": 256000,
                "maxTokens": 8192
            }]
        });

        // Create path if not exists
        if json.get("models").is_none() {
            json["models"] = serde_json::json!({"mode": "merge", "providers": {}});
        }
        if json["models"].get("providers").is_none() {
            json["models"]["providers"] = serde_json::json!({});
        }

        // If moonshot provider exists, just fix baseUrl; otherwise create it
        if json["models"]["providers"].get("moonshot").is_some() {
            json["models"]["providers"]["moonshot"]["baseUrl"] = serde_json::Value::String("https://api.moonshot.cn/v1".into());
            log.push_str("[config] Fixed moonshot baseUrl to api.moonshot.cn\n");
        } else {
            json["models"]["providers"]["moonshot"] = moonshot_config;
            log.push_str("[config] Created moonshot provider with api.moonshot.cn\n");
        }

        // Set default model
        if json.get("agents").is_none() {
            json["agents"] = serde_json::json!({"defaults": {}});
        }
        if json["agents"].get("defaults").is_none() {
            json["agents"]["defaults"] = serde_json::json!({});
        }
        json["agents"]["defaults"]["model"] = serde_json::json!({"primary": "moonshot/kimi-k2.5"});
        log.push_str("[model] Default model set to moonshot/kimi-k2.5\n");

        if let Ok(pretty) = serde_json::to_string_pretty(&json) {
            let _ = std::fs::write(&config_path, pretty);
        }
    }

    // Restart gateway to pick up config changes
    let _ = run_cmd("openclaw", &["gateway", "restart"]);
    log.push_str("[gateway] Restarted gateway\n");

    InstallResult {
        success: true,
        message: "Kimi API configured successfully!".into(),
        log,
    }
}

/// Open OpenClaw dashboard in browser
#[tauri::command]
fn open_dashboard() -> InstallResult {
    // First ensure gateway is running
    let (gw_ok, _) = run_cmd("openclaw", &["gateway", "start"]);
    if !gw_ok {
        let _ = run_cmd("openclaw", &["gateway", "install"]);
        let _ = run_cmd("openclaw", &["gateway", "start"]);
    }

    // Read gateway password from config
    let home = std::env::var("HOME").unwrap_or_default();
    let config_path = format!("{}/.openclaw/openclaw.json", home);
    let mut password = String::new();
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(pw) = json["gateway"]["auth"]["password"].as_str() {
                password = pw.to_string();
            }
        }
    }

    // Open dashboard in default browser
    match Command::new("open").arg("http://127.0.0.1:18789/").output() {
        Ok(output) if output.status.success() => InstallResult {
            success: true,
            message: "Dashboard opened in browser".into(),
            log: password,
        },
        _ => InstallResult {
            success: false,
            message: "Failed to open dashboard. Try visiting http://127.0.0.1:18789/ manually.".into(),
            log: password,
        },
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            check_environment,
            install_openclaw,
            install_node,
            configure_kimi,
            open_dashboard,
            quit_app,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
