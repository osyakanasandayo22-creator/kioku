/**
 * 説明トグル（電球コード）— MIT: tuggable-light-bulb-gsap-draggable-morphsvg/LICENSE.txt
 * 依存: gsap, MorphSVGPlugin, Draggable（index.html で先に読み込む）
 */
(function () {
  "use strict";

  const BULB_SVG_URL = new URL("description-bulb.svg", document.baseURI).href;

  function loadClickSound() {
    const a = new Audio("https://assets.codepen.io/605876/click.mp3");
    a.volume = 0.35;
    try {
      a.preload = "auto";
      a.load();
    } catch {
      // ignore
    }
    return a;
  }

  /** モーフSVGはモバイルで重いので、軽い演出に切り替える */
  function shouldUseLiteCord() {
    try {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return true;
      if (window.matchMedia("(pointer: coarse)").matches) return true;
      if (window.matchMedia("(max-width: 768px)").matches) return true;
    } catch {
      // ignore
    }
    return false;
  }

  /**
   * @returns {Promise<{ destroy: () => void, setOn: (v: boolean) => void }>}
   */
  window.initDescriptionBulb = function initDescriptionBulb(wrapEl, options) {
    const { initialOn = false, onChange = () => {} } = options || {};
    const host = wrapEl && wrapEl.querySelector && wrapEl.querySelector(".descToggleBulbHost");
    if (!host) {
      return Promise.resolve({ destroy: () => {}, setOn: () => {} });
    }

    const g = typeof window.gsap !== "undefined" ? window.gsap : null;
    const MorphSVGPlugin = window.MorphSVGPlugin;
    const Draggable =
      typeof window.Draggable !== "undefined"
        ? window.Draggable
        : g && g.Draggable
          ? g.Draggable
          : null;

    if (!g || !MorphSVGPlugin || !Draggable) {
      return Promise.reject(new Error("gsap plugins missing"));
    }

    const { registerPlugin, set, to, timeline } = g;
    if (!window.__descBulbMorphRegistered) {
      registerPlugin(MorphSVGPlugin);
      window.__descBulbMorphRegistered = true;
    }
    try {
      registerPlugin(Draggable);
    } catch {
      // 既に登録済みの場合など
    }

    return fetch(BULB_SVG_URL, { credentials: "same-origin" })
      .then((res) => {
        if (!res.ok) throw new Error("svg");
        return res.text();
      })
      .then((svgText) => {
        let CORDS;
        let HIT;
        let DUMMY;
        let DUMMY_CORD;
        let CORD_TL;
        let dragArr;

        try {
        host.innerHTML = svgText;

        CORDS = host.querySelectorAll(".toggle-scene__cord");
        HIT = host.querySelector(".toggle-scene__hit-spot");
        DUMMY = host.querySelector(".toggle-scene__dummy-cord");
        DUMMY_CORD = host.querySelector(".toggle-scene__dummy-cord line");
        if (!CORDS.length || !HIT || !DUMMY || !DUMMY_CORD) {
          throw new Error("svg structure");
        }

        const ENDX = DUMMY_CORD.getAttribute("x2");
        const ENDY = DUMMY_CORD.getAttribute("y2");
        const PROXY = document.createElement("div");
        const useLiteCord = shouldUseLiteCord();

        const RESET = () => {
          set(PROXY, { x: ENDX, y: ENDY });
        };
        RESET();

        const STATE = { ON: !!initialOn };
        set(wrapEl, { "--on": STATE.ON ? 1 : 0 });

        let startX;
        let startY;
        const CORD_DURATION = 0.1;

        let clickSound;
        try {
          clickSound = loadClickSound();
        } catch {
          clickSound = null;
        }

        CORD_TL = timeline({
          paused: true,
          onStart: () => {
            set([DUMMY, HIT], { display: "none" });
            set(CORDS[0], { display: "block" });
          },
          onComplete: () => {
            set([DUMMY, HIT], { display: "block" });
            set(CORDS[0], { display: "none" });
            RESET();
          },
        });

        for (let i = 1; i < CORDS.length; i++) {
          CORD_TL.add(
            to(CORDS[0], {
              morphSVG: CORDS[i],
              duration: CORD_DURATION,
              repeat: 1,
              yoyo: true,
            })
          );
        }

        function playToggleFeedback() {
          STATE.ON = !STATE.ON;
          set(wrapEl, { "--on": STATE.ON ? 1 : 0 });
          try {
            onChange(STATE.ON);
          } catch {
            // ignore
          }
          if (clickSound) {
            try {
              clickSound.currentTime = 0;
            } catch {
              // ignore
            }
            clickSound.play().catch(() => {});
          }
        }

        function runLiteToggleAnim() {
          g.killTweensOf(host);
          set(host, { transformOrigin: "50% 35%" });
          to(host, {
            scale: 0.97,
            duration: 0.07,
            ease: "power2.out",
            yoyo: true,
            repeat: 1,
            force3D: true,
          });
        }

        dragArr = Draggable.create(PROXY, {
          trigger: HIT,
          type: "x,y",
          onPress: (e) => {
            startX = e.x;
            startY = e.y;
          },
          onDrag: function () {
            set(DUMMY_CORD, {
              attr: { x2: this.x, y2: this.y },
            });
          },
          onRelease: function (e) {
            const DISTX = Math.abs(e.x - startX);
            const DISTY = Math.abs(e.y - startY);
            const TRAVELLED = Math.sqrt(DISTX * DISTX + DISTY * DISTY);
            if (TRAVELLED > 50) {
              playToggleFeedback();
              to(DUMMY_CORD, {
                attr: { x2: ENDX, y2: ENDY },
                duration: CORD_DURATION,
                onComplete: () => {
                  if (useLiteCord) {
                    runLiteToggleAnim();
                    RESET();
                  } else {
                    CORD_TL.restart();
                  }
                },
              });
            } else {
              to(DUMMY_CORD, {
                attr: { x2: ENDX, y2: ENDY },
                duration: CORD_DURATION,
                onComplete: () => RESET(),
              });
            }
          },
        });

        function destroy() {
          try {
            g.killTweensOf(host);
          } catch {
            // ignore
          }
          try {
            if (dragArr && dragArr[0]) dragArr[0].kill();
          } catch {
            // ignore
          }
          try {
            CORD_TL.kill();
          } catch {
            // ignore
          }
          host.innerHTML = "";
        }

        function setOn(v) {
          const next = !!v;
          if (STATE.ON === next) return;
          STATE.ON = next;
          set(wrapEl, { "--on": STATE.ON ? 1 : 0 });
        }

        return { destroy, setOn };
        } catch (err) {
          host.innerHTML = "";
          throw err;
        }
      });
  };
})();
