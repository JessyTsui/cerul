export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const proxyUrl =
      process.env.HTTPS_PROXY?.trim() || process.env.HTTP_PROXY?.trim();

    if (proxyUrl) {
      const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");

      // EnvHttpProxyAgent reads HTTPS_PROXY/HTTP_PROXY/NO_PROXY automatically.
      // Set NO_PROXY so local backend requests bypass the proxy.
      if (!process.env.NO_PROXY) {
        process.env.NO_PROXY = "localhost,127.0.0.1";
      }

      setGlobalDispatcher(new EnvHttpProxyAgent());
      console.log(`[instrumentation] Global fetch proxy set to ${proxyUrl} (NO_PROXY=${process.env.NO_PROXY})`);
    }
  }
}
