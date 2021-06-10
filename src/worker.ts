// Polyfill
import "whatwg-fetch";

import * as EYC from "./impl";
import * as types from "./types";

// An ext for web workers
const eycExtWorker: types.EYCExt = {
    fetch: async function(url: string) {
        return fetch("https:/" + url).then(response => {
            if (response.status !== 200)
                throw new Error("Status code " + response.status);
            return response.text();
        });
    },

    newStage: async function(w: number, h: number, ex: any) {
        // nothing!
        return "-";
    }
};

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
