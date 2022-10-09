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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newStage: async function(w: number, h: number, ex: any) {
        // Send a message to the host
        postMessage({c: "newStage", w, h, ex});

        // Wait for a response
        return (await awaitReply("newStage")).id;
    },

    loadSpritesheet: async function(stageId: string, desc: unknown) {
        postMessage({c: "loadSpritesheet", s: stageId, d: desc});
        return (await awaitReply("loadSpritesheet", {p: (<any> desc).prefix})).id;
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
                {
                    // Make a fresh EYC instance
                    eyc = await EYC.eyc();
                    eyc.ext = eycExtWorker;

                    // Load the requested URL
                    const emodule = await eyc.importModule(msg.url);

                    // Create an instance of the main class
                    if (emodule.main) {
                        const main = new eyc.Object("main");
                        main.extend(emodule.main.klass.prefix);
                        main.methods.$$core$Program$init(eyc, main, eyc.nil);
                    }
                    break;
                }

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
