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

// Promises for any commands we're waiting for
let replies: Record<string, (val: any) => unknown> = {};

// An ext for web workers
const eycExtWorker: types.EYCExt = {
    fetch: async function(url: string) {
        url = (settings.local ? "." : "https:/") + url;
        return fetch(url).then(async response => {
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
        const r = await new Promise<{id: string}>(res => replies.newStage = res);
        return r.id;
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
                        replies[msg.c](msg);
                        delete replies[msg.c];
                    } else {
                        console.error("Unrecognized command " + msg.c);
                    }
            }

        } catch (ex) {
            console.error(ex);

        }
    });
};
