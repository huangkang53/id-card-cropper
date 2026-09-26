#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::os::windows::process::CommandExt;
use std::process::{Command, Child};
use std::sync::Mutex;
use std::net::TcpListener;

struct Backend(Mutex<Option<Child>>);
struct Port(Mutex<u16>);

fn get_free_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0)).unwrap().local_addr().unwrap().port()
}

#[tauri::command]
fn proxy(port: tauri::State<Port>, path: String, method: Option<String>, body: Option<String>) -> Result<String, String> {
    let p = port.0.lock().unwrap();
    let url = format!("http://127.0.0.1:{}{}", *p, path);
    let rt = reqwest::blocking::Client::new();
    let m = method.unwrap_or_else(|| "GET".to_string());
    let mut req = rt.request(reqwest::Method::from_bytes(m.as_bytes()).unwrap(), &url);
    if let Some(b) = body {
        req = req.header("Content-Type", "application/json").body(b);
    }
    let res = req.send().map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().map_err(|e| e.to_string())?;
    if status.is_success() {
        Ok(text)
    } else {
        Err(format!("HTTP {}", status.as_u16()))
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .manage(Port(Mutex::new(0)))
        .invoke_handler(tauri::generate_handler![proxy])
        .setup(|app| {
            let port = get_free_port();
            *app.state::<Port>().0.lock().unwrap() = port;
            let resource_dir = app.path().resource_dir().unwrap();
            let s = resource_dir.to_string_lossy().replace(r"\\?\", "");
            let resource_dir = std::path::PathBuf::from(s);
            let server_js = resource_dir.join("server").join("index.mjs");
            let node_exe = if cfg!(debug_assertions) {
                "node".to_string()
            } else {
                resource_dir.join("node").join("node.exe").to_string_lossy().to_string()
            };

            let data_dir = app.path().app_data_dir().unwrap();
            std::fs::create_dir_all(&data_dir).ok();

            let log_path = data_dir.join("backend.log");
            let log_file = std::fs::File::create(&log_path).unwrap();
            let child = Command::new(&node_exe)
                .arg(&server_js)
                .env("PORT", port.to_string())
                .env("NODE_PATH", resource_dir.join("node_modules"))
                .env("CROPPER_DATA_DIR", &data_dir)
                .env("CROPPER_DIST_DIR", resource_dir.join("dist"))
                .current_dir(&data_dir)
                .stdin(std::process::Stdio::null())
                .stdout(log_file.try_clone().unwrap())
                .stderr(log_file)
                .creation_flags(0x00000008 | 0x00000200)
                .spawn()
                .expect("failed to start backend");

            app.manage(Backend(Mutex::new(Some(child))));

            for _ in 0..60 {
                if let Ok(res) = reqwest::blocking::get(format!("http://127.0.0.1:{}/openapi/health", port)) {
                    if res.status().is_success() { break; }
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }

            let win = tauri::WebviewWindowBuilder::new(
                app, "main",
                tauri::WebviewUrl::External(format!("http://127.0.0.1:{}", port).parse().unwrap())
            )
            .title("图片批量透视裁剪工具")
            .inner_size(1400.0, 900.0)
            .build()?;
            #[cfg(debug_assertions)]
            win.open_devtools();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
