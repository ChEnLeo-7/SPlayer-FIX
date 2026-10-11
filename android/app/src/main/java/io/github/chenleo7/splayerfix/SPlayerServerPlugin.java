package io.github.chenleo7.splayerfix;

import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.core.view.ViewCompat;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.SSLException;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "SPlayerServer")
public final class SPlayerServerPlugin extends Plugin {

    private static final String PREFERENCES_NAME = "splayer_server";
    private static final String SERVER_URL_KEY = "server_url";
    private static final int CONNECT_TIMEOUT_MS = 6000;
    private static final int MAX_REDIRECTS = 5;
    private static final int MOBILE_API_VERSION = 1;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private static final class ServerException extends Exception {

        final String code;

        ServerException(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    private static final class ProbeResult {

        final String originalUrl;
        final String resolvedUrl;
        final int mobileApiVersion;

        ProbeResult(String originalUrl, String resolvedUrl, int mobileApiVersion) {
            this.originalUrl = originalUrl;
            this.resolvedUrl = resolvedUrl;
            this.mobileApiVersion = mobileApiVersion;
        }

        JSObject toJsObject() {
            JSObject result = new JSObject();
            result.put("url", originalUrl);
            result.put("resolvedUrl", resolvedUrl);
            result.put("mobileApiVersion", mobileApiVersion);
            return result;
        }
    }

    private static final class RestrictedWebViewClient extends BridgeWebViewClient {

        private final Set<String> allowedOrigins;

        RestrictedWebViewClient(Bridge bridge, Set<String> allowedOrigins) {
            super(bridge);
            this.allowedOrigins = allowedOrigins;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            if (request.isForMainFrame() && allowedOrigins.contains(originOf(request.getUrl()))) {
                return false;
            }
            return super.shouldOverrideUrlLoading(view, request);
        }

        @Override
        public void onPageCommitVisible(WebView view, String url) {
            super.onPageCommitVisible(view, url);
            ViewCompat.requestApplyInsets(view.getRootView());
        }

        private static String originOf(Uri uri) {
            StringBuilder origin = new StringBuilder();
            origin.append(uri.getScheme()).append("://").append(uri.getHost());
            if (uri.getPort() != -1) origin.append(":").append(uri.getPort());
            return origin.toString();
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES_NAME, 0);
    }

    @PluginMethod
    public void getServer(PluginCall call) {
        JSObject result = new JSObject();
        String url = preferences().getString(SERVER_URL_KEY, null);
        result.put("url", url == null || url.trim().isEmpty() ? JSONObject.NULL : url);
        call.resolve(result);
    }

    @PluginMethod
    public void testServer(PluginCall call) {
        String input = call.getString("url");
        executor.execute(() -> {
            try {
                call.resolve(probe(input).toJsObject());
            } catch (ServerException error) {
                call.reject(error.getMessage(), error.code);
            } catch (SSLException error) {
                call.reject("TLS 证书验证失败", "TLS_ERROR", error);
            } catch (SocketTimeoutException error) {
                call.reject("连接服务器超时", "TIMEOUT", error);
            } catch (UnknownHostException error) {
                call.reject("无法解析服务器地址", "DNS_ERROR", error);
            } catch (IOException error) {
                call.reject("无法连接服务器", "NETWORK_ERROR", error);
            } catch (JSONException error) {
                call.reject("服务器响应格式无效", "INVALID_RESPONSE", error);
            }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String input = call.getString("url");
        JSArray pluginHeaders = call.getArray("pluginHeaders");
        if (pluginHeaders == null) {
            call.reject("缺少 Capacitor 插件信息", "BRIDGE_ERROR");
            return;
        }
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            call.reject("Android System WebView 版本过低", "WEBVIEW_UNSUPPORTED");
            return;
        }
        executor.execute(() -> {
            try {
                ProbeResult probeResult = probe(input);
                String bridgeScript = createBridgeScript(
                    probeResult.resolvedUrl,
                    pluginHeaders.toString()
                );
                preferences().edit().putString(SERVER_URL_KEY, probeResult.originalUrl).apply();
                call.resolve(probeResult.toJsObject());
                mainHandler.post(() -> openServer(probeResult, bridgeScript));
            } catch (ServerException error) {
                call.reject(error.getMessage(), error.code);
            } catch (SSLException error) {
                call.reject("TLS 证书验证失败", "TLS_ERROR", error);
            } catch (SocketTimeoutException error) {
                call.reject("连接服务器超时", "TIMEOUT", error);
            } catch (UnknownHostException error) {
                call.reject("无法解析服务器地址", "DNS_ERROR", error);
            } catch (IOException error) {
                call.reject("无法连接服务器", "NETWORK_ERROR", error);
            } catch (JSONException error) {
                call.reject("服务器响应格式无效", "INVALID_RESPONSE", error);
            }
        });
    }

    @PluginMethod
    public void clearServer(PluginCall call) {
        preferences().edit().remove(SERVER_URL_KEY).apply();
        call.resolve();
    }

    private void openServer(ProbeResult probeResult, String bridgeScript) {
        Set<String> allowedOrigins = new HashSet<>();
        allowedOrigins.add(probeResult.originalUrl);
        allowedOrigins.add(probeResult.resolvedUrl);

        WebView webView = getBridge().getWebView();
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, bridgeScript, allowedOrigins);
        } else {
            android.util.Log.e("SPlayerServer", "当前 WebView 不支持文档启动脚本");
            return;
        }
        getBridge().setWebViewClient(new RestrictedWebViewClient(getBridge(), allowedOrigins));
        webView.clearHistory();
        webView.loadUrl(probeResult.resolvedUrl);
        mainHandler.postDelayed(() -> getBridge().getWebView().clearHistory(), 2000);
    }

    private String createBridgeScript(String serverUrl, String pluginHeaders) throws IOException {
        StringBuilder script = new StringBuilder();
        script.append("window.WEBVIEW_SERVER_URL=").append(JSONObject.quote(serverUrl)).append(";");
        script.append("window.Capacitor=window.Capacitor||{};");
        script.append("window.Capacitor.Plugins=window.Capacitor.Plugins||{};");
        script.append("window.Capacitor.PluginHeaders=").append(pluginHeaders).append(";");
        try (
            InputStream input = getContext().getAssets().open("native-bridge.js");
            InputStreamReader reader = new InputStreamReader(input, StandardCharsets.UTF_8)
        ) {
            char[] buffer = new char[8192];
            int count;
            while ((count = reader.read(buffer)) != -1) script.append(buffer, 0, count);
        }
        return script.toString();
    }

    private ProbeResult probe(String input) throws ServerException, IOException, JSONException {
        String originalUrl = normalizeServerUrl(input);
        URL currentUrl = new URL(originalUrl + "/api/splayer/health");
        boolean secureEntry = currentUrl.getProtocol().equals("https");

        for (int redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
            HttpURLConnection connection = (HttpURLConnection) currentUrl.openConnection();
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(CONNECT_TIMEOUT_MS);
            connection.setInstanceFollowRedirects(false);
            connection.setRequestMethod("GET");
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "SPlayer-Android");

            try {
                int statusCode = connection.getResponseCode();
                if (isRedirect(statusCode)) {
                    if (redirectCount == MAX_REDIRECTS) {
                        throw new ServerException("TOO_MANY_REDIRECTS", "服务器重定向次数过多");
                    }
                    String location = connection.getHeaderField("Location");
                    if (location == null || location.trim().isEmpty()) {
                        throw new ServerException("INVALID_REDIRECT", "服务器返回了无效重定向");
                    }
                    URL nextUrl = new URL(currentUrl, location);
                    String protocol = nextUrl.getProtocol().toLowerCase(Locale.ROOT);
                    if (!protocol.equals("http") && !protocol.equals("https")) {
                        throw new ServerException("INVALID_REDIRECT", "服务器重定向协议不受支持");
                    }
                    if (secureEntry && protocol.equals("http")) {
                        throw new ServerException("INSECURE_REDIRECT", "HTTPS 服务不能重定向到 HTTP");
                    }
                    currentUrl = nextUrl;
                    continue;
                }
                if (statusCode != HttpURLConnection.HTTP_OK) {
                    throw new ServerException(
                        "HTTP_ERROR",
                        "服务器健康检查返回 HTTP " + statusCode
                    );
                }

                String responseBody = readResponse(connection);
                JSONObject response = new JSONObject(responseBody);
                if (!"SPlayer".equals(response.optString("name")) || !"ok".equals(response.optString("status"))) {
                    throw new ServerException("NOT_SPLAYER", "目标地址不是 SPlayer 服务");
                }
                int apiVersion = response.optInt("mobileApiVersion", -1);
                if (apiVersion != MOBILE_API_VERSION) {
                    throw new ServerException("INCOMPATIBLE_VERSION", "服务端版本与当前 App 不兼容");
                }
                return new ProbeResult(originalUrl, originOf(currentUrl), apiVersion);
            } finally {
                connection.disconnect();
            }
        }

        throw new ServerException("TOO_MANY_REDIRECTS", "服务器重定向次数过多");
    }

    private static String normalizeServerUrl(String input) throws ServerException {
        if (input == null || input.trim().isEmpty()) {
            throw new ServerException("INVALID_URL", "请输入服务器地址");
        }
        try {
            URI uri = new URI(input.trim());
            String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
            if (!scheme.equals("http") && !scheme.equals("https")) {
                throw new ServerException("INVALID_URL", "服务器地址必须以 http:// 或 https:// 开头");
            }
            if (uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
                throw new ServerException("INVALID_URL", "服务器地址格式无效");
            }
            String path = uri.getPath();
            if (path != null && !path.isEmpty() && !path.equals("/")) {
                throw new ServerException("INVALID_URL", "服务器地址不能包含路径");
            }
            return new URI(scheme, null, uri.getHost(), uri.getPort(), null, null, null).toASCIIString();
        } catch (URISyntaxException error) {
            throw new ServerException("INVALID_URL", "服务器地址格式无效");
        }
    }

    private static String originOf(URL url) throws ServerException {
        try {
            return new URI(
                url.getProtocol(),
                null,
                url.getHost(),
                url.getPort(),
                null,
                null,
                null
            ).toASCIIString();
        } catch (URISyntaxException error) {
            throw new ServerException("INVALID_REDIRECT", "重定向地址格式无效");
        }
    }

    private static String readResponse(HttpURLConnection connection) throws IOException {
        StringBuilder content = new StringBuilder();
        try (
            BufferedReader reader = new BufferedReader(
                new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8)
            )
        ) {
            String line;
            while ((line = reader.readLine()) != null) {
                content.append(line);
                if (content.length() > 16 * 1024) throw new IOException("响应内容过大");
            }
        }
        return content.toString();
    }

    private static boolean isRedirect(int statusCode) {
        return statusCode == HttpURLConnection.HTTP_MOVED_PERM ||
        statusCode == HttpURLConnection.HTTP_MOVED_TEMP ||
        statusCode == HttpURLConnection.HTTP_SEE_OTHER ||
        statusCode == 307 ||
        statusCode == 308;
    }

    @Override
    protected void handleOnDestroy() {
        executor.shutdownNow();
        mainHandler.removeCallbacksAndMessages(null);
        super.handleOnDestroy();
    }
}
