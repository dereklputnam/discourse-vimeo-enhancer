import { withPluginApi } from "discourse/lib/plugin-api";

export default {
  name: "vimeo-enhancer",

  initialize() {
    withPluginApi("1.0.0", (api) => {
      // State for the mini player
      let activeIframe = null;
      let miniPlayerEl = null;

      // --- Vimeo postMessage bridge ---
      // Tells us when a video starts or stops playing so we know
      // whether to show the mini player on navigation.
      window.addEventListener("message", (event) => {
        if (!event.origin.includes("vimeo.com")) {
          return;
        }

        let data;
        try {
          data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        } catch {
          return;
        }

        if (data.event === "play") {
          // Find which iframe sent this message
          document.querySelectorAll('iframe[src*="player.vimeo.com"]').forEach((iframe) => {
            if (iframe.contentWindow === event.source) {
              activeIframe = iframe;
            }
          });
        } else if (data.event === "pause" || data.event === "ended") {
          if (event.source === activeIframe?.contentWindow) {
            activeIframe = null;
          }
        }
      });

      // --- Post decoration ---
      // Runs on every cooked post element. Tightens spacing around Vimeo iframes
      // and sets up postMessage communication for play/pause tracking.
      // We use JS here instead of CSS :has() because :has() with attribute selectors
      // is unreliable across Discourse's CSS pipeline.
      api.decorateCookedElement(
        (element) => {
          element.querySelectorAll('iframe[src*="player.vimeo.com"]').forEach((iframe) => {
            // Tighten margin on the element immediately before the iframe
            const prev = iframe.previousElementSibling;
            if (prev) {
              prev.style.marginBottom = "0.4em";
            }

            // Tighten margin on the element immediately after the iframe
            const next = iframe.nextElementSibling;
            if (next) {
              next.style.marginTop = "0.4em";
            }

            // Add api=1 to the iframe src so Vimeo sends postMessage events
            try {
              const url = new URL(iframe.src);
              if (!url.searchParams.has("api")) {
                url.searchParams.set("api", "1");
                iframe.src = url.toString();
              }
            } catch {
              // malformed src — skip
            }

            // Register event listeners once the iframe has loaded
            const setupListeners = () => {
              iframe.contentWindow?.postMessage(
                JSON.stringify({ method: "addEventListener", value: "play" }),
                "https://player.vimeo.com"
              );
              iframe.contentWindow?.postMessage(
                JSON.stringify({ method: "addEventListener", value: "pause" }),
                "https://player.vimeo.com"
              );
              iframe.contentWindow?.postMessage(
                JSON.stringify({ method: "addEventListener", value: "ended" }),
                "https://player.vimeo.com"
              );
            };

            if (iframe.contentDocument?.readyState === "complete") {
              setupListeners();
            } else {
              iframe.addEventListener("load", setupListeners, { once: true });
            }
          });
        },
        { onlyStream: true }
      );

      // --- Mini player on navigation ---
      // routeWillChange fires BEFORE Discourse unmounts the current route,
      // giving us time to move the iframe to a persistent overlay on document.body.
      // Moving an iframe in the DOM does not reload it in modern browsers.
      if (settings.mini_player_enabled) {
        const router = api.container.lookup("router:main");

        router.on("routeWillChange", () => {
          if (!activeIframe || miniPlayerEl) {
            return;
          }

          // Get the video title from the iframe's title attribute
          const title = activeIframe.title || "Vimeo Video";

          // Build the mini player wrapper
          miniPlayerEl = document.createElement("div");
          miniPlayerEl.className = "vimeo-mini-player";

          const videoSlot = document.createElement("div");
          videoSlot.className = "vimeo-mini-player__video";
          videoSlot.appendChild(activeIframe); // Move (not clone) — preserves playback

          const bar = document.createElement("div");
          bar.className = "vimeo-mini-player__bar";

          const titleEl = document.createElement("span");
          titleEl.className = "vimeo-mini-player__title";
          titleEl.textContent = title;

          const closeBtn = document.createElement("button");
          closeBtn.className = "vimeo-mini-player__close";
          closeBtn.setAttribute("aria-label", "Close mini player");
          closeBtn.textContent = "✕";
          closeBtn.addEventListener("click", () => {
            // Pause the video and remove the mini player
            activeIframe?.contentWindow?.postMessage(
              JSON.stringify({ method: "pause" }),
              "https://player.vimeo.com"
            );
            miniPlayerEl.remove();
            miniPlayerEl = null;
            activeIframe = null;
          });

          bar.appendChild(titleEl);
          bar.appendChild(closeBtn);
          miniPlayerEl.appendChild(videoSlot);
          miniPlayerEl.appendChild(bar);
          document.body.appendChild(miniPlayerEl);
        });

        // Clean up mini player when the user navigates back to the same topic
        // or when they manually close it
        api.onPageChange(() => {
          if (!miniPlayerEl) {
            return;
          }

          // If a Vimeo iframe now exists in the post stream, the user is back
          // on a video topic — dismiss the mini player (the post has its own embed)
          const streamHasVimeo = document.querySelector(
            ".topic-post iframe[src*='player.vimeo.com']"
          );
          if (streamHasVimeo) {
            miniPlayerEl.remove();
            miniPlayerEl = null;
            activeIframe = null;
          }
        });
      }
    });
  },
};
