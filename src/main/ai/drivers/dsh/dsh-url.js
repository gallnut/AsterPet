function normalizeDshEndpoint(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("请输入 DSH 地址");
  const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("DSH 地址只支持 HTTP 或 HTTPS");
  if (parsed.username || parsed.password) throw new Error("DSH 地址不能包含用户名或密码");
  if (parsed.search || parsed.hash || (parsed.pathname && parsed.pathname !== "/")) {
    throw new Error("DSH 地址请只填写主机和端口，不要包含路径、查询参数或片段");
  }
  return parsed.origin;
}

module.exports = { normalizeDshEndpoint };
