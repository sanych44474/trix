package app.trix.android;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.annotation.SuppressLint;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.net.http.SslError;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.NoCredentialException;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import org.json.JSONObject;
import java.util.concurrent.Executor;

public final class MainActivity extends ComponentActivity {
    private static final String KEY_WORKER_ORIGIN = "worker_origin";
    private final int background = Color.rgb(11, 13, 17);
    private final int panel = Color.rgb(23, 27, 34);
    private final int accent = Color.rgb(168, 255, 70);
    private final int primaryText = Color.rgb(243, 245, 248);
    private final int mutedText = Color.rgb(159, 166, 177);
    private String workerOrigin;
    private WebView webView;
    private EditText originInput;
    private TextView status;
    private ValueCallback<Uri[]> fileCallback;
    private ActivityResultLauncher<Intent> filePicker;
    private boolean googleSignInPending;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        filePicker = registerForActivityResult(new ActivityResultContracts.StartActivityForResult(), result -> {
            if (fileCallback == null) return;
            Uri[] selected = WebChromeClient.FileChooserParams.parseResult(result.getResultCode(), result.getData());
            fileCallback.onReceiveValue(selected);
            fileCallback = null;
        });
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() {
                if (webView != null && webView.canGoBack()) webView.goBack();
                else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                }
            }
        });
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat systemBars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        systemBars.setAppearanceLightStatusBars(false);
        systemBars.setAppearanceLightNavigationBars(false);
        WebView.setWebContentsDebuggingEnabled((getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0);
        workerOrigin = getPreferences(MODE_PRIVATE).getString(KEY_WORKER_ORIGIN, null);
        if (workerOrigin == null) showOriginSetup(""); else showApp();
    }

    private void showOriginSetup(String value) {
        destroyWebView();
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER_VERTICAL);
        content.setPadding(dp(24), dp(28), dp(24), dp(28));
        content.setBackgroundColor(background);

        TextView mark = new TextView(this);
        mark.setText("T"); mark.setTextSize(23); mark.setTextColor(background);
        mark.setGravity(Gravity.CENTER); mark.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        mark.setBackground(rounded(accent, 16));
        content.addView(mark, new LinearLayout.LayoutParams(dp(48), dp(48)));
        TextView title = label(getString(R.string.hero_title), 32, primaryText, true);
        title.setPadding(0, dp(28), 0, dp(10)); content.addView(title);
        TextView description = label(getString(R.string.origin_body), 15, mutedText, false);
        description.setLineSpacing(dp(4), 1f); content.addView(description);

        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL); card.setPadding(dp(18), dp(18), dp(18), dp(18));
        card.setBackground(rounded(panel, 20));
        LinearLayout.LayoutParams cardParams = new LinearLayout.LayoutParams(-1, -2);
        cardParams.topMargin = dp(24); content.addView(card, cardParams);
        card.addView(label(getString(R.string.origin_title), 17, primaryText, true));
        originInput = new EditText(this);
        originInput.setHint(getString(R.string.origin_hint)); originInput.setSingleLine(true);
        originInput.setTextSize(16); originInput.setTextColor(primaryText);
        originInput.setHintTextColor(Color.rgb(112, 120, 132));
        originInput.setPadding(dp(14), 0, dp(14), 0);
        originInput.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI);
        originInput.setBackground(rounded(Color.rgb(31, 36, 45), 12));
        originInput.setText(value);
        LinearLayout.LayoutParams inputParams = new LinearLayout.LayoutParams(-1, dp(52));
        inputParams.topMargin = dp(14); card.addView(originInput, inputParams);
        status = label("", 13, Color.rgb(255, 137, 137), false);
        status.setVisibility(View.GONE); status.setPadding(0, dp(8), 0, 0); card.addView(status);

        Button button = new Button(this);
        button.setText(getString(R.string.open_button)); button.setTextSize(15); button.setAllCaps(false);
        button.setTextColor(background); button.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        button.setBackground(rounded(accent, 14)); button.setOnClickListener(view -> saveOrigin());
        LinearLayout.LayoutParams buttonParams = new LinearLayout.LayoutParams(-1, dp(54));
        buttonParams.topMargin = dp(16); card.addView(button, buttonParams);

        TextView note = label(getString(R.string.footer_note), 13, mutedText, false);
        note.setPadding(dp(2), dp(18), dp(2), 0); note.setLineSpacing(dp(3), 1f); content.addView(note);
        setContentView(content);
        applyInsets(content);
    }

    private void saveOrigin() {
        String raw = originInput.getText().toString().trim();
        Uri uri;
        try { uri = Uri.parse(raw); } catch (RuntimeException error) { uri = null; }
        if (uri == null || !"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null ||
                uri.getUserInfo() != null || (uri.getPath() != null && !uri.getPath().isEmpty() && !"/".equals(uri.getPath())) ||
                uri.getQuery() != null || uri.getFragment() != null) {
            status.setText(getString(R.string.invalid_origin)); status.setVisibility(View.VISIBLE); return;
        }
        String host = uri.getHost().toLowerCase(java.util.Locale.ROOT);
        int port = uri.getPort();
        workerOrigin = "https://" + host + (port > 0 && port != 443 ? ":" + port : "");
        getPreferences(MODE_PRIVATE).edit().putString(KEY_WORKER_ORIGIN, workerOrigin).apply();
        showApp();
    }

    // The first-party web app requires JavaScript; navigation and native callbacks are origin-checked.
    @SuppressLint("SetJavaScriptEnabled")
    private void showApp() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(background);
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL); toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(dp(14), 0, dp(8), 0); toolbar.setBackgroundColor(background);
        TextView brand = label("trix", 18, primaryText, true);
        toolbar.addView(brand, new LinearLayout.LayoutParams(0, dp(52), 1));
        Button refresh = toolbarButton("↻"); refresh.setContentDescription(getString(R.string.refresh));
        refresh.setOnClickListener(view -> { if (webView != null) webView.reload(); });
        toolbar.addView(refresh, new LinearLayout.LayoutParams(dp(48), dp(48)));
        Button change = toolbarButton("⋮"); change.setContentDescription(getString(R.string.change_server));
        change.setOnClickListener(view -> showOriginSetup(workerOrigin));
        toolbar.addView(change, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(toolbar);

        webView = new WebView(this);
        webView.setBackgroundColor(background);
        WebSettings settings = webView.getSettings();
        settings.setUserAgentString(settings.getUserAgentString() + " TrixAndroid");
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.setSafeBrowsingEnabled(true);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri target = request.getUrl();
                if (handleNativeUrl(target)) return true;
                if (isTrusted(target)) return false;
                openExternal(target);
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                Uri target = Uri.parse(url);
                if (handleNativeUrl(target)) return true;
                if (isTrusted(target)) return false;
                openExternal(target);
                return true;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); }
            @Override public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                if (view != webView) return true;
                destroyWebView();
                Toast.makeText(MainActivity.this, R.string.webview_recovering, Toast.LENGTH_SHORT).show();
                showApp();
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try { filePicker.launch(params.createIntent()); }
                catch (ActivityNotFoundException | SecurityException error) { fileCallback = null; callback.onReceiveValue(null); return true; }
                return true;
            }
        });
        if (WebViewFeature.isFeatureSupported(WebViewFeature.START_SAFE_BROWSING)) {
            WebViewCompat.startSafeBrowsing(this, ignored -> {});
        }
        root.addView(webView, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(root);
        applyInsets(root);
        webView.loadUrl(workerOrigin + "/app-v2/");
    }

    private boolean isTrusted(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null || uri.getHost() == null) return false;
        Uri trusted = Uri.parse(workerOrigin);
        int targetPort = uri.getPort() < 0 ? 443 : uri.getPort();
        int trustedPort = trusted.getPort() < 0 ? 443 : trusted.getPort();
        return uri.getHost().equalsIgnoreCase(trusted.getHost()) && targetPort == trustedPort;
    }

    private boolean handleNativeUrl(Uri uri) {
        if (!"trix-auth".equalsIgnoreCase(uri.getScheme())) return false;
        if (webView == null || webView.getUrl() == null || !isTrustedAppPage(Uri.parse(webView.getUrl()))) return true;
        if ("google".equalsIgnoreCase(uri.getHost())) {
            startGoogleSignIn(uri.getQueryParameter("clientId"), uri.getQueryParameter("nonce"));
            return true;
        }
        if ("open".equalsIgnoreCase(uri.getHost())) {
            Uri target = Uri.parse(uri.getQueryParameter("url") == null ? "" : uri.getQueryParameter("url"));
            String host = target.getHost();
            if ("https".equalsIgnoreCase(target.getScheme()) && ("t.me".equalsIgnoreCase(host) || "telegram.me".equalsIgnoreCase(host))) openExternal(target);
            return true;
        }
        return true;
    }

    private boolean isTrustedAppPage(Uri uri) {
        if (!isTrusted(uri)) return false;
        String path = uri.getPath();
        return "/app-v2".equals(path) || (path != null && path.startsWith("/app-v2/"));
    }

    private void startGoogleSignIn(String clientId, String nonce) {
        if (googleSignInPending) return;
        if (clientId == null || !clientId.matches("[A-Za-z0-9._-]{10,220}\\.apps\\.googleusercontent\\.com") ||
                nonce == null || !nonce.matches("[0-9a-f]{64}")) {
            dispatchGoogleAuthError("failed");
            return;
        }
        googleSignInPending = true;
        GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(clientId)
                .setNonce(nonce)
                .build();
        GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
        Executor mainExecutor = command -> new Handler(Looper.getMainLooper()).post(command);
        try {
            CredentialManager.create(this).getCredentialAsync(this, request, null, mainExecutor,
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override public void onResult(GetCredentialResponse response) {
                            googleSignInPending = false;
                            Credential credential = response.getCredential();
                            if (credential instanceof CustomCredential &&
                                    GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                                try {
                                    GoogleIdTokenCredential google = GoogleIdTokenCredential.createFrom(credential.getData());
                                    dispatchGoogleIdToken(google.getIdToken());
                                } catch (RuntimeException error) { dispatchGoogleAuthError("failed"); }
                            } else dispatchGoogleAuthError("failed");
                        }
                        @Override public void onError(GetCredentialException error) {
                            googleSignInPending = false;
                            if (error instanceof GetCredentialCancellationException) {
                                dispatchGoogleAuthError("cancelled");
                            } else if (error instanceof NoCredentialException) {
                                dispatchGoogleAuthError("no-credential");
                            } else {
                                dispatchGoogleAuthError("failed");
                            }
                        }
                    });
        } catch (RuntimeException error) {
            googleSignInPending = false;
            dispatchGoogleAuthError("failed");
        }
    }

    private void dispatchGoogleIdToken(String idToken) {
        if (webView == null || webView.getUrl() == null || !isTrustedAppPage(Uri.parse(webView.getUrl()))) return;
        webView.evaluateJavascript("window.__trixGoogleAuthCallback && window.__trixGoogleAuthCallback({idToken:" + JSONObject.quote(idToken) + "})", null);
    }

    private void dispatchGoogleAuthError(String code) {
        if (webView == null || webView.getUrl() == null || !isTrustedAppPage(Uri.parse(webView.getUrl()))) return;
        webView.evaluateJavascript("window.__trixGoogleAuthCallback && window.__trixGoogleAuthCallback({error:" + JSONObject.quote(code) + "})", null);
    }

    private void openExternal(Uri uri) {
        if (!"https".equalsIgnoreCase(uri.getScheme()) && !"http".equalsIgnoreCase(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
        catch (ActivityNotFoundException ignored) { Toast.makeText(this, R.string.external_unavailable, Toast.LENGTH_SHORT).show(); }
    }

    private Button toolbarButton(String text) {
        Button button = new Button(this); button.setText(text); button.setTextSize(22); button.setAllCaps(false);
        button.setTextColor(primaryText); button.setBackgroundColor(Color.TRANSPARENT); return button;
    }

    private void destroyWebView() {
        if (webView == null) return;
        WebView old = webView;
        webView = null;
        old.stopLoading();
        if (old.getParent() instanceof ViewGroup) ((ViewGroup) old.getParent()).removeView(old);
        old.destroy();
    }

    private void applyInsets(View view) {
        int left = view.getPaddingLeft();
        int baseTop = view.getPaddingTop();
        int right = view.getPaddingRight();
        int baseBottom = view.getPaddingBottom();
        view.setOnApplyWindowInsetsListener((target, insets) -> {
            int topInset; int bottomInset;
            Insets bars = WindowInsetsCompat.toWindowInsetsCompat(insets, view)
                    .getInsets(WindowInsetsCompat.Type.systemBars());
            topInset = bars.top;
            bottomInset = bars.bottom;
            target.setPadding(left, baseTop + topInset, right, baseBottom + bottomInset); return insets;
        });
        view.requestApplyInsets();
    }

    @Override protected void onPause() {
        if (webView != null) { webView.onPause(); CookieManager.getInstance().flush(); }
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null); fileCallback = null; }
        destroyWebView();
        super.onDestroy();
    }

    private TextView label(String text, float size, int color, boolean bold) {
        TextView view = new TextView(this); view.setText(text); view.setTextSize(size); view.setTextColor(color);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD); return view;
    }

    private GradientDrawable rounded(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable(); drawable.setColor(color); drawable.setCornerRadius(dp(radius)); return drawable;
    }

    private int dp(int value) { return (int) (value * getResources().getDisplayMetrics().density); }
}
