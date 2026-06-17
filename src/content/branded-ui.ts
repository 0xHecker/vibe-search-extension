// Branded shadow-DOM UI for in-page feedback: toast notifications and screenshot region selector.
// Uses the app's design tokens (cream/amber surface, red accent, Neutral Sans + Metal serif).

const TOKENS = {
  bg: "#ffffff",
  bgAmber: "#fffef8",
  border: "#c6c6c6",
  borderFaded: "#f3f3f3",
  accent: "#ff4d4d",
  accentFaded: "#ffe5e5",
  text: "#212121",
  textSecondary: "#787878",
  textMuted: "#d4d4d4",
  shadow: "0px 20px 35px rgba(15, 23, 42, 0.18)",
  radius: "10px",
  radiusSm: "6px",
  fontSans: '"Neutral Sans", ui-sans-serif, system-ui, sans-serif',
  fontSerif: '"Metal", ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
};

type ToastAction = { label: string; onClick: () => void };

export const showToast = (params: {
  message: string;
  actions?: ToastAction[];
  duration?: number;
}) => {
  const rootId = "__vibesearch_toast_root__";
  let root = document.getElementById(rootId);
  if (!root) {
    root = document.createElement("div");
    root.id = rootId;
    const shadow = root.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    container.id = "container";
    Object.assign(container.style, {
      position: "fixed",
      right: "16px",
      bottom: "16px",
      zIndex: "2147483647",
      display: "flex",
      flexDirection: "column",
      gap: "10px",
      pointerEvents: "none",
      fontFamily: TOKENS.fontSans,
    });
    shadow.appendChild(container);
    document.documentElement.appendChild(root);
  }

  const shadow = root.shadowRoot!;
  const container = shadow.getElementById("container")!;

  const toast = document.createElement("div");
  Object.assign(toast.style, {
    maxWidth: "380px",
    minWidth: "280px",
    padding: "12px 14px",
    borderRadius: TOKENS.radius,
    background: TOKENS.bg,
    border: `1px solid ${TOKENS.border}`,
    boxShadow: TOKENS.shadow,
    display: "flex",
    alignItems: "center",
    gap: "12px",
    pointerEvents: "auto",
    fontSize: "13px",
    lineHeight: "1.4",
    color: TOKENS.text,
    fontFamily: TOKENS.fontSans,
  });

  const messageEl = document.createElement("div");
  messageEl.textContent = params.message;
  Object.assign(messageEl.style, {
    flex: "1",
    fontWeight: "500",
  });
  toast.appendChild(messageEl);

  if (params.actions) {
    const actionsRow = document.createElement("div");
    Object.assign(actionsRow.style, {
      display: "flex",
      gap: "8px",
      alignItems: "center",
    });

    for (const action of params.actions) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = action.label;
      Object.assign(btn.style, {
        padding: "5px 10px",
        borderRadius: TOKENS.radiusSm,
        border: `1px solid ${TOKENS.accent}`,
        background: "transparent",
        color: TOKENS.accent,
        fontSize: "12px",
        fontWeight: "600",
        cursor: "pointer",
        fontFamily: TOKENS.fontSans,
        transition: "all 150ms",
      });
      btn.addEventListener("mouseenter", () => {
        btn.style.background = TOKENS.accentFaded;
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.background = "transparent";
      });
      btn.addEventListener("click", () => {
        action.onClick();
        toast.remove();
        if (container.childElementCount === 0) root!.remove();
      });
      actionsRow.appendChild(btn);
    }

    toast.appendChild(actionsRow);
  }

  container.appendChild(toast);

  const duration = params.duration ?? 4000;
  if (duration > 0) {
    setTimeout(() => {
      toast.remove();
      if (container.childElementCount === 0) root!.remove();
    }, duration);
  }
};

export type ScreenshotRegionSelection = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};

export const selectScreenshotRegion = (): Promise<ScreenshotRegionSelection | null> => {
  return new Promise((resolve) => {
    const rootId = "__vibesearch_screenshot_selector__";
    const existing = document.getElementById(rootId);
    if (existing) existing.remove();

    const root = document.createElement("div");
    root.id = rootId;
    const shadow = root.attachShadow({ mode: "open" });

    // Scrim
    const scrim = document.createElement("div");
    Object.assign(scrim.style, {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      background: "rgba(0, 0, 0, 0.4)",
      zIndex: "2147483646",
      cursor: "crosshair",
    });

    // Selection box
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      border: `2px solid ${TOKENS.accent}`,
      background: "rgba(255, 77, 77, 0.08)",
      pointerEvents: "none",
      display: "none",
      zIndex: "2147483647",
    });

    // Hint
    const hint = document.createElement("div");
    hint.textContent = "Drag to select • Enter to save • Esc to cancel";
    Object.assign(hint.style, {
      position: "fixed",
      top: "20px",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "10px 16px",
      borderRadius: TOKENS.radius,
      background: TOKENS.bg,
      border: `1px solid ${TOKENS.border}`,
      boxShadow: TOKENS.shadow,
      fontSize: "13px",
      fontWeight: "500",
      color: TOKENS.text,
      fontFamily: TOKENS.fontSans,
      zIndex: "2147483647",
      pointerEvents: "none",
    });

    shadow.appendChild(scrim);
    shadow.appendChild(box);
    shadow.appendChild(hint);
    document.documentElement.appendChild(root);

    let startX = 0;
    let startY = 0;
    let isDragging = false;

    const cleanup = (selection: ScreenshotRegionSelection | null) => {
      window.removeEventListener("keydown", onKeyDown, true);
      root.remove();
      resolve(selection);
    };

    const onMouseDown = (e: MouseEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      isDragging = true;
      box.style.display = "block";
      box.style.left = `${startX}px`;
      box.style.top = `${startY}px`;
      box.style.width = "0";
      box.style.height = "0";
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const width = Math.abs(e.clientX - startX);
      const height = Math.abs(e.clientY - startY);
      box.style.left = `${x}px`;
      box.style.top = `${y}px`;
      box.style.width = `${width}px`;
      box.style.height = `${height}px`;
    };

    const onMouseUp = (e: MouseEvent) => {
      if (!isDragging) return;
      isDragging = false;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const width = Math.abs(e.clientX - startX);
      const height = Math.abs(e.clientY - startY);
      if (width > 10 && height > 10) {
        cleanup({
          x,
          y,
          width,
          height,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        });
      } else {
        box.style.display = "none";
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
      } else if (e.key === "Enter" && box.style.display === "block") {
        e.preventDefault();
        const x = parseInt(box.style.left, 10);
        const y = parseInt(box.style.top, 10);
        const width = parseInt(box.style.width, 10);
        const height = parseInt(box.style.height, 10);
        if (width > 10 && height > 10) {
          cleanup({
            x,
            y,
            width,
            height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          });
        }
      }
    };

    scrim.addEventListener("mousedown", onMouseDown);
    scrim.addEventListener("mousemove", onMouseMove);
    scrim.addEventListener("mouseup", onMouseUp);
    window.addEventListener("keydown", onKeyDown, true);
  });
};
