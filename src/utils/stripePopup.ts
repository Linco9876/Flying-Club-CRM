export const writeStripeLoadingPage = (
  popup: Window,
  options: {
    title: string;
    message: string;
  }
) => {
  popup.document.title = options.title;
  popup.document.body.innerHTML = `
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background:
          radial-gradient(circle at 20% 15%, rgba(59, 130, 246, 0.18), transparent 28rem),
          radial-gradient(circle at 85% 80%, rgba(245, 158, 11, 0.16), transparent 24rem),
          linear-gradient(135deg, #f8fafc 0%, #eef4ff 48%, #fff7ed 100%);
        color: #0f172a;
      }
      .shell {
        width: min(92vw, 430px);
        padding: 30px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 28px;
        background: rgba(255, 255, 255, 0.88);
        box-shadow: 0 24px 70px rgba(15, 23, 42, 0.16);
        text-align: center;
        backdrop-filter: blur(14px);
      }
      .mark {
        width: 64px;
        height: 64px;
        margin: 0 auto 18px;
        display: grid;
        place-items: center;
        border-radius: 22px;
        background: linear-gradient(135deg, #1d4ed8, #0f172a);
        color: #ffffff;
        font-weight: 800;
        letter-spacing: 0.02em;
        box-shadow: 0 16px 34px rgba(29, 78, 216, 0.3);
      }
      h1 {
        margin: 0;
        font-size: 24px;
        line-height: 1.2;
      }
      p {
        margin: 12px 0 0;
        color: #475569;
        font-size: 15px;
        line-height: 1.55;
      }
      .loader {
        width: 42px;
        height: 42px;
        margin: 24px auto 0;
        border-radius: 999px;
        border: 4px solid #dbeafe;
        border-top-color: #2563eb;
        animation: spin 0.8s linear infinite;
      }
      .footnote {
        margin-top: 20px;
        color: #64748b;
        font-size: 12px;
      }
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
    </style>
    <main class="shell" role="status" aria-live="polite">
      <div class="mark">BFC</div>
      <h1>${options.title}</h1>
      <p>${options.message}</p>
      <div class="loader" aria-hidden="true"></div>
      <div class="footnote">You will be redirected to Stripe in a moment.</div>
    </main>
  `;
};
