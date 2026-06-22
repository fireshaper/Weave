// Weave — Tauri v2 Rust backend
use tauri::Manager;
use tauri_plugin_notification::NotificationExt;

#[tauri::command]
fn send_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(&title)
        .body(&body)
        .show()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn update_tray_tooltip(app: tauri::AppHandle, count: u32) -> Result<(), String> {
    let tooltip = if count > 0 {
        format!("Weave — {} unread", count)
    } else {
        "Weave".to_string()
    };
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_tooltip(Some(&tooltip)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_keyring::init())
        .setup(|app| {
            let _tray = tauri::tray::TrayIconBuilder::with_id("main")
                .tooltip("Weave")
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray: &tauri::tray::TrayIcon, event: tauri::tray::TrayIconEvent| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") {
                            let is_vis = w.is_visible().unwrap_or(false);
                            if is_vis {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            send_notification,
            update_tray_tooltip,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
