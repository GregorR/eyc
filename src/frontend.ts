// SPDX-License-Identifier: ISC
/*
 * Copyright (c) 2020-2022 Gregor Richards
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
 * REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
 * INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
 * LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
 * OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
 * PERFORMANCE OF THIS SOFTWARE.
 */

// The presence of any-typed PIXI here makes this check unhelpful
/* eslint-disable @typescript-eslint/no-explicit-any */

// extern
declare let PIXI: any;

let pixiApp: any = null;
let pixiProps = {
    scale: 64
};

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

    const app = new PIXI.Application({
        width: opts.w || 1920,
        height: opts.h || 1080
    });

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
    let loader = null;

    let frontendPromise: Promise<unknown> = Promise.all([]);
    const spritesheetTextures: Record<string, string> = Object.create(null);
    const spritesheetDatas: Record<string, any> = Object.create(null);
    const spritesheets: Record<string, any> = Object.create(null);
    let spritesheetIdx = 0;
    const sprites: Record<string, any> = Object.create(null);
    let spriteIdx = 0;

    w.onmessage = async ev => {
        const msg = ev.data;
        switch (msg.c) {
            case "newStage":
            {
                // Figure out the scaling
                const scW = Math.ceil(window.screen.width / msg.w);
                const scH = Math.ceil(window.screen.height / msg.h);
                const scale = Math.max(scW, scH) * window.devicePixelRatio;

                // Create the PIXI app. We (currently?) only support one stage.
                frontendPromise = frontendPromise.then(async () => {
                    await loadPixiApp({w: msg.w * scale, h: msg.h * scale});
                });
                await frontendPromise;
                loader = PIXI.Loader.shared;
                pixiProps.scale = scale;

                // Tell them it's ready
                w.postMessage({c: "newStage", id: "stage0"});
                break;
            }

            case "loadSpritesheet":
            {
                // PIXI must have already been loaded!
                const url = msg.d.url;
                frontendPromise = frontendPromise.then(async () => {
                    await new Promise(res => loader.add(url).load(res));
                });
                await frontendPromise;
                const rsc = loader.resources[url];
                const bt = rsc.texture.baseTexture;
                bt.scaleMode = PIXI.SCALE_MODES.NEAREST;
                const id = `spritesheet${spritesheetIdx++}`;
                spritesheetTextures[id] = url;

                // Convert the spritesheet data into the form that PIXI expects
                const data = spritesheetDatas[id] = {
                    meta: {
                        image: url,
                        format: "RGBA8888", //bt.format,
                        size: { w: bt.width, h: bt.height },
                        scale: 1
                    },
                    frames: {},
                    animations: {}
                };
                const sprites = msg.d.sprites;
                for (let key in sprites) {
                    const props = sprites[key];
                    props.x *= props.scale;
                    props.y *= props.scale;
                    props.w *= props.scale;
                    props.h *= props.scale;
                    data.frames[key] = {
                        scale: props.scale,
                        frame: {
                            x: props.x, y: props.y,
                            w: props.w, h: props.h,
                        }
                    };
                    //data.animations[key] = [key];
                }
                const pss = spritesheets[id] = new PIXI.Spritesheet(bt, data);

                frontendPromise = frontendPromise.then(async () => {
                    await new Promise(res => pss.parse(res));
                });
                await frontendPromise;

                w.postMessage({c: "loadSpritesheet", p: msg.d.prefix, id});
                break;
            }

            case "addSprite":
            {
                let id = "";
                do {
                    // Load the parts
                    if (!pixiApp)
                        break;
                    const ss = spritesheets[msg.ss];
                    if (!ss)
                        break;
                    const ssd = spritesheetDatas[msg.ss];
                    if (!ssd)
                        break;
                    if (!ss.textures[msg.s] || !ssd.frames[msg.s])
                        break;

                    // Create the sprite
                    id = `sprite${spriteIdx++}`;
                    const sprite = sprites[id] =
                        new PIXI.Sprite(ss.textures[msg.s]);
                    pixiApp.stage.addChild(sprite);
                    sprite.scale.set(pixiProps.scale / ssd.frames[msg.s].scale);
                    sprite.x = msg.x * pixiProps.scale;
                    sprite.y = msg.y * pixiProps.scale;
                } while (false);

                // Inform the user
                w.postMessage({
                    c: "addSprite", st: msg.st, ss: msg.ss, s: msg.s, id});
                break;
            }

            case "moveSprite":
                do {
                    const sprite = sprites[msg.s];
                    if (!sprite)
                        break;
                    sprite.x = msg.x * pixiProps.scale;
                    sprite.y = msg.y * pixiProps.scale;
                } while (false);

                w.postMessage({
                    c: "moveSprite", st: msg.st, s: msg.s});
                break;

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
