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

// Polyfill
import "whatwg-fetch";

import * as EYC from "./impl";
import * as types from "./types";


const settings = {
    local: true
};
let eyc: types.EYC = null;

// How we filter replies
interface ReplyFilter {
    pattern: any;
    action: (val: any) => unknown;
}

// Promises for any commands we're waiting for
let replies: Record<string, ReplyFilter[]> = Object.create(null);

// Wait for a reply with this pattern
async function awaitReply(c: string, pattern: any = {}): Promise<any> {
    if (!(c in replies))
        replies[c] = [];
    let action: (val: any) => unknown = null;
    const p = new Promise(res => action = res);
    replies[c].push({pattern, action});
    return await p;
}

// An ext for web workers
const eycExtWorker: types.EYCExt = {
    fetch: async function(url: string) {
        url = (settings.local ? "." : "https:/") + url;
        console.log(`Loading ${url}`);
        // FIXME: Do caching smarter
        return fetch(url, {cache: "reload"}).then(async response => {
            if (response.status !== 200)
                throw new Error("Status code " + response.status);
            return response.text();
        });
    },

    frame: async function() {
        postMessage({c: "frame"});
        await awaitReply("frame");
    },

    input: async function() {
        postMessage({c: "input"});
        return (await awaitReply("input")).i;
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newStage: async function(w: number, h: number, ex: any) {
        // Send a message to the host
        postMessage({c: "newStage", w, h, ex});

        // Wait for a response
        return (await awaitReply("newStage")).id;
    },

    loadSpritesheet: async function(desc: unknown) {
        postMessage({c: "loadSpritesheet", d: desc});
        return (await awaitReply("loadSpritesheet", {p: (<any> desc).prefix})).id;
    },

    addSprite: async function(
        stageId: string, spritesheet: string, sprite: string, x: number,
        y: number, z: number, ex: any
    ) {
        postMessage({
            c: "addSprite", st: stageId, ss: spritesheet, s: sprite, x, y, z,
            ex
        });
        return (await awaitReply("addSprite", {
            st: stageId, ss: spritesheet, s: sprite
        })).id;
    },

    updateSprite: async function(
        stageId: string, id: string, spritesheet: string, sprite: string
    ) {
        postMessage({
            c: "updateSprite", st: stageId, id, ss: spritesheet, s: sprite
        });
        return (await awaitReply("updateSprite", {
            st: stageId, id
        })).id;
    },

    moveSprite: async function(
        stageId: string, sprite: string, x: number, y: number
    ) {
        postMessage({
            c: "moveSprite", st: stageId, s: sprite, x, y
        });
        return (await awaitReply("moveSprite", {
            st: stageId, s: sprite
        })).s;
    },

    mirrorSprite: async function(
        stageId: string, sprite: string, mirror: boolean, vertical: boolean
    ) {
        postMessage({
            c: "mirrorSprite", st: stageId, s: sprite, m: +mirror, v: +vertical
        });
        return (await awaitReply("mirrorSprite", {
            st: stageId, s: sprite
        })).s;
    }
};

// Global ordering promise
let p: Promise<unknown> = Promise.all([]);

onmessage = function(ev) {
    p = p.then(async function() {
        const msg = ev.data;
        try {
            switch (msg.c) {
                case "setting":
                    settings[msg.k] = msg.v;
                    break;

                case "go":
                    // Make a fresh EYC instance
                    eyc = await EYC.eyc();
                    eyc.ext = eycExtWorker;

                    // And go
                    eyc.go(msg.url);
                    break;

                default:
                    if (replies[msg.c]) {
                        // Check for a match
                        const ra = replies[msg.c];
                        for (let ri = 0; ri < ra.length; ri++) {
                            const r = ra[ri];
                            const p = r.pattern;

                            // Make sure the pattern matches
                            let match = true;
                            for (const k in p) {
                                if (p[k] !== msg[k]) {
                                    match = false;
                                    break;
                                }
                            }
                            if (!match)
                                continue;

                            // Pattern matches, so use this one
                            ra.splice(ri, 1);
                            r.action(msg);
                            break;
                        }
                        if (ra.length === 0)
                            delete replies[msg.c];
                    } else {
                        console.error("Unrecognized command " + msg.c);
                    }
            }

        } catch (ex) {
            console.error(ex + "\n" + ex.stack);

        }
    });
};
