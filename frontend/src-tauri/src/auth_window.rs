use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub(crate) const MS_LOGIN_LABEL: &str = "ms-login";
#[cfg(not(windows))]
const MS_CLEAR_LABEL: &str = "ms-login-clear";

const MS_STORE_ID: [u8; 16] = *b"bw-ms-login-stre";

fn ms_login_data_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("ms-login-webview"))
}

fn with_isolated_store<'a, R: tauri::Runtime, M: tauri::Manager<R>>(
    builder: WebviewWindowBuilder<'a, R, M>,
    app: &AppHandle,
) -> WebviewWindowBuilder<'a, R, M> {
    let mut b = builder.data_store_identifier(MS_STORE_ID);
    if let Some(dir) = ms_login_data_dir(app) {
        b = b.data_directory(dir);
    }
    b
}

pub(crate) fn clear_ms_login_cookies(app: &AppHandle) -> Result<(), String> {
        if let Some(win) = app.get_webview_window(MS_LOGIN_LABEL) {
        return win.clear_all_browsing_data().map_err(|e| e.to_string());
    }

    #[cfg(windows)]
    {
        if let Some(dir) = ms_login_data_dir(app) {
            if dir.exists() {
                std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        if let Some(existing) = app.get_webview_window(MS_CLEAR_LABEL) {
            let _ = existing.close();
        }
        let url = "about:blank".parse().map_err(|_| "bad url".to_string())?;
        let win = with_isolated_store(
            WebviewWindowBuilder::new(app, MS_CLEAR_LABEL, WebviewUrl::External(url)),
            app,
        )
        .visible(false)
        .build()
        .map_err(|e| e.to_string())?;
        let res = win.clear_all_browsing_data().map_err(|e| e.to_string());
        let _ = win.close();
        res
    }
}

pub(crate) fn open_ms_login_window(
    app: &AppHandle,
    verification_uri: String,
    user_code: String,
) {
    if let Some(existing) = app.get_webview_window(MS_LOGIN_LABEL) {
        let _ = existing.close();
    }
    let parsed = match verification_uri.parse() {
        Ok(u) => u,
        Err(_) => return,
    };

    let code = user_code.replace(['"', '\\', '\n', '<'], "");
    let script = format!(
        r#"(function() {{
          var CODE = "{code}";
          function replaceBrand() {{
            if (document.title.includes('PortableMC')) {{
              document.title = document.title.replace(/PortableMC/g, 'Brassworks');
            }}
            if (!document.body) return;
            var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
            var node;
            while (node = walker.nextNode()) {{
              if (node.nodeValue && node.nodeValue.includes('PortableMC')) {{
                node.nodeValue = node.nodeValue.replace(/PortableMC/g, 'Brassworks');
              }}
            }}
          }}
          setInterval(replaceBrand, 50);
          function fill() {{
            var input = document.querySelector('#otc')
              || document.querySelector('input[name="otc"]')
              || document.querySelector('input[type="tel"]');
            if (!input) return false;
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, CODE);
            input.dispatchEvent(new Event('input', {{ bubbles: true }}));
            input.dispatchEvent(new Event('change', {{ bubbles: true }}));
            var btn = document.querySelector('#idSIButton9')
              || document.querySelector('input[type="submit"]')
              || document.querySelector('button[type="submit"]');
            if (btn) {{ setTimeout(function() {{ btn.click(); }}, 400); return true; }}
            return false;
          }}
          var n = 0;
          var iv = setInterval(function() {{ n++; if (fill() || n > 60) clearInterval(iv); }}, 250);
        }})();"#
    );

    let builder = with_isolated_store(
        WebviewWindowBuilder::new(app, MS_LOGIN_LABEL, WebviewUrl::External(parsed)),
        app,
    )
    .title("Sign in to Microsoft")
    .inner_size(480.0, 720.0)
    .min_inner_size(380.0, 560.0)
    .center()
    .focused(true)
    .initialization_script(script.as_str());
    let _ = builder.build();
}
