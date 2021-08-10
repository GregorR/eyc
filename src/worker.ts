// Polyfill
import "whatwg-fetch";

import * as EYC from "./impl";
import * as types from "./types";


const settings = {
    local: false
};
let eyc: types.EYC = null;

// An ext for web workers
const eycExtWorker: types.EYCExt = {
    fetch: async function(url: string) {
        url = (settings.local ? "." : "https:/") + url;
        return fetch(url).then(response => {
            if (response.status !== 200)
                throw new Error("Status code " + response.status);
            return response.text();
        });
    },

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    newStage: async function(w: number, h: number, ex: any) {
        // nothing!
        void w; void h; void ex;
        return "-";
    }
};

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

                    // Load the requested URL
                    eyc.importModule(msg.url);
                    break;

                default:
                    console.error("Unrecognized command " + msg.c);
            }

        } catch (ex) {
            console.error(ex);

        }
    });
};
