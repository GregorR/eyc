// The presence of any-typed PIXI here makes this check unhelpful
/* eslint-disable @typescript-eslint/no-explicit-any */

// extern
declare let PIXI: any;

let pixiApp: any = null;

// Check for mandatory features
if (typeof HTMLCanvasElement === "undefined" ||
    typeof Worker === "undefined") {
    alert("Your browser does not support mandatory features.");
    throw new Error;
}

// Decide whether to use the advanced mode based on JS features
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const useAdvanced = (function() {
    try {
        Function("async function x() { for (let x of []) {} }");
        return true;
    } catch (ex) {
        return false;
    }
})();

function loadingScreen(opts: any = {}) {
    opts.bg = opts.bg || {};

    // Loading "screen"
    document.body.innerHTML = "";
    Object.assign(document.body.style, {
        margin: "0",
        background: opts.bg.background || 'url("data:image/gif;base64,R0lGODlhBAAEAPEAAAA0PQAxOQA3QAAAACH5BAAAAAAALAAAAAAEAAQAAAIHlGECu+FRAAA7") repeat #a0a0ff'
    });
    const loading = document.createElement("div");
    Object.assign(loading.style, {
        position: "fixed",
        top: "50%",
        left: "0",
        width: "100%",
        textAlign: "center",
        transform: "translate(0, -50%)",
        color: opts.bg.color || '#fea',
        textShadow: opts.bg.shadow || "-2px -2px 0 black, 2px -2px 0 black, -2px 2px 0 black, 2px 2px black, 0.1em 0.1em 0 #01B3FE",
        fontSize: "2rem"
    });
    loading.innerText = "Loading...";
    document.body.appendChild(loading);
}

/* Load the Pixi.JS application with the given options, and make its view front
 * and center */
async function loadPixiApp(opts: any = {}) {
    // Load PIXI
    if (typeof PIXI === "undefined") {
        // Load it first
        const scr = document.createElement("script");
        scr.async = scr.defer = true;
        scr.src = "https://unpkg.com/pixi.js@^6.0.4/dist/browser/pixi.min.js";

        await new Promise((res, rej) => {
            scr.onload = res;
            scr.onerror = rej;
            document.body.appendChild(scr);
        });
    }

    PIXI.settings.SCALE_MODE = PIXI.SCALE_MODES.NEAREST;

    const app = new PIXI.Application({width: opts.w || 1920, height: opts.h || 1080});

    function centerView() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const x: any = {
            position: "fixed"
        };
        if (w/h > 16/9) {
            const iw = Math.round(h*16/9);
            x.width = iw + "px";
            x.height = h + "px";
            x.left = Math.round((w - iw) / 2) + "px";
            x.top = "0";
        } else {
            const ih = Math.round(w*9/16);
            x.width = w + "px";
            x.height = ih + "px";
            x.left = "0";
            x.top = Math.round((h - ih) / 2) + "px";
        }
        Object.assign(app.view.style, x);
    }
    centerView();
    window.addEventListener("resize", centerView);

    document.body.innerHTML = "";
    document.body.appendChild(app.view);
    pixiApp = app;
}

export async function go(): Promise<void> {
    loadingScreen();

    const w = new Worker("eyc-w" + (useAdvanced?"-dbg":"") + ".js");
    const id = 0;

    w.onmessage = ev => {
        const msg = ev.data;
        switch (msg.c) {
            default:
                console.error("Unrecognized command " + msg.c);
        }
    };

    w.postMessage({c: "setting", k: "local", v: true});
    w.postMessage({c: "go", url: "/eatyourcontroller.com/test"});
    /*
    await loadPixiApp();
    const loader = PIXI.Loader.shared;
    await new Promise(res => loader.add("images/cat.png").load(res));
    loader.resources["images/cat.png"].texture.baseTexture.scaleMode = PIXI.SCALE_MODES.NEAREST;
    const sprite = new PIXI.Sprite(loader.resources["images/cat.png"].texture);
    pixiApp.stage.addChild(sprite);
    sprite.x = 42;
    sprite.y = 42;
    sprite.scale.set(4);
    */
}
