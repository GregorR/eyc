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

// Lexicographic base-64 digits
const lexToB64 =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz|~".split("");
const lexFromB64 = (function() {
    const ret = Object.create(null);
    for (let i = 0; i < lexToB64.length; i++)
        ret[lexToB64[i]] = i;
    return ret;
})();

// Lexicographic base-64
export function lexNumToB64(x: number): string {
    function part(x: number): string {
        if (x === 0) return "";
        return part(Math.trunc(x/64)) + lexToB64[Math.abs(x%64)];
    }

    if (x === 0) return "0";
    return part(x);
}

export function lexB64ToNum(p: string): number {
    let ret = 0;
    for (const c of p) {
        ret *= 64;
        ret += lexFromB64[c];
    }
    return ret;
}

// Convert a number to a string that will lexicographically sort correctly
export function numToLexString(x: number): string {
    let out = "";

    let neg = false;
    let ts64 = (x: number) => lexNumToB64(x);

    // 0: Special numbers
    if (x !== x) {
        return "zz1";
    } else if (!Number.isFinite(x)) {
        if (x > 0)
            return "zz0";
        else
            return "-000";
    } else if (x === 0) {
        /* This is a special case because of 0 vs -0. The below algorithm would
         * always return "010", which is why we only treat -0 specially in the
         * reverse */
        if (1/x > 0)
            return "010";
        else
            return "-2g}";
    }

    // 1: Negatives
    if (x < 0) {
        out += "-";
        neg = true;
        ts64 = (x) => {
            return lexNumToB64(x).split("").map(c => lexToB64[63-lexFromB64[c]]).join("");
        };
    }

    // 2: Whole part
    let f = Math.trunc(x);
    const fs = ts64(f);
    let fl = fs.length;
    // 171 is maximum length of a 64-bit float's positive part in base-64
    if (neg) fl = 171-fl;
    const fls = lexNumToB64(fl).padStart(2, "0");
    out += fls + fs;
    x -= f;

    // 3: Fractional part
    if (x) out += ".";
    while (x) {
        x *= 64;
        f = Math.trunc(x);
        x -= f;
        out += ts64(f);
    }

    return out;
}

// Convert a lexicographically-sortable string back to a number
export function lexStringToNum(p: string): number {
    let out = 0;

    let fs64 = (x: string) => lexB64ToNum(x);

    // 0: Special cases
    if (p === "zz1")
        return 0/0;
    else if (p === "zz0")
        return 1/0;
    else if (p === "-000")
        return -1/0;
    else if (p === "-2g}")
        return -0;

    // 1: Negation
    if (p[0] === "-") {
        p = p.slice(1);
        fs64 = x => {
            return -lexB64ToNum(x.split("").map((c: string) => lexToB64[63-lexFromB64[c]]).join(""));
        };
    }

    // 2: Fractional part
    if (p.indexOf(".") >= 0) {
        // eslint-disable-next-line no-useless-escape
        const parts = /^([^\.]*)\.(.*)$/.exec(p);
        p = parts[1];
        let exp = parts[2];
        while (exp.length) {
            const d = exp.slice(-1);
            exp = exp.slice(0, -1);
            out += fs64(d);
            out /= 64;
        }
    }

    // 3: Whole part
    out += fs64(p.slice(2));

    return out;
}
