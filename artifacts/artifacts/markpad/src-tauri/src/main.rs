#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::ffi::OsString;
use std::fs;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::Manager;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;
const DEFAULT_BACKEND_PORT: u16 = 18080;
const BACKEND_PORT_SCAN_LIMIT: u16 = 120;

#[derive(Default)]
struct BackendState {
    child: Mutex<Option<Child>>,
    port: Mutex<u16>,
}

#[tauri::command]
fn get_backend_port(state: tauri::State<'_, BackendState>) -> Result<u16, String> {
    let guard = state
        .port
        .lock()
        .map_err(|_| "Backend port state lock poisoned".to_string())?;

    if *guard > 0 {
        return Ok(*guard);
    }

    if cfg!(debug_assertions) {
        return Ok(8080);
    }

    Err("Backend port is not available".to_string())
}

fn is_port_available(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_ok()
}

fn select_backend_port() -> Result<u16, String> {
    let preferred_port = env::var("MARKPAD_BACKEND_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(DEFAULT_BACKEND_PORT);

    if is_port_available(preferred_port) {
        return Ok(preferred_port);
    }

    for offset in 1..=BACKEND_PORT_SCAN_LIMIT {
        let candidate = preferred_port.saturating_add(offset);
        if candidate > 0 && is_port_available(candidate) {
            return Ok(candidate);
        }
    }

    let fallback_listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("Failed to allocate fallback backend port: {e}"))?;
    let fallback_port = fallback_listener
        .local_addr()
        .map_err(|e| format!("Failed to read fallback backend port: {e}"))?
        .port();
    drop(fallback_listener);

    Ok(fallback_port)
}

fn platform_executable(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn path_delimiter() -> &'static str {
    if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    }
}

fn resolve_resource_path(app: &tauri::AppHandle, relative: &str) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Failed to locate resource directory: {e}"))?;

    Ok(resource_dir.join(relative))
}

fn resolve_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir {}: {e}", app_data_dir.display()))?;

    Ok(app_data_dir)
}

fn resolve_log_file_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let app_data_dir = resolve_app_data_dir(app)?;
    Ok(app_data_dir.join(file_name))
}

#[tauri::command]
fn get_log_paths(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let backend_log = resolve_log_file_path(&app, "backend.log")?;
    let frontend_log = resolve_log_file_path(&app, "frontend.log")?;
    Ok(vec![
        backend_log.display().to_string(),
        frontend_log.display().to_string(),
    ])
}

#[tauri::command]
fn write_frontend_log(app: tauri::AppHandle, level: String, message: String) -> Result<(), String> {
    let frontend_log = resolve_log_file_path(&app, "frontend.log")?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&frontend_log)
        .map_err(|e| format!("Failed to open frontend log {}: {e}", frontend_log.display()))?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);

    writeln!(file, "{} [{}] {}", timestamp, level.to_uppercase(), message)
        .map_err(|e| format!("Failed to write frontend log {}: {e}", frontend_log.display()))?;

    Ok(())
}

fn resolve_existing_resource_path(
    app: &tauri::AppHandle,
    candidates: &[&str],
    label: &str,
) -> Result<PathBuf, String> {
    let mut attempted = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        let path = resolve_resource_path(app, candidate)?;
        attempted.push(path.display().to_string());
        if path.exists() {
            return Ok(path);
        }
    }

    Err(format!(
        "{label} not found. Looked in: {}",
        attempted.join(", ")
    ))
}

fn spawn_backend(app: &tauri::AppHandle, port: u16) -> Result<Child, String> {
    let node_dir = resolve_existing_resource_path(
        app,
        &["runtime/node", "resources/runtime/node"],
        "Bundled Node runtime directory",
    )?;
    let node_bin = node_dir.join(platform_executable("node"));
    let backend_entry = resolve_existing_resource_path(
        app,
        &["backend/dist/index.mjs", "resources/backend/dist/index.mjs"],
        "Bundled backend entry",
    )?;
    let bundled_bin_dir = resolve_existing_resource_path(
        app,
        &["bin", "resources/bin"],
        "Bundled binary directory",
    )?;

    if !node_bin.exists() {
        return Err(format!("Bundled Node runtime not found: {}", node_bin.display()));
    }

    if !backend_entry.exists() {
        return Err(format!("Bundled backend entry not found: {}", backend_entry.display()));
    }

    let app_data_dir = resolve_app_data_dir(app)?;
    let backend_log_path = resolve_log_file_path(app, "backend.log")?;
    let backend_log_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&backend_log_path)
        .map_err(|e| format!("Failed to open backend log {}: {e}", backend_log_path.display()))?;
    let backend_log_err_file = backend_log_file
        .try_clone()
        .map_err(|e| format!("Failed to clone backend log handle {}: {e}", backend_log_path.display()))?;

    let current_path = env::var_os("PATH").unwrap_or_else(OsString::new);
    let mut merged_path = OsString::new();
    merged_path.push(bundled_bin_dir.as_os_str());
    merged_path.push(path_delimiter());
    merged_path.push(node_dir.as_os_str());
    merged_path.push(path_delimiter());
    merged_path.push(current_path);

    let mut command = Command::new(node_bin);
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    command
        .arg(backend_entry)
        .env("PORT", port.to_string())
        .env("NODE_ENV", "production")
        .env("MARKPAD_DATA_DIR", &app_data_dir)
        .env("PATH", merged_path)
        .stdout(Stdio::from(backend_log_file))
        .stderr(Stdio::from(backend_log_err_file));

    command
        .spawn()
        .map_err(|e| format!("Failed to spawn backend: {e}"))
}

fn stop_backend(app: &tauri::AppHandle) {
    let state = app.state::<BackendState>();
    let mut child_guard = match state.child.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    if let Some(mut child) = child_guard.take() {
        let _ = child.kill();
    }

    drop(child_guard);

    match state.port.lock() {
        Ok(mut port_guard) => {
            *port_guard = 0;
        }
        Err(_) => {}
    };
}

fn main() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![get_backend_port, get_log_paths, write_frontend_log])
        .setup(|app| {
            if !cfg!(debug_assertions) {
                let backend_port = select_backend_port()
                    .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;

                let child = spawn_backend(&app.handle(), backend_port)
                    .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;

                let state = app.state::<BackendState>();
                let mut guard = state
                    .child
                    .lock()
                    .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Backend state lock poisoned"))?;
                *guard = Some(child);

                let mut port_guard = state
                    .port
                    .lock()
                    .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Backend port lock poisoned"))?;
                *port_guard = backend_port;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                stop_backend(app_handle);
            }
        });
}
