"use client";

/** The last resort: the root layout itself failed, so this brings its own document and plain paper styling. */
export default function GlobalError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" data-theme="light">
      <body style={{ margin: 0, minHeight: "100dvh", display: "grid", placeItems: "center", background: "#F4ECDD", color: "#17140F", font: "400 1rem/1.5 system-ui, sans-serif", padding: 24 }}>
        <div role="alert" style={{ maxWidth: 420 }}>
          <h1 style={{ font: "560 1.563rem/1.15 Georgia, serif", margin: "0 0 8px" }}>The press jammed.</h1>
          <p style={{ margin: "0 0 16px" }}>Something broke on our side. Your stubs are safe on this device.</p>
          <button type="button" onClick={() => retry()} style={{ font: "inherit", padding: "12px 20px", border: "1px solid #17140F", borderRadius: 12, background: "#E4572E", color: "#17140F", cursor: "pointer" }}>
            Try again
          </button>{" "}
          {/* a plain anchor: the framework's Link needs the app shell this boundary replaces */}
          <a href="/make" style={{ marginLeft: 12 }}>Make a stub</a> · <a href="/wall">Wall</a> · <a href="/help">Help</a>
        </div>
      </body>
    </html>
  );
}
