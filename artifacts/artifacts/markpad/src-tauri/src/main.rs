#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::env;
use std::ffi::OsString;
use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use tauri::Manager;

#[derive(Default)]
struct BackendState {
    child: Mutex<Option<Child>>,
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

fn spawn_backend(app: &tauri::AppHandle) -> Result<Child, String> {
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

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;

    fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data dir {}: {e}", app_data_dir.display()))?;

    let current_path = env::var_os("PATH").unwrap_or_else(OsString::new);
    let mut merged_path = OsString::new();
    merged_path.push(bundled_bin_dir.as_os_str());
    merged_path.push(path_delimiter());
    merged_path.push(node_dir.as_os_str());
    merged_path.push(path_delimiter());
    merged_path.push(current_path);

    let mut command = Command::new(node_bin);
    command
        .arg(backend_entry)
        .env("PORT", "8080")
        .env("NODE_ENV", "production")
        .env("MARKPAD_DATA_DIR", &app_data_dir)
        .env("PATH", merged_path)
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    command
        .spawn()
        .map_err(|e| format!("Failed to spawn backend: {e}"))
}

fn wait_for_backend_ready(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    let target = SocketAddr::from(([127, 0, 0, 1], port));

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&target, Duration::from_millis(300)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(120));
    }

    false
}

fn stop_backend(app: &tauri::AppHandle) {
    let state = app.state::<BackendState>();
    let mut guard = match state.child.lock() {
        Ok(guard) => guard,
        Err(_) => return,
    };

    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
}

fn main() {
    tauri::Builder::default()
        .manage(BackendState::default())
        .setup(|app| {
            if !cfg!(debug_assertions) {
                let mut child = spawn_backend(&app.handle())
                    .map_err(|err| std::io::Error::new(std::io::ErrorKind::Other, err))?;

                if !wait_for_backend_ready(8080, Duration::from_secs(12)) {
                    let _ = child.kill();
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::TimedOut,
                        "Backend failed to start within timeout",
                    )
                    .into());
                }

                let state = app.state::<BackendState>();
                let mut guard = state
                    .child
                    .lock()
                    .map_err(|_| std::io::Error::new(std::io::ErrorKind::Other, "Backend state lock poisoned"))?;
                *guard = Some(child);
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
