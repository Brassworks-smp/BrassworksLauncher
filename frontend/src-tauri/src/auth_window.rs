
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub(crate) const MS_LOGIN_LABEL: &str = "ms-login";

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

    let _ = WebviewWindowBuilder::new(app, MS_LOGIN_LABEL, WebviewUrl::External(parsed))
        .title("Sign in to Microsoft")
        .inner_size(480.0, 720.0)
        .min_inner_size(380.0, 560.0)
        .center()
        .focused(true)
        .initialization_script(script.as_str())
        .build();
}
