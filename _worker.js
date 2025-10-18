// ===== 工具函数：复制响应头，去掉代理场景不需要/会冲突的头 =====
function cloneHeaders(src) {
  const h = new Headers(src);
  [
    "content-length",
    "transfer-encoding",
    "content-encoding",
    "connection",
    "keep-alive",
    "alt-svc",
    "location"
  ].forEach(k => h.delete(k));
  return h;
}

// ===== 可选：若目标是 HTML，注入 <base> 以修复相对路径资源 =====
async function maybeInjectBase(resp, baseHref) {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  if (!ct.startsWith("text/html")) return resp; // 非 HTML 原样返回
  const html = await resp.text();
  const injected = html.replace(
    /<head(.*?)>/i,
    (m, g1) => `<head${g1}><base href="${baseHref}">`
  );
  const h = cloneHeaders(resp.headers);
  h.set("content-type", "text/html; charset=utf-8");
  return new Response(injected, { status: resp.status, headers: h });
}

// ===== 你的首页伪装页 & 辅助函数（保持不变） =====
async function nginx() {
  const text = `
  <!DOCTYPE html>
  <html>
  <head>
  <title>Welcome to nginx!</title>
  <style>
    body { width: 35em; margin: 0 auto; font-family: Tahoma, Verdana, Arial, sans-serif; }
  </style>
  </head>
  <body>
  <h1>Welcome to nginx!</h1>
  <p>If you see this page, the nginx web server is successfully installed and working. Further configuration is required.</p>
  <p>For online documentation and support please refer to <a href="http://nginx.org/">nginx.org</a>.<br/>
  Commercial support is available at <a href="http://nginx.com/">nginx.com</a>.</p>
  <p><em>Thank you for using nginx.</em></p>
  </body>
  </html>`;
  return text;
}

async function ADD(envadd) {
  let addtext = envadd.replace(/[ \t|"'\r\n]+/g, ",").replace(/,+/g, ",");
  if (addtext.charAt(0) === ",") addtext = addtext.slice(1);
  if (addtext.charAt(addtext.length - 1) === ",") addtext = addtext.slice(0, addtext.length - 1);
  return addtext.split(",");
}

// ===== 仅此一个默认导出！=====
let token = "";
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ========= 短链：共用 EMBY_TOKEN（优先用环境变量，其次用 ?token=） =========
    if (path === "/Normal.fwd" || path === "/Nsfw.fwd") {
      const t = env.EMBY_TOKEN || url.searchParams.get("token");
      if (!t) return new Response("Missing token", { status: 400 });

      const targetPath =
        path === "/Normal.fwd"
          ? "https://edec7dc6.cf-workers-2u5.pages.dev/zxc-1/Forward-Widgets/refs/heads/main/zxc-1.nor.fwd"
          : "https://edec7dc6.cf-workers-2u5.pages.dev/zxc-1/Forward-Widgets/refs/heads/main/zxc-1.sex.fwd";

      const target = new URL(targetPath);
      target.searchParams.set("token", t);

      // 反向代理返回（地址栏保持短链）
      const resp = await fetch(target.toString());
      const baseHref = target.origin + target.pathname.replace(/[^/]+$/, "");
      const finalResp = await maybeInjectBase(resp, baseHref);
      return new Response(finalResp.body, {
        status: finalResp.status,
        headers: cloneHeaders(finalResp.headers)
      });
    }

    // ========= 可选通配短链：/go/* → 目标站同名路径（按需保留） =========
    if (path.startsWith("/go/")) {
      const splat = path.replace(/^\/go\//, "");
      const target = `https://target.example.com/${splat}`;
      const resp = await fetch(target);
      return new Response(resp.body, { status: resp.status, headers: cloneHeaders(resp.headers) });
    }

    // ========= 你的原始 GitHub Raw 代理逻辑（保持原样） =========
    if (path !== "/") {
      let githubRawUrl = "https://raw.githubusercontent.com";
      if (new RegExp(githubRawUrl, "i").test(path)) {
        githubRawUrl += path.split(githubRawUrl)[1];
      } else {
        if (env.GH_NAME) {
          githubRawUrl += "/" + env.GH_NAME;
          if (env.GH_REPO) {
            githubRawUrl += "/" + env.GH_REPO;
            if (env.GH_BRANCH) githubRawUrl += "/" + env.GH_BRANCH;
          }
        }
        githubRawUrl += path;
      }

      // token 选择顺序（与你原来一致）
      if (env.GH_TOKEN && env.TOKEN) {
        if (env.TOKEN == url.searchParams.get("token")) token = env.GH_TOKEN || token;
        else token = url.searchParams.get("token") || token;
      } else token = url.searchParams.get("token") || env.GH_TOKEN || env.TOKEN || token;

      const githubToken = token;
      if (!githubToken || githubToken === "") return new Response("TOKEN不能为空", { status: 400 });

      const headers = new Headers();
      headers.append("Authorization", `token ${githubToken}`);

      const response = await fetch(githubRawUrl, { headers });
      if (response.ok) {
        return new Response(response.body, {
          status: response.status,
          headers: cloneHeaders(response.headers)
        });
      } else {
        const errorText = env.ERROR || "无法获取文件，检查路径或TOKEN是否正确。";
        return new Response(errorText, { status: response.status });
      }
    }

    // ========= 根路径：与你原来一致 =========
    const envKey = env.URL302 ? "URL302" : (env.URL ? "URL" : null);
    if (envKey) {
      const URLs = await ADD(env[envKey]);
      const URL = URLs[Math.floor(Math.random() * URLs.length)];
      return envKey === "URL302" ? Response.redirect(URL, 302) : fetch(new Request(URL, request));
    }
    return new Response(await nginx(), {
      headers: { "Content-Type": "text/html; charset=UTF-8" }
    });
  }
};