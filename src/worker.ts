// Polyfill
import "whatwg-fetch";

import * as EYC from "./impl";
import * as types from "./types";

let eyc: types.EYC = null;

let p: Promise<unknown> = Promise.all([]);

onmessage = function(ev) {
    p = p.then(async function() {
        const msg = ev.data;
        switch (msg.c) {
            default:
                console.error("Unrecognized command " + msg.c);
        }
    });
};
